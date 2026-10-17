import HubAPI
import HubKit
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// "Ask Cookie" from any app's share sheet (intent 0019, SHR-1..6): up to
/// three pictures, or a text, sent to Cookie with "Add to calendar",
/// "Summarize" or a question. Her answer, and the events she added with
/// their Undo, show in the sheet.
final class AskShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        let host = UIHostingController(rootView: AskShareView(
            shared: { await Self.attachment(from: providers) },
            close: { [weak self] in self?.extensionContext?.completeRequest(returningItems: nil) }
        ))
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
    }

    /// Pictures first (a screenshot shared from Photos), then text. Each
    /// picture is shrunk as it's read, so three full screenshots never sit
    /// in the extension's small memory at once (SHR-5).
    static func attachment(from providers: [NSItemProvider]) async -> CookieAttachment? {
        var pictures: [Data] = []
        for p in providers where p.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            guard pictures.count < CookieAttachment.imageLimit else { break }
            if let data = await data(p, UTType.image), let jpeg = CookieImage.jpeg(from: data) { pictures.append(jpeg) }
        }
        if !pictures.isEmpty { return .images(pictures) }
        for p in providers where p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            if let text = try? await p.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String,
               let (attachment, _) = CookieAttachment.pasted(from: text) {
                return attachment
            }
        }
        return nil
    }

    private static func data(_ provider: NSItemProvider, _ type: UTType) async -> Data? {
        await withCheckedContinuation { done in
            _ = provider.loadDataRepresentation(for: type) { data, _ in done.resume(returning: data) }
        }
    }
}

struct AskShareView: View {
    let shared: () async -> CookieAttachment?
    let close: () -> Void

    @State private var attachment: CookieAttachment?
    @State private var loaded = false
    @State private var question = ""
    @State private var busy = false
    @State private var answer: CookieMessage?
    @State private var error: String?
    @State private var undone: String?
    private let client = SharedClient.make(deviceName: "share")
    private let time = HomeTime(identifier: TimeZone.current.identifier)

    /// SHR-3: the buttons are the parent's words, in the phone's language.
    private static let chinese = Locale.current.language.languageCode?.identifier == "zh"
    private static let addWords = chinese ? "加到日历" : "Add this to the calendar"
    private static let summaryWords = chinese ? "总结一下" : "Summarize this"

    var body: some View {
        NavigationStack {
            Form {
                if !loaded {
                    ProgressView()
                } else if let attachment {
                    Section { preview(attachment) }
                    if let answer {
                        answerSection(answer)
                    } else if !client.isSignedIn {
                        Text("Sign in to Hub first, then share again.").foregroundStyle(.orange)
                    } else {
                        choices
                    }
                    if let error { Text(error).foregroundStyle(.red) }
                } else {
                    Text("There's no picture or text here for Cookie to read.")
                }
            }
            .navigationTitle("Ask Cookie")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(answer == nil ? "Cancel" : "Done") { close() } }
            }
        }
        .task {
            attachment = await shared()
            loaded = true
        }
    }

    private func preview(_ attachment: CookieAttachment) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            switch attachment {
            case .images(let images):
                HStack(spacing: 8) {
                    ForEach(Array(images.enumerated()), id: \.offset) { _, data in
                        if let image = UIImage(data: data) {
                            Image(uiImage: image).resizable().scaledToFill()
                                .frame(width: 72, height: 72).clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }
            case .pasted(let text):
                Text(text).font(.footnote).lineLimit(4).foregroundStyle(.secondary)
            }
            Text(attachment.label).font(.caption).foregroundStyle(.tertiary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(attachment.label)
    }

    private var choices: some View {
        Section {
            Button { Task { await ask(Self.addWords) } } label: { Label("Add to calendar", systemImage: "calendar.badge.plus") }
            Button { Task { await ask(Self.summaryWords) } } label: { Label("Summarize", systemImage: "text.alignleft") }
            HStack {
                TextField("Ask something else", text: $question)
                    .submitLabel(.send)
                    .onSubmit { Task { await askTyped() } }
                Button { Task { await askTyped() } } label: { Image(systemName: "arrow.up.circle.fill") }
                    .disabled(CookieChat.question(question) == nil)
                    .accessibilityLabel("Send")
            }
            if busy {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Cookie is reading…").foregroundStyle(.secondary)
                }
            }
        }
        .disabled(busy)
    }

    private func answerSection(_ answer: CookieMessage) -> some View {
        Section {
            Text(answer.text).textSelection(.enabled)
            if let line = answer.sourceLine { Text(line).font(.caption).foregroundStyle(.secondary) }
            if let changes = answer.changes {
                ForEach(changes.cards) { card in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(card.title).font(.subheadline.bold())
                        Text([card.whenLine(time), card.whoLine].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption)
                        Text(undone == nil ? card.stateLine : "Undone").font(.caption).foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }
                if undone == nil, changes.canUndo() {
                    Button("Undo", role: .destructive) { Task { await undo(changes) } }
                }
            }
        }
    }

    private func askTyped() async {
        guard let words = CookieChat.question(question) else { return }
        await ask(words)
    }

    private func ask(_ words: String) async {
        guard let attachment, !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            let body = CookieChat.body(text: words, attachment: attachment, conversationId: nil)
            answer = CookieChat.message(try await client.api.askAssistant(body: body).ok.body.json)
        } catch {
            // SHR-6: nothing is queued.
            self.error =
                HubError.from(error) == .offline
                ? "You're offline. Try again when you're back online."
                : HubError.from(error)?.message ?? "Cookie can't answer right now. Try again in a moment."
        }
    }

    private func undo(_ changes: CookieChanges) async {
        do {
            _ = try await client.undoCookieChanges(turnId: changes.turnId)
            undone = "Undone."
        } catch {
            self.error = HubError.from(error)?.message ?? "Couldn't undo that."
        }
    }
}
