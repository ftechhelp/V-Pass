<?php

declare(strict_types=1);

namespace OCA\VPass\Db;

use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @template-extends UserScopedMapper<Item>
 */
class ItemMapper extends UserScopedMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'vpass_items', Item::class);
	}

	/**
	 * Items that have been in the trash since before $cutoff (unix seconds).
	 *
	 * @return list<Item>
	 */
	public function findTrashedBefore(int $cutoff, int $limit = 500): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->isNotNull('deleted_at'))
			->andWhere($qb->expr()->lt('deleted_at', $qb->createNamedParameter($cutoff, IQueryBuilder::PARAM_INT)))
			->orderBy('id', 'ASC')
			->setMaxResults($limit);
		return $this->findEntities($qb);
	}
}
