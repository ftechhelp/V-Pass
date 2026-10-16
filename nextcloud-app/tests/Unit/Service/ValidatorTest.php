<?php

declare(strict_types=1);

namespace OCA\VPass\Tests\Unit\Service;

use OCA\VPass\Exception\ValidationException;
use OCA\VPass\Service\Validator;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class ValidatorTest extends TestCase {
	private const ENVELOPE = '1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.c2VjcmV0LWNpcGhlcnRleHQ';

	public function testAcceptsWellFormedValues(): void {
		$this->assertSame('6f1c5a4e-9a2b-4c3d-8e9f-0a1b2c3d4e5f', Validator::uuid('6f1c5a4e-9a2b-4c3d-8e9f-0a1b2c3d4e5f'));
		$this->assertSame(self::ENVELOPE, Validator::envelope(self::ENVELOPE, 'data', 1000));
		$this->assertSame(['id' => '6f1c5a4e-9a2b-4c3d-8e9f-0a1b2c3d4e5f', 'wrappedKey' => self::ENVELOPE, 'data' => self::ENVELOPE],
			Validator::encryptedObject(['id' => '6f1c5a4e-9a2b-4c3d-8e9f-0a1b2c3d4e5f', 'wrappedKey' => self::ENVELOPE, 'data' => self::ENVELOPE, 'extra' => 'dropped']));
	}

	public static function badUuids(): array {
		return [['not-a-uuid'], ['6F1C5A4E-9A2B-4C3D-8E9F-0A1B2C3D4E5F'], [''], [123], [null], ['../../etc/passwd']];
	}

	#[DataProvider('badUuids')]
	public function testRejectsBadUuids(mixed $value): void {
		$this->expectException(ValidationException::class);
		Validator::uuid($value);
	}

	public static function badEnvelopes(): array {
		return [
			['plaintext password'],
			['2.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.abc'],
			['1.short.abc'],
			['1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.'],
			['1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.has space'],
			[['array']],
		];
	}

	#[DataProvider('badEnvelopes')]
	public function testRejectsBadEnvelopes(mixed $value): void {
		$this->expectException(ValidationException::class);
		Validator::envelope($value, 'data', 1000);
	}

	public function testEnforcesEnvelopeLength(): void {
		$this->expectException(ValidationException::class);
		Validator::envelope(self::ENVELOPE, 'data', 10);
	}

	public function testKdfParams(): void {
		$valid = ['algorithm' => 'argon2id', 'opsLimit' => 3, 'memLimit' => 64 * 1024 * 1024, 'salt' => 'AAAAAAAAAAAAAAAAAAAAAA', 'junk' => 1];
		$this->assertSame(['algorithm' => 'argon2id', 'opsLimit' => 3, 'memLimit' => 67108864, 'salt' => 'AAAAAAAAAAAAAAAAAAAAAA'], Validator::kdf($valid));

		foreach ([
			['algorithm' => 'pbkdf2'] + $valid,
			['opsLimit' => 1] + $valid,
			['memLimit' => 1024] + $valid,
			['salt' => 'short'] + $valid,
			['opsLimit' => '3'] + $valid,
		] as $invalid) {
			try {
				Validator::kdf($invalid);
				$this->fail('Accepted invalid KDF params: ' . json_encode($invalid));
			} catch (ValidationException) {
				$this->addToAssertionCount(1);
			}
		}
	}
}
