<?php

declare(strict_types=1);

namespace OCA\VPass\Controller;

use OCA\VPass\Exception\NotFoundException;
use OCA\VPass\Exception\ValidationException;
use OCA\VPass\Service\AttachmentService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\Http\StreamResponse;
use OCP\AppFramework\OCS\OCSNotFoundException;
use OCP\IRequest;
use OCP\IUserSession;

class AttachmentController extends BaseApiController {
	public function __construct(
		IRequest $request,
		IUserSession $userSession,
		private AttachmentService $attachments,
	) {
		parent::__construct($request, $userSession);
	}

	/** Multipart upload: fields id, wrappedKey, meta + the encrypted blob as "file". */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v1/items/{itemId}/attachments')]
	public function upload(string $itemId, string $id, string $wrappedKey, string $meta): DataResponse {
		return $this->handle(function () use ($itemId, $id, $wrappedKey, $meta) {
			$file = $this->request->getUploadedFile('file');
			if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_string($file['tmp_name'] ?? null)) {
				$tooBig = in_array($file['error'] ?? null, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true);
				throw new ValidationException(
					$tooBig ? 'File is larger than the server allows' : 'No file uploaded',
					$tooBig ? Http::STATUS_REQUEST_ENTITY_TOO_LARGE : Http::STATUS_BAD_REQUEST,
				);
			}
			$handle = fopen($file['tmp_name'], 'rb');
			if ($handle === false) {
				throw new ValidationException('Could not read upload');
			}
			try {
				return $this->attachments->create($this->uid(), $itemId, $id, $wrappedKey, $meta, $handle, (int)$file['size']);
			} finally {
				if (is_resource($handle)) {
					fclose($handle);
				}
			}
		}, Http::STATUS_CREATED);
	}

	/** Streams the encrypted blob; decryption happens in the client. */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/attachments/{id}')]
	public function download(string $id): Response {
		try {
			[$attachment, $file] = $this->attachments->open($this->uid(), $id);
		} catch (NotFoundException|ValidationException $e) {
			throw new OCSNotFoundException($e->getMessage());
		}
		$response = new StreamResponse($file->read());
		$response->addHeader('Content-Type', 'application/octet-stream');
		$response->addHeader('Content-Length', (string)$file->getSize());
		$response->addHeader('Content-Disposition', 'attachment; filename="' . $attachment->getUuid() . '.bin"');
		$response->addHeader('Cache-Control', 'private, no-store');
		return $response;
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'DELETE', url: '/api/v1/attachments/{id}')]
	public function destroy(string $id): DataResponse {
		return $this->handle(fn () => ['revision' => $this->attachments->delete($this->uid(), $id)]);
	}
}
