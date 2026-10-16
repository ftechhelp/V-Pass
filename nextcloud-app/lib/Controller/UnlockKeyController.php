<?php

declare(strict_types=1);

namespace OCA\VPass\Controller;

use OCA\VPass\Service\UnlockKeyService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\AppFramework\Http\DataResponse;
use OCP\IRequest;
use OCP\IUserSession;

/** Passkeys registered to unlock the vault via WebAuthn PRF. */
class UnlockKeyController extends BaseApiController {
	public function __construct(
		IRequest $request,
		IUserSession $userSession,
		private UnlockKeyService $keys,
	) {
		parent::__construct($request, $userSession);
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/unlock-keys')]
	public function index(): DataResponse {
		return $this->handle(fn () => $this->keys->list($this->uid()));
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 10, period: 300)]
	#[ApiRoute(verb: 'POST', url: '/api/v1/unlock-keys')]
	public function create(string $credentialId, string $prfSalt, string $wrappedVaultKey, string $label = ''): DataResponse {
		return $this->handle(
			fn () => $this->keys->create($this->uid(), $credentialId, $prfSalt, $wrappedVaultKey, $label),
			Http::STATUS_CREATED,
		);
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'DELETE', url: '/api/v1/unlock-keys/{id}')]
	public function destroy(int $id): DataResponse {
		return $this->handle(function () use ($id) {
			$this->keys->delete($this->uid(), $id);
			return [];
		});
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v1/unlock-keys/{id}/used')]
	public function markUsed(int $id): DataResponse {
		return $this->handle(function () use ($id) {
			$this->keys->markUsed($this->uid(), $id);
			return [];
		});
	}
}
