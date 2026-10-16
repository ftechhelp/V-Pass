<?php

declare(strict_types=1);

namespace OCA\VPass\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\Entity;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;

/**
 * Shared queries for tables keyed by (user_id, uuid) with a revision column.
 *
 * @template T of Entity
 * @template-extends QBMapper<T>
 */
abstract class UserScopedMapper extends QBMapper {
	/**
	 * @return T
	 * @throws DoesNotExistException
	 */
	public function findByUuid(string $userId, string $uuid): Entity {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('uuid', $qb->createNamedParameter($uuid)));
		return $this->findEntity($qb);
	}

	public function existsByUuid(string $userId, string $uuid): bool {
		try {
			$this->findByUuid($userId, $uuid);
			return true;
		} catch (DoesNotExistException) {
			return false;
		}
	}

	/**
	 * @return list<T>
	 */
	public function findChangedSince(string $userId, int $revision): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->gt('revision', $qb->createNamedParameter($revision, IQueryBuilder::PARAM_INT)))
			->orderBy('revision', 'ASC')
			->addOrderBy('id', 'ASC');
		return $this->findEntities($qb);
	}

	public function deleteByUser(string $userId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$qb->executeStatement();
	}
}
