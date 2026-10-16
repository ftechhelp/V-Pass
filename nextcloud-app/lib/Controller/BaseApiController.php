<?php

declare(strict_types=1);

namespace OCA\VPass\Controller;

use OCA\VPass\AppInfo\Application;
use OCA\VPass\Exception\ConflictException;
use OCA\VPass\Exception\NotFoundException;
use OCA\VPass\Exception\ValidationException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\OCS\OCSForbiddenException;
use OCP\AppFramework\OCS\OCSNotFoundException;
use OCP\AppFramework\OCSController;
use OCP\IRequest;
use OCP\IUserSession;

/**
 * Common plumbing for the V-Pass OCS API: resolves the current user and maps
 * service exceptions to HTTP status codes the clients understand.
 */
abstract class BaseApiController extends OCSController {
	public function __construct(
		IRequest $request,
		private IUserSession $userSession,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	protected function uid(): string {
		$user = $this->userSession->getUser();
		if ($user === null) {
			throw new OCSForbiddenException();
		}
		return $user->getUID();
	}

	/**
	 * @param callable(): mixed $action
	 */
	protected function handle(callable $action, int $status = Http::STATUS_OK): DataResponse {
		try {
			$result = $action();
			return $result instanceof DataResponse ? $result : new DataResponse($result, $status);
		} catch (NotFoundException $e) {
			throw new OCSNotFoundException($e->getMessage());
		} catch (ValidationException $e) {
			return new DataResponse(['message' => $e->getMessage()], $e->getStatus());
		} catch (ConflictException $e) {
			return new DataResponse(['message' => $e->getMessage(), 'current' => $e->getCurrent()], Http::STATUS_CONFLICT);
		}
	}
}
