<?php

declare(strict_types=1);

namespace OCA\VPass\Tests\Unit\Service;

use OCA\VPass\Db\Item;
use OCA\VPass\Db\ItemMapper;
use OCA\VPass\Db\Tombstone;
use OCA\VPass\Exception\ConflictException;
use OCA\VPass\Exception\NotFoundException;
use OCA\VPass\Exception\ValidationException;
use OCA\VPass\Service\AttachmentService;
use OCA\VPass\Service\ItemService;
use OCA\VPass\Service\RevisionService;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IDBConnection;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

class ItemServiceTest extends TestCase {
	private const UUID = '6f1c5a4e-9a2b-4c3d-8e9f-0a1b2c3d4e5f';
	private const ENVELOPE = '1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.Y2lwaGVydGV4dA';

	private ItemMapper&MockObject $items;
	private AttachmentService&MockObject $attachments;
	private RevisionService&MockObject $revisions;
	private ItemService $service;

	protected function setUp(): void {
		$this->items = $this->createMock(ItemMapper::class);
		$this->attachments = $this->createMock(AttachmentService::class);
		$this->revisions = $this->createMock(RevisionService::class);
		$time = $this->createMock(ITimeFactory::class);
		$time->method('getTime')->willReturn(1_800_000_000);
		$this->service = new ItemService($this->items, $this->attachments, $this->revisions, $this->createMock(IDBConnection::class), $time);
	}

	private function existing(int $revision): Item {
		$item = new Item();
		$item->setUuid(self::UUID);
		$item->setUserId('alice');
		$item->setWrappedKey(self::ENVELOPE);
		$item->setData(self::ENVELOPE);
		$item->setRevision($revision);
		return $item;
	}

	public function testCreateAssignsNewRevisionAndTimestamps(): void {
		$this->revisions->expects($this->once())->method('next')->with('alice')->willReturn(7);
		$this->items->method('existsByUuid')->willReturn(false);
		$this->items->expects($this->once())->method('insert')->willReturnArgument(0);

		$item = $this->service->create('alice', self::UUID, self::ENVELOPE, self::ENVELOPE);

		$this->assertSame(7, $item->getRevision());
		$this->assertSame(1_800_000_000, $item->getCreatedAt());
		$this->assertSame(['id', 'wrappedKey', 'data', 'revision', 'createdAt', 'updatedAt', 'deletedAt'], array_keys($item->jsonSerialize()));
	}

	public function testCreateRejectsExistingId(): void {
		$this->revisions->method('next')->willReturn(1);
		$this->items->method('existsByUuid')->willReturn(true);
		$this->items->method('findByUuid')->willReturn($this->existing(3));
		$this->expectException(ConflictException::class);
		$this->service->create('alice', self::UUID, self::ENVELOPE, self::ENVELOPE);
	}

	public function testBatchRejectsDuplicatesAndOversizedRequests(): void {
		$object = ['id' => self::UUID, 'wrappedKey' => self::ENVELOPE, 'data' => self::ENVELOPE];
		try {
			$this->service->createMany('alice', [$object, $object]);
			$this->fail('Accepted duplicate ids');
		} catch (ValidationException) {
			$this->addToAssertionCount(1);
		}
		$this->expectException(ValidationException::class);
		$this->service->createMany('alice', []);
	}

	public function testBatchRejectsPlaintext(): void {
		$this->expectException(ValidationException::class);
		$this->service->createMany('alice', [['id' => self::UUID, 'wrappedKey' => self::ENVELOPE, 'data' => '{"password":"hunter2"}']]);
	}

	public function testUpdateWithStaleRevisionConflictsAndReturnsServerCopy(): void {
		$current = $this->existing(5);
		$this->items->method('findByUuid')->willReturn($current);
		$this->items->expects($this->never())->method('update');
		try {
			$this->service->update('alice', self::UUID, self::ENVELOPE, self::ENVELOPE, 4);
			$this->fail('Expected a conflict');
		} catch (ConflictException $e) {
			$this->assertSame($current, $e->getCurrent());
		}
	}

	public function testUpdateWithCurrentRevisionSucceeds(): void {
		$this->items->method('findByUuid')->willReturn($this->existing(5));
		$this->revisions->method('next')->willReturn(9);
		$this->items->expects($this->once())->method('update')->willReturnArgument(0);
		$this->assertSame(9, $this->service->update('alice', self::UUID, self::ENVELOPE, self::ENVELOPE, 5)->getRevision());
	}

	public function testUpdateMissingItem(): void {
		$this->items->method('findByUuid')->willThrowException(new DoesNotExistException('nope'));
		$this->expectException(NotFoundException::class);
		$this->service->update('alice', self::UUID, self::ENVELOPE, self::ENVELOPE, 1);
	}

	public function testTrashAndRestoreToggleDeletedAt(): void {
		$this->items->method('findByUuid')->willReturnCallback(fn () => $this->existing(1));
		$this->items->method('update')->willReturnArgument(0);
		$this->revisions->method('next')->willReturn(2);
		$this->assertSame(1_800_000_000, $this->service->trash('alice', self::UUID)->getDeletedAt());
		$this->assertNull($this->service->restore('alice', self::UUID)->getDeletedAt());
	}

	public function testDeleteRemovesAttachmentsAndRecordsTombstone(): void {
		$this->items->method('findByUuid')->willReturn($this->existing(1));
		$this->revisions->method('next')->willReturn(12);
		$this->attachments->expects($this->once())->method('deleteForItem')->with('alice', self::UUID, 12);
		$this->items->expects($this->once())->method('delete');
		$this->revisions->expects($this->once())->method('tombstone')->with('alice', Tombstone::TYPE_ITEM, self::UUID, 12);
		$this->assertSame(12, $this->service->delete('alice', self::UUID));
	}

	public function testPurgeOnlyDeletesExpiredTrash(): void {
		$expired = $this->existing(1);
		$expired->setDeletedAt(1_800_000_000 - 31 * 86400);
		$this->items->expects($this->once())->method('findTrashedBefore')->with(1_800_000_000 - 30 * 86400)->willReturn([$expired]);
		$this->items->method('findByUuid')->willReturn($expired);
		$this->revisions->method('next')->willReturn(3);
		$this->items->expects($this->once())->method('delete');
		$this->assertSame(1, $this->service->purgeExpired(30));
	}
}
