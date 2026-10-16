<?php

declare(strict_types=1);

namespace OCA\VPass\Settings;

use OCA\VPass\AppInfo\Application;
use OCA\VPass\Service\SettingsService;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\Settings\ISettings;
use OCP\Util;

/** Shown under Administration settings → Security. */
class Admin implements ISettings {
	public function __construct(
		private SettingsService $settings,
		private IInitialState $initialState,
	) {
	}

	public function getForm(): TemplateResponse {
		Util::addScript(Application::APP_ID, 'vpass-admin');
		$this->initialState->provideInitialState('admin-settings', $this->settings->toArray());
		return new TemplateResponse(Application::APP_ID, 'admin', [], '');
	}

	public function getSection(): string {
		return 'security';
	}

	public function getPriority(): int {
		return 80;
	}
}
