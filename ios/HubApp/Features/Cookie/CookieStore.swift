import Foundation
import HubAPI
import HubKit
import Observation

/// The chat with Cookie (intent 0007, CK-4). Nothing is kept on the phone:
/// history comes from the server each time the app starts (CSEC-8), and
/// signing out forgets what's in memory.
@MainActor @Observable
final class CookieStore {
    private(set) var messages: [CookieMessage] = []
    private(set) var isAsking = false
    private(set) var isLoading = false
    /// Why history couldn't be loaded, in words to show.
    private(set) var loadError: String?
    var draft = ""
    /// Screenshots or a long paste going with the next question (intent
    /// 0019, SHT-1..3), and a note about it ("cut to 8,000 characters").
    private(set) var attachment: CookieAttachment?
    private(set) var attachmentNote: String?
    private(set) var isAttaching = false
    /// Nil until Settings → Cookie or the first spoken answer fetches it.
    var spokenAnswers: Bool?

    private let client: HubClient
    private var loaded = false
    private var conversationId: String?
    private var lastAskedAt: Date?
    private var settling = false
    /// Called with each email summary as it arrives (intent 0009), so the
    /// bubble can show it and read it out.
    var onFollowup: ((CookieMessage) -> Void)?

    init(client: HubClient) {
        self.client = client
    }

    var canSend: Bool { !isAsking && !isAttaching && CookieChat.question(draft, with: attachment) != nil }

    // MARK: Screenshots and pasted text (intent 0019)

    /// Pictures from Photos or the clipboard, shrunk off the main thread
    /// (SHT-2). Pictures replace a pasted text; three at most.
    func attach(pictures: [Data]) async {
        guard !pictures.isEmpty else { return }
        isAttaching = true
        defer { isAttaching = false }
        let shrunk = await Task.detached(priority: .userInitiated) {
            pictures.compactMap { CookieImage.jpeg(from: $0) }
        }.value
        let earlier: [Data] = if case .images(let images) = attachment { images } else { [] }
        let all = earlier + shrunk
        attachmentNote =
            shrunk.count < pictures.count ? "A picture couldn't be read."
            : all.count > CookieAttachment.imageLimit ? "Cookie takes \(CookieAttachment.imageLimit) pictures at most."
            : nil
        guard !all.isEmpty else { return }
        attachment = .images(Array(all.prefix(CookieAttachment.imageLimit)))
    }

    /// A paste too long for a question becomes something shared (SHT-3).
    func attach(pasted text: String) {
        guard let (attachment, cut) = CookieAttachment.pasted(from: text) else { return }
        self.attachment = attachment
        attachmentNote = cut ? "Only the first \(CookieAttachment.pastedLimit.formatted()) characters are sent." : nil
    }

    /// SHT-3: typing or pasting past the question limit moves the text out of the field.
    func draftChanged() {
        guard CookieAttachment.isLongPaste(draft), attachment == nil else { return }
        attach(pasted: draft)
        draft = ""
    }

    func removeAttachment() {
        attachment = nil
        attachmentNote = nil
    }

    /// The last turns, once per app start.
    func loadIfNeeded() async {
        guard !loaded, !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let turns = try await client.api.listAssistantTurns(query: .init(limit: 30)).ok.body.json.turns
            // Anything asked while this was loading stays at the end.
            messages = CookieChat.messages(turns) + messages
            if conversationId == nil { conversationId = CookieChat.conversation(after: turns) }
            if lastAskedAt == nil { lastAskedAt = turns.last.flatMap { HomeTime.parse($0.createdAt) } }
            loaded = true
            loadError = nil
            // An email summary still on its way when the app started.
            if isSettling { Task { await settle() } }
        } catch {
            loadError = HubError.from(error)?.message ?? "Couldn't load the chat."
        }
    }

    func send() async {
        guard !isAsking, let words = CookieChat.question(draft, with: attachment) else { return }
        let attached = attachment
        draft = ""
        removeAttachment()
        let shown = [words, attached?.label].compactMap { $0 }.joined(separator: " · ")
        let pictures: [Data] = if case .images(let images) = attached { images } else { [] }
        messages.append(CookieMessage(id: UUID().uuidString, role: .you, text: shown, pictures: pictures))
        _ = await ask { CookieChat.body(text: words, attachment: attached, conversationId: $0) } bubbles: {
            [CookieChat.message($0)]
        }
    }

    /// A spoken question (CK-2, CK-5): the recording goes up, and what she
    /// heard comes back with her answer (VOX-2). Nil when she couldn't be
    /// reached; the chat then says why.
    func ask(clip: Data) async -> CookieAnswer? {
        guard !isAsking else { return nil }
        // SHT-5: what's attached goes with the recording.
        let attached = attachment
        removeAttachment()
        return await ask { CookieVoice.body(clip: clip, conversationId: $0, attachment: attached) } bubbles: {
            CookieChat.messages(spoken: $0)
        }
    }

    private func ask(
        _ body: (String?) -> Operations.AskAssistant.Input.Body, bubbles: (CookieAnswer) -> [CookieMessage]
    ) async -> CookieAnswer? {
        isAsking = true
        defer { isAsking = false }
        // A follow-up continues the conversation; after a pause it's a new one (MEM-8).
        if let last = lastAskedAt, Date.now.timeIntervalSince(last) >= CookieChat.followUpWindow { conversationId = nil }
        do {
            let answer = try await client.api.askAssistant(body: body(conversationId)).ok.body.json
            conversationId = answer.conversationId
            lastAskedAt = .now
            messages.append(contentsOf: bubbles(answer))
            // ERA-1: the summary of an email she went to read follows.
            if answer.waiting != nil { Task { await settle() } }
            return answer
        } catch {
            let why = HubError.from(error)?.message ?? "Cookie couldn't be reached. Try again."
            messages.append(CookieMessage(id: UUID().uuidString, role: .cookie, text: why, kind: .notice))
            return nil
        }
    }

    /// "Spoken answers" in Settings → Cookie (VOX-5), fetched once and
    /// kept up to date by that screen. On until known otherwise.
    func spokenAnswersOn() async -> Bool {
        if let spokenAnswers { return spokenAnswers }
        spokenAnswers = try? await client.api.getAssistantSettings().ok.body.json.speak
        return spokenAnswers ?? true
    }

    /// "Undo" under an answer that saved or forgot a fact (MEM-2): forgets
    /// what was saved, or brings back what was forgotten.
    func undo(_ message: CookieMessage) async -> String? {
        guard let change = message.memory, let index = messages.firstIndex(where: { $0.id == message.id }) else { return nil }
        do {
            switch change.kind {
            case .saved: _ = try await client.api.forgetAssistantMemory(path: .init(id: change.id)).ok
            case .forgot: _ = try await client.api.restoreAssistantMemory(path: .init(id: change.id)).ok
            }
        } catch {
            return HubError.from(error)?.message ?? "Couldn't undo that."
        }
        // The answer stays; the Undo goes.
        messages[index] = message.withoutMemory()
        return change.kind == .saved ? "Not saved after all." : "Restored."
    }

    // MARK: Changes to the calendar (intent 0008, ACT-1, ACT-3)

    /// "Undo" under an answer that added events: they leave the hub at
    /// once, and the family calendar shortly after. Words for the banner.
    func undoChanges(_ changes: CookieChanges) async -> String {
        do {
            let after = try await client.undoCookieChanges(turnId: changes.turnId)
            replaceChanges(after)
            return after.cards.count == 1 ? "Undone." : "Undone: \(after.cards.count) changes."
        } catch {
            return HubError.from(error)?.message ?? "Couldn't undo that."
        }
    }

    /// Whether a card is still waiting on the worker, or an email summary
    /// is on its way.
    var isSettling: Bool { CookieChat.needsRefresh(messages) }

    /// While a card says "Being added…" or an email summary is on its way,
    /// asks the server again every few seconds, for a few minutes at most.
    func settle() async {
        // One loop for every card on screen.
        guard !settling else { return }
        settling = true
        defer { settling = false }
        let started = Date.now
        while isSettling, Date.now.timeIntervalSince(started) < CookieChat.settleLimit {
            try? await Task.sleep(for: CookieChat.settleInterval)
            guard !Task.isCancelled else { return }
            guard let turns = try? await client.api.listAssistantTurns(query: .init(limit: 30)).ok.body.json.turns
            else { continue }
            let known = Set(messages.map(\.id))
            messages = CookieChat.refreshed(messages, from: turns)
            for message in messages where !known.contains(message.id) { onFollowup?(message) }
        }
        // ERA-5: the wait is over, summary or not.
        messages = messages.map { $0.waitingUntil != nil && !$0.isWaiting() ? $0.notWaiting() : $0 }
    }

    /// The changes of one answer, as they are now.
    func changes(of turnId: String) -> CookieChanges? {
        messages.first { $0.id == turnId }?.changes
    }

    private func replaceChanges(_ changes: CookieChanges) {
        guard let index = messages.firstIndex(where: { $0.id == changes.turnId }) else { return }
        messages[index] = messages[index].with(changes: changes)
    }

    /// After "Clear history", and on sign-out (SEC-3).
    func reset() {
        messages = []
        conversationId = nil
        lastAskedAt = nil
        loaded = false
        loadError = nil
        draft = ""
        removeAttachment()
        spokenAnswers = nil
    }
}
