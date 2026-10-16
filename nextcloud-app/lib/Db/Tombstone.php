<?php

declare(strict_types=1);

namespace OCA\VPass\Db;

use JsonSerializable;
use OCP\AppFramework\Db\Entity;
use OCP\DB\Types;

/**
 * Records a permanent deletion so clients syncing incrementally learn about it.
 *
 * @method string getUserId()
 * @method void setUserId(string $userId)
 * @method string getObjectType()
 * @method void setObjectType(string $objectType)
 * @method string getObjectUuid()
 * @method void setObjectUuid(string $objectUuid)
 * @method int getRevision()
 * @method void setRevision(int $revision)
 */
class Tombstone extends Entity implements JsonSerializable {
	public const TYPE_ITEM = 'item';
	public const TYPE_FOLDER = 'folder';
	public const TYPE_ATTACHMENT = 'attachment';

	protected $userId = '';
	protected $objectType = '';
	protected $objectUuid = '';
	protected $revision = 0;

	public function __construct() {
		$this->addType('userId', Types::STRING);
		$this->addType('objectType', Types::STRING);
		$this->addType('objectUuid', Types::STRING);
		$this->addType('revision', Types::INTEGER);
	}

	public function jsonSerialize(): array {
		return [
			'type' => $this->objectType,
			'id' => $this->objectUuid,
			'revision' => $this->revision,
		];
	}
}
