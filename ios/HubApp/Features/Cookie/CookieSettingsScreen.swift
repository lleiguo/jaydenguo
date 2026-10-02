import HubAPI
import HubKit
import SwiftUI

/// Settings → Cookie (intent 0007): what she has cost this month against
/// the monthly limit (LIM-5), her memory (MEM-4), and clearing the chat
/// (MEM-9).
struct CookieSettingsScreen: View {
    @Environment(AppModel.self) private var model
    @State private var state: Loadable<CookieSettings> = .loading
    @State private var confirmClear = false

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

    private func refresh() async {
        let next = await load { try await model.client.api.getAssistantSettings().ok.body.json }
        if case .failed = next, state.value != nil { return }
        state = next
    }

    private func setCap(_ cap: Double) async {
        do {
            state = .loaded(try await model.client.api.updateAssistantSettings(body: .json(.init(monthlyCapUsd: cap))).ok.body.json)
        } catch {
            model.show(HubError.from(error)?.message ?? "Couldn't change the limit.")
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
