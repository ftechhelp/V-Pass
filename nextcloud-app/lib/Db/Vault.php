<?php

declare(strict_types=1);

namespace OCA\VPass\Db;

use JsonSerializable;
use OCP\AppFramework\Db\Entity;
use OCP\DB\Types;

/**
 * Per-user vault header: KDF parameters and the wrapped vault keys.
 * `revision` is a monotonically increasing counter bumped on every write,
 * used by clients for incremental sync.
 *
 * @method string getUserId()
 * @method void setUserId(string $userId)
 * @method string getKdfParams()
 * @method void setKdfParams(string $kdfParams)
 * @method string getWrappedVaultKey()
 * @method void setWrappedVaultKey(string $wrappedVaultKey)
 * @method string getRecoveryWrappedVaultKey()
 * @method void setRecoveryWrappedVaultKey(string $recoveryWrappedVaultKey)
 * @method int getRevision()
 * @method void setRevision(int $revision)
 * @method int getCreatedAt()
 * @method void setCreatedAt(int $createdAt)
 * @method int getUpdatedAt()
 * @method void setUpdatedAt(int $updatedAt)
 */
class Vault extends Entity implements JsonSerializable {
	protected $userId = '';
	protected $kdfParams = '';
	protected $wrappedVaultKey = '';
	protected $recoveryWrappedVaultKey = '';
	protected $revision = 0;
	protected $createdAt = 0;
	protected $updatedAt = 0;

	public function __construct() {
		$this->addType('userId', Types::STRING);
		$this->addType('kdfParams', Types::STRING);
		$this->addType('wrappedVaultKey', Types::STRING);
		$this->addType('recoveryWrappedVaultKey', Types::STRING);
		$this->addType('revision', Types::INTEGER);
		$this->addType('createdAt', Types::INTEGER);
		$this->addType('updatedAt', Types::INTEGER);
	}

	public function jsonSerialize(): array {
		return [
			'kdf' => json_decode($this->kdfParams, true),
			'wrappedVaultKey' => $this->wrappedVaultKey,
			'recoveryWrappedVaultKey' => $this->recoveryWrappedVaultKey,
			'revision' => $this->revision,
			'createdAt' => $this->createdAt,
			'updatedAt' => $this->updatedAt,
		];
	}
}
