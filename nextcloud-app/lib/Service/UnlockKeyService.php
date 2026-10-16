<?php

declare(strict_types=1);

namespace OCA\VPass\Service;

use OCA\VPass\Db\UnlockKey;
use OCA\VPass\Db\UnlockKeyMapper;
use OCA\VPass\Exception\NotFoundException;
use OCA\VPass\Exception\ValidationException;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Utility\ITimeFactory;

class UnlockKeyService {
	public const MAX_KEYS = 20;

	public function __construct(
		private UnlockKeyMapper $keys,
		private VaultService $vaults,
		private ITimeFactory $time,
	) {
	}

	/**
	 * @return list<UnlockKey>
	 */
	public function list(string $userId): array {
		return $this->keys->findAllForUser($userId);
	}

	public function create(string $userId, mixed $credentialId, mixed $prfSalt, mixed $wrappedVaultKey, mixed $label): UnlockKey {
		$this->vaults->get($userId);
		$existing = $this->keys->findAllForUser($userId);
		if (count($existing) >= self::MAX_KEYS) {
			throw new ValidationException('Too many passkeys registered');
		}
		$credentialId = Validator::b64url($credentialId, 'credentialId', 16, 1400);
		foreach ($existing as $key) {
			if ($key->getCredentialId() === $credentialId) {
				throw new ValidationException('This passkey is already registered');
			}
		}
		$key = new UnlockKey();
		$key->setUserId($userId);
		$key->setType('passkey_prf');
		$key->setCredentialId($credentialId);
		$key->setPrfSalt(Validator::b64url($prfSalt, 'prfSalt', 43, 43));
		$key->setWrappedVaultKey(Validator::envelope($wrappedVaultKey, 'wrappedVaultKey', Validator::MAX_KEY));
		$key->setLabel(Validator::label($label) ?: 'Passkey');
		$key->setCreatedAt($this->time->getTime());
		return $this->keys->insert($key);
	}

	public function delete(string $userId, int $id): void {
		$this->keys->delete($this->find($userId, $id));
	}

	public function markUsed(string $userId, int $id): void {
		$key = $this->find($userId, $id);
		$key->setLastUsedAt($this->time->getTime());
		$this->keys->update($key);
	}

	private function find(string $userId, int $id): UnlockKey {
		try {
			return $this->keys->findForUser($userId, $id);
		} catch (DoesNotExistException) {
			throw new NotFoundException('Passkey not found');
		}
	}
}
