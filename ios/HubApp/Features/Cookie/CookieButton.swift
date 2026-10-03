import HubKit
import SwiftUI

/// Cookie's avatar, floating over every screen (intent 0007, CK-1). A tap
/// opens the chat (CK-4); press and hold to talk (CK-2); what she heard and
/// her answer show in a bubble beside her (CK-3).
struct CookieButton: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var pressing = false
    @State private var hold: Task<Void, Never>?
    private let size: CGFloat = 52

    var body: some View {
        @Bindable var model = model
        let talk = model.cookieTalk
        let offline = model.offlineSince != nil
        VStack(alignment: .trailing, spacing: 8) {
            bubble(talk)
            avatar(talk, offline: offline)
        }
        .padding(.trailing, 16)
        // Above the tab bar, and above the undo banner while it shows.
        .padding(.bottom, model.toast == nil ? 62 : 124)
        .animation(.snappy, value: model.toast)
        .animation(.snappy, value: talk.phase)
        .sensoryFeedback(.impact(weight: .medium), trigger: talk.began)
        .sensoryFeedback(.impact(weight: .light), trigger: talk.ended)
        .sheet(isPresented: $model.cookieOpen) { CookieChatSheet() }
    }

    private func avatar(_ talk: CookieTalk, offline: Bool) -> some View {
        let recording = talk.isRecording
        let leaving = talk.phase == .recording(leaving: true)
        return CookieAvatar(size: size)
            .shadow(color: .black.opacity(0.25), radius: 5, y: 2)
            .opacity(offline ? 0.45 : 1)
            .scaleEffect(pressing ? 1.08 : 1)
            // The level ring: it swells with the voice, and turns grey when
            // lifting the finger would cancel.
            .background {
                if recording {
                    Circle()
                        .fill((leaving ? Color.gray : Color.red).opacity(0.35))
                        .scaleEffect(1.25 + talk.level * 0.6)
                        .animation(.linear(duration: 0.08), value: talk.level)
                }
            }
            .overlay {
                if recording { Circle().stroke(leaving ? Color.gray : Color.red, lineWidth: 3) }
                if talk.phase == .asking { ProgressView().controlSize(.large).tint(.white) }
            }
            .animation(.snappy, value: pressing)
            .contentShape(Circle())
            .gesture(
                DragGesture(minimumDistance: 0, coordinateSpace: .local)
                    .onChanged { value in
                        let inside = CookieVoice.isInside(x: value.location.x, y: value.location.y, size: size)
                        if !pressing {
                            pressing = true
                            hold = Task {
                                try? await Task.sleep(for: .seconds(CookieVoice.holdDelay))
                                guard !Task.isCancelled else { return }
                                // CK-3: a hold while she speaks is a new question; the speech stops.
                                await talk.holdBegan(offline: model.offlineSince != nil)
                            }
                        }
                        talk.holdMoved(inside: inside)
                    }
                    .onEnded { value in
                        pressing = false
                        hold?.cancel()
                        hold = nil
                        let inside = CookieVoice.isInside(x: value.location.x, y: value.location.y, size: size)
                        if talk.holdEnded(inside: inside) == .tap { tapped() }
                    }
            )
            .accessibilityElement()
            .accessibilityAddTraits(.isButton)
            .accessibilityLabel("Ask Cookie")
            .accessibilityHint(
                offline ? "Offline" : talk.isSpeaking ? "Stops her speaking" : "Opens the chat with Cookie. Hold to talk."
            )
            .accessibilityAction { tapped() }
            .accessibilityIdentifier("cookieButton")
    }

    private func tapped() {
        let talk = model.cookieTalk
        // CK-3: a tap while she speaks stops the speech.
        if talk.isSpeaking { return talk.stopSpeaking() }
        guard !talk.isBusy else { return }
        // CK-7: nothing is queued offline.
        if model.offlineSince != nil { return model.show("You're offline. Cookie needs a connection.") }
        talk.closeBubble()
        model.cookieOpen = true
    }

    @ViewBuilder
    private func bubble(_ talk: CookieTalk) -> some View {
        switch talk.phase {
        case .idle:
            EmptyView()
        case .recording(let leaving):
            card {
                Label(
                    leaving ? "Release to cancel" : "Listening… \(CookieVoice.clock(talk.elapsed))",
                    systemImage: leaving ? "xmark.circle" : "waveform"
                )
                .font(.subheadline.weight(.medium))
                .foregroundStyle(leaving ? AnyShapeStyle(.secondary) : AnyShapeStyle(.red))
                if !leaving {
                    Text("Release to send. Slide away to cancel.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("cookieListening")
        case .asking:
            card {
                Text("Cookie is looking…").font(.subheadline).foregroundStyle(.secondary)
            }
            .accessibilityIdentifier("cookieBubbleLooking")
        case .answered(let heard, let answer):
            card {
                Button {
                    talk.closeBubble()
                    model.cookieOpen = true
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        if !heard.isEmpty {
                            Text("“\(heard)”").font(.caption).foregroundStyle(.secondary)
                                .accessibilityIdentifier("cookieBubbleHeard")
                        }
                        Text(answer.text).font(.subheadline).foregroundStyle(.primary)
                            .accessibilityIdentifier("cookieBubbleAnswer")
                        if let line = answer.sourceLine {
                            Text(line).font(.caption2).foregroundStyle(.secondary)
                        }
                        if talk.isSpeaking {
                            // Shown while she reads it out, so silence is the phone's volume, not her.
                            Label("Speaking. Tap Cookie to stop.", systemImage: "speaker.wave.2.fill")
                                .font(.caption2).foregroundStyle(.tint)
                                .accessibilityIdentifier("cookieSpeaking")
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityLabel((heard.isEmpty ? "" : "You asked: \(heard). ") + answer.spokenLabel)
                .accessibilityHint("Opens the chat")
                .accessibilityIdentifier("cookieBubble")
                if answer.waitingUntil != nil { CookieWaiting() }
                // CASEC-4: what she added, read back as a card, with Undo one tap away.
                if answer.changes != nil { CookieChangeCards(turnId: answer.id).padding(.top, 4) }
            }
        case .hint(let text, let settings):
            card {
                Text(text).font(.subheadline)
                if settings {
                    // CK-6: how to turn the microphone on.
                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                    }
                    .font(.subheadline.weight(.semibold))
                }
            }
            .accessibilityIdentifier("cookieHint")
        }
    }

    private func card(@ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 4, content: content)
            .multilineTextAlignment(.leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: 280, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(.separator, lineWidth: 0.5))
            .shadow(color: .black.opacity(0.15), radius: 6, y: 2)
            .padding(.leading, 16)
            .transition(.scale(scale: 0.9, anchor: .bottomTrailing).combined(with: .opacity))
    }
}

/// The app icon's artwork in a circle: Cookie herself.
struct CookieAvatar: View {
    let size: CGFloat

    var body: some View {
        Image("Cookie")
            .resizable()
            .scaledToFill()
            .frame(width: size, height: size)
            .clipShape(Circle())
            .overlay(Circle().stroke(.background, lineWidth: 2))
            .accessibilityHidden(true)
    }
}
