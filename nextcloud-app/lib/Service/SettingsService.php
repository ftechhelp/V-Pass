<?php

declare(strict_types=1);

namespace OCA\VPass\Service;

use OCA\VPass\AppInfo\Application;
use OCA\VPass\Exception\ValidationException;
use OCP\IAppConfig;
use OCP\Util;

/** Admin-configurable settings. */
class SettingsService {
	public const DEFAULT_MAX_ATTACHMENT_MB = 50;
	public const DEFAULT_TRASH_RETENTION_DAYS = 30;

	public function __construct(
		private IAppConfig $config,
	) {
	}

	public function hibpEnabled(): bool {
		return $this->config->getValueBool(Application::APP_ID, 'hibp_enabled', true);
	}

	public function maxAttachmentMb(): int {
		return $this->config->getValueInt(Application::APP_ID, 'max_attachment_mb', self::DEFAULT_MAX_ATTACHMENT_MB);
	}

	/** Effective limit: the admin setting, capped by PHP's upload limits. */
	public function maxAttachmentBytes(): int {
		$configured = $this->maxAttachmentMb() * 1024 * 1024;
		$php = Util::uploadLimit();
		return is_infinite((float)$php) ? $configured : (int)min($configured, $php);
	}

	public function trashRetentionDays(): int {
		return $this->config->getValueInt(Application::APP_ID, 'trash_retention_days', self::DEFAULT_TRASH_RETENTION_DAYS);
	}

	/**
	 * @return array{hibpEnabled: bool, maxAttachmentMb: int, trashRetentionDays: int}
	 */
	public function toArray(): array {
		return [
			'hibpEnabled' => $this->hibpEnabled(),
			'maxAttachmentMb' => $this->maxAttachmentMb(),
			'trashRetentionDays' => $this->trashRetentionDays(),
		];
	}

	public function update(?bool $hibpEnabled, ?int $maxAttachmentMb, ?int $trashRetentionDays): void {
		if ($maxAttachmentMb !== null && ($maxAttachmentMb < 1 || $maxAttachmentMb > 1024)) {
			throw new ValidationException('Attachment limit must be between 1 and 1024 MB');
		}
		if ($trashRetentionDays !== null && ($trashRetentionDays < 1 || $trashRetentionDays > 3650)) {
			throw new ValidationException('Trash retention must be between 1 and 3650 days');
		}
		if ($hibpEnabled !== null) {
			$this->config->setValueBool(Application::APP_ID, 'hibp_enabled', $hibpEnabled);
		}
		if ($maxAttachmentMb !== null) {
			$this->config->setValueInt(Application::APP_ID, 'max_attachment_mb', $maxAttachmentMb);
		}
		if ($trashRetentionDays !== null) {
			$this->config->setValueInt(Application::APP_ID, 'trash_retention_days', $trashRetentionDays);
		}
	}
}
