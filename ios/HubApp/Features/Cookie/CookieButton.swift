import HubKit
import SwiftUI

/// Cookie's avatar, floating over every screen (intent 0007, CK-1): a tap
/// opens the chat (CK-4). Press and hold to talk arrives with voice (K6).
struct CookieButton: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        let offline = model.offlineSince != nil
        Button {
            // CK-7: nothing is queued offline.
            if offline { model.show("You're offline. Cookie needs a connection.") } else { model.cookieOpen = true }
        } label: {
            CookieAvatar(size: 52)
                .shadow(color: .black.opacity(0.25), radius: 5, y: 2)
                .opacity(offline ? 0.45 : 1)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Ask Cookie")
        .accessibilityHint(offline ? "Offline" : "Opens the chat with Cookie")
        .accessibilityIdentifier("cookieButton")
        .padding(.trailing, 16)
        // Above the tab bar, and above the undo banner while it shows.
        .padding(.bottom, model.toast == nil ? 62 : 124)
        .animation(.snappy, value: model.toast)
        .sheet(isPresented: $model.cookieOpen) { CookieChatSheet() }
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
