import HubKit
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// "Review in Cookie" from any app's share sheet (intent 0004, EXT-3; VID-1):
/// the shared link with a sport, note and date, submitted with the device
/// token. A Google Photos link can't be read by the site (F-4), so it's
/// handed to the app, which opens the Photos picker with the note kept.
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        let host = UIHostingController(rootView: ShareView(
            link: { await Self.firstURL(in: providers) },
            close: { [weak self] in self?.extensionContext?.completeRequest(returningItems: nil) }
        ))
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
    }

    /// A URL, or the first link in shared text (some apps share "Look at
    /// this https://…").
    static func firstURL(in providers: [NSItemProvider]) async -> URL? {
        for p in providers where p.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            if let url = try? await p.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL, url.scheme?.hasPrefix("http") == true {
                return url
            }
        }
        for p in providers where p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            if let text = try? await p.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String,
               let match = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
                .firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
               let url = match.url, url.scheme?.hasPrefix("http") == true {
                return url
            }
        }
        return nil
    }
}

struct ShareView: View {
    let link: () async -> URL?
    let close: () -> Void

    @State private var url: URL?
    @State private var loaded = false
    @State private var sport = VideoSport.auto
    @State private var filmedOn = Date.now
    @State private var note = ""
    @State private var busy = false
    @State private var error: String?
    @State private var done: String?
    private let client = SharedClient.make(deviceName: "share")

    var body: some View {
        NavigationStack {
            Form {
                if let done {
                    Section { Label(done, systemImage: "checkmark.circle") }
                } else if !loaded {
                    ProgressView()
                } else if let url {
                    Section {
                        Text(url.absoluteString).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                        if VideoLink.isPhotosShare(url) {
                            Text("Google Photos links can't be read by the hub. Hub will open so you can pick this video in Google Photos; your note is kept.")
                                .font(.footnote)
                        }
                    }
                    Section {
                        Picker("Sport", selection: $sport) {
                            Text("Detect automatically").tag(VideoSport.auto)
                            ForEach(VideoSport.all, id: \.self) { Text(VideoSport.label($0)).tag($0) }
                        }
                        DatePicker("Filmed on", selection: $filmedOn, in: ...Date.now, displayedComponents: .date)
                        TextField("Note or question (what to look at)", text: $note, axis: .vertical)
                    }
                    if !client.isSignedIn {
                        Text("Sign in to Hub first, then share again.").foregroundStyle(.orange)
                    }
                    if let error { Text(error).foregroundStyle(.red) }
                } else {
                    Text("There's no link to review in what was shared.")
                }
            }
            .navigationTitle("Review in Cookie")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(done == nil ? "Cancel" : "Done") { close() } }
                if done == nil, url != nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Review") { Task { await submit() } }.disabled(busy || !client.isSignedIn)
                    }
                }
            }
        }
        .task {
            url = await link()
            loaded = true
        }
    }

    private func submit() async {
        guard let url else { return }
        error = nil
        let day = VideoLink.day(filmedOn)
        if VideoLink.isPhotosShare(url) {
            SharedSettings(appGroup: ResponseCache.bundleAppGroup).pendingPhotosReview =
                PendingReview(sport: sport, note: note.trimmingCharacters(in: .whitespacesAndNewlines), filmedOn: day)
            done = "Open Hub to pick the video in Google Photos."
            return
        }
        busy = true
        defer { busy = false }
        do {
            let data = try await client.post("/api/v1/videos", [
                "url": .string(url.absoluteString),
                "sport": .string(sport),
                "filmedOn": .string(day),
                "note": .text(note),
                "segmentStart": .null,
                "segmentEnd": .null,
            ])
            let status = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["status"] as? String
            done = status == "saved" ? "Saved with your note (this kind of link can't be reviewed)." : "Review started. Hub tells you when it's ready."
        } catch {
            self.error = HubError.from(error)?.message ?? "Couldn't send it. Check your connection and try again."
        }
    }
}
