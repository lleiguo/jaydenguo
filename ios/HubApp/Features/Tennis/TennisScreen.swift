import HubAPI
import HubKit
import SwiftUI

/// Tennis (intent 0004, ITEN-1; TEN-2, TEN-3, TEN-6, TEN-9, TEN-10): his
/// next matches with the estimate, tournaments in progress and the ones
/// he's entered in, ones found for him to enter, matching ones not open yet
/// and skipped ones (refreshed with every sync), and past tournaments.
struct TennisScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL

    var body: some View {
        RemoteContent(fetch: { try await model.client.api.getTennisOverview().ok.body.json }) { o in
            List {
                Section {
                    Text("Last updated: \(updated(o.lastUpdated))")
                        .font(.subheadline).foregroundStyle(.secondary)
                        .accessibilityIdentifier("tennisLastUpdated")
                    NavigationLink(value: Route.tennisResults) { Label("Results and W–L", systemImage: "list.number") }
                    NavigationLink(value: Route.tennisAccuracy) { Label("How accurate are the predictions?", systemImage: "target") }
                }
                if !o.nextMatches.isEmpty {
                    Section("Next matches") {
                        ForEach(o.nextMatches, id: \.draw.id) { n in
                            NavigationLink(value: Route.tournament(id: n.tournament.id)) {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(n.tournament.name).font(.headline)
                                    DrawSummary(draw: n.draw)
                                }
                            }
                            .accessibilityIdentifier("nextMatch")
                            if let p = n.prediction {
                                PredictionCard(prediction: p, selfName: o.selfName, explanation: n.explanation)
                                AccuracyLink()
                            }
                        }
                    }
                }
                if !o.inProgress.isEmpty {
                    Section("In progress") {
                        ForEach(o.inProgress, id: \.id) { TournamentRow(t: $0) }
                    }
                }
                Section(enteredTitle(o.selfName)) {
                    if o.upcomingRows.isEmpty { Caption("Not entered in any upcoming tournament.") }
                    ForEach(o.upcomingRows, id: \.key) { upcomingRow($0) }
                }
                if !o.found.isEmpty {
                    Section {
                        ForEach(o.found, id: \.id) { foundRow($0) }
                    } header: {
                        Text("Found for him")
                    } footer: {
                        Text("Entering and paying happen on the tournament site.")
                    }
                }
                Section("Upcoming matching tournaments (not yet open)") {
                    if o.notOpen.isEmpty { Caption("None found yet.") }
                    ForEach(o.notOpen, id: \.id) { notOpenRow($0) }
                }
                if !o.skipped.isEmpty {
                    Section("Skipped") {
                        ForEach(o.skipped, id: \.id) { skippedRow($0) }
                    }
                }
                Section("Past tournaments") {
                    if o.past.isEmpty { Caption("No past tournaments.") }
                    ForEach(o.past, id: \.id) { TournamentRow(t: $0) }
                }
            }
            .accessibilityIdentifier("tennisList")
        }
        .navigationTitle("Tennis")
        .toolbar { ToolbarItem(placement: .primaryAction) { RefreshSourcesButton(kind: "tennis_tc", site: "Tennis Canada") } }
    }

    // TEN-2, TEN-10: every tournament he's registered for, before and after
    // the acceptance list and the draw, with his next opponent.
    @ViewBuilder
    private func upcomingRow(_ r: Components.Schemas.TennisOverview.UpcomingRowsPayloadPayload) -> some View {
        let content = VStack(alignment: .leading, spacing: 4) {
            Text(r.name).font(.headline)
            Caption([TennisFormat.dates(r.startDate, r.endDate), r.venue, r.driveMinutes.map { "\(Int($0)) min drive" }]
                .compactMap { $0 }.joined(separator: " · "))
            if !r.events.isEmpty { Caption(r.events.joined(separator: ", ")) }
            Text(r.status.label).font(.subheadline.weight(.medium))
            if r.draws.isEmpty {
                Caption(r.status.kind == "withdrawn" ? "—" : "Draw not out yet")
            }
            ForEach(r.draws, id: \.id) { d in
                let line = d.nextMatch?.line ?? "Draw is out"
                Text(r.draws.count > 1 ? "\(d.eventName ?? d.drawName ?? "Draw"): \(line)" : line).font(.subheadline)
                if let p = r.drawPredictions.first(where: { $0.drawId == d.id })?.prediction {
                    Text("\(TennisFormat.percent(p.probability)) to win · confidence \(p.confidence.rawValue)")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityIdentifier("upcomingTournament")
        if let id = r.tournamentId {
            NavigationLink(value: Route.tournament(id: id)) { content }
        } else {
            content
        }
        if let action = r.status.action {
            Button("\(action.text) →") { openURL(action.url) }
        }
    }

    // TEN-9, TEN-10: found on Thursdays, not registered. The owner enters
    // on the site: the link opens in Safari to pay.
    private func foundRow(_ e: Components.Schemas.TennisOverview.FoundPayloadPayload) -> some View {
        let needsYou = e.status == "found"
        return VStack(alignment: .leading, spacing: 4) {
            Text(e.tournamentName).font(.headline)
            Caption([TennisFormat.dates(e.startDate, e.endDate), e.eventName].joined(separator: " · "))
            Caption([[e.venue, e.city].compactMap { $0 }.joined(separator: ", "), e.driveMinutes.map { "\(Int($0)) min drive" },
                     e.entryDeadline.map { "entries close \($0)" }]
                .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
            Label(foundText(e.status), systemImage: needsYou ? "exclamationmark.triangle.fill" : "info.circle")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(needsYou ? .orange : .primary)
            if let note = e.note { Caption(note) }
            HStack(spacing: 16) {
                if needsYou, let url = https(e.entryUrl) {
                    Button("Enter on the site →") { openURL(url) }
                }
                if let url = https(e.tournamentUrl) {
                    Button("Tournament page") { openURL(url) }
                }
            }
            .buttonStyle(.borderless)
            .font(.subheadline)
        }
        .accessibilityIdentifier("foundEntry")
    }

    // Matching tournaments whose entry hasn't opened yet; the Thursday job
    // enters him once it does.
    private func notOpenRow(_ e: Components.Schemas.TennisOverview.NotOpenPayloadPayload) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(e.tournamentName).font(.headline)
            Caption([TennisFormat.dates(e.startDate, e.endDate), e.eventName].filter { !$0.isEmpty }.joined(separator: " · "))
            Caption([[e.venue, e.city].compactMap { $0 }.joined(separator: ", "), e.driveMinutes.map { "\(Int($0)) min drive" }]
                .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
            Text([e.entryOpens.map { "Entry opens \($0)" }, e.entryDeadline.map { "closes \($0)" }]
                .compactMap { $0 }.joined(separator: " · "))
                .font(.subheadline.weight(.medium))
            if let url = https(e.tournamentUrl) {
                Button("Tournament page") { openURL(url) }.buttonStyle(.borderless).font(.subheadline)
            }
        }
        .accessibilityIdentifier("notOpenEntry")
    }

    private func skippedRow(_ e: Components.Schemas.TennisOverview.SkippedPayloadPayload) -> some View {
        Button {
            if let url = https(e.tournamentUrl) { openURL(url) }
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(e.tournamentName).font(.subheadline.weight(.medium))
                Caption([TennisFormat.dates(e.startDate, e.endDate), e.note].compactMap { $0 }.joined(separator: " · "))
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("skippedEntry")
    }

    private func enteredTitle(_ selfName: String?) -> String {
        guard let name = selfName.flatMap(Self.firstName) else { return "Tournaments he's entered in" }
        return "Tournaments \(name) is entered in"
    }

    /// "Guo, Jayden" or "Jayden Guo" → "Jayden".
    static func firstName(_ name: String) -> String? {
        let given = name.contains(",") ? name.split(separator: ",").dropFirst().first.map(String.init) ?? "" : name
        return given.split(separator: " ").first.map(String.init)
    }

    private func updated(_ iso: String?) -> String {
        guard let date = iso.flatMap(HomeTime.parse) else { return "not synced yet" }
        let home = model.homeTime
        return "\(home.dayTitle(home.localDate(date))), \(home.time(date))"
    }

    private func foundText(_ status: String) -> String {
        switch status {
        case "found": "Not entered yet"
        case "withdrawn": "Not on the entry list any more"
        default: "Not entered"
        }
    }

    private func https(_ s: String?) -> URL? {
        guard let s, let url = URL(string: s), url.scheme == "https" else { return nil }
        return url
    }
}

/// A tournament in a list: dates, place, entry status, W–L there.
struct TournamentRow: View {
    let t: TournamentView

    var body: some View {
        NavigationLink(value: Route.tournament(id: t.id)) {
            VStack(alignment: .leading, spacing: 3) {
                Text(t.name).font(.headline)
                Caption(TennisFormat.dates(t.startDate, t.endDate))
                let played = t.record.wins + t.record.losses
                Caption(([[t.venue, t.city].compactMap { $0 }.joined(separator: ", "), t.entryStatus]
                    + (played > 0 ? [TennisFormat.record(wins: t.record.wins, losses: t.record.losses)] : []))
                    .filter { !$0.isEmpty }.joined(separator: " · "))
                if !t.events.isEmpty { Text(t.events.joined(separator: ", ")).font(.subheadline) }
            }
        }
        .accessibilityIdentifier("tournament")
    }
}
