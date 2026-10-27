import AVFoundation
import HubKit
import SwiftUI

/// The review's clip full screen (intent 0026, FS-1..4): the same player, so
/// nothing downloads again and the time and speed carry over; upright or
/// sideways; the speeds, frame steps, points strip and current point stay.
/// Tapping the video shows and hides them; they hide after 3 s of playing.
struct FullScreenPlayer: View {
    let clip: ClipPlayer
    let points: [VideoTimeline.Point]
    let duration: Double
    @Environment(\.dismiss) private var dismiss
    @State private var controls = true
    /// Changes on every touch, restarting the 3 s before the controls hide.
    @State private var touched = 0
    @State private var drag: CGFloat = 0

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea().accessibilityIdentifier("fullScreenPlayer")
            PlayerLayerView(player: clip.player)
                .ignoresSafeArea()
                .offset(y: max(drag, 0))
                .contentShape(Rectangle())
                .onTapGesture {
                    controls.toggle()
                    touched += 1
                }
                .accessibilityHidden(true)
            if controls { overlay.transition(.opacity) }
        }
        .gesture(DragGesture(minimumDistance: 20)
            .onChanged { drag = $0.translation.height }
            .onEnded { v in
                if v.translation.height > 120 { dismiss() } else { withAnimation { drag = 0 } }
            })
        .animation(.easeInOut(duration: 0.2), value: controls)
        .environment(\.colorScheme, .dark)
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
        .task(id: touched) {
            try? await Task.sleep(for: .seconds(3))
            if !Task.isCancelled, clip.playing { controls = false }
        }
        .onChange(of: clip.playing) { touched += 1 }
    }

    private var overlay: some View {
        VStack(spacing: 10) {
            HStack {
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.title3.weight(.semibold)).padding(10)
                }
                .accessibilityLabel("Close full screen")
                .accessibilityIdentifier("closeFullScreen")
                Spacer()
                Text(VideoTimeline.clock(clip.time)).monospacedDigit().accessibilityIdentifier("fullScreenTime")
            }
            Spacer()
            CurrentPoint(points: points, time: clip.time)
                .frame(maxWidth: .infinity, alignment: .leading)
            PointStrip(points: points, time: clip.time, duration: duration) { s in
                clip.seek(to: s)
                touched += 1
            }
            HStack(spacing: 12) {
                Button { clip.togglePlay(); touched += 1 } label: {
                    Image(systemName: clip.playing ? "pause.fill" : "play.fill").frame(width: 24)
                }
                .accessibilityLabel(clip.playing ? "Pause" : "Play")
                .accessibilityIdentifier("fullScreenPlay")
                ClipStepButtons(clip: clip) { touched += 1 }
                Spacer(minLength: 8)
                ClipSpeedButtons(clip: clip) { touched += 1 }
            }
            .buttonStyle(.bordered)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("fullScreenControls")
        .foregroundStyle(.white)
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(alignment: .bottom) {
            LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .top, endPoint: .bottom)
                .frame(height: 200)
                .ignoresSafeArea()
                .allowsHitTesting(false)
        }
    }
}

/// The player's picture alone, aspect fit (FS-2). `VideoPlayer` brings its
/// own controls, which can't hold ours.
private struct PlayerLayerView: UIViewRepresentable {
    let player: AVPlayer

    final class LayerView: UIView {
        override static var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }

    func makeUIView(context: Context) -> LayerView {
        let view = LayerView()
        view.playerLayer.videoGravity = .resizeAspect
        view.playerLayer.player = player
        return view
    }

    func updateUIView(_ view: LayerView, context: Context) {
        view.playerLayer.player = player
    }
}

/// The point at the current time (PLAY-5), on the page and full screen.
struct CurrentPoint: View {
    let points: [VideoTimeline.Point]
    let time: Double

    var body: some View {
        Group {
            if let active = VideoTimeline.active(points, at: time) {
                Text("\(active.label): ").bold().foregroundStyle(active.good ? .good : .warning) + Text(active.text)
            } else {
                Text(points.isEmpty ? "No points name a time." : "Points show here as the video reaches them.")
                    .foregroundStyle(.secondary)
            }
        }
        .font(.subheadline)
        .accessibilityIdentifier("currentPoint")
    }
}

/// 0.25×, 0.5× and 1× (PLAY-3).
struct ClipSpeedButtons: View {
    let clip: ClipPlayer
    var touched: () -> Void = {}

    var body: some View {
        ForEach(ClipPlayer.speeds, id: \.self) { s in
            Button(s == 1 ? "1×" : "\(String(format: "%g", s))×") {
                clip.setSpeed(s)
                touched()
            }
            .tint(clip.speed == s ? .accentColor : .secondary)
            .accessibilityLabel(s == 1 ? "Normal speed" : s == 0.5 ? "Half speed" : "Quarter speed")
            .accessibilityAddTraits(clip.speed == s ? .isSelected : [])
        }
    }
}

/// One frame back and forward (PLAY-3).
struct ClipStepButtons: View {
    let clip: ClipPlayer
    var touched: () -> Void = {}

    var body: some View {
        Button { clip.step(-1); touched() } label: { Image(systemName: "backward.frame") }
            .accessibilityLabel("Back one frame")
        Button { clip.step(1); touched() } label: { Image(systemName: "forward.frame") }
            .accessibilityLabel("Forward one frame")
    }
}
