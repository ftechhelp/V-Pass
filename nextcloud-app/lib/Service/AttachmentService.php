<?php

declare(strict_types=1);

namespace OCA\VPass\Service;

use OCA\VPass\AppInfo\Application;
use OCA\VPass\Db\Attachment;
use OCA\VPass\Db\AttachmentMapper;
use OCA\VPass\Db\ItemMapper;
use OCA\VPass\Db\Tombstone;
use OCA\VPass\Exception\ConflictException;
use OCA\VPass\Exception\NotFoundException;
use OCA\VPass\Exception\ValidationException;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\TTransactional;
use OCP\AppFramework\Http;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\AppData\IAppDataFactory;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException as FileNotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\Files\SimpleFS\ISimpleFolder;
use OCP\IDBConnection;
use Psr\Log\LoggerInterface;

/**
 * Encrypted attachments. Ciphertext is stored in the app's private data folder
 * (not in the user's Files), one folder per user, one file per attachment uuid.
 */
class AttachmentService {
	use TTransactional;

	private IAppData $appData;

	public function __construct(
		private AttachmentMapper $attachments,
		private ItemMapper $items,
		private RevisionService $revisions,
		private SettingsService $settings,
		private IDBConnection $db,
		private ITimeFactory $time,
		private LoggerInterface $logger,
		IAppDataFactory $appDataFactory,
	) {
		$this->appData = $appDataFactory->get(Application::APP_ID);
	}

	/**
	 * @param resource $content encrypted file contents
	 */
	public function create(string $userId, string $itemUuid, string $uuid, string $wrappedKey, string $meta, $content, int $size): Attachment {
		Validator::uuid($itemUuid, 'itemId');
		Validator::uuid($uuid);
		Validator::envelope($wrappedKey, 'wrappedKey', Validator::MAX_KEY);
		Validator::envelope($meta, 'meta', Validator::MAX_META);
		if ($size > $this->settings->maxAttachmentBytes()) {
			throw new ValidationException('File is larger than the allowed maximum', Http::STATUS_REQUEST_ENTITY_TOO_LARGE);
		}
		try {
			$item = $this->items->findByUuid($userId, $itemUuid);
		} catch (DoesNotExistException) {
			throw new NotFoundException('Item not found');
		}
		if ($item->getDeletedAt() !== null) {
			throw new ValidationException('Restore the item from the trash before adding files');
		}
		if ($this->attachments->existsByUuid($userId, $uuid)) {
			throw new ConflictException('Attachment already exists');
		}

		$this->userFolder($userId, true)->newFile($uuid, $content);
		try {
			return $this->atomic(function () use ($userId, $itemUuid, $uuid, $wrappedKey, $meta, $size) {
				$attachment = new Attachment();
				$attachment->setUuid($uuid);
				$attachment->setItemUuid($itemUuid);
				$attachment->setUserId($userId);
				$attachment->setWrappedKey($wrappedKey);
				$attachment->setMeta($meta);
				$attachment->setSize($size);
				$attachment->setRevision($this->revisions->next($userId));
				$attachment->setCreatedAt($this->time->getTime());
				return $this->attachments->insert($attachment);
			}, $this->db);
		} catch (\Throwable $e) {
			$this->deleteFile($userId, $uuid);
			throw $e;
		}
	}

	/**
	 * @return array{0: Attachment, 1: ISimpleFile}
	 */
	public function open(string $userId, string $uuid): array {
		try {
			$attachment = $this->attachments->findByUuid($userId, Validator::uuid($uuid));
			return [$attachment, $this->userFolder($userId, false)->getFile($uuid)];
		} catch (DoesNotExistException|FileNotFoundException) {
			throw new NotFoundException('Attachment not found');
		}
	}

	public function delete(string $userId, string $uuid): int {
		return $this->atomic(function () use ($userId, $uuid) {
			try {
				$attachment = $this->attachments->findByUuid($userId, Validator::uuid($uuid));
			} catch (DoesNotExistException) {
				throw new NotFoundException('Attachment not found');
			}
			$revision = $this->revisions->next($userId);
			$this->remove($attachment, $revision);
			return $revision;
		}, $this->db);
	}

	/** Remove every attachment of an item, recording tombstones at $revision. Call inside a transaction. */
	public function deleteForItem(string $userId, string $itemUuid, int $revision): void {
		foreach ($this->attachments->findByItem($userId, $itemUuid) as $attachment) {
			$this->remove($attachment, $revision);
		}
	}

	public function deleteAllForUser(string $userId): void {
		$this->attachments->deleteByUser($userId);
		try {
			$this->appData->getFolder($userId)->delete();
		} catch (FileNotFoundException) {
			// nothing stored
		}
	}

	private function remove(Attachment $attachment, int $revision): void {
		$this->attachments->delete($attachment);
		$this->revisions->tombstone($attachment->getUserId(), Tombstone::TYPE_ATTACHMENT, $attachment->getUuid(), $revision);
		$this->deleteFile($attachment->getUserId(), $attachment->getUuid());
	}

	private function deleteFile(string $userId, string $uuid): void {
		try {
			$this->userFolder($userId, false)->getFile($uuid)->delete();
		} catch (FileNotFoundException) {
			// already gone
		} catch (\Throwable $e) {
			$this->logger->warning('Could not delete attachment file ' . $uuid, ['exception' => $e]);
		}
	}

	private function userFolder(string $userId, bool $create): ISimpleFolder {
		try {
			return $this->appData->getFolder($userId);
		} catch (FileNotFoundException $e) {
			if (!$create) {
				throw $e;
			}
			return $this->appData->newFolder($userId);
		}
	}
}
