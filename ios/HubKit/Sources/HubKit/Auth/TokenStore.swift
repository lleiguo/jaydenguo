import Foundation
import Security

/// Holds the device token (intent 0004, SEC-1). Only the Keychain store is
/// used in the app; the in-memory one is for tests and previews.
public protocol TokenStore: Sendable {
    func read() throws -> String?
    func save(_ token: String) throws
    func delete() throws
}

public enum TokenStoreError: Error, Equatable {
    case keychain(OSStatus)
}

/// The Keychain, `AfterFirstUnlockThisDeviceOnly`, in an access group the
/// app's extensions share, so widgets and the notification extension can
/// call the API. Never synced, never in backups.
public struct KeychainTokenStore: TokenStore {
    public let service: String
    public let accessGroup: String?
    private let account = "device-token"

    public init(service: String = "com.jaydenguo.hub", accessGroup: String? = nil) {
        self.service = service
        self.accessGroup = accessGroup
    }

    private func query() -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: false,
        ]
        if let accessGroup { q[kSecAttrAccessGroup as String] = accessGroup }
        return q
    }

    public func read() throws -> String? {
        var q = query()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else { throw TokenStoreError.keychain(status) }
        return String(data: data, encoding: .utf8)
    }

    public func save(_ token: String) throws {
        try delete()
        var q = query()
        q[kSecValueData as String] = Data(token.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(q as CFDictionary, nil)
        guard status == errSecSuccess else { throw TokenStoreError.keychain(status) }
    }

    public func delete() throws {
        let status = SecItemDelete(query() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw TokenStoreError.keychain(status) }
    }

    /// Moves a token saved before the extensions needed it (the app's own
    /// group) into the shared group, so the notification extension can read
    /// it (PUSH-2). Every copy is removed first, so signing out later can't
    /// leave one behind.
    public static func moveIntoGroup(_ group: String, service: String = "com.jaydenguo.hub") throws {
        let any = KeychainTokenStore(service: service)
        guard let token = try any.read() else { return }
        try any.delete()
        try KeychainTokenStore(service: service, accessGroup: group).save(token)
    }
}

public final class MemoryTokenStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var token: String?

    public init(token: String? = nil) { self.token = token }

    public func read() throws -> String? { lock.withLock { token } }
    public func save(_ token: String) throws { lock.withLock { self.token = token } }
    public func delete() throws { lock.withLock { token = nil } }
}
