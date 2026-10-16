<?php

declare(strict_types=1);

namespace OCA\VPass\Tests\Unit\Service;

use OCA\VPass\Service\ExtensionPackage;
use PHPUnit\Framework\TestCase;

class ExtensionPackageTest extends TestCase {
	private string $dir;

	protected function setUp(): void {
		$this->dir = sys_get_temp_dir() . '/vpass-ext-' . bin2hex(random_bytes(4));
		mkdir($this->dir);
	}

	protected function tearDown(): void {
		array_map('unlink', glob($this->dir . '/*') ?: []);
		rmdir($this->dir);
	}

	public function testMissingPackage(): void {
		$package = new ExtensionPackage($this->dir);
		$this->assertNull($package->zipPath());
		$this->assertNull($package->version());
	}

	public function testReadsVersionOnlyWithZip(): void {
		file_put_contents($this->dir . '/extension.json', '{"version":"0.2.1"}');
		$package = new ExtensionPackage($this->dir);
		$this->assertNull($package->version());

		file_put_contents($this->dir . '/vpass-extension.zip', 'PK');
		$this->assertSame('0.2.1', $package->version());
		$this->assertSame($this->dir . '/vpass-extension.zip', $package->zipPath());
	}

	public function testRejectsMalformedVersions(): void {
		file_put_contents($this->dir . '/vpass-extension.zip', 'PK');
		foreach (['"1.2.3.4.5"', '"v1"', '"1.2.3; rm -rf"', '12', 'null'] as $value) {
			file_put_contents($this->dir . '/extension.json', '{"version":' . $value . '}');
			$this->assertNull((new ExtensionPackage($this->dir))->version(), $value);
		}
	}
}
