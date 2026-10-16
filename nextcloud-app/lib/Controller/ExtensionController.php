<?php

declare(strict_types=1);

namespace OCA\VPass\Controller;

use OCA\VPass\AppInfo\Application;
use OCA\VPass\Service\ExtensionPackage;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\FrontpageRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\NotFoundResponse;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\Http\StreamResponse;
use OCP\IRequest;

class ExtensionController extends Controller {
	public function __construct(
		IRequest $request,
		private ExtensionPackage $package,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/** The bundled browser extension, for manual ("load unpacked") installs. Logged-in users only. */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[FrontpageRoute(verb: 'GET', url: '/extension/download')]
	public function download(): Response {
		$path = $this->package->zipPath();
		$version = $this->package->version();
		if ($path === null || $version === null) {
			return new NotFoundResponse();
		}
		$response = new StreamResponse(fopen($path, 'rb'));
		$response->addHeader('Content-Type', 'application/zip');
		$response->addHeader('Content-Length', (string)filesize($path));
		$response->addHeader('Content-Disposition', 'attachment; filename="vpass-extension-' . $version . '.zip"');
		$response->addHeader('Cache-Control', 'private, no-cache');
		return $response;
	}
}
