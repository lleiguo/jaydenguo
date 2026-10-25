import AVFoundation
import HubKit
import MediaPlayer
import Observation

/// Reads the day's mail aloud (intent 0025, MA-1..3): the parts the server
/// wrote, one after another, in Cookie's voice from the server or the
/// phone's own when that isn't there. Keeps playing with the screen locked,
/// with the part on the lock screen and its controls.
@MainActor @Observable
final class MailPlayer {
    private(set) var queue: MailQueue?
    private(set) var isPlaying = false
    private(set) var isLoading = false
    private var day = ""

    private let client: HubClient
    private let cache = MailAudioCache()
    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private let synthesizer = AVSpeechSynthesizer()
    @ObservationIgnored private var ending: PartEnd?
    /// Goes up whenever the part changes, so a slow fetch for an old part
    /// is dropped when it lands.
    @ObservationIgnored private var run = 0
    @ObservationIgnored private var commandsReady = false
    /// Marks an email read once it has been read aloud (MD-6).
    var onRead: (@MainActor (String) -> Void)?

    init(client: HubClient) {
        self.client = client
    }

    var current: MailSpeechPart? { queue?.current }
    var isActive: Bool { queue != nil }

    /// Starts the day from the top.
    func play() async {
        isLoading = true
        defer { isLoading = false }
        guard let script = try? await client.api.getMailScript().ok.body.json, !script.parts.isEmpty else { return }
        day = script.day
        cache.keepOnly(day)
        queue = MailQueue(parts: script.parts)
        setUpCommands()
        await start()
    }

    func togglePause() {
        if isPlaying {
            player?.pause()
            if synthesizer.isSpeaking { synthesizer.pauseSpeaking(at: .word) }
            isPlaying = false
        } else if player != nil || synthesizer.isPaused {
            if let player { player.play() } else { synthesizer.continueSpeaking() }
            isPlaying = true
        } else {
            Task { await start() }
        }
        updateNowPlaying()
    }

    /// At the end it stays on the last part, paused, until closed: Play
    /// reads it again, Back goes back.
    func next() {
        guard queue?.next() == true else { return finished() }
        Task { await start() }
    }

    private func finished() {
        run += 1
        silence()
        isPlaying = false
        updateNowPlaying()
    }

    func previous() {
        queue?.previous()
        Task { await start() }
    }

    func stop() {
        run += 1
        silence()
        queue = nil
        isPlaying = false
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        Task.detached { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    }

    /// Clear history and sign-out (MSEC-3).
    func reset() {
        stop()
        cache.wipe()
    }

    // MARK: Playing a part

    private func start() async {
        run += 1
        let mine = run
        silence()
        guard let part = queue?.current else { return }
        try? await Task.detached {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio)
            try session.setActive(true)
        }.value
        isPlaying = true
        updateNowPlaying()
        let sound = await audio(for: part)
        guard mine == run else { return }
        let end = PartEnd { [weak self] in self?.partEnded(mine) }
        ending = end
        if let sound, let player = try? AVAudioPlayer(data: sound, fileTypeHint: AVFileType.mp3.rawValue) {
            player.delegate = end
            self.player = player
            player.play()
        } else {
            let utterance = AVSpeechUtterance(string: part.text)
            utterance.voice = AVSpeechSynthesisVoice(language: CookieVoice.voiceLanguage(part.language.rawValue))
            synthesizer.delegate = end
            synthesizer.speak(utterance)
        }
        if let item = part.itemId { onRead?(item) }
        // The next part is fetched while this one plays.
        if let queue, queue.hasNext {
            let next = queue.parts[queue.index + 1]
            Task { _ = await audio(for: next) }
        }
    }

    private func audio(for part: MailSpeechPart) async -> Data? {
        if let kept = cache.read(day: day, part: part.id) { return kept }
        guard let data = await MailVoice.fetch(client.api, day: day, part: part.id) else { return nil }
        cache.write(data, day: day, part: part.id)
        return data
    }

    private func partEnded(_ which: Int) {
        guard which == run else { return }
        next()
    }

    /// Stops what's sounding without calling its end.
    private func silence() {
        ending?.cancelled = true
        ending = nil
        player?.stop()
        player = nil
        if synthesizer.isSpeaking || synthesizer.isPaused { synthesizer.stopSpeaking(at: .immediate) }
    }

    // MARK: Lock screen (MA-3)

    private func updateNowPlaying() {
        guard let queue, let part = queue.current else { return }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: part.title,
            MPMediaItemPropertyArtist: "Today's mail",
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyPlaybackQueueIndex: queue.index,
            MPNowPlayingInfoPropertyPlaybackQueueCount: queue.parts.count,
        ]
    }

    private func setUpCommands() {
        guard !commandsReady else { return }
        commandsReady = true
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { if self?.isPlaying == false { self?.togglePause() } }
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { if self?.isPlaying == true { self?.togglePause() } }
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { self?.togglePause() }
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { self?.next() }
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { self?.previous() }
            return .success
        }
    }
}

/// Tells the player when a part has ended; callbacks arrive off the main
/// actor.
private final class PartEnd: NSObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate, @unchecked Sendable {
    private let done: @MainActor () -> Void
    @MainActor var cancelled = false

    init(_ done: @escaping @MainActor () -> Void) {
        self.done = done
    }

    private nonisolated func ended() {
        Task { @MainActor in if !self.cancelled { self.done() } }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) { ended() }
    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: (any Error)?) { ended() }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) { ended() }
}
