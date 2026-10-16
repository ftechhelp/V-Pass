<?php

declare(strict_types=1);

namespace OCA\VPass\Controller;

use OCA\VPass\AppInfo\Application;
use OCA\VPass\Service\ExtensionPackage;
use OCA\VPass\Service\SettingsService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\FrontpageRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\IRequest;
use OCP\Util;

class PageController extends Controller {
	public function __construct(
		IRequest $request,
		private IInitialState $initialState,
		private SettingsService $settings,
		private ExtensionPackage $extension,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[FrontpageRoute(verb: 'GET', url: '/')]
	public function index(): TemplateResponse {
		Util::addScript(Application::APP_ID, 'vpass-main');
		$this->initialState->provideInitialState('config', [
			'hibpEnabled' => $this->settings->hibpEnabled(),
			'maxAttachmentBytes' => $this->settings->maxAttachmentBytes(),
			'trashRetentionDays' => $this->settings->trashRetentionDays(),
			// Version of the browser extension this server offers for download (null: none bundled).
			'extensionVersion' => $this->extension->version(),
		]);

		$response = new TemplateResponse(Application::APP_ID, 'main');
		// libsodium (Argon2id, XChaCha20) runs as WebAssembly. This allows WASM
		// compilation only — JavaScript eval() stays forbidden.
		$csp = new ContentSecurityPolicy();
		$csp->allowEvalWasm(true);
		$response->setContentSecurityPolicy($csp);
		return $response;
	}
}
