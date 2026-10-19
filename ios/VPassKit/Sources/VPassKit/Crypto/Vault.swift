/// Key hierarchy
///
///   master password ──Argon2id──▶ master key ──KDF──▶ KEK ──wraps──▶ Vault Key (VK)
///   recovery key ─────────────────────────────KDF──▶ RK  ──wraps──▶ VK
///   VK ──wraps──▶ per-item / per-folder keys ──encrypt──▶ item payloads
///
/// Only wrapped keys and ciphertext ever reach the server. The iPhone app never
/// creates vaults or changes the master password; the web app does that.
public struct VaultKeyset: Codable, Sendable, Equatable {
	public var kdf: KdfParams
	/// VK wrapped by the key-encryption key derived from the master password.
	public var wrappedVaultKey: String
	/// VK wrapped by the key derived from the recovery key.
	public var recoveryWrappedVaultKey: String
}

public struct NewVault: Sendable {
	public var keyset: VaultKeyset
	public var vaultKey: Bytes
	public var recoveryKey: String
}

private func passwordWrappingKey(_ password: String, kdf: KdfParams) throws -> Bytes {
	var masterKey = try deriveMasterKey(password, params: kdf)
	defer { wipe(&masterKey) }
	return deriveSubkey(masterKey, context: KDFContext.keyEncryptionKey)
}

/// Used by the tests and the UI-test stub; real vaults are created in the web app.
public func createVaultKeys(masterPassword: String, kdf: KdfParams) throws -> NewVault {
	let vaultKey = generateKey()
	var kek = try passwordWrappingKey(masterPassword, kdf: kdf)
	defer { wipe(&kek) }
	var secret = generateKey()
	defer { wipe(&secret) }
	var rk = deriveSubkey(secret, context: KDFContext.recovery)
	defer { wipe(&rk) }
	let keyset = VaultKeyset(
		kdf: kdf,
		wrappedVaultKey: wrapKey(kek, vaultKey, aad: AAD.vaultKeyPassword),
		recoveryWrappedVaultKey: wrapKey(rk, vaultKey, aad: AAD.vaultKeyRecovery)
	)
	return NewVault(keyset: keyset, vaultKey: vaultKey, recoveryKey: formatRecoveryKey(secret))
}

public func unlockWithPassword(_ password: String, kdf: KdfParams, wrappedVaultKey: String) throws -> Bytes {
	var kek = try passwordWrappingKey(password, kdf: kdf)
	defer { wipe(&kek) }
	do {
		return try unwrapKey(kek, wrappedVaultKey, aad: AAD.vaultKeyPassword)
	} catch is DecryptionError {
		throw WrongPasswordError()
	}
}

public func unlockWithRecoveryKey(_ recoveryKey: String, recoveryWrappedVaultKey: String) throws -> Bytes {
	var secret = try parseRecoveryKey(recoveryKey)
	defer { wipe(&secret) }
	var rk = deriveSubkey(secret, context: KDFContext.recovery)
	defer { wipe(&rk) }
	do {
		return try unwrapKey(rk, recoveryWrappedVaultKey, aad: AAD.vaultKeyRecovery)
	} catch is DecryptionError {
		throw InvalidRecoveryKeyError(.mismatch)
	}
}
