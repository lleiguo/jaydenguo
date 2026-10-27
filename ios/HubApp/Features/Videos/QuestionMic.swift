import HubKit
import Observation
import SwiftUI

/// Speaking a question about a review (intent 0026, ASK-10): hold the mic,
/// as on Cookie's button (CK-2), and the words land in the question box to
/// check before asking. The recording goes only to the server's transcriber
/// and isn't kept (ASKSEC-3).
@MainActor @Observable
final class QuestionVoice {
    enum Phase: Equatable {
        case idle
        /// `leaving`: the finger is off the mic, so lifting it cancels.
        case recording(leaving: Bool)
        case hearing
    }

    private(set) var phase: Phase = .idle
    private(set) var level = 0.0
    /// Count up for the haptic when recording begins.
    private(set) var began = 0

    private let recorder = CookieRecorder()
    private var meter: Task<Void, Never>?
    /// What to do with what was heard, and a line to show otherwise.
    var heard: (String) -> Void = { _ in }
    var say: (String) -> Void = { _ in }

    var isRecording: Bool { if case .recording = phase { true } else { false } }

    func holdBegan(_ client: HubClient, reviewId: String) async {
        guard phase == .idle else { return }
        switch CookieRecorder.access {
        case .granted: break
        case .undetermined:
            // CK-6: the system asks; the hold is over by the time it's answered.
            if await CookieRecorder.askForAccess() { say("Now hold to talk.") } else { microphoneOff() }
            return
        case .denied:
            return microphoneOff()
        }
        phase = .recording(leaving: false)
        level = 0
        began += 1
        do {
            try await recorder.start()
        } catch {
            if isRecording, !(error is CancellationError) {
                stop()
                say("Couldn't start recording. Try again, or type your question.")
            }
            return
        }
        guard isRecording else { return recorder.cancel() }
        meter = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(80))
                guard let self, !Task.isCancelled, self.isRecording else { return }
                let level = await self.recorder.level()
                if abs(level - self.level) > 0.02 { self.level = level }
                // LIM-3: at the limit it stops and is heard.
                if self.recorder.elapsed >= CookieVoice.longestClip {
                    return await self.hear(client, reviewId: reviewId)
                }
            }
        }
    }

    func holdMoved(inside: Bool) {
        if case .recording(let leaving) = phase, leaving == inside { phase = .recording(leaving: !inside) }
    }

    func holdEnded(inside: Bool, _ client: HubClient, reviewId: String) async {
        guard isRecording else { return }
        switch CookieVoice.release(recordedFor: recorder.elapsed, inside: inside) {
        case .send: await hear(client, reviewId: reviewId)
        case .tooShort:
            stop()
            say("Hold to talk")
        case .cancel, .tap:
            stop()
        }
    }

    private func hear(_ client: HubClient, reviewId: String) async {
        meter?.cancel()
        meter = nil
        level = 0
        phase = .hearing
        defer { phase = .idle }
        guard let clip = await recorder.finish(), !clip.isEmpty else {
            return say("That didn't record. Try again, or type your question.")
        }
        do {
            // The clip lives in this call only (ASKSEC-3).
            let text = try await client.api.transcribeVideoQuestion(
                path: .init(id: reviewId),
                body: .json(.init(audio: .init(data: clip.base64EncodedString(), mimeType: CookieVoice.clipType)))
            ).ok.body.json.text
            if text.isEmpty { say("Didn't catch that. Try again.") } else { heard(text) }
        } catch {
            say(HubError.from(error)?.message ?? "Couldn't hear that. Try again, or type your question.")
        }
    }

    private func stop() {
        meter?.cancel()
        meter = nil
        recorder.cancel()
        level = 0
        phase = .idle
    }

    private func microphoneOff() {
        say("The microphone is off for this app. Turn it on in Settings, or type your question.")
    }
}

/// The mic next to the question box: hold to talk (CK-2). The keyboard's
/// own dictation works in the box too.
struct HoldToTalkButton: View {
    let voice: QuestionVoice
    let start: () async -> Void
    let end: (_ inside: Bool) async -> Void
    @State private var pressing = false
    @State private var hold: Task<Void, Never>?
    private let size: CGFloat = 36

    var body: some View {
        let leaving = voice.phase == .recording(leaving: true)
        Image(systemName: voice.phase == .hearing ? "ellipsis.circle.fill" : "mic.circle.fill")
            .font(.system(size: size))
            .foregroundStyle(voice.isRecording ? AnyShapeStyle(leaving ? .gray : .red) : AnyShapeStyle(.tint))
            .scaleEffect(voice.isRecording ? 1 + voice.level * 0.25 : pressing ? 1.08 : 1)
            .animation(.linear(duration: 0.08), value: voice.level)
            .frame(width: size + 8, height: size + 8)
            .contentShape(Circle())
            .gesture(
                DragGesture(minimumDistance: 0, coordinateSpace: .local)
                    .onChanged { value in
                        let inside = CookieVoice.isInside(x: value.location.x, y: value.location.y, size: size + 8)
                        if !pressing {
                            pressing = true
                            hold = Task {
                                try? await Task.sleep(for: .seconds(CookieVoice.holdDelay))
                                guard !Task.isCancelled else { return }
                                await start()
                            }
                        }
                        voice.holdMoved(inside: inside)
                    }
                    .onEnded { value in
                        pressing = false
                        hold?.cancel()
                        hold = nil
                        let inside = CookieVoice.isInside(x: value.location.x, y: value.location.y, size: size + 8)
                        Task { await end(inside) }
                    }
            )
            .disabled(voice.phase == .hearing)
            .sensoryFeedback(.impact(weight: .medium), trigger: voice.began)
            .accessibilityElement()
            .accessibilityAddTraits(.isButton)
            .accessibilityLabel(voice.isRecording ? "Recording" : "Speak your question")
            .accessibilityHint("Hold to talk. Or use the keyboard's dictation.")
            .accessibilityIdentifier("questionMic")
    }
}
