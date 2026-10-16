<?php

declare(strict_types=1);

namespace OCA\VPass\Service;

use OCA\VPass\Exception\ValidationException;

/**
 * Shape checks for client-supplied values. The server cannot validate encrypted
 * content, but it enforces formats and sizes so garbage never reaches the database.
 */
class Validator {
	public const MAX_ITEM_DATA = 1048576;
	public const MAX_KEY = 255;
	public const MAX_META = 8192;

	private const UUID_RE = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';
	private const ENVELOPE_RE = '/^1\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]+$/';
	private const B64URL_RE = '/^[A-Za-z0-9_-]+$/';

	public static function uuid(mixed $value, string $field = 'id'): string {
		if (!is_string($value) || !preg_match(self::UUID_RE, $value)) {
			throw new ValidationException("Invalid $field");
		}
		return $value;
	}

	public static function envelope(mixed $value, string $field, int $maxLength): string {
		if (!is_string($value) || strlen($value) > $maxLength || !preg_match(self::ENVELOPE_RE, $value)) {
			throw new ValidationException("Invalid $field");
		}
		return $value;
	}

	public static function b64url(mixed $value, string $field, int $minLength, int $maxLength): string {
		if (!is_string($value) || strlen($value) < $minLength || strlen($value) > $maxLength || !preg_match(self::B64URL_RE, $value)) {
			throw new ValidationException("Invalid $field");
		}
		return $value;
	}

	public static function label(mixed $value, string $field = 'label'): string {
		if (!is_string($value) || mb_strlen($value) > 255) {
			throw new ValidationException("Invalid $field");
		}
		return trim($value);
	}

	/**
	 * @return array{algorithm: string, opsLimit: int, memLimit: int, salt: string}
	 */
	public static function kdf(mixed $value): array {
		if (!is_array($value)
			|| ($value['algorithm'] ?? null) !== 'argon2id'
			|| !is_int($value['opsLimit'] ?? null) || $value['opsLimit'] < 2 || $value['opsLimit'] > 20
			|| !is_int($value['memLimit'] ?? null) || $value['memLimit'] < 32 * 1024 * 1024 || $value['memLimit'] > 1024 * 1024 * 1024
			|| !is_string($value['salt'] ?? null) || !preg_match('/^[A-Za-z0-9_-]{22}$/', $value['salt'])) {
			throw new ValidationException('Invalid KDF parameters');
		}
		return [
			'algorithm' => 'argon2id',
			'opsLimit' => $value['opsLimit'],
			'memLimit' => $value['memLimit'],
			'salt' => $value['salt'],
		];
	}

	/**
	 * @return array{id: string, wrappedKey: string, data: string}
	 */
	public static function encryptedObject(mixed $value): array {
		if (!is_array($value)) {
			throw new ValidationException('Invalid object');
		}
		return [
			'id' => self::uuid($value['id'] ?? null),
			'wrappedKey' => self::envelope($value['wrappedKey'] ?? null, 'wrappedKey', self::MAX_KEY),
			'data' => self::envelope($value['data'] ?? null, 'data', self::MAX_ITEM_DATA),
		];
	}
}
