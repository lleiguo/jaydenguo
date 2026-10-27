import HubAPI
import HubKit
import SwiftUI

/// Videos (intent 0004, IVID-1, IVID-3; VID-1..5): the review history per
/// sport, deleted reviews to restore, compare two, and starting a review.
struct VideosScreen: View {
    @Environment(AppModel.self) private var model
    @State private var sport: String?
    @State private var showDeleted = false
    @State private var adding = false
    @State private var comparing = false
    @State private var picked: [String] = []

    var body: some View {
        RemoteContent(fetch: { [sport, showDeleted] in
            try await model.client.api.listVideoReviews(query: .init(
                sport: sport.flatMap { .init(rawValue: $0) }, deleted: showDeleted ? ._1 : nil
            )).ok.body.json.reviews
        }) { reviews in
            List {
                Section {
                    Picker("Sport", selection: $sport) {
                        Text("All sports").tag(String?.none)
                        ForEach(VideoSport.all, id: \.self) { Text(VideoSport.label($0)).tag(Optional($0)) }
                    }
                    Toggle("Show deleted", isOn: $showDeleted)
                }
                if comparing {
                    Section {
                        Text("Pick two reviews to compare (\(picked.count) of 2).")
                        if picked.count == 2 {
                            NavigationLink("Compare") { CompareScreen(ids: picked) }
                        }
                    }
                }
                Section {
                    ForEach(reviews, id: \.id) { r in row(r) }
                }
            }
            .overlay {
                if reviews.isEmpty {
                    ContentUnavailableView("No reviews yet", systemImage: "video",
                                           description: Text(showDeleted ? "Nothing deleted." : "Tap + to review a video."))
                }
            }
        }
        .id("\(sport ?? "all")-\(showDeleted)")
        .navigationTitle("Videos")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { adding = true } label: { Label("New review", systemImage: "plus") }
            }
            ToolbarItem(placement: .secondaryAction) {
                Button(comparing ? "Done comparing" : "Compare two") {
                    comparing.toggle()
                    picked = []
                }
            }
        }
        .sheet(isPresented: $adding, onDismiss: { model.newReviewDraft = nil }) {
            NewReviewSheet(draft: model.newReviewDraft) { id in model.morePath.append(.video(id: id)) }
        }
        // EXT-3: a Google Photos video shared to the hub.
        .onChange(of: model.newReviewDraft, initial: true) { _, draft in
            if draft != nil { adding = true }
        }
    }

    @ViewBuilder
    private func row(_ r: VideoSummary) -> some View {
        let label = VideoRow(review: r, picked: comparing ? picked.contains(r.id) : nil)
        if comparing {
            Button {
                if let i = picked.firstIndex(of: r.id) { picked.remove(at: i) }
                else if picked.count < 2 { picked.append(r.id) }
            } label: { label }
                .buttonStyle(.plain)
        } else {
            NavigationLink(value: Route.video(id: r.id)) { label }
                .accessibilityIdentifier("videoRow")
                .swipeActions {
                    if r.deletedAt == nil {
                        Button { Task { await act("Review deleted.") { _ = try await model.client.api.deleteVideoReview(path: .init(id: r.id)).noContent } } } label: {
                            Label("Delete", systemImage: "trash")
                        }
                        .tint(.red)
                    } else {
                        Button { Task { await act("Review restored.") { _ = try await model.client.api.restoreVideoReview(path: .init(id: r.id)).ok } } } label: {
                            Label("Restore", systemImage: "arrow.uturn.backward")
                        }
                        .tint(.green)
                    }
                }
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
}

struct VideoRow: View {
    let review: VideoSummary
    /// In compare mode: whether it's picked.
    let picked: Bool?

    var body: some View {
        let r = review
        HStack(spacing: 12) {
            if let picked {
                Image(systemName: picked ? "checkmark.circle.fill" : "circle").foregroundStyle(picked ? Color.accentColor : .secondary)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text("\(VideoSport.text(r.sport.rawValue, source: r.sportSource.rawValue)) · \(r.filmedOn)").font(.headline)
                if let note = r.note { Text(note).font(.subheadline).lineLimit(2) }
                Text(VideoStatus.label(r.status))
                    .font(.caption)
                    .foregroundStyle(r.status == "failed" ? .red : VideoStatus.running(r.status) ? .warning : .secondary)
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// Start a review (IVID-3; VID-1, VID-2): a Google Drive link, or a pick
/// from Google Photos; the sport (worked out from the video by default:
/// intent 0005, SPT-1), when it was filmed, a note, and an optional part of
/// the video.
struct NewReviewSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let opened: (String) -> Void

    enum Source: String, CaseIterable { case photos = "Google Photos", link = "Paste a link" }
    @State private var source: Source = .photos
    @State private var url = ""
    @State private var sport = VideoSport.auto
    @State private var filmedOn = Date.now
    @State private var note = ""
    @State private var start = ""
    @State private var end = ""
    @State private var error: String?
    @State private var busy = false
    @State private var google: (drive: Bool, photos: Bool)?

    /// Prefilled from the share sheet (EXT-3): Google Photos, with the note.
    init(draft: PendingReview? = nil, opened: @escaping (String) -> Void) {
        self.opened = opened
        if let draft {
            _sport = State(initialValue: draft.sport)
            _note = State(initialValue: draft.note)
            _filmedOn = State(initialValue: VideoLink.date(draft.filmedOn) ?? .now)
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Where it is", selection: $source) {
                        ForEach(Source.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    if source == .link {
                        TextField("Google Drive link", text: $url)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .accessibilityIdentifier("videoLink")
                        Caption("Google Drive links are reviewed. YouTube links are saved with your note but can't be reviewed.")
                    } else {
                        Caption("After you tap Review, a Google Photos link appears on the review. Open it, pick one video, and come back.")
                    }
                    if let google, !(source == .link ? google.drive : google.photos) {
                        Label("Connect Google Drive and Photos first (Settings → Accounts).", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.warning)
                    }
                }
                Section {
                    Picker("Sport", selection: $sport) {
                        Text("Detect automatically").tag(VideoSport.auto)
                        ForEach(VideoSport.all, id: \.self) { Text(VideoSport.label($0)).tag($0) }
                    }
                    DatePicker("Filmed on", selection: $filmedOn, in: ...Date.now, displayedComponents: .date)
                    TextField("Note (what to look at)", text: $note, axis: .vertical)
                }
                Section {
                    HStack {
                        TextField("From (m:ss)", text: $start).keyboardType(.numbersAndPunctuation)
                        TextField("To (m:ss)", text: $end).keyboardType(.numbersAndPunctuation)
                    }
                } header: {
                    Text("Part to review (optional: the whole video if empty, up to 10 minutes)")
                } footer: {
                    Text("Leave blank to review the whole video.")
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .navigationTitle("New review")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Review") { Task { await submit() } }.disabled(busy) }
            }
            .task {
                if let s = try? await model.client.api.getVideoSettings().ok.body.json { google = (s.google.drive, s.google.photos) }
            }
        }
    }

    private func submit() async {
        error = nil
        let link = url.trimmingCharacters(in: .whitespaces)
        if source == .link, link.isEmpty { return error = "Paste the video's link, or pick from Google Photos." }
        guard let from = VideoTimeline.parse(start), let to = VideoTimeline.parse(end) else {
            return error = "Enter the part as m:ss, e.g. 0:12."
        }
        busy = true
        defer { busy = false }
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = .current
        let day = utc.dateComponents([.year, .month, .day], from: filmedOn)
        let filmed = String(format: "%04d-%02d-%02d", day.year!, day.month!, day.day!)
        do {
            let data = try await model.client.post("/api/v1/videos", [
                "url": source == .link ? .string(link) : .null,
                "sport": .string(sport),
                "filmedOn": .string(filmed),
                "note": .text(note),
                "segmentStart": from.map { .double($0) } ?? .null,
                "segmentEnd": to.map { .double($0) } ?? .null,
            ])
            let created = try JSONDecoder().decode(Components.Schemas.VideoCreated.self, from: data)
            model.show(created.status == "saved" ? "Saved with your note." : "Review started.")
            await model.dataChanged()
            dismiss()
            if created.status != "saved" { opened(created.id) }
        } catch {
            self.error = HubError.from(error)?.message ?? "Couldn't start the review."
        }
    }
}

/// Two reviews side by side, e.g. the same stroke months apart (VID-4).
struct CompareScreen: View {
    @Environment(AppModel.self) private var model
    let ids: [String]

    var body: some View {
        RemoteContent(fetch: {
            var out: [VideoDetail] = []
            for id in ids { out.append(try await model.client.api.getVideoReview(path: .init(id: id)).ok.body.json) }
            return out.sorted { $0.filmedOn < $1.filmedOn }
        }) { reviews in
            List {
                ForEach(reviews, id: \.id) { r in
                    Section("\(VideoSport.text(r.sport.rawValue, source: r.sportSource.rawValue)) · \(r.filmedOn)") {
                        if let note = r.note { Caption(note) }
                        if let advice = r.advice {
                            Text(advice.summary)
                            Text("What's good").font(.subheadline.bold())
                            ForEach(Array(advice.good.enumerated()), id: \.offset) { _, p in Text("• \(p.text)") }
                            Text("What to fix").font(.subheadline.bold())
                            ForEach(Array(advice.fix.enumerated()), id: \.offset) { i, p in Text("\(i + 1). \(p.text)") }
                        } else {
                            Caption("No review yet.")
                        }
                    }
                }
            }
        }
        .navigationTitle("Compare")
    }
}
