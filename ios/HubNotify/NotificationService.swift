import Foundation
import HubKit
import UserNotifications

/// Rewrites the generic push ("Hub: New update") with the real text before
/// it shows (intent 0004, PUSH-2). Apple only ever carries the id; the text
/// comes from the site with the device token. If that fails in time, the
/// generic text shows.
///
/// iOS calls in on its own threads; the lock makes sure the notification is
/// delivered once, by whichever of the fetch and the time limit comes first.
final class NotificationService: UNNotificationServiceExtension, @unchecked Sendable {
    private let lock = NSLock()
    private var content: UNMutableNotificationContent?
    private var deliver: ((UNNotificationContent) -> Void)?
    private var task: Task<Void, Never>?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler handler: @escaping (UNNotificationContent) -> Void) {
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent,
              let id = Push.id(from: request.content.userInfo)
        else { return handler(request.content) }
        let group = ResponseCache.bundleAppGroup
        let info = Bundle.main.infoDictionary
        let config = HubConfig(
            baseURL: SharedSettings(appGroup: group).baseURL ?? HubConfig.productionURL,
            appVersion: info?["CFBundleShortVersionString"] as? String ?? "0",
            deviceName: "notification"
        )
        let client = HubClient(config: config, tokens: KeychainTokenStore(accessGroup: group))
        lock.withLock {
            self.content = content
            deliver = handler
            task = Task { [self] in finish(with: await Push.text(id: id, client: client)) }
        }
    }

    // iOS is about to give up: show what we have.
    override func serviceExtensionTimeWillExpire() {
        lock.withLock { task }?.cancel()
        finish(with: nil)
    }

    private func finish(with text: Push.Text?) {
        let pending: (UNMutableNotificationContent, (UNNotificationContent) -> Void)? = lock.withLock {
            guard let content, let deliver else { return nil }
            self.deliver = nil
            return (content, deliver)
        }
        guard let (content, deliver) = pending else { return }
        if let text {
            content.title = text.title
            content.body = text.body
            content.userInfo["target"] = text.target
            content.threadIdentifier = text.kind.rawValue
        }
        deliver(content)
    }
}
