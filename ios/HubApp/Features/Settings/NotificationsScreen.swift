import HubKit
import SwiftUI
import UserNotifications

/// Settings → App → Notifications (intent 0004, PUSH-3): each kind on or
/// off for this phone. iOS's own settings and Focus still apply on top.
struct NotificationsScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @State private var status: UNAuthorizationStatus?

    var body: some View {
        Form {
            Section {
                switch status {
                case .denied:
                    Text("Notifications are off for the hub in iOS Settings.")
                    Button("Open iOS Settings") {
                        if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
                    }
                case .notDetermined:
                    Text("Notifications aren't on yet.")
                    Button("Turn on notifications") { Task { await model.enableNotifications() } }
                default:
                    if let problem = model.pushProblem {
                        Label(problem, systemImage: "exclamationmark.triangle").foregroundStyle(.warning)
                    } else if model.notificationSettings?.registered != true {
                        HStack { ProgressView(); Text("Setting up this phone…") }
                    }
                }
            } footer: {
                Text("A notification's text comes from the hub, not through Apple: Apple only sees that something was sent.")
            }
            if let settings = model.notificationSettings, settings.registered {
                Section("Tell me about") {
                    ForEach(settings.available, id: \.kind) { item in
                        Toggle(item.label, isOn: Binding(
                            get: { settings.kinds.contains(where: { $0.rawValue == item.kind.rawValue }) },
                            set: { on in
                                var kinds = Set(settings.kinds.map(\.rawValue))
                                if on { kinds.insert(item.kind.rawValue) } else { kinds.remove(item.kind.rawValue) }
                                Task { await model.setNotificationKinds(Array(kinds)) }
                            }
                        ))
                        .accessibilityIdentifier("kind-\(item.kind.rawValue)")
                    }
                    // Not in the server's list: builds before it couldn't read it (intent 0009).
                    Toggle("Cookie's answer is ready", isOn: Binding(
                        get: { settings.kinds.contains(where: { $0.rawValue == "cookie" }) },
                        set: { on in
                            var kinds = Set(settings.kinds.map(\.rawValue))
                            if on { kinds.insert("cookie") } else { kinds.remove("cookie") }
                            Task { await model.setNotificationKinds(Array(kinds)) }
                        }
                    ))
                    .accessibilityIdentifier("kind-cookie")
                }
            }
        }
        .navigationTitle("Notifications")
        .task(id: scenePhase == .active) {
            status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
            await model.loadNotificationSettings()
        }
    }
}

/// Asked once after sign-in, before iOS's own question (plan N7.4).
struct NotificationsPrompt: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 12) {
            // The explanation scrolls at large text sizes; the buttons stay put.
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Image(systemName: "bell.badge").font(.largeTitle).foregroundStyle(.tint).accessibilityHidden(true)
                    Text("Turn on notifications?").font(.title2.bold())
                    Text("The hub can tell you when something needs you: a new clash in the next two weeks, a tennis draw or entry, a finished video review, or a source that keeps failing.")
                    Text("You choose which kinds in Settings → App → Notifications. What they say comes from the hub, not through Apple.")
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollBounceBehavior(.basedOnSize)
            Button { Task { await model.enableNotifications() } } label: {
                Text("Turn on").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            Button("Not now") { model.declineNotifications() }
                .frame(maxWidth: .infinity)
        }
        .padding(24)
        .presentationDetents([.large])
    }
}
