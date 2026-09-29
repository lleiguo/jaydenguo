import CryptoKit
import Foundation

/// The last response of each GET, for reading offline (intent 0004, OFF-1)
/// and for the widgets (EXT-2). Files live in the app group so the widgets
/// can read them, readable after the first unlock (widgets run while the
/// phone is locked), kept out of backups, and wiped on sign-out (OFF-3,
/// SEC-3).
public final class ResponseCache: Sendable {
    public let directory: URL
    /// Most responses kept; the oldest go first.
    let limit: Int

    public init(directory: URL, limit: Int = 300) {
        self.directory = directory
        self.limit = limit
    }

    /// The app group's cache, or the app's own caches folder when the group
    /// isn't available (tests, or a build signed without it).
    public static func shared(appGroup: String?) -> ResponseCache {
        let base = appGroup.flatMap { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: $0) }
            ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        return ResponseCache(directory: base.appendingPathComponent("HubCache", isDirectory: true))
    }

    /// The app group named in the bundle's Info.plist (`HubAppGroup`).
    public static var bundleAppGroup: String? {
        (Bundle.main.object(forInfoDictionaryKey: "HubAppGroup") as? String).flatMap { $0.isEmpty ? nil : $0 }
    }

    /// A request's file name: the path and query, hashed.
    public static func key(path: String) -> String {
        SHA256.hash(data: Data(path.utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
    }

    public func store(_ data: Data, key: String, at date: Date = .now) {
        do {
            try prepare()
            let url = file(key)
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            try FileManager.default.setAttributes([.modificationDate: date], ofItemAtPath: url.path)
            prune()
        } catch {
            // A full disk shouldn't break the app; the next fetch tries again.
        }
    }

    /// The stored body and when it was fetched.
    public func load(key: String) -> (data: Data, fetchedAt: Date)? {
        let url = file(key)
        guard let data = try? Data(contentsOf: url),
              let date = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date
        else { return nil }
        return (data, date)
    }

    /// Removes everything, including the widget snapshot (SEC-3).
    public func wipe() {
        try? FileManager.default.removeItem(at: directory)
    }

    func file(_ key: String) -> URL { directory.appendingPathComponent("\(key).json") }

    private func prepare() throws {
        guard !FileManager.default.fileExists(atPath: directory.path) else { return }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var url = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try url.setResourceValues(values)
    }

    private func prune() {
        let keys: [URLResourceKey] = [.contentModificationDateKey]
        guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: keys),
              files.count > limit
        else { return }
        let dated = files.map { ($0, (try? $0.resourceValues(forKeys: Set(keys)).contentModificationDate) ?? .distantPast) }
        for (url, _) in dated.sorted(by: { $0.1 < $1.1 }).prefix(files.count - limit) where url.lastPathComponent != WidgetSnapshot.fileName {
            try? FileManager.default.removeItem(at: url)
        }
    }
}
