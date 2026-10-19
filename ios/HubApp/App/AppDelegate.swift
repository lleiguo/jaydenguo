import HubKit
import UIKit
import UserNotifications

/// UIKit callbacks SwiftUI doesn't offer: the player's landscape rule
/// (IVID-2), the APNs token and notification taps (PUSH-3, PUSH-4).
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    /// Set when the app's model is made, before any callback below.
    @MainActor static weak var model: AppModel?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        MainActor.assumeIsolated { OrientationLock.allowLandscape ? .allButUpsideDown : .portrait }
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = Push.hex(deviceToken)
        Task { @MainActor in await Self.model?.registerPush(token: token) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Task { @MainActor in Self.model?.pushUnavailable() }
    }

    // Shown while the app is open too, with the text the extension fetched.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    // PUSH-4: a tap opens its screen.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        let id = Push.id(from: info)
        let target = info["target"] as? String
        let kind = info["kind"] as? String
        await MainActor.run { Self.model?.openNotification(id: id, target: target, kind: kind) }
    }
}
