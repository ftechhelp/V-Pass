<?php

declare(strict_types=1);

namespace OCA\VPass\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @template-extends QBMapper<Vault>
 */
class VaultMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'vpass_vaults', Vault::class);
	}

	/**
	 * @throws DoesNotExistException
	 */
	public function findByUser(string $userId): Vault {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		return $this->findEntity($qb);
	}

	/**
	 * Atomically increment the revision counter. Returns false if the user has no vault.
	 * Inside a transaction the row stays locked until commit, so revisions never repeat.
	 */
	public function bumpRevision(string $userId, int $now): bool {
		$qb = $this->db->getQueryBuilder();
		$qb->update($this->getTableName())
			->set('revision', $qb->createFunction($qb->getColumnName('revision') . ' + 1'))
			->set('updated_at', $qb->createNamedParameter($now, IQueryBuilder::PARAM_INT))
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		return $qb->executeStatement() > 0;
	}

	public function currentRevision(string $userId): ?int {
		$qb = $this->db->getQueryBuilder();
		$qb->select('revision')
			->from($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$result = $qb->executeQuery();
		$revision = $result->fetchOne();
		$result->closeCursor();
		return $revision === false ? null : (int)$revision;
	}

	public function deleteByUser(string $userId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$qb->executeStatement();
	}
}
