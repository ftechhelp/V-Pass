<?php

declare(strict_types=1);

namespace OCA\VPass\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Initial schema. Every *_key / data / meta column holds a client-side encrypted
 * envelope; the server never has the keys to read them.
 */
class Version1000Date20261016000000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('vpass_vaults')) {
			$table = $schema->createTable('vpass_vaults');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true, 'unsigned' => true]);
			$table->addColumn('user_id', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('kdf_params', Types::STRING, ['notnull' => true, 'length' => 512]);
			$table->addColumn('wrapped_vault_key', Types::STRING, ['notnull' => true, 'length' => 255]);
			$table->addColumn('recovery_wrapped_vault_key', Types::STRING, ['notnull' => true, 'length' => 255]);
			$table->addColumn('revision', Types::BIGINT, ['notnull' => true, 'default' => 0, 'unsigned' => true]);
			$table->addColumn('created_at', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->addColumn('updated_at', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->setPrimaryKey(['id']);
			$table->addUniqueIndex(['user_id'], 'vpass_vaults_user');
		}

		if (!$schema->hasTable('vpass_items')) {
			$table = $schema->createTable('vpass_items');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true, 'unsigned' => true]);
			$table->addColumn('uuid', Types::STRING, ['notnull' => true, 'length' => 36]);
			$table->addColumn('user_id', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('wrapped_key', Types::STRING, ['notnull' => true, 'length' => 255]);
			$table->addColumn('data', Types::TEXT, ['notnull' => false]);
			$table->addColumn('revision', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->addColumn('created_at', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->addColumn('updated_at', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->addColumn('deleted_at', Types::BIGINT, ['notnull' => false, 'unsigned' => true]);
			$table->setPrimaryKey(['id']);
			$table->addUniqueIndex(['user_id', 'uuid'], 'vpass_items_uuid');
			$table->addIndex(['user_id', 'revision'], 'vpass_items_rev');
			$table->addIndex(['deleted_at'], 'vpass_items_deleted');
		}

		if (!$schema->hasTable('vpass_folders')) {
			$table = $schema->createTable('vpass_folders');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true, 'unsigned' => true]);
			$table->addColumn('uuid', Types::STRING, ['notnull' => true, 'length' => 36]);
			$table->addColumn('user_id', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('wrapped_key', Types::STRING, ['notnull' => true, 'length' => 255]);
			$table->addColumn('data', Types::TEXT, ['notnull' => false]);
			$table->addColumn('revision', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->addColumn('created_at', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->addColumn('updated_at', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->setPrimaryKey(['id']);
			$table->addUniqueIndex(['user_id', 'uuid'], 'vpass_folders_uuid');
			$table->addIndex(['user_id', 'revision'], 'vpass_folders_rev');
		}

		if (!$schema->hasTable('vpass_attachments')) {
			$table = $schema->createTable('vpass_attachments');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true, 'unsigned' => true]);
			$table->addColumn('uuid', Types::STRING, ['notnull' => true, 'length' => 36]);
			$table->addColumn('item_uuid', Types::STRING, ['notnull' => true, 'length' => 36]);
			$table->addColumn('user_id', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('wrapped_key', Types::STRING, ['notnull' => true, 'length' => 255]);
			$table->addColumn('meta', Types::TEXT, ['notnull' => false]);
			$table->addColumn('size', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->addColumn('revision', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->addColumn('created_at', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->setPrimaryKey(['id']);
			$table->addUniqueIndex(['user_id', 'uuid'], 'vpass_att_uuid');
			$table->addIndex(['user_id', 'item_uuid'], 'vpass_att_item');
			$table->addIndex(['user_id', 'revision'], 'vpass_att_rev');
		}

		if (!$schema->hasTable('vpass_unlock_keys')) {
			$table = $schema->createTable('vpass_unlock_keys');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true, 'unsigned' => true]);
			$table->addColumn('user_id', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('type', Types::STRING, ['notnull' => true, 'length' => 32]);
			$table->addColumn('credential_id', Types::STRING, ['notnull' => true, 'length' => 2048]);
			$table->addColumn('prf_salt', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('wrapped_vault_key', Types::STRING, ['notnull' => true, 'length' => 255]);
			$table->addColumn('label', Types::STRING, ['notnull' => true, 'length' => 255]);
			$table->addColumn('created_at', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->addColumn('last_used_at', Types::BIGINT, ['notnull' => false, 'unsigned' => true]);
			$table->setPrimaryKey(['id']);
			$table->addIndex(['user_id'], 'vpass_unlock_user');
		}

		if (!$schema->hasTable('vpass_tombstones')) {
			$table = $schema->createTable('vpass_tombstones');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true, 'unsigned' => true]);
			$table->addColumn('user_id', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('object_type', Types::STRING, ['notnull' => true, 'length' => 16]);
			$table->addColumn('object_uuid', Types::STRING, ['notnull' => true, 'length' => 36]);
			$table->addColumn('revision', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->setPrimaryKey(['id']);
			$table->addIndex(['user_id', 'revision'], 'vpass_tomb_rev');
		}

		return $schema;
	}
}
