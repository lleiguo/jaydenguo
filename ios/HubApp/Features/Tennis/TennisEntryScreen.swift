import HubAPI
import HubKit
import SwiftUI

/// Intent 0017, ACC-5: one upcoming entry and its acceptance list. Once the
/// tournament is synced, its own screen shows the same list.
struct TennisEntryScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    let id: String

    var body: some View {
        RemoteContent(fetch: { try await model.client.api.getTennisEntry(path: .init(id: id)).ok.body.json }) { e in
            List {
                Section {
                    Caption([TennisFormat.dates(e.startDate, e.endDate), e.venue].compactMap { $0 }.joined(separator: " · "))
                    if let url = URL(string: e.tournamentUrl), url.scheme == "https" {
                        Button("Open on the tournament site") { openURL(url) }
                    }
                }
                EntryListSections(entry: e)
            }
            .navigationTitle(e.tournamentName)
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

/// His status, when the list was read, the main draw (him highlighted,
/// known players linked), then the reserve list, folded away.
struct EntryListSections: View {
    @Environment(AppModel.self) private var model
    let entry: Components.Schemas.EntryListView
    @State private var showReserves = false

    var body: some View {
        Section(entry.eventName) {
            Text(entry.status.label).font(.headline).accessibilityIdentifier("entryStatus")
            if let read = entry.listCheckedAt.flatMap(TennisEntryFormat.read) {
                Caption("List read \(read)")
            }
            if let note = entry.note { Caption(note) }
            if !entry.listOut {
                Caption(entry.status.kind == "main_draw"
                    ? "The list shows here after the next read."
                    : "The acceptance list isn't out yet.")
            }
        }
        if entry.listOut {
            Section("Main draw (\(entry.mainDraw.count))") {
                ForEach(Array(entry.mainDraw.enumerated()), id: \.offset) { _, p in player(p) }
            }
            if !entry.reserve.isEmpty {
                Section {
                    DisclosureGroup("Reserve list (\(entry.reserve.count))", isExpanded: $showReserves) {
                        ForEach(Array(entry.reserve.enumerated()), id: \.offset) { _, p in player(p) }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func player(_ p: Components.Schemas.EntryListPlayer) -> some View {
        let name = (p.reservePosition.map { "\(Int($0)). " } ?? "") + p.names.joined(separator: " / ")
        if p.isSelf {
            Text(name).bold().listRowBackground(Color.yellow.opacity(0.25)).accessibilityIdentifier("entrySelf")
        } else if let key = p.playerKey {
            NavigationLink(value: Route.player(key: key)) { Text(name) }
        } else {
            Text(name)
        }
    }
}

enum TennisEntryFormat {
    /// "Oct 16, 6:42 PM" from the server's ISO time.
    static func read(_ iso: String) -> String? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return nil }
        return d.formatted(.dateTime.month(.abbreviated).day().hour().minute())
    }
}
