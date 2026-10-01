import AVKit
import HubAPI
import HubKit
import SwiftUI

/// One review (intent 0004, IVID-1, IVID-2; VID-3..5, PLAY-3..7): progress
/// while it runs, the Google Photos pick, the clip with the advice's points
/// on it, the combined advice with jump buttons, the verdict, the parent's
/// vote, both models' reviews and the judging.
struct VideoDetailScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var review: VideoDetail?
    @State private var error: String?
    @State private var clip = ClipPlayer()
    @State private var confirmDelete = false
    @State private var confirmDeleteVideo = false
    /// A new sport for a finished review, waiting for "review again" or
    /// "only the label" (intent 0005, SPT-6).
    @State private var newSport: String?

    var body: some View {
        Group {
            if let r = review {
                content(r)
            } else if let error {
                ContentUnavailableView("Couldn't load", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                ProgressView()
            }
        }
        .navigationTitle(review.map { "\(VideoSport.text($0.sport.rawValue, source: $0.sportSource.rawValue)) · \($0.filmedOn)" } ?? "Review")
        .navigationBarTitleDisplayMode(.inline)
        // VID-5: follow the job while it runs.
        .task(id: model.changes) {
            await refresh()
            while let r = review, r.isRunning, !Task.isCancelled {
                try? await Task.sleep(for: .seconds(3))
                await refresh()
            }
        }
        .onAppear { OrientationLock.allowLandscape = true }
        .onDisappear {
            OrientationLock.allowLandscape = false
            clip.close()
        }
        .confirmationDialog("Delete this review?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Task { await delete() } }
        } message: {
            Text("It can be restored from the deleted reviews.")
        }
        .confirmationDialog("Delete the video copy? The review stays.", isPresented: $confirmDeleteVideo, titleVisibility: .visible) {
            Button("Delete video", role: .destructive) { Task { await deleteVideo() } }
        }
        .confirmationDialog(newSport.map { "Review it again as \(VideoSport.label($0))?" } ?? "",
                            isPresented: Binding(get: { newSport != nil }, set: { if !$0 { newSport = nil } }),
                            titleVisibility: .visible, presenting: newSport) { sport in
            Button("Review again as \(VideoSport.label(sport))") { Task { await changeSport(sport, again: true) } }
            Button("Only change the label") { Task { await changeSport(sport, again: false) } }
        } message: { _ in
            Text(review?.parentVote.map { $0 != ._empty_ } == true
                 ? "That runs the whole review again and clears your vote, which was about this review."
                 : "That runs the whole review again.")
        }
    }

    private func refresh() async {
        do {
            let r = try await model.client.api.getVideoReview(path: .init(id: id)).ok.body.json
            review = r
            if r.status == "done", r.hasPlayback { await clip.load(model.client, reviewId: id) }
        } catch {
            if review == nil { self.error = HubError.from(error)?.message ?? "Couldn't load the review." }
        }
    }

    private func content(_ r: VideoDetail) -> some View {
        let advice = r.advice
        let points = advice.map(VideoTimeline.points) ?? []
        return List {
            header(r)
            if r.status == "done", r.hasPlayback { player(r, points: points) }
            if let advice {
                AdviceSections(title: r.mode == .debate ? "The advice" : "The review", review: advice,
                               jump: clip.ready ? { clip.seek(to: $0) } : nil,
                               active: clip.ready ? VideoTimeline.active(points, at: clip.time)?.id : nil)
            }
            if let v = r.verdict { verdictSection(v) }
            if r.mode == .debate, r.status == "done" { voteSection(r) }
            if r.mode == .debate {
                ForEach(VideoModel.allCases, id: \.self) { m in
                    if let own = r.review(by: m) {
                        Section {
                            DisclosureGroup("\(m.label)'s review") {
                                AdviceBody(review: own, jump: clip.ready ? { clip.seek(to: $0) } : nil)
                            }
                        }
                    }
                }
                judging(r)
            }
            Section {
                if r.deletedAt == nil {
                    Button("Delete review", role: .destructive) { confirmDelete = true }
                } else {
                    Button("Restore review") { Task { await restore() } }
                }
            }
        }
        .accessibilityIdentifier("videoReview")
    }

    // MARK: Sections

    @ViewBuilder
    private func header(_ r: VideoDetail) -> some View {
        Section {
            sportRow(r)
            if let note = r.note { Text(note) }
            Label(r.progress.map { "\(VideoStatus.label(r.status)): \($0)" } ?? VideoStatus.label(r.status),
                  systemImage: r.status == "failed" ? "exclamationmark.triangle.fill" : r.isRunning ? "hourglass" : "checkmark.circle")
                .foregroundStyle(r.status == "failed" ? .red : .primary)
                .accessibilityIdentifier("reviewStatus")
            if r.isRunning { ProgressView() }
            if let error = r.errorMessage { Text(error).foregroundStyle(.red) }
            // F-4: pick the video in Google Photos; the review starts once picked.
            if r.status == "picking", let uri = r.pickerUri.flatMap(URL.init(string:)), uri.scheme == "https" {
                Button("Pick the video in Google Photos") { openURL(uri) }
                    .buttonStyle(.borderedProminent)
                Caption("Pick one video, then come back: the review starts by itself.")
            }
            if r.status == "failed" { Button("Try again") { Task { await retry() } } }
            let details = [r.mediaName, segment(r), r.mode == .debate ? "two models" : "\(r.mode.rawValue.capitalized) only"].compactMap { $0 }
            Caption(details.joined(separator: " · "))
            if let url = r.url.flatMap(URL.init(string:)), url.scheme == "https" {
                Button("Open the video") { openURL(url) }
            }
        }
    }

    /// intent 0005, SPT-5: set the sport. A finished review asks first.
    @ViewBuilder
    private func sportRow(_ r: VideoDetail) -> some View {
        let source = r.sportSource.rawValue
        let unset = VideoSport.unset(source: source, running: r.isRunning)
        let blank = unset || source == "detecting"
        Picker("Sport", selection: Binding(
            get: { blank ? "" : r.sport.rawValue },
            set: { sport in
                guard !sport.isEmpty, sport != r.sport.rawValue || blank else { return }
                if r.status == "done" { newSport = sport } else { Task { await changeSport(sport, again: false) } }
            })) {
            if blank { Text(source == "detecting" ? "Detect automatically" : "Not set").tag("") }
            ForEach(VideoSport.all, id: \.self) { Text(VideoSport.label($0)).tag($0) }
        }
        .disabled(r.status == "analysing")
        .accessibilityIdentifier("sportPicker")
        if r.status == "analysing" {
            Caption("Change the sport when the review has finished.")
        } else if unset {
            Label("The sport couldn't be worked out from the video, so the review used a general checklist. Set it here.",
                  systemImage: "questionmark.circle")
                .foregroundStyle(.warning)
        } else if source == "detected" {
            Caption("Worked out from the video.")
        }
    }

    private func segment(_ r: VideoDetail) -> String? {
        guard r.segmentStart != nil || r.segmentEnd != nil else { return nil }
        return "part \(VideoTimeline.clock(r.segmentStart ?? 0))–\(r.segmentEnd.map(VideoTimeline.clock) ?? "end")"
    }

    @ViewBuilder
    private func player(_ r: VideoDetail, points: [VideoTimeline.Point]) -> some View {
        Section {
            if clip.ready {
                VideoPlayer(player: clip.player)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .listRowInsets(EdgeInsets())
                PointStrip(points: points, time: clip.time, duration: r.durationSec ?? max(clip.time, 1)) { clip.seek(to: $0) }
                let active = VideoTimeline.active(points, at: clip.time)
                Group {
                    if let active {
                        Text("\(active.label): ").bold().foregroundStyle(active.good ? .good : .warning) + Text(active.text)
                    } else {
                        Text(points.isEmpty ? "No points name a time." : "Points show here as the video reaches them.")
                            .foregroundStyle(.secondary)
                    }
                }
                .font(.subheadline)
                .accessibilityIdentifier("currentPoint")
                // Speeds on one row, frame steps and the time on the next, so
                // neither wraps at large text sizes (APP-6).
                HStack { speedButtons }
                    .buttonStyle(.bordered)
                HStack { stepButtons }
                    .buttonStyle(.bordered)
                if let start = r.segmentStart, start > 0 {
                    Caption("This is the reviewed part. Times count from its start (\(VideoTimeline.clock(start)) in the original).")
                }
            } else if let error = clip.error {
                Text(error).foregroundStyle(.red)
            } else {
                HStack { ProgressView(); Text("Loading the video…") }
            }
            if clip.ready {
                Button("Delete video", role: .destructive) { confirmDeleteVideo = true }
            }
        } footer: {
            Text("A private copy of the reviewed part, without sound, kept until you delete it.")
        }
    }

    @ViewBuilder private var speedButtons: some View {
        ForEach(ClipPlayer.speeds, id: \.self) { s in
            Button(s == 1 ? "1×" : "\(String(format: "%g", s))×") { clip.setSpeed(s) }
                .tint(clip.speed == s ? .accentColor : .secondary)
                .accessibilityLabel(s == 1 ? "Normal speed" : s == 0.5 ? "Half speed" : "Quarter speed")
                .accessibilityAddTraits(clip.speed == s ? .isSelected : [])
        }
    }

    @ViewBuilder private var stepButtons: some View {
        Button { clip.step(-1) } label: { Image(systemName: "backward.frame") }
            .accessibilityLabel("Back one frame")
        Button { clip.step(1) } label: { Image(systemName: "forward.frame") }
            .accessibilityLabel("Forward one frame")
        Spacer(minLength: 8)
        Text(VideoTimeline.clock(clip.time)).monospacedDigit().accessibilityIdentifier("videoTime")
    }

    private func verdictSection(_ v: Components.Schemas.Verdict) -> some View {
        Section("Verdict") {
            Text(v.tie ? "A tie" : "\(VideoModel(rawValue: v.winner.rawValue)?.label ?? "") wrote the more useful review")
                .font(.headline)
            LabeledContent("Gemini", value: String(format: "%.1f / 25", v.totals.gemini))
            LabeledContent("Claude", value: String(format: "%.1f / 25", v.totals.claude))
            Caption("Each judge scored both reviews without knowing which model wrote which. Scores of their own review: Gemini \(Int(v.selfScores.gemini.own)), Claude \(Int(v.selfScores.claude.own)).")
        }
    }

    // VID-3d: once, never changed.
    @ViewBuilder
    private func voteSection(_ r: VideoDetail) -> some View {
        Section {
            if let vote = r.parentVote, let m = VideoModel(rawValue: vote.rawValue) {
                Text("You found \(m.label)'s review more useful.").accessibilityIdentifier("yourVote")
            } else {
                HStack {
                    ForEach(VideoModel.allCases, id: \.self) { m in
                        Button(m.label) { Task { await vote(m) } }.buttonStyle(.bordered)
                    }
                }
            }
        } header: {
            Text("Which review was more useful?")
        } footer: {
            if r.parentVote == nil { Text("Your vote is saved once and can't be changed. It's the real measure.") }
        }
    }

    @ViewBuilder
    private func judging(_ r: VideoDetail) -> some View {
        let first = r.scores(round: "critique"), final = r.scores(round: "final_score")
        if !first.isEmpty {
            Section("Scores (out of 25)") {
                ForEach(Array((first.map { ("First", $0) } + final.map { ("Final", $0) }).enumerated()), id: \.offset) { _, row in
                    LabeledContent("\(row.0): \(row.1.judge.label) on \(row.1.of.label)", value: "\(row.1.scores.sum)")
                }
            }
            Section {
                DisclosureGroup("Critiques") {
                    ForEach(Array(r.critiques.enumerated()), id: \.offset) { _, c in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(c.judge.label) on \(c.of.label)'s review").font(.subheadline.bold())
                            Text(c.entry.comment).font(.subheadline)
                            ForEach(c.entry.errors, id: \.point) { e in Caption("Error: \(e.point) — \(e.reason)") }
                            ForEach(c.entry.unsupported, id: \.self) { Caption("Not in the video: \($0)") }
                            ForEach(c.entry.missed, id: \.self) { Caption("Missed: \($0)") }
                        }
                    }
                }
                DisclosureGroup("Replies") {
                    ForEach(Array(r.rebuttals.enumerated()), id: \.offset) { _, reb in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(reb.model.label)'s replies").font(.subheadline.bold())
                            ForEach(reb.rebuttal.replies, id: \.point) { reply in
                                Text("\(reply.response == "concede" ? "Conceded" : "Defended"): \(reply.point)").font(.subheadline)
                                Caption(reply.argument)
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: Actions

    private func act(_ done: String, _ work: () async throws -> Void) async {
        do {
            try await work()
            model.show(done)
        } catch {
            model.show(HubError.from(error)?.message ?? "That didn't work.")
        }
        await model.dataChanged()
    }

    private func vote(_ m: VideoModel) async {
        await act("Vote saved.") { _ = try await model.client.api.voteVideoReview(path: .init(id: id), body: .json(.init(vote: .init(rawValue: m.rawValue)!))).ok }
    }

    private func changeSport(_ sport: String, again: Bool) async {
        newSport = nil
        await act(again ? "Reviewing again as \(VideoSport.label(sport))." : "Sport changed to \(VideoSport.label(sport)).") {
            try await model.client.patch("/api/v1/videos/\(id)", ["sport": .string(sport), "reviewAgain": .bool(again)])
        }
        if again { clip.close() }
        await refresh()
    }

    private func retry() async {
        await act("Trying again.") { _ = try await model.client.api.retryVideoReview(path: .init(id: id)).accepted }
    }

    private func delete() async {
        await act("Review deleted.") { _ = try await model.client.api.deleteVideoReview(path: .init(id: id)).noContent }
        dismiss()
    }

    private func restore() async {
        await act("Review restored.") { _ = try await model.client.api.restoreVideoReview(path: .init(id: id)).ok }
    }

    private func deleteVideo() async {
        clip.close()
        await act("Video deleted. The review stays.") { _ = try await model.client.api.deletePlayback(path: .init(id: id)).noContent }
    }
}

/// Markers for the advice's points under the clip (PLAY-4); the same jumps
/// are buttons in the advice for VoiceOver, so this strip is hidden from it.
struct PointStrip: View {
    let points: [VideoTimeline.Point]
    let time: Double
    let duration: Double
    let seek: (Double) -> Void

    var body: some View {
        GeometryReader { geo in
            let x = { (s: Double) in geo.size.width * min(1, max(0, s / max(duration, 0.1))) }
            ZStack(alignment: .leading) {
                Capsule().fill(Color.secondary.opacity(0.3)).frame(height: 3)
                Rectangle().fill(Color.primary).frame(width: 2, height: 16).offset(x: x(time) - 1)
                ForEach(points) { p in
                    Circle()
                        .fill(p.good ? Color.green : .orange)
                        .overlay { if p.disputed { Circle().strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [2, 2])) } }
                        .frame(width: 14, height: 14)
                        .offset(x: x(p.seconds) - 7)
                        .onTapGesture { seek(p.seconds) }
                }
            }
            .frame(maxHeight: .infinity)
        }
        .frame(height: 24)
        .accessibilityHidden(true)
    }
}

/// A review's advice as list sections, with "at 0:04" jump buttons.
struct AdviceSections: View {
    let title: String
    let review: ReviewContent
    let jump: ((Double) -> Void)?
    let active: String?

    var body: some View {
        Section(title) { Text(review.summary) }
        Section("What's good") { PointRows(points: review.good, section: "good", jump: jump, active: active) }
        Section("What to fix") { PointRows(points: review.fix, section: "fix", jump: jump, active: active, ranked: true) }
        Section("Drills") { DrillRows(drills: review.drills) }
        Section("Film next time") { Text(review.filmNext) }
    }
}

/// The same advice inside a disclosure (each model's own review).
struct AdviceBody: View {
    let review: ReviewContent
    let jump: ((Double) -> Void)?

    var body: some View {
        Text(review.summary)
        Text("What's good").font(.subheadline.bold())
        PointRows(points: review.good, section: "good", jump: jump, active: nil)
        Text("What to fix").font(.subheadline.bold())
        PointRows(points: review.fix, section: "fix", jump: jump, active: nil, ranked: true)
        DrillRows(drills: review.drills)
        Caption("Film next: \(review.filmNext)")
    }
}

struct PointRows: View {
    let points: [ReviewContent.Point]
    let section: String
    let jump: ((Double) -> Void)?
    let active: String?
    var ranked = false

    var body: some View {
        ForEach(Array(points.enumerated()), id: \.offset) { i, p in
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(ranked ? "\(i + 1). \(p.text)" : p.text).fontWeight(active == "\(section)-\(i)" ? .bold : .regular)
                    if let status = p.status {
                        Text(status).font(.caption2.weight(.semibold))
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background((p.disputed ? Color.orange : Color.green).opacity(0.2), in: Capsule())
                    }
                }
                Caption(p.why)
                if p.disputed, let sides = p.sides {
                    Caption("For: \(sides.for) Against: \(sides.against)")
                }
                if let at = p.at {
                    if let jump, let sec = VideoTimeline.seconds(at) {
                        Button("at \(at)") { jump(sec) }
                            .font(.caption)
                            .buttonStyle(.borderless)
                            .accessibilityLabel("Show \(VideoTimeline.clock(sec)) in the video")
                    } else {
                        Caption("at \(at)")
                    }
                }
            }
            .listRowBackground(active == "\(section)-\(i)" ? Color.accentColor.opacity(0.12) : nil)
        }
    }
}

struct DrillRows: View {
    let drills: [ReviewContent.Drill]

    var body: some View {
        ForEach(drills, id: \.name) { d in
            VStack(alignment: .leading, spacing: 2) {
                Text(d.name).font(.subheadline.bold())
                Text(d.how).font(.subheadline)
                Caption(d.reps)
            }
        }
    }
}
