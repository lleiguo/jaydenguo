import HubKit
import SwiftUI

/// More: School, Suggestions, Videos and Settings (intent 0004, APP-1,
/// APP-3).
struct MoreScreen: View {
    @Environment(AppModel.self) private var model
    @State private var pending = 0

    var body: some View {
        List {
            Section {
                NavigationLink(value: Route.school) { Label("School", systemImage: "graduationcap") }
                NavigationLink(value: Route.suggestions) {
                    Label("Suggestions", systemImage: "envelope")
                        .badge(pending)
                }
                NavigationLink(value: Route.videos) { Label("Videos", systemImage: "video") }
            }
            Section("Settings") {
                NavigationLink(value: Route.settings) { Label("General", systemImage: "gearshape") }
                NavigationLink { PeopleScreen() } label: { Label("People", systemImage: "person.2") }
                NavigationLink(value: Route.sources) { Label("Sources", systemImage: "arrow.triangle.2.circlepath") }
                NavigationLink(value: Route.accounts) { Label("Accounts", systemImage: "key") }
                NavigationLink { ClashesScreen() } label: { Label("Clashes", systemImage: "exclamationmark.triangle") }
                NavigationLink { CostsScreen() } label: { Label("Costs", systemImage: "dollarsign.circle") }
                NavigationLink { DeletedScreen() } label: { Label("Deleted", systemImage: "trash") }
                NavigationLink { SessionsScreen() } label: { Label("Sessions", systemImage: "iphone.and.arrow.forward") }
                NavigationLink { AppSettingsScreen() } label: { Label("App", systemImage: "iphone") }
            }
        }
        .navigationTitle("More")
        .task(id: model.changes) {
            if let n = try? await model.client.api.listSuggestions().ok.body.json.pending { pending = Int(n) }
        }
    }
}

/// The pages the More tab's links open.
struct MoreDestination: View {
    let route: Route

    var body: some View {
        switch route {
        case .school: SchoolScreen()
        case .suggestions: SuggestionsScreen()
        case .sources: SourcesScreen()
        case .accounts: AccountsScreen()
        case .settings: GeneralSettingsScreen()
        case .videos: VideosScreen()
        case .video(let id): VideoDetailScreen(id: id)
        default: EmptyView()
        }
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
