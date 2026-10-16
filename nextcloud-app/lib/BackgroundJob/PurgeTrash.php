<?php

declare(strict_types=1);

namespace OCA\VPass\BackgroundJob;

use OCA\VPass\Service\ItemService;
use OCA\VPass\Service\SettingsService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJob;
use OCP\BackgroundJob\TimedJob;
use Psr\Log\LoggerInterface;

/** Daily: permanently delete items that stayed in the trash past the retention period. */
class PurgeTrash extends TimedJob {
	public function __construct(
		ITimeFactory $time,
		private ItemService $items,
		private SettingsService $settings,
		private LoggerInterface $logger,
	) {
		parent::__construct($time);
		$this->setInterval(24 * 60 * 60);
		$this->setTimeSensitivity(IJob::TIME_INSENSITIVE);
	}

	protected function run($argument): void {
		$purged = $this->items->purgeExpired($this->settings->trashRetentionDays());
		if ($purged > 0) {
			$this->logger->info("Purged $purged expired V-Pass trash items");
		}
	}
}
