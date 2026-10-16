<?php

declare(strict_types=1);

namespace OCA\VPass\Db;

use JsonSerializable;
use OCP\AppFramework\Db\Entity;
use OCP\DB\Types;

/**
 * Metadata row for an encrypted file attached to an item. The ciphertext itself
 * lives in the app data folder (appdata_<instance>/vpass/<user>/<uuid>).
 *
 * @method string getUuid()
 * @method void setUuid(string $uuid)
 * @method string getItemUuid()
 * @method void setItemUuid(string $itemUuid)
 * @method string getUserId()
 * @method void setUserId(string $userId)
 * @method string getWrappedKey()
 * @method void setWrappedKey(string $wrappedKey)
 * @method string getMeta()
 * @method void setMeta(string $meta)
 * @method int getSize()
 * @method void setSize(int $size)
 * @method int getRevision()
 * @method void setRevision(int $revision)
 * @method int getCreatedAt()
 * @method void setCreatedAt(int $createdAt)
 */
class Attachment extends Entity implements JsonSerializable {
	protected $uuid = '';
	protected $itemUuid = '';
	protected $userId = '';
	protected $wrappedKey = '';
	protected $meta = '';
	protected $size = 0;
	protected $revision = 0;
	protected $createdAt = 0;

	public function __construct() {
		$this->addType('uuid', Types::STRING);
		$this->addType('itemUuid', Types::STRING);
		$this->addType('userId', Types::STRING);
		$this->addType('wrappedKey', Types::STRING);
		$this->addType('meta', Types::STRING);
		$this->addType('size', Types::INTEGER);
		$this->addType('revision', Types::INTEGER);
		$this->addType('createdAt', Types::INTEGER);
	}

	public function jsonSerialize(): array {
		return [
			'id' => $this->uuid,
			'itemId' => $this->itemUuid,
			'wrappedKey' => $this->wrappedKey,
			'meta' => $this->meta,
			'size' => $this->size,
			'revision' => $this->revision,
			'createdAt' => $this->createdAt,
		];
	}
}
