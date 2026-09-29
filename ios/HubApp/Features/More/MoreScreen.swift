import HubKit
import SwiftUI

/// More: Videos, School, Suggestions and Settings (intent 0004, APP-1). N2
/// has Settings → App; the rest arrive in N6.
struct MoreScreen: View {
    var body: some View {
        List {
            Section {
                Label("Videos", systemImage: "video").foregroundStyle(.secondary)
                Label("School", systemImage: "graduationcap").foregroundStyle(.secondary)
                Label("Suggestions", systemImage: "envelope").foregroundStyle(.secondary)
            } footer: {
                Text("Coming in a later build.")
            }
            Section("Settings") {
                NavigationLink {
                    AppSettingsScreen()
                } label: {
                    Label("App", systemImage: "iphone")
                }
            }
        }
        .navigationTitle("More")
    }
}

/// Settings → App: the account, the lock, the version and signing out.
struct AppSettingsScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(AppLock.self) private var lock
    @State private var confirmSignOut = false

    var body: some View {
        @Bindable var lock = lock
        Form {
            Section("Account") {
                LabeledContent("Signed in as", value: model.email ?? "…")
                LabeledContent("Home time zone", value: model.homeTime.timeZone.identifier)
            }
            Section {
                Toggle("Lock with Face ID", isOn: $lock.enabled)
            } footer: {
                Text("Asks for Face ID or your passcode when the app opens, and after five minutes away.")
            }
            Section {
                LabeledContent("Version", value: model.client.config.appVersion)
            }
            Section {
                Button("Sign out", role: .destructive) { confirmSignOut = true }
                    .accessibilityIdentifier("signOut")
            } footer: {
                Text("Signing out removes the hub's data from this phone.")
            }
        }
        .navigationTitle("App")
        .confirmationDialog("Sign out of the hub on this phone?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { Task { await model.signOut() } }
        }
    }
}
