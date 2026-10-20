import AuthenticationServices
import HubAPI
import HubKit
import SwiftUI

/// Settings → General (APP-3): the home time zone (CAL-9), the copy to
/// Google Calendar (GCO-1, GCO-2) and two-way sync with the household
/// calendar (intent 0020, TWO-9), which replaces the copy.
struct GeneralSettingsScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var account: String?

    var body: some View {
        RemoteContent(fetch: {
            async let copy = model.client.api.getCalendarCopy().ok.body.json
            // A server without it (older than intent 0020) still shows the rest.
            async let household = try? model.client.api.getHouseholdSync().ok.body.json
            return try await (copy: copy, household: household)
        }) { data in
            let copy = data.copy
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
                if let household = data.household { HouseholdSyncSection(sync: household) }
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

/// "Household calendar, both ways" (intent 0020, TWO-9, TWSEC-2): Off, Dry
/// run or On, what a dry run would do, and "Apply" for a held run.
private struct HouseholdSyncSection: View {
    @Environment(AppModel.self) private var model
    let sync: HouseholdSync
    @State private var confirmOn = false

    var body: some View {
        Section {
            if sync.sources.isEmpty {
                Text("Add the household Google calendar on the Sources page first.")
            } else {
                if sync.sources.count > 1 {
                    Picker("Household calendar", selection: Binding(
                        get: { sync.sourceId },
                        set: { id in Task { await choose(id) } }
                    )) {
                        Text("Choose…").tag(String?.none)
                        ForEach(sync.sources, id: \.id) { Text($0.name).tag(Optional($0.id)) }
                    }
                }
                Picker("Two-way sync", selection: Binding(
                    get: { sync.mode },
                    set: { mode in
                        if mode == .on { confirmOn = true } else { Task { await set(mode) } }
                    }
                )) {
                    ForEach(HouseholdMode.ordered, id: \.self) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("householdMode")
                if let source = sync.chosenSource, !source.canWrite {
                    Text("To switch it on, tap \u{201C}Let Cookie add events\u{201D} in Settings → Accounts for the household calendar's Google account.")
                        .font(.callout)
                }
                if sync.mode == .dryRun {
                    if let dry = sync.dryRun {
                        Caption("What the next run would do (\(time(dry.at))):")
                        PlanList(plan: dry.plan)
                    } else {
                        Caption("Working out the list…")
                    }
                }
                if sync.mode == .on, let held = sync.held {
                    Label(held.reason, systemImage: "pause.circle.fill")
                        .foregroundStyle(.orange)
                        .accessibilityIdentifier("householdHeld")
                    PlanList(plan: held.plan)
                    Button("Apply") { Task { await apply() } }
                }
                if sync.mode == .on, let at = sync.lastRunAt {
                    Caption("Last run \(time(at))" + (sync.lastSummary.map { ": \($0)" } ?? "") + ".")
                        .accessibilityIdentifier("householdStatus")
                }
                if let error = sync.lastError { Text(error).foregroundStyle(.red) }
            }
        } header: {
            Text("Household calendar, both ways")
        } footer: {
            Text("Puts every event on the hub into the household calendar in Google, with whose it is in the title, and brings moves made there back. Try Dry run first: it lists what would change without writing anything.")
        }
        .confirmationDialog("Write the hub's events into the household calendar in Google?", isPresented: $confirmOn, titleVisibility: .visible) {
            Button("Switch on") { Task { await set(.on) } }
        } message: {
            Text("The copy to Google Calendar switches off. The first run waits for you to check it.")
        }
    }

    private func time(_ iso: String) -> String { model.homeTime.dayAndTime(iso) }

    private func save(_ done: String, _ work: () async throws -> Void) async {
        do {
            try await work()
            model.show(done)
        } catch {
            model.show(HubError.from(error)?.message ?? "Couldn't save that.")
        }
        await model.dataChanged()
    }

    private func set(_ mode: HouseholdMode) async {
        await save(mode.savedMessage) {
            try await model.client.patch("/api/v1/household-sync", ["mode": .string(mode.rawValue), "sourceId": sync.sourceId.map(JSONField.string) ?? .null])
        }
    }

    // Choosing another calendar switches it off, as on the website.
    private func choose(_ id: String?) async {
        guard let id, id != sync.sourceId else { return }
        await save("Calendar chosen. Two-way sync is off until you switch it on.") {
            try await model.client.patch("/api/v1/household-sync", ["mode": .string("off"), "sourceId": .string(id)])
        }
    }

    private func apply() async {
        await save("Applying. This takes a minute or two.") { _ = try await model.client.api.applyHouseholdSync().accepted }
    }
}

/// What a run would do, by kind of change, each part folded.
private struct PlanList: View {
    let plan: HouseholdPlan
    @Environment(AppModel.self) private var model

    var body: some View {
        if plan.isEmpty {
            Text("Nothing to change: the household calendar is up to date.")
        } else {
            ForEach(plan.sections, id: \.heading) { part in
                DisclosureGroup("\(part.heading): \(HouseholdPlan.count(part.lines))") {
                    ForEach(Array(part.lines.enumerated()), id: \.offset) { _, line in
                        VStack(alignment: .leading) {
                            Text(line.title)
                            Caption(model.homeTime.dayAndTime(line.start))
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
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
                ForEach(clashes, id: \.self) { c in
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

/// One event's open clashes, from a clash notification (intent 0023,
/// NTF-C2): both events side by side, and the ways to settle it here.
struct ClashScreen: View {
    @Environment(AppModel.self) private var model
    let eventId: String

    var body: some View {
        RemoteContent(fetch: {
            try await model.client.api.listClashes(query: .init(days: 60)).ok.body.json.clashes
                .filter { ($0.a == eventId || $0.b == eventId) && $0.acceptedId == nil }
        }) { clashes in
            List {
                if clashes.isEmpty {
                    Section {
                        Label("Already resolved", systemImage: "checkmark.circle").foregroundStyle(.green)
                        Button("Open the event") { open(eventId, day: nil) }
                    }
                }
                ForEach(clashes, id: \.self) { c in
                    Section {
                        side(c.eventA)
                        side(c.eventB)
                        Button("Accept clash: both stay", systemImage: "checkmark") {
                            Task {
                                await act("Clash accepted.") {
                                    _ = try await model.client.api.acceptClash(body: .json(.init(a: c.a, b: c.b))).ok
                                }
                            }
                        }
                        .accessibilityIdentifier("accept-clash")
                    } header: {
                        Text("Overlap \(Int(c.overlapMin)) min")
                    }
                }
            }
        }
        .navigationTitle("Clash")
    }

    @ViewBuilder private func side(_ e: CalendarEvent) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(e.title, systemImage: e.category.symbol).font(.headline)
            Caption([when(e), e.locationName].compactMap { $0 }.joined(separator: " · "))
            HStack {
                Button("Skip this one", systemImage: "forward.end") {
                    Task {
                        await act("Skipped \(e.title).") {
                            _ = try await model.client.api.skipEvent(path: .init(id: e.id), body: .json(.init(skip: true))).ok
                        }
                    }
                }
                .accessibilityIdentifier("skip-\(e.id)")
                Spacer()
                Button("Open") { open(e.id, day: e.startDate.map { model.homeTime.localDate($0) }) }
            }
            .buttonStyle(.bordered)
        }
        .padding(.vertical, 4)
    }

    private func open(_ id: String, day: String?) {
        if let day { model.pendingEventDay = day }
        model.go(.event(id: id))
    }

    private func when(_ e: CalendarEvent) -> String {
        guard let s = e.startDate else { return e.start }
        if e.allDay { return model.homeTime.dayTitle(model.homeTime.localDate(s)) }
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

/// Settings → Deleted (CAL-6, intent 0022 DEL-5): deleted events, from a
/// source or not, to restore.
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
                            if let source = e.source { Caption("From \(source.name)") }
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
