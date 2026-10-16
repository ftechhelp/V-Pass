<?php

declare(strict_types=1);

namespace OCA\VPass\Controller;

use OCA\VPass\Exception\ValidationException;
use OCA\VPass\Service\HibpService;
use OCA\VPass\Service\SettingsService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\AppFramework\Http\DataResponse;
use OCP\IRequest;
use OCP\IUserSession;
use Psr\Log\LoggerInterface;

class BreachController extends BaseApiController {
	public function __construct(
		IRequest $request,
		IUserSession $userSession,
		private HibpService $hibp,
		private SettingsService $settings,
		private LoggerInterface $logger,
	) {
		parent::__construct($request, $userSession);
	}

	/** k-anonymity range lookup: receives a 5-hex-char SHA-1 prefix, never a password. */
	#[NoAdminRequired]
	#[UserRateLimit(limit: 600, period: 600)]
	#[ApiRoute(verb: 'GET', url: '/api/v1/breach/range/{prefix}')]
	public function range(string $prefix): DataResponse {
		$this->uid();
		if (!$this->settings->hibpEnabled()) {
			return new DataResponse(['message' => 'Breach checks are disabled by the administrator'], Http::STATUS_FORBIDDEN);
		}
		return $this->handle(function () use ($prefix) {
			try {
				return ['range' => $this->hibp->range($prefix)];
			} catch (ValidationException $e) {
				throw $e;
			} catch (\Throwable $e) {
				$this->logger->warning('Have I Been Pwned lookup failed', ['exception' => $e]);
				return new DataResponse(['message' => 'Breach service unreachable'], Http::STATUS_BAD_GATEWAY);
			}
		});
	}
}
