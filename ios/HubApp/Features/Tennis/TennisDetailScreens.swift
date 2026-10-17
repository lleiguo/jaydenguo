import HubAPI
import HubKit
import SwiftUI

/// One tournament (TEN-2, TEN-3): his draws with the next match and the
/// estimate, and his matches there.
struct TournamentScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    let id: String
    @State private var selected: MatchRef?

    var body: some View {
        RemoteContent(fetch: { try await model.client.api.getTournament(path: .init(id: id)).ok.body.json }) { data in
            let t = data.tournament
            List {
                Section {
                    Caption([TennisFormat.dates(t.startDate, t.endDate), t.venue, t.city, t.region].compactMap { $0 }.joined(separator: " · "))
                    Text(([t.entryStatus]
                        + (t.entryDeadline != nil && t.when == .upcoming ? ["entry deadline \(t.entryDeadline!)"] : [])
                        + (t.record.wins + t.record.losses > 0 ? ["\(TennisFormat.record(wins: t.record.wins, losses: t.record.losses)) here"] : []))
                        .joined(separator: " · "))
                    if let url = t.sourceUrl.flatMap(URL.init(string:)), url.scheme == "https" {
                        Button("Open on the tournament site") { openURL(url) }
                    }
                }
                if !t.draws.isEmpty {
                    Section("His draws") {
                        ForEach(t.draws, id: \.id) { d in
                            DrawSummary(draw: d)
                            if let url = d.sourceUrl.flatMap(URL.init(string:)), url.scheme == "https" {
                                Button("Draw on the site") { openURL(url) }
                            }
                            if d.status == .active, let p = data.drawPredictions.first(where: { $0.drawId == d.id }),
                               let prediction = p.prediction {
                                PredictionCard(prediction: prediction, selfName: nil, explanation: p.explanation)
                                AccuracyLink()
                            }
                        }
                    }
                }
                if t.when != .past {
                    ForEach(data.entries, id: \.id) { e in EntryListSections(entry: e) }
                }
                Section("His matches") {
                    if data.matches.isEmpty { Caption("No matches yet.") }
                    ForEach(data.matches, id: \.match.id) { row in
                        let ref = MatchRef(match: row.match, view: row.view)
                        Button { selected = ref } label: { MatchRow(ref: ref, shows: .tournament, homeTime: model.homeTime) }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("tennisMatch")
                    }
                }
            }
            .navigationTitle(t.name)
        }
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $selected) { ref in
            MatchSheet(ref: ref, homeTime: model.homeTime) { model.tennisPath.append($0) }
        }
    }
}

/// An opponent (TEN-4, TEN-5, TEN-6): every meeting, their form, and the
/// estimate for a match between them.
struct PlayerScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    let key: String
    @State private var selected: MatchRef?

    var body: some View {
        RemoteContent(fetch: { try await model.client.api.getTennisPlayer(path: .init(key: key)).ok.body.json }) { data in
            List {
                Section {
                    Caption([data.player.club ?? "Club not shown", "ranking not shown on the site"].joined(separator: " · "))
                    if let url = data.player.profileUrl.flatMap(URL.init(string:)), url.scheme == "https" {
                        Button("Profile on the tournament site") { openURL(url) }
                    }
                    ForEach(data.upcoming, id: \.draw.id) { u in
                        NavigationLink(value: Route.tournament(id: u.tournament.id)) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(u.tournament.name).font(.subheadline.weight(.medium))
                                if let next = u.draw.nextMatch { Caption(next.line) }
                            }
                        }
                    }
                }
                if let p = data.prediction {
                    Section("If they play") {
                        PredictionCard(prediction: p, selfName: nil, explanation: data.explanation)
                        AccuracyLink()
                    }
                }
                Section {
                    if data.h2h.meetings.isEmpty { Caption("They haven't played each other in singles yet.") }
                    ForEach(data.h2h.meetings, id: \.match.id) { row in
                        let ref = MatchRef(match: row.match, view: row.view)
                        Button { selected = ref } label: { MatchRow(ref: ref, shows: .h2h, homeTime: model.homeTime) }
                            .buttonStyle(.plain)
                    }
                } header: {
                    Text("Head-to-head: \(TennisFormat.record(data.h2h.record))").accessibilityIdentifier("h2hRecord")
                }
                Section("Form") {
                    Text("Last 12 months: \(TennisFormat.record(data.form.lastYear))"
                        + (data.form.winRate.map { " (\(TennisFormat.percent($0)) won)" } ?? ""))
                    if data.form.last.isEmpty { Caption("No results found for this player yet.") }
                    ForEach(data.form.last, id: \.match.id) { row in
                        HStack {
                            Text(row.match.matchDate).font(.subheadline.monospacedDigit())
                            Text(row.view.resultLetter ?? "—").font(.subheadline.bold())
                            Text(row.view.score).font(.subheadline.monospacedDigit())
                            Spacer()
                            Text("vs \(row.view.opponentNames)").font(.subheadline).lineLimit(2).multilineTextAlignment(.trailing)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
            .navigationTitle(data.player.name)
        }
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $selected) { ref in
            MatchSheet(ref: ref, homeTime: model.homeTime) { model.tennisPath.append($0) }
        }
    }
}

/// Every match of his (TEN-7): a season filter and the running W–L.
struct TennisResultsScreen: View {
    @Environment(AppModel.self) private var model
    @State private var season: Int?
    @State private var selected: MatchRef?

    var body: some View {
        RemoteContent(fetch: { [season] in
            try await model.client.api.listTennisResults(query: .init(season: season.map(String.init))).ok.body.json
        }) { data in
            List {
                Section {
                    Picker("Season", selection: $season) {
                        Text("All").tag(Int?.none)
                        ForEach(data.seasons.map { Int($0) }, id: \.self) { Text(String($0)).tag(Int?.some($0)) }
                    }
                    let singles = data.singles, total = data.total
                    Text("W–L \(TennisFormat.record(total))"
                        + (singles.wins + singles.losses != total.wins + total.losses ? " · singles \(TennisFormat.record(singles))" : ""))
                        .font(.headline)
                        .accessibilityIdentifier("record")
                }
                Section("Matches") {
                    if data.rows.isEmpty { Caption("No matches yet.") }
                    ForEach(data.rows, id: \.match.id) { row in
                        let ref = MatchRef(match: row.match, view: row.view,
                                           running: TennisFormat.record(wins: row.running.wins, losses: row.running.losses))
                        Button { selected = ref } label: { MatchRow(ref: ref, shows: .results, homeTime: model.homeTime) }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("tennisMatch")
                    }
                }
            }
        }
        .id(season)
        .navigationTitle("Results")
        .sheet(item: $selected) { ref in
            MatchSheet(ref: ref, homeTime: model.homeTime) { model.tennisPath.append($0) }
        }
    }
}

/// "How accurate is this?" (TEN-6): past matches predicted from what was
/// known the month before, grouped by how sure the prediction was.
struct AccuracyScreen: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        RemoteContent(fetch: { try await model.client.api.getTennisAccuracy().ok.body.json }) { bt in
            List {
                Section {
                    Text("Each past match in the data (his and his opponents') was predicted using only the results from before its month, then checked against what happened. A well-calibrated estimate wins about as often as it says: matches called 70% should be won about 70% of the time.")
                        .font(.subheadline)
                }
                if bt.n == 0 {
                    Caption("No rated matches yet.")
                } else {
                    Section {
                        Text("\(Int(bt.n)) matches · the favourite won \(pct(bt.accuracy))")
                            .accessibilityIdentifier("accuracySummary")
                        Caption("Brier score \(three(bt.brier)) (ratings alone \(three(bt.brierBase)); lower is better, 0.25 is a coin toss)")
                    }
                    Section("By how sure it was") {
                        ForEach(bt.buckets, id: \.from) { b in
                            LabeledContent("Called \(Int((b.from * 100).rounded()))–\(Int((b.to * 100).rounded()))%") {
                                Text(b.n > 0 ? "\(Int(b.n)) · said \(pct(b.predicted)) · won \(pct(b.actual))" : "none")
                                    .monospacedDigit()
                            }
                            .accessibilityIdentifier("calibrationRow")
                        }
                    }
                    Section {
                        ForEach(bt.byConfidence, id: \.confidence) { c in
                            LabeledContent(c.confidence.rawValue.capitalized) {
                                Text("\(Int(c.n)) · won \(pct(c.accuracy)) · Brier \(three(c.brier))").monospacedDigit()
                            }
                        }
                    } header: {
                        Text("By confidence")
                    } footer: {
                        Text("Opponents new to the circuit have few results, so many predictions are \"low\" confidence early on.")
                    }
                }
            }
        }
        .navigationTitle("Accuracy")
    }

    private func pct(_ x: Double?) -> String { x.map(TennisFormat.percent) ?? "—" }
    private func three(_ x: Double?) -> String { x.map { String(format: "%.3f", $0) } ?? "—" }
}
