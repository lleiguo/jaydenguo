import AuthenticationServices
import HubKit
import SwiftUI

/// Google sign-in through the site (intent 0004, API-1). Nothing about
/// Jayden appears here (AUTH-3).
struct SignInView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "calendar.badge.checkmark")
                .font(.system(size: 64))
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            Text("Hub").font(.largeTitle.bold())
            Text("Sign in with the Google account that's allowed to use the site.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Spacer()
            if let error = model.signInError {
                Text(error)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("signInError")
            }
            Button {
                Task {
                    await model.signIn { url in
                        // An ephemeral sheet: no Google cookies stay behind.
                        try await webAuthenticationSession.authenticate(
                            using: url,
                            callback: .customScheme(SignInRequest.callbackScheme),
                            preferredBrowserSession: .ephemeral,
                            additionalHeaderFields: [:]
                        )
                    }
                }
            } label: {
                HStack {
                    if model.isSigningIn { ProgressView() }
                    Text("Sign in with Google")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(model.isSigningIn)
        }
        .padding(24)
    }
}
