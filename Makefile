# V-Pass developer tasks. Run `make help` for a list.
APP_ID      := vpass
APP_DIR     := nextcloud-app
VERSION     := $(shell sed -n 's:.*<version>\(.*\)</version>.*:\1:p' $(APP_DIR)/appinfo/info.xml)
BUILD_DIR   := build
COMPOSE     := docker compose -f dev/docker-compose.yml
PHP_IMAGE   := composer:2
OCC         := $(COMPOSE) exec -T -u www-data nextcloud php occ

.PHONY: help install build dev test typecheck lint-php test-php dev-up dev-down dev-reset dev-logs test-api e2e zk-check appstore clean

help: ## Show this help
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

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

dev-up: build ## Start Nextcloud 35 on http://localhost:8080 with V-Pass enabled
	$(COMPOSE) up -d
	./dev/setup.sh

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

appstore: build ## Package build/vpass-<version>.tar.gz for installing on a server
	rm -rf $(BUILD_DIR)/$(APP_ID)
	mkdir -p $(BUILD_DIR)/$(APP_ID)
	cp -r $(APP_DIR)/appinfo $(APP_DIR)/img $(APP_DIR)/js $(APP_DIR)/lib $(APP_DIR)/templates $(BUILD_DIR)/$(APP_ID)/
	find $(BUILD_DIR)/$(APP_ID)/js -name '*.map' -delete
	tar -czf $(BUILD_DIR)/$(APP_ID)-$(VERSION).tar.gz -C $(BUILD_DIR) $(APP_ID)
	@echo "Created $(BUILD_DIR)/$(APP_ID)-$(VERSION).tar.gz"

clean: ## Remove build output
	rm -rf $(BUILD_DIR) $(APP_DIR)/js
