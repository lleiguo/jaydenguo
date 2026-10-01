import AVKit
import HubAPI
import HubKit
import SwiftUI

/// One review (intent 0004, IVID-1, IVID-2; VID-3..5, PLAY-3..7): progress
/// while it runs, the Google Photos pick, the clip with the advice's points
/// on it, and the advice with jump buttons.
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
            Text("That runs the whole review again.")
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
                AdviceSections(review: advice,
                               jump: clip.ready ? { clip.seek(to: $0) } : nil,
                               active: clip.ready ? VideoTimeline.active(points, at: clip.time)?.id : nil)
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
            let details = [r.mediaName, segment(r)].compactMap { $0 }
            if !details.isEmpty { Caption(details.joined(separator: " · ")) }
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
    let review: ReviewContent
    let jump: ((Double) -> Void)?
    let active: String?

    var body: some View {
        Section("The review") { Text(review.summary) }
        Section("What's good") { PointRows(points: review.good, section: "good", jump: jump, active: active) }
        Section("What to fix") { PointRows(points: review.fix, section: "fix", jump: jump, active: active, ranked: true) }
        Section("Drills") { DrillRows(drills: review.drills) }
        Section("Film next time") { Text(review.filmNext) }
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
                Text(ranked ? "\(i + 1). \(p.text)" : p.text).fontWeight(active == "\(section)-\(i)" ? .bold : .regular)
                Caption(p.why)
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
