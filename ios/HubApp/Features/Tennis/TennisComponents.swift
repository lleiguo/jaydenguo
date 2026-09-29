import HubAPI
import HubKit
import SwiftUI

/// His draw: event, line and seed, and the next match (TEN-3).
struct DrawSummary: View {
    let draw: DrawView

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(draw.title).font(.subheadline.weight(.medium))
            if let place = draw.placeLine { Caption(place) }
            if draw.status == .active, let next = draw.nextMatch {
                Text(next.line).font(.subheadline)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// The win estimate, its confidence and the why (TEN-6, TEN-11). Only the
/// win %: the owner asked for no score band (2026-09-27).
struct PredictionCard: View {
    let prediction: PredictionView
    let selfName: String?
    let explanation: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(heading): \(TennisFormat.percent(prediction.probability))")
                    .font(.headline)
                Spacer(minLength: 8)
                Text("\(prediction.confidence.rawValue) confidence")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Caption("Estimate, not a certainty")
            let level = prediction.opponentLevel
            Text("\(prediction.opponentName): \(Int(level.tournaments)) \(level.tournaments == 1 ? "tournament" : "tournaments") and \(TennisFormat.record(wins: level.lastYear.wins, losses: level.lastYear.losses)) in the last 12 months · head-to-head \(TennisFormat.record(wins: prediction.headToHead.wins, losses: prediction.headToHead.losses))")
                .font(.subheadline)
            Text("Why: \(prediction.why)").font(.caption).foregroundStyle(.secondary)
            if let explanation { Text(explanation).font(.subheadline) }
        }
        .padding(.vertical, 4)
        .accessibilityIdentifier("prediction")
    }

    private var heading: String {
        selfName?.split(separator: " ").first.map { "\($0) wins" } ?? "Win chance"
    }
}

/// "How accurate is this?" under an estimate, as its own row: a list row
/// holds one link.
struct AccuracyLink: View {
    var body: some View {
        NavigationLink(value: Route.tennisAccuracy) {
            Text("How accurate is this?").font(.subheadline)
        }
    }
}

/// A match and his side of it, from any of the tennis responses.
struct MatchRef: Identifiable {
    let match: MatchView
    let view: Perspective
    var running: String?
    var id: String { match.id }
}

/// One of his matches (TEN-4, TEN-7): date, where, opponent, result, and
/// the correction notes. Tapping opens the match sheet.
struct MatchRow: View {
    enum Shows { case results, tournament, h2h }

    let ref: MatchRef
    let shows: Shows
    let homeTime: HomeTime

    var body: some View {
        let m = ref.match, v = ref.view
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(heading).font(.subheadline.weight(.medium))
                if shows != .h2h { Text("vs \(v.opponentNames)").font(.subheadline) }
                if let partner = v.partner { Caption("with \(partner.name)") }
                Caption(when)
                CorrectionNotes(
                    corrected: m.corrected, manual: m.origin == .manual, disagrees: m.sourceDisagrees,
                    siteSays: m.siteSays(side: v.sideNumber), site: "The site"
                )
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 3) {
                if m.isScheduled {
                    Text("not played yet").font(.caption).foregroundStyle(.secondary)
                } else {
                    Text(v.resultLetter ?? "—")
                        .font(.headline)
                        .foregroundStyle(v.resultLetter == "W" ? .green : v.resultLetter == "L" ? .red : .primary)
                    Text(v.score).font(.subheadline.monospacedDigit())
                }
                if let running = ref.running { Caption(running) }
            }
        }
        // The whole row takes the tap, not only its text.
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
    }

    private var heading: String {
        let m = ref.match
        switch shows {
        case .tournament: return m.round ?? "Match"
        case .results: return [m.tournamentName ?? "Match", m.round].compactMap { $0 }.joined(separator: " · ")
        case .h2h: return [m.tournamentName, m.round].compactMap { $0 }.joined(separator: " · ")
        }
    }

    private var when: String {
        let m = ref.match
        guard let at = m.scheduledAt else { return m.matchDate }
        return "\(m.matchDate) \(homeTime.time(at))"
    }

    private var accessibilityText: String {
        let m = ref.match, v = ref.view
        var parts = [heading, "against \(v.opponentNames)", when]
        if m.isScheduled { parts.append("not played yet") }
        else { parts.append("\(v.resultLetter == "W" ? "won" : v.resultLetter == "L" ? "lost" : "no result") \(v.score)") }
        if let running = ref.running { parts.append("record \(running)") }
        if m.corrected { parts.append("corrected by you") }
        if m.sourceDisagrees { parts.append("the site disagrees") }
        return parts.joined(separator: ", ")
    }
}

/// A match's details with links and the owner's corrections (TEN-8):
/// result, score and start time; back to the site's result; delete.
struct MatchSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let ref: MatchRef
    let open: (Route) -> Void

    enum Result: String, CaseIterable, Identifiable {
        case won = "Won", lost = "Lost", notPlayed = "Not played yet"
        var id: String { rawValue }
    }
    enum How: String, CaseIterable, Identifiable {
        case played, retired, walkover
        var id: String { rawValue }
        var label: String { rawValue.capitalized }
    }

    @State private var result: Result
    @State private var score: String
    @State private var how: How
    @State private var hasTime: Bool
    @State private var time: Date
    @State private var error: String?
    @State private var saving = false
    @State private var confirmDelete = false

    init(ref: MatchRef, homeTime: HomeTime, open: @escaping (Route) -> Void) {
        self.ref = ref
        self.open = open
        let m = ref.match, v = ref.view
        _result = State(initialValue: v.resultLetter == "W" ? .won : v.resultLetter == "L" ? .lost : .notPlayed)
        _score = State(initialValue: TennisFormat.editableScore(TennisFormat.sets(m.sets), side: v.sideNumber))
        _how = State(initialValue: How(rawValue: m.outcome.rawValue) ?? .played)
        let hhmm = m.localTime(homeTime)
        _hasTime = State(initialValue: hhmm != nil)
        _time = State(initialValue: homeTime.date(m.matchDate, hhmm: hhmm ?? "09:00") ?? .now)
    }

    var body: some View {
        let m = ref.match, v = ref.view
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Date", value: m.matchDate)
                    if let round = m.round { LabeledContent("Round", value: round) }
                    if let t = m.tournamentName, let id = m.tournamentId {
                        Button { go(.tournament(id: id)) } label: { LabeledContent("Tournament", value: t) }
                    }
                    ForEach(v.opponents, id: \.key) { p in
                        Button { go(.player(key: p.key)) } label: { LabeledContent("Opponent", value: p.name) }
                    }
                    if !m.isScheduled {
                        LabeledContent("Result", value: "\(v.resultLetter ?? "—") \(v.score)")
                    }
                    CorrectionNotes(
                        corrected: m.corrected, manual: m.origin == .manual, disagrees: m.sourceDisagrees,
                        siteSays: m.siteSays(side: v.sideNumber), site: "The site"
                    )
                    if let notes = m.notes, !notes.isEmpty { Text(notes) }
                }

                Section {
                    Picker("Result", selection: $result) {
                        ForEach(Result.allCases) { Text($0.rawValue).tag($0) }
                    }
                    if result != .notPlayed {
                        HStack {
                            Text("Score")
                            TextField("Score", text: $score, prompt: Text("6-3 4-6 10-8"))
                                .multilineTextAlignment(.trailing)
                                .keyboardType(.numbersAndPunctuation)
                                .autocorrectionDisabled()
                                .accessibilityIdentifier("scoreField")
                        }
                        Picker("How", selection: $how) {
                            ForEach(How.allCases) { Text($0.label).tag($0) }
                        }
                    }
                    Toggle("Start time", isOn: $hasTime)
                    if hasTime {
                        DatePicker("Starts", selection: $time, displayedComponents: .hourAndMinute)
                            .environment(\.timeZone, model.homeTime.timeZone)
                    }
                    if let error { Text(error).foregroundStyle(.red).font(.callout) }
                    Button("Save correction") { Task { await save() } }
                        .disabled(saving)
                } header: {
                    Text("Correct it")
                } footer: {
                    Text("Scores are from his side, his games first. Your correction stays through future syncs.")
                }

                Section {
                    if m.corrected, let site = m.siteSays(side: v.sideNumber) {
                        Button("Use the site's result (\(site))") { Task { await useSite() } }
                    }
                    Button("Delete match", role: .destructive) { confirmDelete = true }
                }
            }
            .navigationTitle(v.opponentNames.isEmpty ? "Match" : "vs \(v.opponentNames)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                // The keyboard covers the form's button while typing.
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Save correction") { Task { await save() } }.disabled(saving)
                }
            }
            .confirmationDialog("Delete this match?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) { Task { await delete() } }
            }
        }
    }

    private func go(_ route: Route) {
        dismiss()
        open(route)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        error = nil
        let played = result != .notPlayed
        var fields: [String: JSONField] = [
            "won": played ? .bool(result == .won) : .null,
            "outcome": .string(played ? how.rawValue : "scheduled"),
            "time": hasTime ? .string(model.homeTime.hhmm(time)) : .null,
        ]
        if played { fields["score"] = .string(score) }
        do {
            try await model.client.patch("/api/v1/tennis/matches/\(ref.match.id)", fields)
            model.show("Saved. Your correction stays through future syncs.")
            await model.dataChanged()
            dismiss()
        } catch {
            self.error = HubError.from(error)?.message ?? "Couldn't save. Check your connection and try again."
        }
    }

    private func useSite() async {
        do {
            _ = try await model.client.api.useSourceTennisMatch(path: .init(id: ref.match.id)).noContent
            model.show("Now showing the site's result.")
            await model.dataChanged()
            dismiss()
        } catch {
            self.error = HubError.from(error)?.message ?? "Couldn't change that."
        }
    }

    private func delete() async {
        do {
            let undo = try await model.client.api.deleteTennisMatch(path: .init(id: ref.match.id)).ok.body.json.undo
            model.show("Match deleted.", undo: undo)
            await model.dataChanged()
            dismiss()
        } catch {
            self.error = HubError.from(error)?.message ?? "Couldn't delete it."
        }
    }
}
