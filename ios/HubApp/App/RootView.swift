import HubKit
import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppLock.self) private var lock

    var body: some View {
        ZStack {
            switch model.phase {
            case .signedOut:
                SignInView()
            case .signedIn:
                if lock.isLocked { LockedView() } else { MainTabs() }
            case .updateRequired(let message):
                UpdateRequiredView(message: message)
            }
            if lock.isCovered, model.phase == .signedIn {
                PrivacyCover()
            }
        }
    }
}

/// Shown over the app in the app switcher, so a glance doesn't reveal
/// Jayden's schedule (SEC-2).
struct PrivacyCover: View {
    var body: some View {
        ZStack {
            Rectangle().fill(.regularMaterial).ignoresSafeArea()
            Image(systemName: "lock.fill").font(.largeTitle).foregroundStyle(.secondary)
        }
        .accessibilityHidden(true)
    }
}

struct LockedView: View {
    @Environment(AppLock.self) private var lock

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "lock.fill").font(.system(size: 48)).foregroundStyle(.secondary)
            Text("The hub is locked").font(.title2.bold())
            Button("Unlock") { Task { await lock.unlock() } }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
        }
        .task { await lock.unlock() }
    }
}

struct UpdateRequiredView: View {
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label("Update the app", systemImage: "arrow.down.app")
        } description: {
            Text(message)
        } actions: {
            Link("Open TestFlight", destination: URL(string: "itms-beta://")!)
        }
    }
}
