import AuthenticationServices
import HubAPI
import HubKit
import SwiftUI

/// Settings → Accounts (intent 0004, APP-3, SEC-5; CRED-1, CRED-4, CRED-6):
/// the logins and private links the hub signs in with. Secrets are
/// write-only: typed in secure fields, never returned by the API, never
/// shown. Google is connected on the website through a one-time handoff
/// (API-5), in the browser sheet.
struct AccountsScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var adding: Providers.Provider?

    var body: some View {
        RemoteContent(fetch: { try await model.client.api.listCredentials().ok.body.json.credentials }) { creds in
            List {
                let google = creds.filter { $0.provider == "google" }
                Section {
                    ForEach(google, id: \.id) { c in credentialLink(c) }
                    Menu {
                        ForEach(Providers.googleFeatures, id: \.feature) { f in
                            Button(f.label) { Task { await connectGoogle(f.feature) } }
                        }
                    } label: {
                        Label(google.isEmpty ? "Connect Google" : "Connect or reconnect Google", systemImage: "link.badge.plus")
                    }
                } header: {
                    ProviderHeader(name: "Google", creds: google)
                }
                ForEach(Providers.all) { p in
                    let mine = creds.filter { $0.provider == p.id }
                    Section {
                        ForEach(mine, id: \.id) { c in credentialLink(c) }
                        Button { adding = p } label: { Label("Add", systemImage: "plus") }
                    } header: {
                        ProviderHeader(name: p.name, creds: mine)
                    }
                }
            }
        }
        .navigationTitle("Accounts")
        .sheet(item: $adding) { p in AddCredentialSheet(provider: p) }
    }

    private func credentialLink(_ c: CredentialView) -> some View {
        NavigationLink { CredentialScreen(id: c.id) } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(c.label)
                Caption(Providers.kindLabel(c.kind) + (c.username.map { " · \($0)" } ?? ""))
                if c.needsAttention { Label("Needs attention", systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(.red) }
            }
        }
        .accessibilityIdentifier("credential")
    }

    /// API-5: a one-time link opens the website's Google flow signed in;
    /// it ends at jaydenguohub://done.
    private func connectGoogle(_ feature: String) async {
        do {
            let handoff = try await model.client.api.startHandoff(body: .json(.init(next: "/accounts/google/connect?feature=\(feature)"))).created.body.json
            guard let url = URL(string: handoff.url) else { return }
            let done = try await webAuthenticationSession.authenticate(
                using: url, callback: .customScheme(SignInRequest.callbackScheme),
                preferredBrowserSession: .ephemeral, additionalHeaderFields: [:]
            )
            let error = URLComponents(url: done, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "error" }?.value
            model.show(error == nil ? "Google connected." : "Google wasn't connected (\(error!)).")
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            return
        } catch {
            model.show(HubError.from(error)?.message ?? "Couldn't open Google.")
        }
        await model.dataChanged()
    }
}

struct ProviderHeader: View {
    let name: String
    let creds: [CredentialView]

    var body: some View {
        HStack {
            Text(name)
            Spacer()
            if creds.isEmpty { Text("Not connected") }
            else if creds.contains(where: \.needsAttention) { Text("Needs attention").foregroundStyle(.red) }
            else { Text("Connected").foregroundStyle(.green) }
        }
    }
}


/// One account: its state, test, update and remove (CRED-6).
struct CredentialScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var testing = false
    @State private var editing = false
    @State private var code = ""
    @State private var confirmRemove = false

    var body: some View {
        RemoteContent(fetch: { try await model.client.api.getCredential(path: .init(id: id)).ok.body.json }) { c in
            Form {
                Section {
                    LabeledContent("Kind", value: Providers.kindLabel(c.kind))
                    if let user = c.username { LabeledContent("Username", value: user) }
                    if c.kind != "oauth" {
                        LabeledContent(c.kind == "password" ? "Password" : "Link") {
                            Text("••••").accessibilityLabel("hidden")
                        }
                    }
                    LabeledContent("Last changed", value: fmt(c.updatedAt))
                    LabeledContent("Last used", value: fmt(c.lastUsedAt))
                    if let tested = c.lastTestAt {
                        Label("Last test \(fmt(tested)): \(c.lastTestOk == true ? "worked" : (c.lastError ?? "didn't work"))",
                              systemImage: c.lastTestOk == true ? "checkmark.circle" : "exclamationmark.triangle")
                            .foregroundStyle(c.lastTestOk == true ? Color.primary : .red)
                    }
                    if c.status == "removing" { Caption("Removing…") }
                }
                if c.waitingForCode {
                    Section {
                        TextField("Sign-in code from the email", text: $code)
                            .textContentType(.oneTimeCode)
                            .keyboardType(.numberPad)
                        Button("Send code") { Task { await sendCode(c) } }.disabled(code.isEmpty)
                    } footer: {
                        Text("\(c.label) emailed a code while signing in. Type it here to finish.")
                    }
                }
                Section {
                    if testing { HStack { ProgressView(); Text("Testing…") } }
                    else { Button("Test connection") { Task { await test(c) } } }
                    if c.kind != "oauth" { Button("Update") { editing = true } }
                    Button("Remove", role: .destructive) { confirmRemove = true }
                }
            }
            .navigationTitle(c.label)
            .sheet(isPresented: $editing) { EditCredentialSheet(credential: c) }
            .confirmationDialog("Remove \(c.label)?", isPresented: $confirmRemove, titleVisibility: .visible) {
                Button("Remove", role: .destructive) { Task { await remove(c) } }
            } message: {
                Text("The stored \(Providers.kindLabel(c.kind).lowercased()) is deleted.")
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }

    private func fmt(_ iso: String?) -> String {
        iso.flatMap(HomeTime.parse).map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "never"
    }

    /// The worker tests the login and writes the result back; follow it.
    private func test(_ c: CredentialView) async {
        testing = true
        defer { testing = false }
        do {
            _ = try await model.client.api.testCredential(path: .init(id: c.id)).accepted
            for _ in 0..<(c.provider == "veracross" ? 200 : 40) {
                try await Task.sleep(for: .seconds(1.5))
                let next = try await model.client.api.getCredential(path: .init(id: c.id)).ok.body.json
                if next.waitingForCode != c.waitingForCode || next.lastTestAt != c.lastTestAt {
                    await model.dataChanged()
                    if next.lastTestAt != c.lastTestAt {
                        model.show(next.lastTestOk == true ? "\(c.label): connection works." : "\(c.label): \(next.lastError ?? "didn't work").")
                        return
                    }
                    if next.waitingForCode { model.show("Enter the sign-in code from the email.") }
                }
            }
            model.show("The test is still running. Check back shortly.")
        } catch {
            model.show(HubError.from(error)?.message ?? "Couldn't test it.")
        }
    }

    private func sendCode(_ c: CredentialView) async {
        do {
            _ = try await model.client.api.submitSignInCode(path: .init(id: c.id), body: .json(.init(code: code))).accepted
            code = ""
            model.show("Code sent. Finishing the sign-in…")
        } catch {
            model.show(HubError.from(error)?.message ?? "Couldn't send the code.")
        }
    }

    private func remove(_ c: CredentialView) async {
        do {
            _ = try await model.client.api.removeCredential(path: .init(id: c.id)).noContent
            model.show("\(c.label) removed.")
            await model.dataChanged()
            dismiss()
        } catch {
            model.show(HubError.from(error)?.message ?? "Couldn't remove it.")
        }
    }
}

/// The fields of a login or private link. The secret is write-only: never
/// pre-filled, blank keeps the stored one when editing (CRED-4).
struct CredentialFields: View {
    let kind: String
    @Binding var label: String
    @Binding var username: String
    @Binding var secret: String
    let editing: Bool

    var body: some View {
        TextField("Name", text: $label)
        if kind == "password" {
            TextField("Username", text: $username)
                .textContentType(.username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            SecureField(editing ? "Password (leave blank to keep)" : "Password", text: $secret)
                .textContentType(.password)
                .accessibilityIdentifier("secretField")
        } else {
            // A link is shown while typed so it can be checked; it's never shown again once saved.
            TextField(editing ? "Calendar link (leave blank to keep)" : "webcal://… or https://…", text: $secret)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("secretField")
        }
    }
}

struct AddCredentialSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let provider: Providers.Provider
    @State private var kind: String
    @State private var label = ""
    @State private var username = ""
    @State private var secret = ""
    @State private var error: String?

    init(provider: Providers.Provider) {
        self.provider = provider
        _kind = State(initialValue: provider.kinds[0])
    }

    var body: some View {
        NavigationStack {
            Form {
                if provider.kinds.count > 1 {
                    Picker("Kind", selection: $kind) {
                        ForEach(provider.kinds, id: \.self) { Text(Providers.kindLabel($0)).tag($0) }
                    }
                    .pickerStyle(.segmented)
                }
                CredentialFields(kind: kind, label: $label, username: $username, secret: $secret, editing: false)
                if let error { Text(error).foregroundStyle(.red) }
            }
            .navigationTitle(provider.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(label.isEmpty || secret.isEmpty || (kind == "password" && username.isEmpty))
                }
            }
        }
    }

    private func save() async {
        var fields: [String: JSONField] = ["kind": .string(kind), "provider": .string(provider.id), "label": .string(label), "secret": .string(secret)]
        if kind == "password" { fields["username"] = .string(username) }
        do {
            try await model.client.post("/api/v1/credentials", fields)
            secret = ""
            model.show("\(label) saved.")
            await model.dataChanged()
            dismiss()
        } catch {
            self.error = HubError.from(error)?.message ?? "Couldn't save it."
        }
    }
}

struct EditCredentialSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let credential: CredentialView
    @State private var label: String
    @State private var username: String
    @State private var secret = ""
    @State private var error: String?

    init(credential: CredentialView) {
        self.credential = credential
        _label = State(initialValue: credential.label)
        _username = State(initialValue: credential.username ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                CredentialFields(kind: credential.kind, label: $label, username: $username, secret: $secret, editing: true)
                if let error { Text(error).foregroundStyle(.red) }
            }
            .navigationTitle("Update")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(label.isEmpty) }
            }
        }
    }

    private func save() async {
        do {
            _ = try await model.client.api.updateCredential(path: .init(id: credential.id), body: .json(.init(
                label: label,
                username: credential.kind == "password" ? username : nil,
                secret: secret.isEmpty ? nil : secret
            ))).ok
            secret = ""
            model.show("Saved.")
            await model.dataChanged()
            dismiss()
        } catch {
            self.error = HubError.from(error)?.message ?? "Couldn't save it."
        }
    }
}
