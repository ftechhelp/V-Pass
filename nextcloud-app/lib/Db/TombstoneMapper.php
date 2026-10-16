<?php

declare(strict_types=1);

namespace OCA\VPass\Db;

use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @template-extends QBMapper<Tombstone>
 */
class TombstoneMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'vpass_tombstones', Tombstone::class);
	}

	public function record(string $userId, string $type, string $uuid, int $revision): void {
		$tombstone = new Tombstone();
		$tombstone->setUserId($userId);
		$tombstone->setObjectType($type);
		$tombstone->setObjectUuid($uuid);
		$tombstone->setRevision($revision);
		$this->insert($tombstone);
	}

	/**
	 * @return list<Tombstone>
	 */
	public function findSince(string $userId, int $revision): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->gt('revision', $qb->createNamedParameter($revision, IQueryBuilder::PARAM_INT)))
			->orderBy('revision', 'ASC');
		return $this->findEntities($qb);
	}

	public function deleteByUser(string $userId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$qb->executeStatement();
	}
}
