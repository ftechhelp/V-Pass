<?php

declare(strict_types=1);

namespace OCA\VPass\Exception;

/**
 * Optimistic-concurrency failure: the client edited an outdated revision,
 * or tried to create an object whose id already exists.
 */
class ConflictException extends \Exception {
	public function __construct(string $message, private ?\JsonSerializable $current = null) {
		parent::__construct($message);
	}

	public function getCurrent(): ?\JsonSerializable {
		return $this->current;
	}
}
