<?php

declare(strict_types=1);

namespace OCA\VPass\Service;

use OCA\VPass\Db\TombstoneMapper;
use OCA\VPass\Db\VaultMapper;
use OCA\VPass\Exception\NotFoundException;
use OCP\AppFramework\Utility\ITimeFactory;

/**
 * Per-user revision counter. Every write gets a new revision so clients can ask
 * "what changed since revision N?". Must be called inside a transaction.
 */
class RevisionService {
	public function __construct(
		private VaultMapper $vaults,
		private TombstoneMapper $tombstones,
		private ITimeFactory $time,
	) {
	}

	/**
	 * @throws NotFoundException when the user has not set up a vault yet
	 */
	public function next(string $userId): int {
		if (!$this->vaults->bumpRevision($userId, $this->time->getTime())) {
			throw new NotFoundException('Vault not initialized');
		}
		return (int)$this->vaults->currentRevision($userId);
	}

	public function current(string $userId): int {
		return $this->vaults->currentRevision($userId) ?? 0;
	}

	public function tombstone(string $userId, string $type, string $uuid, int $revision): void {
		$this->tombstones->record($userId, $type, $uuid, $revision);
	}
}
