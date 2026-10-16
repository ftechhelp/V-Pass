<?php

declare(strict_types=1);

namespace OCA\VPass\Exception;

use OCP\AppFramework\Http;

class ValidationException extends \Exception {
	public function __construct(string $message, private int $status = Http::STATUS_BAD_REQUEST) {
		parent::__construct($message);
	}

	public function getStatus(): int {
		return $this->status;
	}
}
