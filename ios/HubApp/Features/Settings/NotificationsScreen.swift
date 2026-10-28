import HubAPI
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
    @State private var people: [Components.Schemas.Person] = []

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
                    // Kinds older builds can't read come apart, in `more` (intents 0009, 0023).
                    ForEach(settings.more, id: \.kind) { item in
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
                    // Kinds added after build 23 come as plain strings, in
                    // `extra` (intent 0025); only those this build knows show.
                    ForEach(settings.extra.filter { Components.Schemas.DeviceSettings.KindsPayloadPayload(rawValue: $0.kind) != nil }, id: \.kind) { item in
                        Toggle(item.label, isOn: Binding(
                            get: { settings.kinds.contains(where: { $0.rawValue == item.kind }) },
                            set: { on in
                                var kinds = Set(settings.kinds.map(\.rawValue))
                                if on { kinds.insert(item.kind) } else { kinds.remove(item.kind) }
                                Task { await model.setNotificationKinds(Array(kinds)) }
                            }
                        ))
                        .accessibilityIdentifier("kind-\(item.kind)")
                    }
                }
                if model.leaveOn { TimeToLeaveSection(settings: settings, people: people) }
            }
        }
        .navigationTitle("Notifications")
        .task(id: scenePhase == .active) {
            status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
            await model.loadNotificationSettings()
            if let list = try? await model.client.api.listPeople().ok.body.json.people { people = list }
        }
    }
}

/// "Time to leave" (intent 0027, TRF-A1, TRF-A3): whether the phone may
/// share its place, and whose events it covers.
private struct TimeToLeaveSection: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    let settings: Components.Schemas.DeviceSettings
    let people: [Components.Schemas.Person]

    var body: some View {
        Section {
            switch model.leave.status {
            case .authorizedAlways:
                Label("Uses where this phone is, even when the app is closed.", systemImage: "location.fill")
            case .authorizedWhenInUse:
                Label("Uses where this phone is while the app is open, else home.", systemImage: "location")
                Button("Allow all the time, for running late") { model.leave.askAlways() }
            case .notDetermined:
                Text("Starts from home until this phone shares where it is.")
                Button("Share where this phone is") { model.leave.sync(on: true) }
            default:
                Text("Location is off for the hub, so it starts from home.")
                Button("Open iOS Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
            }
            if people.count > 1 {
                ForEach(people, id: \.id) { person in
                    Toggle(person.name, isOn: Binding(
                        get: { covers(person.id) },
                        set: { on in Task { await model.setLeavePeople(choose(person.id, on)) } }
                    ))
                    .accessibilityIdentifier("leave-person")
                }
            }
        } header: {
            Text("Time to leave")
        } footer: {
            Text("Tells you when to leave for an event with a place in the next two hours, from live traffic, and if you're running late. Home's address is in Settings → General on the website. The hub keeps only this phone's latest place, rounded, for a day.")
        }
    }

    private var chosen: [String] { settings.leavePeople ?? [] }
    private func covers(_ id: String) -> Bool { chosen.isEmpty || chosen.contains(id) }

    /// Empty means everyone; switching the last one off isn't allowed.
    private func choose(_ id: String, _ on: Bool) -> [String] {
        var set = Set(chosen.isEmpty ? people.map(\.id) : chosen)
        if on { set.insert(id) } else if set.count > 1 { set.remove(id) }
        return set.count == people.count ? [] : Array(set)
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
                    Text("The hub can tell you when something needs you: a new clash in the next two weeks, each tennis step (open to enter, registered, accepted, the draw, results), his swim meet entries and results, new suggestions, a finished video review, or a source that keeps failing.")
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
