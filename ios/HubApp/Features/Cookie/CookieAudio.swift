import AVFoundation
import HubKit

/// The audio session is switched off the main thread: activating it can
/// take a while, and the screen must never wait for it.
private enum CookieSession {
    static func use(_ category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions = []) async throws {
        try await Task.detached {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(category, mode: mode, options: options)
            try session.setActive(true)
        }.value
    }

    static func rest() {
        Task.detached {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }
}

/// The recording itself, off the main thread: AAC in an MPEG-4 file, in a
/// protected temporary file that is deleted as soon as the clip is read
/// or the recording is cancelled (CSEC-2).
private actor CookieTape {
    private var recorder: AVAudioRecorder?
    private var url: URL?

    func start() async throws {
        cancel()
        try await CookieSession.use(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("cookie-\(UUID().uuidString).m4a")
        let recorder = try AVAudioRecorder(url: file, settings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: CookieVoice.sampleRate,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: CookieVoice.bitRate,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ])
        recorder.isMeteringEnabled = true
        url = file
        guard recorder.record(forDuration: CookieVoice.longestClip + 1) else {
            cancel()
            throw CocoaError(.fileWriteUnknown)
        }
        try? FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUnlessOpen], ofItemAtPath: file.path
        )
        self.recorder = recorder
    }

    /// A recording left behind by a crash is removed at the next launch.
    func sweep() {
        let folder = FileManager.default.temporaryDirectory
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        for file in files where file.lastPathComponent.hasPrefix("cookie-") && file.pathExtension == "m4a" && file != url {
            try? FileManager.default.removeItem(at: file)
        }
    }

    func level() -> Double {
        guard let recorder else { return 0 }
        recorder.updateMeters()
        return CookieVoice.level(decibels: recorder.averagePower(forChannel: 0))
    }

    /// Stops and hands over the clip; the file is gone afterwards.
    func finish() -> Data? {
        defer { cancel() }
        guard let recorder, let url else { return nil }
        recorder.stop()
        return try? Data(contentsOf: url)
    }

    func cancel() {
        recorder?.stop()
        recorder = nil
        if let url { try? FileManager.default.removeItem(at: url) }
        url = nil
    }
}

/// Records one spoken question (intent 0007, CK-2).
@MainActor
final class CookieRecorder {
    enum Access { case granted, denied, undetermined }

    private let tape = CookieTape()
    private var startedAt: Date?
    /// Goes up with every start and stop, so a slow start that was
    /// cancelled meanwhile is thrown away when it lands.
    private var run = 0

    init() {
        Task { [tape] in await tape.sweep() }
    }

    #if DEBUG
    /// UI tests pass a clip (`-HubCookieClip <base64>`), so nothing is
    /// recorded and the microphone is never asked for.
    static let fixture: Data? = {
        let arguments = ProcessInfo.processInfo.arguments
        guard let i = arguments.firstIndex(of: "-HubCookieClip"), arguments.indices.contains(i + 1) else { return nil }
        return Data(base64Encoded: arguments[i + 1])
    }()
    #else
    static let fixture: Data? = nil
    #endif

    static var access: Access {
        if fixture != nil { return .granted }
        switch AVAudioApplication.shared.recordPermission {
        case .granted: return .granted
        case .denied: return .denied
        default: return .undetermined
        }
    }

    /// CK-6: the system's question, the first time.
    static func askForAccess() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }

    /// How long it has been recording; 0 until the microphone is running.
    var elapsed: TimeInterval { startedAt.map { Date.now.timeIntervalSince($0) } ?? 0 }

    /// Throws when the microphone can't be started, or when the recording
    /// was cancelled before it had.
    func start() async throws {
        run += 1
        let mine = run
        startedAt = nil
        if Self.fixture == nil {
            try await tape.start()
            guard mine == run else {
                await tape.cancel()
                throw CancellationError()
            }
        }
        startedAt = .now
    }

    /// 0 to 1, for the level ring. Steady in a UI test, so its screen settles.
    func level() async -> Double {
        Self.fixture != nil ? 0.5 : await tape.level()
    }

    /// Stops and hands over the clip; nothing of it stays on the phone.
    func finish() async -> Data? {
        run += 1
        startedAt = nil
        if let clip = Self.fixture { return clip }
        return await tape.finish()
    }

    func cancel() {
        run += 1
        startedAt = nil
        if Self.fixture == nil { Task { await tape.cancel() } }
    }
}

/// Reads an answer aloud (VOX-5): the server's voice when it has one, the
/// phone's own voice otherwise.
@MainActor
final class CookieSpeaker {
    private var player: AVAudioPlayer?
    private let synthesizer = AVSpeechSynthesizer()
    private var finish: Finish?
    private var stops = 0

    /// The server's MP3. False when it can't be played, or when she was
    /// stopped while the speaker was being readied.
    func play(_ audio: Data, onFinish: @escaping @MainActor @Sendable () -> Void) async -> Bool {
        guard await prepare() else { return false }
        guard let player = try? AVAudioPlayer(data: audio) else { return false }
        let finish = Finish(onFinish)
        player.delegate = finish
        guard player.play() else { return false }
        self.player = player
        self.finish = finish
        return true
    }

    /// The phone's own voice, in the answer's language.
    func say(_ text: String, language: String?, onFinish: @escaping @MainActor @Sendable () -> Void) async {
        guard await prepare() else { return }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: CookieVoice.voiceLanguage(language))
        let finish = Finish(onFinish)
        synthesizer.delegate = finish
        self.finish = finish
        synthesizer.speak(utterance)
    }

    func stop() {
        stops += 1
        // Stopping isn't finishing: the old callback must not fire.
        finish?.cancelled = true
        finish = nil
        player?.stop()
        player = nil
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
    }

    /// Playback only: speaking never touches the microphone. False when
    /// `stop()` was called meanwhile.
    private func prepare() async -> Bool {
        stop()
        let mine = stops
        try? await CookieSession.use(.playback, mode: .spokenAudio)
        return mine == stops
    }

    /// Lets other apps' audio come back once she is quiet.
    func rest() {
        guard player == nil, !synthesizer.isSpeaking else { return }
        CookieSession.rest()
    }
}

/// Tells the speaker when a clip or an utterance has ended. The callbacks
/// arrive off the main actor.
private final class Finish: NSObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate, @unchecked Sendable {
    private let done: @MainActor @Sendable () -> Void
    @MainActor var cancelled = false

    init(_ done: @escaping @MainActor @Sendable () -> Void) {
        self.done = done
    }

    private nonisolated func ended() {
        Task { @MainActor in if !self.cancelled { self.done() } }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) { ended() }
    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: (any Error)?) { ended() }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) { ended() }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) { ended() }
}
