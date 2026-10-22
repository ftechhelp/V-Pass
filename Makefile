# V-Pass developer tasks. Run `make help` for a list.
APP_ID      := vpass
APP_DIR     := nextcloud-app
VERSION     := $(shell sed -n 's:.*<version>\(.*\)</version>.*:\1:p' $(APP_DIR)/appinfo/info.xml)
BUILD_DIR   := build
COMPOSE     := docker compose -f dev/docker-compose.yml
PHP_IMAGE   := composer:2
OCC         := $(COMPOSE) exec -T -u www-data nextcloud php occ
IOS_KIT     := ios/VPassKit
SWIFT_IMAGE := vpass-swift
SWIFT       := docker run --rm -u $$(id -u):$$(id -g) -e HOME=/tmp -v $(CURDIR)/$(IOS_KIT):/pkg -w /pkg $(SWIFT_IMAGE)

.PHONY: help install build dev test typecheck lint-php test-php dev-up dev-upgrade dev-down dev-reset dev-logs test-api e2e zk-check appstore extension extension-zip test-extension e2e-extension store-images vectors-ios ios-kit-image test-ios-kit test-ios-interop clean

help: ## Show this help
	@grep -E '^[a-z0-9-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install JS and PHP dev dependencies
	npm ci
	docker run --rm -u $$(id -u):$$(id -g) -v $(CURDIR)/$(APP_DIR):/app -w /app $(PHP_IMAGE) install --no-interaction

build: ## Production build of the web app (js/)
	npm run build

dev: ## Rebuild the web app on every change
	npm run dev

test: ## Unit tests for @vpass/core (crypto, importers, tools)
	npm test

typecheck: ## Typecheck core and the Vue app
	npm run typecheck

lint-php: ## php -l every PHP file (in Docker)
	docker run --rm -v $(CURDIR)/$(APP_DIR):/app -w /app $(PHP_IMAGE) sh -c "find lib tests -name '*.php' -print0 | xargs -0 -n1 php -l > /dev/null && echo 'PHP syntax OK'"

test-php: ## PHP unit tests (in Docker)
	docker run --rm -v $(CURDIR)/$(APP_DIR):/app -w /app $(PHP_IMAGE) vendor/bin/phpunit -c tests/phpunit.xml

.PHONY: test-runtime
test-runtime: ## Require the fixed PHP runtime in the running dev container
	sh dev/check-php-runtime.sh

dev-up: build ## Start Nextcloud 35 on http://localhost:8080 with V-Pass enabled
	$(COMPOSE) up -d
	./dev/setup.sh

dev-upgrade: ## Run occ upgrade on the dev instance (needed after bumping the app version)
	$(OCC) upgrade

dev-down: ## Stop the dev containers (data is kept)
	$(COMPOSE) down

dev-reset: ## Stop and DELETE all dev data
	$(COMPOSE) down -v

dev-logs: ## Tail the Nextcloud log
	$(COMPOSE) exec nextcloud tail -f /var/www/html/data/nextcloud.log

test-api: ## API integration tests against the dev instance
	npm run test:api

e2e: ## Browser end-to-end tests against the dev instance
	npm run e2e

zk-check: ## Prove the server stores no plaintext (needs a populated dev instance)
	./e2e/zero-knowledge-check.sh

extension: ## Build the Chrome extension into browser-extension/dist (load it unpacked)
	npm run build:extension

extension-zip: extension ## Package the extension: build/vpass-extension-<version>.zip (Chrome Web Store) + the web app's download copy
	node browser-extension/scripts/package.js

test-extension: ## Extension unit tests: field detection, filling, save prompts, sender checks
	npm run test:extension

e2e-extension: extension-zip ## Extension end-to-end tests in Chromium against the dev instance
	npm run e2e:extension

store-images: extension ## Regenerate the Chrome Web Store screenshots in browser-extension/store/images (needs dev-up)
	VPASS_STORE_IMAGES=1 npx playwright test -c e2e/playwright.extension.config.ts store-images

appstore: build extension-zip ## Package build/vpass-<version>.tar.gz for installing on a server (includes the extension download)
	rm -rf $(BUILD_DIR)/$(APP_ID)
	mkdir -p $(BUILD_DIR)/$(APP_ID)
	cp -r $(APP_DIR)/appinfo $(APP_DIR)/img $(APP_DIR)/js $(APP_DIR)/lib $(APP_DIR)/templates $(APP_DIR)/extension $(BUILD_DIR)/$(APP_ID)/
	find $(BUILD_DIR)/$(APP_ID)/js -name '*.map' -delete
	tar -czf $(BUILD_DIR)/$(APP_ID)-$(VERSION).tar.gz -C $(BUILD_DIR) $(APP_ID)
	@echo "Created $(BUILD_DIR)/$(APP_ID)-$(VERSION).tar.gz"

vectors-ios: ## Regenerate the Swift port's test vectors (and its EFF word list) from @vpass/core
	npm run vectors:ios

ios-kit-image: ## Build the Docker image with Swift + libsodium used for VPassKit's Linux tests
	docker build -q -t $(SWIFT_IMAGE) $(IOS_KIT)

test-ios-kit: ios-kit-image ## VPassKit (the iPhone app's crypto/API core) unit + vector tests, in Docker
	$(SWIFT) swift test

test-ios-interop: ios-kit-image ## The Swift client against the dev instance, checked by @vpass/core (needs dev-up)
	npx vitest run -c e2e/vitest.ios.config.ts

clean: ## Remove build output
	rm -rf $(BUILD_DIR) $(APP_DIR)/js $(APP_DIR)/extension browser-extension/dist
