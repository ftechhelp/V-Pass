<?php

declare(strict_types=1);

namespace OCA\VPass\Db;

use OCP\IDBConnection;

/**
 * @template-extends UserScopedMapper<Folder>
 */
class FolderMapper extends UserScopedMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'vpass_folders', Folder::class);
	}
}
