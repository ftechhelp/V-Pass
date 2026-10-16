<?php

declare(strict_types=1);

namespace OCA\VPass\Db;

use JsonSerializable;
use OCP\AppFramework\Db\Entity;
use OCP\DB\Types;

/**
 * A passkey registered to unlock the vault through the WebAuthn PRF extension.
 * `wrappedVaultKey` can only be opened with the authenticator's PRF output.
 *
 * @method string getUserId()
 * @method void setUserId(string $userId)
 * @method string getType()
 * @method void setType(string $type)
 * @method string getCredentialId()
 * @method void setCredentialId(string $credentialId)
 * @method string getPrfSalt()
 * @method void setPrfSalt(string $prfSalt)
 * @method string getWrappedVaultKey()
 * @method void setWrappedVaultKey(string $wrappedVaultKey)
 * @method string getLabel()
 * @method void setLabel(string $label)
 * @method int getCreatedAt()
 * @method void setCreatedAt(int $createdAt)
 * @method int|null getLastUsedAt()
 * @method void setLastUsedAt(?int $lastUsedAt)
 */
class UnlockKey extends Entity implements JsonSerializable {
	protected $userId = '';
	protected $type = '';
	protected $credentialId = '';
	protected $prfSalt = '';
	protected $wrappedVaultKey = '';
	protected $label = '';
	protected $createdAt = 0;
	protected $lastUsedAt = null;

	public function __construct() {
		$this->addType('userId', Types::STRING);
		$this->addType('type', Types::STRING);
		$this->addType('credentialId', Types::STRING);
		$this->addType('prfSalt', Types::STRING);
		$this->addType('wrappedVaultKey', Types::STRING);
		$this->addType('label', Types::STRING);
		$this->addType('createdAt', Types::INTEGER);
		$this->addType('lastUsedAt', Types::INTEGER);
	}

	public function jsonSerialize(): array {
		return [
			'id' => $this->id,
			'type' => $this->type,
			'credentialId' => $this->credentialId,
			'prfSalt' => $this->prfSalt,
			'wrappedVaultKey' => $this->wrappedVaultKey,
			'label' => $this->label,
			'createdAt' => $this->createdAt,
			'lastUsedAt' => $this->lastUsedAt,
		];
	}
}
