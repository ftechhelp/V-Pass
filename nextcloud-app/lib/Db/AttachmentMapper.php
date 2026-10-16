<?php

declare(strict_types=1);

namespace OCA\VPass\Db;

use OCP\IDBConnection;

/**
 * @template-extends UserScopedMapper<Attachment>
 */
class AttachmentMapper extends UserScopedMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'vpass_attachments', Attachment::class);
	}

	/**
	 * @return list<Attachment>
	 */
	public function findByItem(string $userId, string $itemUuid): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('item_uuid', $qb->createNamedParameter($itemUuid)));
		return $this->findEntities($qb);
	}
}
