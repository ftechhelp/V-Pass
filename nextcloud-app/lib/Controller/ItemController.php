<?php

declare(strict_types=1);

namespace OCA\VPass\Controller;

use OCA\VPass\Service\ItemService;
use OCA\VPass\Service\RevisionService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\IRequest;
use OCP\IUserSession;

class ItemController extends BaseApiController {
	public function __construct(
		IRequest $request,
		IUserSession $userSession,
		private ItemService $items,
		private RevisionService $revisions,
	) {
		parent::__construct($request, $userSession);
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v1/items')]
	public function create(string $id, string $wrappedKey, string $data): DataResponse {
		return $this->handle(fn () => $this->items->create($this->uid(), $id, $wrappedKey, $data), Http::STATUS_CREATED);
	}

	/**
	 * Bulk insert (import). All items share one revision; the request is atomic.
	 *
	 * @param list<mixed> $items
	 */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v1/items/batch')]
	public function createBatch(array $items): DataResponse {
		return $this->handle(function () use ($items) {
			$uid = $this->uid();
			$created = $this->items->createMany($uid, array_values($items));
			return ['revision' => $this->revisions->current($uid), 'items' => $created];
		}, Http::STATUS_CREATED);
	}

	/** Update with optimistic concurrency: 409 + current copy if $baseRevision is stale. */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'PUT', url: '/api/v1/items/{id}')]
	public function update(string $id, string $wrappedKey, string $data, int $baseRevision): DataResponse {
		return $this->handle(fn () => $this->items->update($this->uid(), $id, $wrappedKey, $data, $baseRevision));
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v1/items/{id}/trash')]
	public function trash(string $id): DataResponse {
		return $this->handle(fn () => $this->items->trash($this->uid(), $id));
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v1/items/{id}/restore')]
	public function restore(string $id): DataResponse {
		return $this->handle(fn () => $this->items->restore($this->uid(), $id));
	}

	/** Permanent delete (also removes attachments). */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'DELETE', url: '/api/v1/items/{id}')]
	public function destroy(string $id): DataResponse {
		return $this->handle(fn () => ['revision' => $this->items->delete($this->uid(), $id)]);
	}
}
