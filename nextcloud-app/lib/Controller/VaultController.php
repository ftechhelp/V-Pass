<?php

declare(strict_types=1);

namespace OCA\VPass\Controller;

use OCA\VPass\Db\AttachmentMapper;
use OCA\VPass\Db\TombstoneMapper;
use OCA\VPass\Service\FolderService;
use OCA\VPass\Service\ItemService;
use OCA\VPass\Service\RevisionService;
use OCA\VPass\Service\VaultService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\PasswordConfirmationRequired;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\AppFramework\Http\DataResponse;
use OCP\IRequest;
use OCP\IUserSession;

class VaultController extends BaseApiController {
	public function __construct(
		IRequest $request,
		IUserSession $userSession,
		private VaultService $vaults,
		private ItemService $items,
		private FolderService $folders,
		private AttachmentMapper $attachments,
		private TombstoneMapper $tombstones,
		private RevisionService $revisions,
	) {
		parent::__construct($request, $userSession);
	}

	/** Vault header (KDF params + wrapped keys). 404 if the user has not set up V-Pass yet. */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/vault')]
	public function get(): DataResponse {
		return $this->handle(fn () => $this->vaults->get($this->uid()));
	}

	/**
	 * @param array<string, mixed> $kdf
	 */
	#[NoAdminRequired]
	#[UserRateLimit(limit: 10, period: 300)]
	#[ApiRoute(verb: 'POST', url: '/api/v1/vault')]
	public function create(array $kdf, string $wrappedVaultKey, string $recoveryWrappedVaultKey): DataResponse {
		return $this->handle(
			fn () => $this->vaults->create($this->uid(), $kdf, $wrappedVaultKey, $recoveryWrappedVaultKey),
			Http::STATUS_CREATED,
		);
	}

	/**
	 * Change master password and/or recovery key.
	 *
	 * @param array<string, mixed>|null $kdf
	 */
	#[NoAdminRequired]
	#[UserRateLimit(limit: 20, period: 300)]
	#[ApiRoute(verb: 'PUT', url: '/api/v1/vault')]
	public function update(?array $kdf = null, ?string $wrappedVaultKey = null, ?string $recoveryWrappedVaultKey = null): DataResponse {
		return $this->handle(fn () => $this->vaults->updateKeys($this->uid(), $kdf, $wrappedVaultKey, $recoveryWrappedVaultKey));
	}

	/** Permanently delete the vault. Requires the Nextcloud password to be confirmed. */
	#[NoAdminRequired]
	#[PasswordConfirmationRequired]
	#[ApiRoute(verb: 'DELETE', url: '/api/v1/vault')]
	public function destroy(): DataResponse {
		return $this->handle(function () {
			$this->vaults->deleteAllForUser($this->uid());
			return [];
		});
	}

	/** Everything changed after revision $since (0 = full download), plus deletions. */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/sync')]
	public function sync(int $since = 0): DataResponse {
		return $this->handle(function () use ($since) {
			$uid = $this->uid();
			$this->vaults->get($uid);
			$since = max(0, $since);
			return [
				'revision' => $this->revisions->current($uid),
				'items' => $this->items->changedSince($uid, $since),
				'folders' => $this->folders->changedSince($uid, $since),
				'attachments' => $this->attachments->findChangedSince($uid, $since),
				'tombstones' => $since === 0 ? [] : $this->tombstones->findSince($uid, $since),
			];
		});
	}
}
