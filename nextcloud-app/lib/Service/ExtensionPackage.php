<?php

declare(strict_types=1);

namespace OCA\VPass\Service;

/**
 * The browser extension zip bundled with the app (`extension/`, written by
 * `make extension-zip` and shipped by `make appstore`). The web app's
 * "Browser extension" page offers it for download until the Chrome Web Store
 * listing exists. Missing in development checkouts that never packaged it.
 */
class ExtensionPackage {
	public function __construct(
		private string $directory = __DIR__ . '/../../extension',
	) {
	}

	public function version(): ?string {
		$json = @file_get_contents($this->directory . '/extension.json');
		if ($json === false || $this->zipPath() === null) {
			return null;
		}
		$version = json_decode($json, true)['version'] ?? null;
		// Chrome extension versions: 1 to 4 dot-separated integers.
		return is_string($version) && preg_match('/^\d{1,9}(\.\d{1,9}){0,3}$/', $version) === 1 ? $version : null;
	}

	public function zipPath(): ?string {
		$path = $this->directory . '/vpass-extension.zip';
		return is_file($path) ? $path : null;
	}
}
