<?php

declare(strict_types=1);

namespace OCA\VPass\Controller;

use OCA\VPass\Service\SettingsService;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\DataResponse;
use OCP\IRequest;
use OCP\IUserSession;

/** Admin-only (no #[NoAdminRequired]). */
class AdminSettingsController extends BaseApiController {
	public function __construct(
		IRequest $request,
		IUserSession $userSession,
		private SettingsService $settings,
	) {
		parent::__construct($request, $userSession);
	}

	#[ApiRoute(verb: 'GET', url: '/api/v1/admin/settings')]
	public function get(): DataResponse {
		return $this->handle(fn () => $this->settings->toArray());
	}

	#[ApiRoute(verb: 'PUT', url: '/api/v1/admin/settings')]
	public function update(?bool $hibpEnabled = null, ?int $maxAttachmentMb = null, ?int $trashRetentionDays = null): DataResponse {
		return $this->handle(function () use ($hibpEnabled, $maxAttachmentMb, $trashRetentionDays) {
			$this->settings->update($hibpEnabled, $maxAttachmentMb, $trashRetentionDays);
			return $this->settings->toArray();
		});
	}
}
