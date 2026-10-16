<?php

declare(strict_types=1);

namespace OCA\VPass\Controller;

use OCA\VPass\Service\FolderService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\IRequest;
use OCP\IUserSession;

class FolderController extends BaseApiController {
	public function __construct(
		IRequest $request,
		IUserSession $userSession,
		private FolderService $folders,
	) {
		parent::__construct($request, $userSession);
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v1/folders')]
	public function create(string $id, string $wrappedKey, string $data): DataResponse {
		return $this->handle(
			fn () => $this->folders->create($this->uid(), ['id' => $id, 'wrappedKey' => $wrappedKey, 'data' => $data]),
			Http::STATUS_CREATED,
		);
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'PUT', url: '/api/v1/folders/{id}')]
	public function update(string $id, string $wrappedKey, string $data, int $baseRevision): DataResponse {
		return $this->handle(fn () => $this->folders->update($this->uid(), $id, $wrappedKey, $data, $baseRevision));
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'DELETE', url: '/api/v1/folders/{id}')]
	public function destroy(string $id): DataResponse {
		return $this->handle(fn () => ['revision' => $this->folders->delete($this->uid(), $id)]);
	}
}
