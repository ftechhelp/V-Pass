<?php

declare(strict_types=1);

namespace OCA\VPass\Service;

use OCA\VPass\Db\FolderMapper;
use OCA\VPass\Db\ItemMapper;
use OCA\VPass\Db\TombstoneMapper;
use OCA\VPass\Db\UnlockKeyMapper;
use OCA\VPass\Db\Vault;
use OCA\VPass\Db\VaultMapper;
use OCA\VPass\Exception\ConflictException;
use OCA\VPass\Exception\NotFoundException;
use OCA\VPass\Exception\ValidationException;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\TTransactional;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IDBConnection;

class VaultService {
	use TTransactional;

	public function __construct(
		private VaultMapper $vaults,
		private ItemMapper $items,
		private FolderMapper $folders,
		private UnlockKeyMapper $unlockKeys,
		private TombstoneMapper $tombstones,
		private AttachmentService $attachments,
		private IDBConnection $db,
		private ITimeFactory $time,
	) {
	}

	public function find(string $userId): ?Vault {
		try {
			return $this->vaults->findByUser($userId);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	public function get(string $userId): Vault {
		return $this->find($userId) ?? throw new NotFoundException('Vault not initialized');
	}

	public function create(string $userId, mixed $kdf, mixed $wrappedVaultKey, mixed $recoveryWrappedVaultKey): Vault {
		$kdf = Validator::kdf($kdf);
		$wrapped = Validator::envelope($wrappedVaultKey, 'wrappedVaultKey', Validator::MAX_KEY);
		$recovery = Validator::envelope($recoveryWrappedVaultKey, 'recoveryWrappedVaultKey', Validator::MAX_KEY);
		return $this->atomic(function () use ($userId, $kdf, $wrapped, $recovery) {
			if ($this->find($userId) !== null) {
				throw new ConflictException('A vault already exists for this user');
			}
			$now = $this->time->getTime();
			$vault = new Vault();
			$vault->setUserId($userId);
			$vault->setKdfParams(json_encode($kdf, JSON_THROW_ON_ERROR));
			$vault->setWrappedVaultKey($wrapped);
			$vault->setRecoveryWrappedVaultKey($recovery);
			$vault->setRevision(0);
			$vault->setCreatedAt($now);
			$vault->setUpdatedAt($now);
			return $this->vaults->insert($vault);
		}, $this->db);
	}

	/**
	 * Change the master password (new KDF params + re-wrapped vault key) and/or
	 * replace the recovery key wrap. The vault key itself never changes here.
	 */
	public function updateKeys(string $userId, mixed $kdf, mixed $wrappedVaultKey, mixed $recoveryWrappedVaultKey): Vault {
		if (($kdf === null) !== ($wrappedVaultKey === null)) {
			throw new ValidationException('kdf and wrappedVaultKey must be updated together');
		}
		if ($kdf === null && $recoveryWrappedVaultKey === null) {
			throw new ValidationException('Nothing to update');
		}
		$vault = $this->get($userId);
		if ($kdf !== null) {
			$vault->setKdfParams(json_encode(Validator::kdf($kdf), JSON_THROW_ON_ERROR));
			$vault->setWrappedVaultKey(Validator::envelope($wrappedVaultKey, 'wrappedVaultKey', Validator::MAX_KEY));
		}
		if ($recoveryWrappedVaultKey !== null) {
			$vault->setRecoveryWrappedVaultKey(Validator::envelope($recoveryWrappedVaultKey, 'recoveryWrappedVaultKey', Validator::MAX_KEY));
		}
		$vault->setUpdatedAt($this->time->getTime());
		return $this->vaults->update($vault);
	}

	/** Irreversibly delete the user's vault and everything in it. */
	public function deleteAllForUser(string $userId): void {
		$this->atomic(function () use ($userId) {
			$this->items->deleteByUser($userId);
			$this->folders->deleteByUser($userId);
			$this->unlockKeys->deleteByUser($userId);
			$this->tombstones->deleteByUser($userId);
			$this->vaults->deleteByUser($userId);
		}, $this->db);
		$this->attachments->deleteAllForUser($userId);
	}
}
