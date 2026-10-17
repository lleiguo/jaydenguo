import HubKit
import SwiftUI

/// The tennis and swimming pages a link or row can open (ITEN-1, ISWM-1).
struct SportDestination: View {
    let route: Route

    var body: some View {
        switch route {
        case .tournament(let id): TournamentScreen(id: id)
        case .tennisEntry(let id): TennisEntryScreen(id: id)
        case .player(let key): PlayerScreen(key: key)
        case .tennisResults: TennisResultsScreen()
        case .tennisAccuracy: AccuracyScreen()
        case .meet(let id): MeetScreen(id: id)
        case .swimEvent(let key): SwimEventScreen(key: key)
        default: EmptyView()
        }
    }
}

/// Loads a screen's data, reloads when the server's data changes (CAL-8)
/// and on pull to refresh, and keeps what's shown if a reload fails. With
/// `pull`, pulling down runs it first (Tennis: the quick check, TPR-1).
struct RemoteContent<Value, Content: View>: View {
    @Environment(AppModel.self) private var model
    let fetch: @MainActor () async throws -> Value
    var pull: (@MainActor () async -> Void)? = nil
    @ViewBuilder let content: (Value) -> Content
    @State private var state: Loadable<Value> = .loading

    var body: some View {
        LoadableView(state: state, content: content)
            .task(id: model.changes) { await refresh() }
            .refreshable {
                await pull?()
                await refresh()
            }
    }

    private func refresh() async {
        let next = await load(fetch)
        if case .failed = next, state.value != nil { return }
        state = next
    }
}

/// "Refresh" on a sport screen (APP-7): syncs its source and follows along.
struct RefreshSourcesButton: View {
    @Environment(AppModel.self) private var model
    let kind: String
    let site: String

    var body: some View {
        if model.refreshing.contains(kind) {
            ProgressView().accessibilityLabel("Refreshing from \(site)")
        } else {
            Button {
                Task { await model.refreshSources(kind: kind, site: site) }
            } label: {
                Label("Refresh from \(site)", systemImage: "arrow.clockwise")
            }
        }
    }
}

/// A caption line in secondary text.
struct Caption: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text).font(.caption).foregroundStyle(.secondary)
    }
}

/// "✎ Corrected by you", "✎ Added by you" and "⚠ The site says …" under a
/// result (TEN-8, SWM-7).
struct CorrectionNotes: View {
    let corrected: Bool
    let manual: Bool
    let disagrees: Bool
    /// "The site says W 6–3 6–4", or nil when the site no longer lists it.
    let siteSays: String?
    let site: String

    var body: some View {
        if corrected { Caption("✎ Corrected by you") }
        else if manual { Caption("✎ Added by you") }
        if disagrees {
            Label(siteSays.map { "\(site) says \($0)" } ?? "\(site) no longer lists this", systemImage: "exclamationmark.triangle.fill")
                .font(.caption.weight(.medium))
                .foregroundStyle(.red)
                .accessibilityIdentifier("sourceDisagrees")
        }
    }
}
