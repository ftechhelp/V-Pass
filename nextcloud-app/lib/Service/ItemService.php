<?php

declare(strict_types=1);

namespace OCA\VPass\Service;

use OCA\VPass\Db\Item;
use OCA\VPass\Db\ItemMapper;
use OCA\VPass\Db\Tombstone;
use OCA\VPass\Exception\ConflictException;
use OCA\VPass\Exception\NotFoundException;
use OCA\VPass\Exception\ValidationException;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\TTransactional;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IDBConnection;

class ItemService {
	use TTransactional;

	public const MAX_BATCH = 500;

	public function __construct(
		private ItemMapper $items,
		private AttachmentService $attachments,
		private RevisionService $revisions,
		private IDBConnection $db,
		private ITimeFactory $time,
	) {
	}

	/**
	 * @return list<Item>
	 */
	public function changedSince(string $userId, int $revision): array {
		return $this->items->findChangedSince($userId, $revision);
	}

	public function create(string $userId, string $uuid, string $wrappedKey, string $data): Item {
		return $this->createMany($userId, [['id' => $uuid, 'wrappedKey' => $wrappedKey, 'data' => $data]])[0];
	}

	/**
	 * Insert several items in one transaction with a single revision (used by import).
	 *
	 * @param list<mixed> $objects
	 * @return list<Item>
	 */
	public function createMany(string $userId, array $objects): array {
		if (count($objects) === 0 || count($objects) > self::MAX_BATCH) {
			throw new ValidationException('Send between 1 and ' . self::MAX_BATCH . ' items');
		}
		$valid = array_map(Validator::encryptedObject(...), $objects);
		if (count(array_unique(array_column($valid, 'id'))) !== count($valid)) {
			throw new ValidationException('Duplicate item ids in request');
		}
		return $this->atomic(function () use ($userId, $valid) {
			$revision = $this->revisions->next($userId);
			$now = $this->time->getTime();
			$created = [];
			foreach ($valid as $object) {
				if ($this->items->existsByUuid($userId, $object['id'])) {
					throw new ConflictException('Item ' . $object['id'] . ' already exists', $this->items->findByUuid($userId, $object['id']));
				}
				$item = new Item();
				$item->setUuid($object['id']);
				$item->setUserId($userId);
				$item->setWrappedKey($object['wrappedKey']);
				$item->setData($object['data']);
				$item->setRevision($revision);
				$item->setCreatedAt($now);
				$item->setUpdatedAt($now);
				$created[] = $this->items->insert($item);
			}
			return $created;
		}, $this->db);
	}

	public function update(string $userId, string $uuid, string $wrappedKey, string $data, int $baseRevision): Item {
		Validator::envelope($wrappedKey, 'wrappedKey', Validator::MAX_KEY);
		Validator::envelope($data, 'data', Validator::MAX_ITEM_DATA);
		return $this->atomic(function () use ($userId, $uuid, $wrappedKey, $data, $baseRevision) {
			$item = $this->find($userId, $uuid);
			if ($item->getRevision() !== $baseRevision) {
				throw new ConflictException('Item was changed by another client', $item);
			}
			$item->setWrappedKey($wrappedKey);
			$item->setData($data);
			$item->setRevision($this->revisions->next($userId));
			$item->setUpdatedAt($this->time->getTime());
			return $this->items->update($item);
		}, $this->db);
	}

	public function trash(string $userId, string $uuid): Item {
		return $this->setDeletedAt($userId, $uuid, $this->time->getTime());
	}

	public function restore(string $userId, string $uuid): Item {
		return $this->setDeletedAt($userId, $uuid, null);
	}

	/** Permanently delete an item and its attachments. Returns the new revision. */
	public function delete(string $userId, string $uuid): int {
		return $this->atomic(function () use ($userId, $uuid) {
			$item = $this->find($userId, $uuid);
			$revision = $this->revisions->next($userId);
			$this->attachments->deleteForItem($userId, $uuid, $revision);
			$this->items->delete($item);
			$this->revisions->tombstone($userId, Tombstone::TYPE_ITEM, $uuid, $revision);
			return $revision;
		}, $this->db);
	}

	/** Permanently delete items that have been in the trash longer than $retentionDays. */
	public function purgeExpired(int $retentionDays): int {
		$cutoff = $this->time->getTime() - $retentionDays * 86400;
		$batchSize = 500;
		$purged = 0;
		do {
			$batch = $this->items->findTrashedBefore($cutoff, $batchSize);
			$progress = 0;
			foreach ($batch as $item) {
				try {
					$this->delete($item->getUserId(), $item->getUuid());
					$progress++;
				} catch (NotFoundException) {
					// deleted concurrently, or the vault is gone
				}
			}
			$purged += $progress;
		} while (count($batch) === $batchSize && $progress > 0);
		return $purged;
	}

	private function setDeletedAt(string $userId, string $uuid, ?int $deletedAt): Item {
		return $this->atomic(function () use ($userId, $uuid, $deletedAt) {
			$item = $this->find($userId, $uuid);
			$item->setDeletedAt($deletedAt);
			$item->setRevision($this->revisions->next($userId));
			$item->setUpdatedAt($this->time->getTime());
			return $this->items->update($item);
		}, $this->db);
	}

	private function find(string $userId, string $uuid): Item {
		try {
			return $this->items->findByUuid($userId, Validator::uuid($uuid));
		} catch (DoesNotExistException) {
			throw new NotFoundException('Item not found');
		}
	}
}
