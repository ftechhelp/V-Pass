<?php

declare(strict_types=1);

namespace OCA\VPass\Listener;

use OCA\VPass\Service\VaultService;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\User\Events\UserDeletedEvent;

/**
 * Remove the vault, its items and attachment files when a Nextcloud user is deleted.
 *
 * @template-implements IEventListener<Event>
 */
class UserDeletedListener implements IEventListener {
	public function __construct(
		private VaultService $vaults,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof UserDeletedEvent) {
			return;
		}
		$this->vaults->deleteAllForUser($event->getUser()->getUID());
	}
}
