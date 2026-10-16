<?php

declare(strict_types=1);

namespace OCA\VPass\Service;

use OCA\VPass\Exception\ValidationException;
use OCP\Http\Client\IClientService;
use OCP\ICache;
use OCP\ICacheFactory;

/**
 * Proxy for the Have I Been Pwned "range" API (k-anonymity). The browser sends
 * only the first 5 hex chars of a SHA-1 hash; responses are padded and cached.
 * Proxying avoids loosening the CSP and lets admins disable lookups entirely.
 */
class HibpService {
	private const ENDPOINT = 'https://api.pwnedpasswords.com/range/';
	private const CACHE_TTL = 86400;

	private ICache $cache;

	public function __construct(
		private IClientService $clients,
		ICacheFactory $cacheFactory,
	) {
		$this->cache = $cacheFactory->createDistributed('vpass-hibp');
	}

	public function range(string $prefix): string {
		$prefix = strtoupper($prefix);
		if (!preg_match('/^[0-9A-F]{5}$/', $prefix)) {
			throw new ValidationException('Prefix must be 5 hex characters');
		}
		$cached = $this->cache->get($prefix);
		if (is_string($cached)) {
			return $cached;
		}
		$response = $this->clients->newClient()->get(self::ENDPOINT . $prefix, [
			'headers' => [
				'Add-Padding' => 'true',
				'User-Agent' => 'V-Pass-for-Nextcloud',
			],
			'timeout' => 10,
		]);
		$body = (string)$response->getBody();
		$this->cache->set($prefix, $body, self::CACHE_TTL);
		return $body;
	}
}
