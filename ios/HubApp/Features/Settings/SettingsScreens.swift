import AuthenticationServices
import HubAPI
import HubKit
import SwiftUI

/// Settings → General (APP-3): the home time zone (CAL-9) and the copy to
/// Google Calendar (GCO-1, GCO-2).
struct GeneralSettingsScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var account: String?

    var body: some View {
        RemoteContent(fetch: { try await model.client.api.getCalendarCopy().ok.body.json }) { copy in
            Form {
                Section {
                    NavigationLink { TimeZonePicker() } label: {
                        LabeledContent("Home time zone", value: model.homeTime.timeZone.identifier)
                    }
                } footer: {
                    Text("Every time in the hub is shown in this zone, wherever the phone is.")
                }
                Section {
                    if copy.accounts.isEmpty {
                        Button("Connect a Google account for the copy") { Task { await connect() } }
                    } else if copy.enabled {
                        Text("On, to \(copy.accounts.first { $0.id == copy.credentialId }?.label ?? "a Google account").")
                            .accessibilityIdentifier("calendarCopyStatus")
                        if let last = copy.lastRunAt.flatMap(HomeTime.parse) {
                            Caption("Last copied \(last.formatted(.relative(presentation: .named)))"
                                + (copy.last.map { ": \(Int($0.created)) added, \(Int($0.updated)) changed, \(Int($0.deleted)) removed" } ?? ""))
                        }
                        if let error = copy.lastError { Text(error).foregroundStyle(.red) }
                        Button("Copy now") { Task { await run() } }
                        Button("Switch off, keep the copy") { Task { await off(keep: true) } }
                        Button("Switch off and delete the copy", role: .destructive) { Task { await off(keep: false) } }
                    } else {
                        Picker("Account", selection: Binding(get: { account ?? copy.accounts.first?.id }, set: { account = $0 })) {
                            ForEach(copy.accounts, id: \.id) { Text($0.label).tag(Optional($0.id)) }
                        }
                        Button("Switch on") { Task { await on(account ?? copy.accounts.first?.id) } }
                    }
                } header: {
                    Text("Copy to Google Calendar")
                } footer: {
                    Text("Copies the first person's events, as they show here, to a separate hub calendar in Google Calendar, once a day and when you tap Copy now. Only that calendar is ever written.")
                }
            }
        }
        .navigationTitle("General")
    }

    private func act(_ done: String, _ work: () async throws -> Void) async {
        do {
            try await work()
            model.show(done)
        } catch {
            model.show(HubError.from(error)?.message ?? "That didn't work.")
        }
        await model.dataChanged()
    }

    private func on(_ id: String?) async {
        guard let id else { return }
        await act("The copy is on.") { try await model.client.patch("/api/v1/calendar-copy", ["enabled": .bool(true), "credentialId": .string(id)]) }
    }

    private func off(keep: Bool) async {
        await act(keep ? "Switched off; the copy stays." : "Switched off; the copy is deleted.") {
            try await model.client.patch("/api/v1/calendar-copy", ["enabled": .bool(false), "keep": .bool(keep)])
        }
    }

    private func run() async {
        await act("Copying. This takes a minute.") { _ = try await model.client.api.runCalendarCopy().accepted }
    }

    private func connect() async {
        do {
            let handoff = try await model.client.api.startHandoff(body: .json(.init(next: "/accounts/google/connect?feature=calendar_copy"))).created.body.json
            guard let url = URL(string: handoff.url) else { return }
            _ = try await webAuthenticationSession.authenticate(
                using: url, callback: .customScheme(SignInRequest.callbackScheme),
                preferredBrowserSession: .ephemeral, additionalHeaderFields: [:]
            )
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            return
        } catch {
            model.show(HubError.from(error)?.message ?? "Couldn't open Google.")
        }
        await model.dataChanged()
    }
}

struct TimeZonePicker: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    var body: some View {
        let zones = TimeZone.knownTimeZoneIdentifiers.filter { search.isEmpty || $0.localizedCaseInsensitiveContains(search) }
        List(zones, id: \.self) { zone in
            Button {
                Task {
                    await model.setHomeTimeZone(zone)
                    dismiss()
                }
            } label: {
                HStack {
                    Text(zone.replacingOccurrences(of: "_", with: " "))
                    Spacer()
                    if zone == model.homeTime.timeZone.identifier { Image(systemName: "checkmark") }
                }
            }
            .foregroundStyle(.primary)
        }
        .searchable(text: $search)
        .navigationTitle("Home time zone")
    }
}

/// Settings → People (owner, 2026-09-28): whose events are on the calendar.
struct PeopleScreen: View {
    @Environment(AppModel.self) private var model
    @State private var newName = ""
    @State private var renaming: Person?
    @State private var renameText = ""

    var body: some View {
        RemoteContent(fetch: { try await model.client.api.listPeople().ok.body.json.people }) { people in
            List {
                Section {
                    ForEach(people, id: \.id) { p in
                        HStack {
                            Text(p.name)
                            if p.isPrimary { Spacer(); Text("First").font(.caption).foregroundStyle(.secondary) }
                        }
                        .swipeActions {
                            if !p.isPrimary {
                                Button { Task { await remove(p) } } label: { Label("Remove", systemImage: "trash") }
                                    .tint(.red)
                            }
                            Button { renaming = p; renameText = p.name } label: { Label("Rename", systemImage: "pencil") }
                        }
                        .accessibilityIdentifier("person")
                    }
                } footer: {
                    Text("Each event belongs to one or more of them, and only the same person's events clash. Swipe to rename or remove.")
                }
                Section {
                    TextField("Add a person", text: $newName)
                        .onSubmit { Task { await add() } }
                        .submitLabel(.done)
                    Button("Add") { Task { await add() } }.disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .navigationTitle("People")
        .alert("Rename", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $renameText)
            Button("Save") { Task { await rename() } }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
    }

    private func act(_ done: String, _ work: () async throws -> Void) async {
        do {
            try await work()
            model.show(done)
        } catch {
            model.show(HubError.from(error)?.message ?? "That didn't work.")
        }
        await model.dataChanged()
    }

    private func add() async {
        let name = newName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        await act("\(name) added.") { _ = try await model.client.api.addPerson(body: .json(.init(name: name))).created }
        newName = ""
    }

    private func rename() async {
        guard let p = renaming else { return }
        await act("Renamed.") { _ = try await model.client.api.renamePerson(path: .init(id: p.id), body: .json(.init(name: renameText))).ok }
        renaming = nil
    }

    private func remove(_ p: Person) async {
        await act("\(p.name) removed.") { _ = try await model.client.api.removePerson(path: .init(id: p.id)).ok }
    }
}

/// Settings → Clashes (CON-2): the next 60 days' clashes, accept or not.
struct ClashesScreen: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        RemoteContent(fetch: { try await model.client.api.listClashes(query: .init(days: 60)).ok.body.json.clashes }) { clashes in
            List {
                ForEach(clashes, id: \.a) { c in
                    VStack(alignment: .leading, spacing: 4) {
                        Label(c.eventA.title, systemImage: c.eventA.category.symbol)
                        Label(c.eventB.title, systemImage: c.eventB.category.symbol)
                        Caption("\(when(c.eventA)) · overlap \(Int(c.overlapMin)) min" + (c.acceptedId != nil ? " · accepted" : ""))
                    }
                    .foregroundStyle(c.acceptedId == nil ? Color.red : .secondary)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("clash")
                    .swipeActions {
                        if let id = c.acceptedId {
                            Button("Un-accept") { Task { await act("Clash no longer accepted.") { _ = try await model.client.api.undoAcceptClash(path: .init(id: id)).noContent } } }
                        } else {
                            Button("Accept") {
                                Task { await act("Clash accepted.") { _ = try await model.client.api.acceptClash(body: .json(.init(a: c.a, b: c.b))).ok } }
                            }
                            .tint(.green)
                        }
                    }
                }
            }
            .overlay { if clashes.isEmpty { ContentUnavailableView("No clashes", systemImage: "checkmark.circle") } }
        }
        .navigationTitle("Clashes")
    }

    private func when(_ e: CalendarEvent) -> String {
        guard let s = e.startDate else { return e.start }
        return "\(model.homeTime.dayTitle(model.homeTime.localDate(s))), \(model.homeTime.time(s))"
    }

    private func act(_ done: String, _ work: () async throws -> Void) async {
        do {
            try await work()
            model.show(done)
        } catch {
            model.show(HubError.from(error)?.message ?? "That didn't work.")
        }
        await model.dataChanged()
    }
}

/// Settings → Deleted (CAL-6): deleted events, to restore.
struct DeletedScreen: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        RemoteContent(fetch: { try await model.client.api.listDeletedEvents().ok.body.json.events }) { events in
            List {
                ForEach(events, id: \.id) { e in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Label(e.title, systemImage: e.category.symbol)
                            Caption(e.startDate.map { "\(model.homeTime.dayTitle(model.homeTime.localDate($0))), \(e.allDay ? "all day" : model.homeTime.time($0))" } ?? e.start)
                        }
                        Spacer()
                        Button("Restore") { Task { await restore(e) } }.buttonStyle(.bordered)
                    }
                    .accessibilityIdentifier("deletedEvent")
                }
            }
            .overlay { if events.isEmpty { ContentUnavailableView("Nothing deleted", systemImage: "trash.slash") } }
        }
        .navigationTitle("Deleted")
    }

    private func restore(_ e: CalendarEvent) async {
        do {
            _ = try await model.client.api.restoreEvent(path: .init(id: e.id)).noContent
            model.show("\(e.title) restored.")
        } catch {
            model.show(HubError.from(error)?.message ?? "Couldn't restore it.")
        }
        await model.dataChanged()
    }
}

/// Settings → Sessions (SEC-4): where the account is signed in, and "Sign
/// out everywhere", which signs this phone out too.
struct SessionsScreen: View {
    @Environment(AppModel.self) private var model
    @State private var confirm = false

    var body: some View {
        RemoteContent(fetch: { try await model.client.api.listSessions().ok.body.json.sessions }) { sessions in
            List {
                Section {
                    // This phone first, then the most recently used.
                    let sorted = sessions.sorted { a, b in
                        a.current != b.current ? a.current : (a.lastSeenAt ?? a.createdAt) > (b.lastSeenAt ?? b.createdAt)
                    }
                    ForEach(Array(sorted.enumerated()), id: \.offset) { _, s in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(s.current ? "This phone" : s.kind == .device ? "iPhone app — \(s.deviceName ?? "unnamed phone")" : (s.userAgent.map(Self.browser) ?? "A browser"))
                            Caption("Signed in \(s.createdAt.formatted(date: .abbreviated, time: .omitted))"
                                + (s.lastSeenAt.map { " · last seen \($0.formatted(.relative(presentation: .named)))" } ?? ""))
                        }
                    }
                }
                Section {
                    Button("Sign out everywhere", role: .destructive) { confirm = true }
                } footer: {
                    Text("Ends every session, including this phone's. Use it if a phone or computer is lost.")
                }
            }
        }
        .navigationTitle("Sessions")
        .confirmationDialog("Sign out everywhere?", isPresented: $confirm, titleVisibility: .visible) {
            Button("Sign out everywhere", role: .destructive) {
                Task {
                    _ = try? await model.client.api.revokeAllSessions().ok
                    await model.signOut()
                }
            }
        }
    }

    /// A short name for a browser's user agent.
    static func browser(_ ua: String) -> String {
        let browser = ua.contains("Edg/") ? "Edge" : ua.contains("Chrome/") ? "Chrome" : ua.contains("Firefox/") ? "Firefox" : ua.contains("Safari/") ? "Safari" : "A browser"
        let os = ua.contains("iPhone") ? "iPhone" : ua.contains("iPad") ? "iPad" : ua.contains("Mac OS X") ? "Mac" : ua.contains("Windows") ? "Windows" : ua.contains("Android") ? "Android" : nil
        return os.map { "\(browser) on \($0)" } ?? browser
    }
}
