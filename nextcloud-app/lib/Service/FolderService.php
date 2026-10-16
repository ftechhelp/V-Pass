<?php

declare(strict_types=1);

namespace OCA\VPass\Service;

use OCA\VPass\Db\Folder;
use OCA\VPass\Db\FolderMapper;
use OCA\VPass\Db\Tombstone;
use OCA\VPass\Exception\ConflictException;
use OCA\VPass\Exception\NotFoundException;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\TTransactional;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IDBConnection;

/**
 * Folders are encrypted like items. Item→folder membership lives inside the
 * encrypted item payload, so deleting a folder never touches items server-side.
 */
class FolderService {
	use TTransactional;

	public function __construct(
		private FolderMapper $folders,
		private RevisionService $revisions,
		private IDBConnection $db,
		private ITimeFactory $time,
	) {
	}

	/**
	 * @return list<Folder>
	 */
	public function changedSince(string $userId, int $revision): array {
		return $this->folders->findChangedSince($userId, $revision);
	}

	public function create(string $userId, mixed $object): Folder {
		$valid = Validator::encryptedObject($object);
		return $this->atomic(function () use ($userId, $valid) {
			if ($this->folders->existsByUuid($userId, $valid['id'])) {
				throw new ConflictException('Folder already exists', $this->folders->findByUuid($userId, $valid['id']));
			}
			$now = $this->time->getTime();
			$folder = new Folder();
			$folder->setUuid($valid['id']);
			$folder->setUserId($userId);
			$folder->setWrappedKey($valid['wrappedKey']);
			$folder->setData($valid['data']);
			$folder->setRevision($this->revisions->next($userId));
			$folder->setCreatedAt($now);
			$folder->setUpdatedAt($now);
			return $this->folders->insert($folder);
		}, $this->db);
	}

	public function update(string $userId, string $uuid, string $wrappedKey, string $data, int $baseRevision): Folder {
		Validator::envelope($wrappedKey, 'wrappedKey', Validator::MAX_KEY);
		Validator::envelope($data, 'data', Validator::MAX_ITEM_DATA);
		return $this->atomic(function () use ($userId, $uuid, $wrappedKey, $data, $baseRevision) {
			$folder = $this->find($userId, $uuid);
			if ($folder->getRevision() !== $baseRevision) {
				throw new ConflictException('Folder was changed by another client', $folder);
			}
			$folder->setWrappedKey($wrappedKey);
			$folder->setData($data);
			$folder->setRevision($this->revisions->next($userId));
			$folder->setUpdatedAt($this->time->getTime());
			return $this->folders->update($folder);
		}, $this->db);
	}

	public function delete(string $userId, string $uuid): int {
		return $this->atomic(function () use ($userId, $uuid) {
			$folder = $this->find($userId, $uuid);
			$revision = $this->revisions->next($userId);
			$this->folders->delete($folder);
			$this->revisions->tombstone($userId, Tombstone::TYPE_FOLDER, $uuid, $revision);
			return $revision;
		}, $this->db);
	}

	private function find(string $userId, string $uuid): Folder {
		try {
			return $this->folders->findByUuid($userId, Validator::uuid($uuid));
		} catch (DoesNotExistException) {
			throw new NotFoundException('Folder not found');
		}
	}
}
