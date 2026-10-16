<?php

declare(strict_types=1);

namespace OCA\VPass\Tests\Unit\Service;

use OCA\VPass\Exception\ValidationException;
use OCA\VPass\Service\HibpService;
use OCP\Http\Client\IClient;
use OCP\Http\Client\IClientService;
use OCP\Http\Client\IResponse;
use OCP\ICache;
use OCP\ICacheFactory;
use PHPUnit\Framework\TestCase;

class HibpServiceTest extends TestCase {
	public function testFetchesPaddedRangeOnceAndCaches(): void {
		$cache = $this->createMock(ICache::class);
		$cache->method('get')->willReturn(null);
		$cache->expects($this->once())->method('set')->with('5BAA6', "1E4C9B93F3F0682250B6CF8331B7EE68FD8:3\r\n", 86400);
		$factory = $this->createMock(ICacheFactory::class);
		$factory->method('createDistributed')->willReturn($cache);

		$response = $this->createMock(IResponse::class);
		$response->method('getBody')->willReturn("1E4C9B93F3F0682250B6CF8331B7EE68FD8:3\r\n");
		$client = $this->createMock(IClient::class);
		$client->expects($this->once())->method('get')
			->with('https://api.pwnedpasswords.com/range/5BAA6', $this->callback(fn (array $o) => $o['headers']['Add-Padding'] === 'true'))
			->willReturn($response);
		$clients = $this->createMock(IClientService::class);
		$clients->method('newClient')->willReturn($client);

		$this->assertSame("1E4C9B93F3F0682250B6CF8331B7EE68FD8:3\r\n", (new HibpService($clients, $factory))->range('5baa6'));
	}

	public function testServesFromCache(): void {
		$cache = $this->createMock(ICache::class);
		$cache->method('get')->willReturn('cached');
		$factory = $this->createMock(ICacheFactory::class);
		$factory->method('createDistributed')->willReturn($cache);
		$clients = $this->createMock(IClientService::class);
		$clients->expects($this->never())->method('newClient');
		$this->assertSame('cached', (new HibpService($clients, $factory))->range('ABCDE'));
	}

	public function testOnlyAcceptsFiveHexChars(): void {
		$factory = $this->createMock(ICacheFactory::class);
		$factory->method('createDistributed')->willReturn($this->createMock(ICache::class));
		$service = new HibpService($this->createMock(IClientService::class), $factory);
		foreach (['5BAA61E4C9', 'ZZZZZ', '', '../..'] as $bad) {
			try {
				$service->range($bad);
				$this->fail("Accepted $bad");
			} catch (ValidationException) {
				$this->addToAssertionCount(1);
			}
		}
	}
}
