import HubKit
import Observation
import SwiftUI

/// Talking to Cookie (intent 0007, CK-2, CK-3, CK-5, VOX-5): press and
/// hold on her button, or the chat's mic button. One recording at a time;
/// what she heard and her answer land in the chat, and are read aloud.
@MainActor @Observable
final class CookieTalk {
    enum Phase: Equatable {
        case idle
        /// `leaving`: the finger is off the button, so lifting it cancels.
        case recording(leaving: Bool)
        case asking
        /// The bubble by her button (CK-3).
        case answered(heard: String, answer: CookieMessage)
        /// A line to show instead: "Hold to talk", the microphone is off…
        case hint(String, settings: Bool)
    }

    private(set) var phase: Phase = .idle
    private(set) var level = 0.0
    private(set) var elapsed: TimeInterval = 0
    /// The turn being read aloud, if one is.
    private var speaking: String?
    /// Count up for the haptics: recording began, recording ended.
    private(set) var began = 0
    private(set) var ended = 0

    private let store: CookieStore
    private let client: HubClient
    private let recorder = CookieRecorder()
    private let speaker = CookieSpeaker()
    private var meter: Task<Void, Never>?
    private var closing: Task<Void, Never>?
    /// A hold that didn't start a recording (the microphone question, a
    /// refusal) mustn't open the chat when the finger lifts.
    private var holdSpent = false
    /// Whether the answer goes to the bubble by the button, or only into
    /// the open chat.
    private var fromChat = false

    init(store: CookieStore, client: HubClient) {
        self.store = store
        self.client = client
    }

    var isRecording: Bool { if case .recording = phase { true } else { false } }
    var isBusy: Bool { isRecording || phase == .asking }
    var isSpeaking: Bool { speaking != nil }

    // MARK: Press and hold (CK-2)

    /// The press has lasted `CookieVoice.holdDelay`.
    func holdBegan(offline: Bool) async {
        holdSpent = true
        guard !offline else { return show("You're offline. Cookie needs a connection.") }
        await startRecording(fromChat: false)
    }

    func holdMoved(inside: Bool) {
        if case .recording(let leaving) = phase, leaving == inside { phase = .recording(leaving: !inside) }
    }

    /// The finger lifted. `.tap` means: nothing was recorded, open the chat.
    func holdEnded(inside: Bool) -> CookieVoice.Release {
        defer { holdSpent = false }
        guard isRecording else { return holdSpent ? .cancel : CookieVoice.release(recordedFor: nil, inside: inside) }
        let release = CookieVoice.release(recordedFor: recorder.elapsed, inside: inside)
        switch release {
        case .send: send()
        case .tooShort:
            stopRecording()
            show("Hold to talk")
        case .cancel, .tap:
            stopRecording()
            phase = .idle
        }
        return release
    }

    // MARK: The chat's mic button (CK-5)

    /// Tap to start, tap again to stop and send.
    func toggle(offline: Bool) async {
        if isRecording { return send() }
        guard phase != .asking else { return }
        guard !offline else { return show("You're offline. Cookie needs a connection.") }
        await startRecording(fromChat: true)
    }

    // MARK: Recording

    private func startRecording(fromChat: Bool) async {
        guard !isBusy, !store.isAsking else { return }
        stopSpeaking()
        closing?.cancel()
        switch CookieRecorder.access {
        case .granted: break
        case .undetermined:
            // CK-6: the system asks; the hold is over by the time it's answered.
            if await CookieRecorder.askForAccess() {
                show(fromChat ? "Tap the microphone and ask." : "Now hold to talk.")
            } else {
                showMicrophoneOff()
            }
            return
        case .denied:
            return showMicrophoneOff()
        }
        self.fromChat = fromChat
        // Shown at once; the microphone starts off the main thread.
        phase = .recording(leaving: false)
        level = 0
        elapsed = 0
        began += 1
        let wait = Task { [weak self] in
            // A microphone that hasn't started by now isn't going to.
            try? await Task.sleep(for: .seconds(3))
            guard let self, !Task.isCancelled, self.isRecording, self.recorder.elapsed == 0 else { return }
            self.stopRecording()
            self.show("Couldn't start recording. Try again, or type your question.")
        }
        do {
            try await recorder.start()
        } catch {
            wait.cancel()
            // Cancelled meanwhile (the finger lifted): that already said so.
            if isRecording, !(error is CancellationError) {
                stopRecording()
                show("Couldn't start recording. Try again, or type your question.")
            }
            return
        }
        wait.cancel()
        guard isRecording else { return recorder.cancel() }
        meter = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(80))
                guard let self, !Task.isCancelled, self.isRecording else { return }
                // Only what changes on screen: the ring, and the clock once a second.
                let level = await self.recorder.level()
                guard !Task.isCancelled, self.isRecording else { return }
                if abs(level - self.level) > 0.02 { self.level = level }
                let elapsed = self.recorder.elapsed.rounded(.down)
                if elapsed != self.elapsed { self.elapsed = elapsed }
                // LIM-3: at the limit it stops and sends.
                if self.recorder.elapsed >= CookieVoice.longestClip { return self.send() }
            }
        }
    }

    private func stopRecording() {
        meter?.cancel()
        meter = nil
        recorder.cancel()
        level = 0
        ended += 1
    }

    private func send() {
        meter?.cancel()
        meter = nil
        level = 0
        ended += 1
        phase = .asking
        Task {
            guard let clip = await recorder.finish(), !clip.isEmpty else {
                return show("That didn't record. Try again, or type your question.")
            }
            await ask(clip)
        }
    }

    private func ask(_ clip: Data) async {
        // The clip isn't kept: it lives in this call and goes with it (CSEC-2).
        let answer = await store.ask(clip: clip)
        guard let answer else {
            // The chat holds the reason; by the button, say it in the bubble.
            phase = fromChat ? .idle : .hint(store.messages.last?.text ?? "Cookie couldn't be reached.", settings: false)
            if !fromChat { closeLater(after: CookieVoice.bubbleLinger) }
            return
        }
        let message = CookieChat.message(answer)
        phase = fromChat ? .idle : .answered(heard: answer.heard, answer: message)
        await speak(answer)
    }

    // MARK: Speech (VOX-5, CK-3)

    private func speak(_ answer: CookieAnswer) async {
        guard CookieVoice.speaks(answer, spokenAnswers: await store.spokenAnswersOn()) else {
            // Nothing to hear, so leave time to read.
            return closeLater(after: lingerAfterAnswer + 3)
        }
        let turn = answer.turnId
        let finished: @MainActor @Sendable () -> Void = { [weak self] in self?.spoke(turn) }
        speaking = turn
        // Stopped, or a new question began, while her voice was being fetched.
        let audio = await client.cookieSpeech(turnId: turn)
        guard speaking == turn else { return }
        if let audio, await speaker.play(audio, onFinish: finished) { return }
        guard speaking == turn else { return }
        // The phone's own voice: her voice didn't answer, or the month's spend is near the cap.
        let fromWeb = answer.sources.contains { $0.kind == .web }
        await speaker.say(
            CookieVoice.spokenText(answer.text, fromWeb: fromWeb, language: answer.language.rawValue),
            language: answer.language.rawValue, onFinish: finished
        )
    }

    private func spoke(_ turn: String) {
        guard speaking == turn else { return }
        speaking = nil
        speaker.rest()
        if case .answered = phase { closeLater(after: lingerAfterAnswer) }
    }

    /// CK-3: tapping her while she speaks stops the speech.
    func stopSpeaking() {
        guard isSpeaking else { return }
        speaking = nil
        speaker.stop()
        speaker.rest()
        if case .answered = phase { closeLater(after: lingerAfterAnswer) }
    }

    // MARK: The bubble

    func closeBubble() {
        closing?.cancel()
        if !isBusy { phase = .idle }
    }

    private func show(_ hint: String) {
        phase = .hint(hint, settings: false)
        closeLater(after: 4)
    }

    private func showMicrophoneOff() {
        phase = .hint("Cookie can't hear you: the microphone is off for Hub. You can still type.", settings: true)
        closeLater(after: 8)
    }

    private var lingerAfterAnswer: TimeInterval {
        if case .answered(_, let answer) = phase { return CookieVoice.linger(answer) }
        return CookieVoice.bubbleLinger
    }

    private func closeLater(after seconds: TimeInterval) {
        closing?.cancel()
        let shown = phase
        closing = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard let self, !Task.isCancelled, self.phase == shown else { return }
            self.phase = .idle
        }
    }

    /// Signing out, or the app going to the background mid-question.
    func reset() {
        meter?.cancel()
        closing?.cancel()
        recorder.cancel()
        speaker.stop()
        speaker.rest()
        speaking = nil
        level = 0
        phase = .idle
    }
}
