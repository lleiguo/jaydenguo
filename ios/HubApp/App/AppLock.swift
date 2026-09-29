import HubKit
import LocalAuthentication
import Observation
import SwiftUI

/// Face ID (or the passcode) on launch and after five minutes away (intent
/// 0004, SEC-2), and a cover over the app in the app switcher.
@MainActor @Observable
final class AppLock {
    private static let enabledKey = "appLockEnabled"

    var enabled: Bool {
        didSet { UserDefaults.standard.set(enabled, forKey: Self.enabledKey) }
    }
    private(set) var isLocked: Bool
    private(set) var isCovered = false
    private var backgroundedAt: Date?
    private let forceOff: Bool

    init(forceOff: Bool = false) {
        self.forceOff = forceOff
        let stored = UserDefaults.standard.object(forKey: Self.enabledKey) as? Bool ?? true
        enabled = stored
        isLocked = !forceOff && LockPolicy.shouldLock(enabled: stored, backgroundedAt: nil)
    }

    func sceneChanged(_ phase: ScenePhase) {
        switch phase {
        case .background:
            backgroundedAt = backgroundedAt ?? .now
            isCovered = true
        case .inactive:
            isCovered = true
        case .active:
            isCovered = false
            if !forceOff, LockPolicy.shouldLock(enabled: enabled, backgroundedAt: backgroundedAt) { isLocked = true }
            backgroundedAt = nil
        @unknown default:
            break
        }
    }

    /// Just signed in with Google: no need to ask for Face ID straight away.
    func didSignIn() { isLocked = false }

    func unlock() async {
        let context = LAContext()
        context.localizedCancelTitle = "Not now"
        var error: NSError?
        // No passcode set at all: the lock can't work, so don't trap the owner.
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            isLocked = false
            return
        }
        if (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock the hub")) == true {
            isLocked = false
        }
    }
}
