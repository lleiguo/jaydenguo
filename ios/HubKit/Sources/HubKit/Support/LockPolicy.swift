import Foundation

/// When the app locks (intent 0004, SEC-2): on launch, and after five
/// minutes in the background, unless the owner turned the lock off.
public enum LockPolicy {
    public static let grace: TimeInterval = 5 * 60

    public static func shouldLock(enabled: Bool, backgroundedAt: Date?, now: Date = .now) -> Bool {
        guard enabled else { return false }
        guard let backgroundedAt else { return true }
        return now.timeIntervalSince(backgroundedAt) >= grace
    }
}
