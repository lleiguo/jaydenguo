import AVKit
import HubKit
import Observation
import SwiftUI

/// The reviewed clip (intent 0004, IVID-2; PLAY-3..5): downloaded with the
/// device token to a protected temporary file, played muted with AVKit,
/// and deleted when the screen closes. Points jump it; slow motion and
/// frame steps for looking closely.
@MainActor @Observable
final class ClipPlayer {
    let player = AVPlayer()
    private(set) var time: Double = 0
    private(set) var speed: Float = 1
    private(set) var playing = false
    private(set) var loading = false
    private(set) var ready = false
    private(set) var error: String?
    private var file: URL?
    private var observer: Any?

    static let speeds: [Float] = [0.25, 0.5, 1]

    func load(_ client: HubClient, reviewId: String) async {
        guard file == nil, !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let file = try await client.download("/api/v1/videos/\(reviewId)/video")
            // Closed while downloading: don't keep it.
            guard !Task.isCancelled else {
                try? FileManager.default.removeItem(at: file)
                return
            }
            self.file = file
            player.isMuted = true
            player.replaceCurrentItem(with: AVPlayerItem(url: file))
            observer = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 10), queue: .main) { [weak self] t in
                MainActor.assumeIsolated {
                    self?.time = t.seconds.isFinite ? t.seconds : 0
                    self?.playing = self?.player.rate != 0
                }
            }
            ready = true
        } catch {
            self.error = HubError.from(error)?.message ?? "The video couldn't be loaded."
        }
    }

    /// Shows a moment, paused, frame-exact (PLAY-4).
    func seek(to seconds: Double) {
        player.pause()
        playing = false
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        time = seconds
    }

    /// Play or pause, for the full-screen view's own controls (intent 0026, FS-3).
    func togglePlay() {
        if player.rate != 0 { player.pause() } else { player.rate = speed }
        playing = player.rate != 0
    }

    /// One frame back or forward (PLAY-3).
    func step(_ frames: Int) {
        player.pause()
        playing = false
        player.currentItem?.step(byCount: frames)
    }

    func setSpeed(_ rate: Float) {
        speed = rate
        player.defaultRate = rate
        if player.rate != 0 { player.rate = rate }
    }

    /// Stops and deletes the temporary file (IVID-2).
    func close() {
        player.pause()
        if let observer { player.removeTimeObserver(observer) }
        observer = nil
        player.replaceCurrentItem(with: nil)
        if let file { try? FileManager.default.removeItem(at: file) }
        file = nil
        ready = false
    }

    /// Deletes clip files left by a session the app didn't get to close
    /// (killed while a review was open). Run at launch.
    nonisolated static func removeLeftovers() {
        let temp = FileManager.default.temporaryDirectory
        for url in (try? FileManager.default.contentsOfDirectory(at: temp, includingPropertiesForKeys: nil)) ?? []
        where url.lastPathComponent.hasPrefix("playback-") {
            try? FileManager.default.removeItem(at: url)
        }
    }
}

/// Lets the player screen turn to landscape; the rest of the app stays
/// portrait (IVID-2).
@MainActor
enum OrientationLock {
    static var allowLandscape = false {
        didSet {
            guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }
            scene.windows.first?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
            if !allowLandscape { scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)) }
        }
    }
}
