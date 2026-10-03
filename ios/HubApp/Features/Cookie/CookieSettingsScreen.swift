import HubAPI
import HubKit
import SwiftUI

/// Settings → Cookie (intent 0007): what she has cost this month against
/// the monthly limit (LIM-5), spoken answers (VOX-5), the web (TOOL-17, CSEC-3), her memory
/// (MEM-4), clearing the chat (MEM-9), and the calendar she adds events to
/// (intent 0008, GCW-1, GCW-8).
struct CookieSettingsScreen: View {
    @Environment(AppModel.self) private var model
    @State private var state: Loadable<CookieSettings> = .loading
    @State private var confirmClear = false
    /// The Google calendars the hub reads, any of which she could add to.
    @State private var calendars: [SourceView] = []

    private static let money = FloatingPointFormatStyle<Double>.Currency(code: "USD")

    var body: some View {
        LoadableView(state: state) { settings in
            Form {
                Section {
                    LabeledContent("Spent so far", value: settings.monthSpendUsd.formatted(Self.money))
                    Stepper(
                        "Monthly limit: \(settings.monthlyCapUsd.formatted(Self.money.precision(.fractionLength(0))))",
                        value: Binding(get: { settings.monthlyCapUsd }, set: { cap in Task { await setCap(cap) } }),
                        in: 0...50, step: 1
                    )
                    .accessibilityIdentifier("cookieCap")
                    ProgressView(value: min(settings.monthSpendUsd, settings.monthlyCapUsd), total: max(settings.monthlyCapUsd, 0.01))
                        .tint(settings.monthSpendUsd >= settings.monthlyCapUsd ? .red : .accentColor)
                        .accessibilityLabel("\(Int(settings.monthlyCapUsd > 0 ? settings.monthSpendUsd / settings.monthlyCapUsd * 100 : 100)) percent of the limit used")
                } header: {
                    Text("This month")
                } footer: {
                    Text("An estimate in US dollars, from what each question used. At the limit Cookie stops answering until next month, or until you raise it.")
                }
                Section {
                    Toggle("Spoken answers", isOn: Binding(get: { settings.speak }, set: { on in Task { await setSpeak(on) } }))
                        .accessibilityIdentifier("cookieSpeak")
                } footer: {
                    Text("When you talk to Cookie, she answers out loud as well as in writing. Typed questions are never read out.")
                }
                Section {
                    Toggle("Use the web", isOn: Binding(get: { settings.web }, set: { on in Task { await setWeb(on) } }))
                        .accessibilityIdentifier("cookieWeb")
                    NavigationLink {
                        CookiePrivateWordsScreen(words: settings.privateTerms) { words in await setPrivateWords(words) }
                    } label: {
                        LabeledContent("Never send to the web", value: "\(settings.privateTerms.count) words")
                    }
                    .accessibilityIdentifier("cookiePrivateWords")
                } footer: {
                    Text("Off, Cookie answers only from the hub and her memory. On, she can search Google or read a link you give her. A search never includes the family's names or the words on this list, and its answer is Google's, shown as it is. Google keeps searches for up to three days.")
                }
                adding(settings)
                Section {
                    NavigationLink { CookieMemoryScreen() } label: { Label("Memory", systemImage: "brain") }
                        .accessibilityIdentifier("cookieMemoryLink")
                } footer: {
                    Text("What Cookie was told to remember.")
                }
                Section {
                    Button("Clear history", role: .destructive) { confirmClear = true }
                        .accessibilityIdentifier("cookieClear")
                } footer: {
                    Text("Removes the words of every question and answer, for everyone. What they cost stays on the Costs page.")
                }
            }
        }
        .navigationTitle("Cookie")
        .task { await refresh() }
        .refreshable { await refresh() }
        .confirmationDialog("Clear the chat with Cookie for everyone?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Clear history", role: .destructive) { Task { await clear() } }
        }
    }

    @ViewBuilder
    private func adding(_ settings: CookieSettings) -> some View {
        Section {
            if calendars.count > 1 {
                Picker("Calendar she adds to", selection: Binding(
                    get: { settings.addCalendarSourceId ?? "" },
                    set: { id in Task { await setAddCalendar(id) } }
                )) {
                    if settings.addCalendarSourceId == nil { Text("Choose…").tag("") }
                    ForEach(calendars, id: \.id) { Text($0.name).tag($0.id) }
                }
                .accessibilityIdentifier("cookieAddCalendar")
            }
            if settings.canAdd {
                Label("Cookie can add events", systemImage: "calendar.badge.plus")
                    .accessibilityIdentifier("cookieCanAdd")
            } else {
                Button {
                    model.go(.accounts)
                } label: {
                    Label("Connect Google to let Cookie add events", systemImage: "link.badge.plus")
                }
                .accessibilityIdentifier("cookieConnectAdd")
            }
        } header: {
            Text("Adding events")
        } footer: {
            Text(settings.canAdd
                ? "Ask her to add one event, like “add a dentist appointment for Sam on Thursday at 6 pm”. It shows in the hub at once and on the family's Google Calendar a few seconds later. Each answer has Undo for ten minutes."
                : "Cookie can add an event you ask for to the family's Google Calendar once Google allows it: on the Accounts page, connect Google and choose “Let Cookie add events”.")
        }
    }

    private func setAddCalendar(_ id: String) async {
        guard !id.isEmpty else { return }
        await update("Couldn't change the calendar.") {
            try await model.client.api.updateAssistantSettings(body: .json(.init(addCalendarSourceId: id))).ok.body.json
        }
    }

    private func refresh() async {
        if let sources = try? await model.client.api.listSources().ok.body.json.sources {
            calendars = sources.filter { $0.kind == "google_calendar" }
        }
        let next = await load { try await model.client.api.getAssistantSettings().ok.body.json }
        if case .failed = next, state.value != nil { return }
        state = next
        if let settings = next.value { model.cookie.spokenAnswers = settings.speak }
    }

    private func setCap(_ cap: Double) async {
        await update("Couldn't change the limit.") {
            try await model.client.api.updateAssistantSettings(body: .json(.init(monthlyCapUsd: cap))).ok.body.json
        }
    }

    private func setSpeak(_ on: Bool) async {
        await update("Couldn't change that.") { try await model.client.api.updateAssistantSettings(body: .json(.init(speak: on))).ok.body.json }
    }

    private func setWeb(_ on: Bool) async {
        await update("Couldn't change that.") { try await model.client.api.updateAssistantSettings(body: .json(.init(web: on))).ok.body.json }
    }

    private func setPrivateWords(_ words: [String]) async -> Bool {
        await update("Couldn't save the list.") {
            try await model.client.api.updateAssistantSettings(body: .json(.init(privateTerms: words))).ok.body.json
        }
    }

    @discardableResult
    private func update(_ fallback: String, _ work: () async throws -> CookieSettings) async -> Bool {
        do {
            let settings = try await work()
            state = .loaded(settings)
            model.cookie.spokenAnswers = settings.speak
            return true
        } catch {
            model.show(HubError.from(error)?.message ?? fallback)
            return false
        }
    }

    private func clear() async {
        do {
            _ = try await model.client.api.clearAssistantHistory().noContent
            model.cookie.reset()
            model.show("Cookie's history is cleared.")
        } catch {
            model.show(HubError.from(error)?.message ?? "Couldn't clear the history.")
        }
    }
}

/// "Never send to the web" (CSEC-3): words a search may not contain. The
/// family's names are refused whether or not they are listed.
struct CookiePrivateWordsScreen: View {
    @Environment(\.dismiss) private var dismiss
    @State var words: [String]
    let save: ([String]) async -> Bool
    @State private var draft = ""

    var body: some View {
        List {
            Section {
                ForEach(words, id: \.self) { Text($0) }
                    .onDelete { offsets in
                        var next = words
                        next.remove(atOffsets: offsets)
                        Task { await set(next) }
                    }
                HStack {
                    TextField("Add a word or name", text: $draft)
                        .submitLabel(.done)
                        .onSubmit(add)
                        .accessibilityIdentifier("cookiePrivateWord")
                    Button("Add", action: add)
                        .disabled(word == nil)
                        .accessibilityIdentifier("cookieAddPrivateWord")
                }
            } footer: {
                Text("The school, your street, clubs, anyone outside the family. The names under People are always kept out of searches, so they don't need to be here. Swipe a word to remove it.")
            }
        }
        .navigationTitle("Never send to the web")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var word: String? {
        let w = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        return w.isEmpty || w.count > 60 || words.contains(where: { $0.caseInsensitiveCompare(w) == .orderedSame }) ? nil : w
    }

    private func add() {
        guard let w = word else { return }
        Task { if await set(words + [w]) { draft = "" } }
    }

    private func set(_ next: [String]) async -> Bool {
        guard await save(next) else { return false }
        words = next
        return true
    }
}
