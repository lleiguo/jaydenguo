import HubAPI
import HubKit
import SwiftUI

/// Settings → Cookie → Memory (intent 0007, MEM-4): everything she was told
/// to remember, with who saved it and when. Add, edit, forget; forgotten
/// facts can be brought back for 30 days.
struct CookieMemoryScreen: View {
    @Environment(AppModel.self) private var model
    @State private var memories: Loadable<[CookieMemory]> = .loading
    @State private var forgotten: [CookieMemory] = []
    @State private var editing: Draft?

    /// A new fact (no id) or one being edited.
    struct Draft: Identifiable {
        /// The fact's id, or nil for a new one.
        let memory: String?
        var text: String
        var id: String { memory ?? "new" }
    }

    var body: some View {
        LoadableView(state: memories) { list in
            List {
                Section {
                    if list.isEmpty {
                        Caption("Nothing yet. Say “Cookie, remember that…”, or add a fact here.")
                    }
                    ForEach(list, id: \.id) { memory in
                        Button { editing = Draft(memory: memory.id, text: memory.text) } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(memory.text).foregroundStyle(.primary)
                                Caption(memory.savedLine(model.homeTime))
                            }
                        }
                        .accessibilityIdentifier("cookieMemory")
                        .accessibilityHint("Edits this fact")
                        .swipeActions {
                            Button("Forget", role: .destructive) { Task { await forget(memory) } }
                        }
                        .accessibilityAction(named: "Forget") { Task { await forget(memory) } }
                    }
                } footer: {
                    Text("One list for the whole family. Don't keep passwords, card numbers or sign-in codes here: Cookie refuses them.")
                }
                if !forgotten.isEmpty {
                    Section {
                        ForEach(forgotten, id: \.id) { memory in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(memory.text).foregroundStyle(.secondary)
                                Caption(memory.savedLine(model.homeTime))
                            }
                            .swipeActions {
                                Button("Restore") { Task { await restore(memory) } }.tint(.accentColor)
                            }
                            .accessibilityAction(named: "Restore") { Task { await restore(memory) } }
                            .accessibilityIdentifier("cookieForgotten")
                        }
                    } header: {
                        Text("Forgotten")
                    } footer: {
                        Text("Swipe to restore. Deleted for good after 30 days.")
                    }
                }
            }
        }
        .navigationTitle("Memory")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Add a fact", systemImage: "plus") { editing = Draft(memory: nil, text: "") }
                    .accessibilityIdentifier("cookieAddMemory")
            }
        }
        .sheet(item: $editing) { draft in
            MemoryEditor(draft: draft) { text in await save(draft, text) }
        }
        .task { await refresh() }
        .refreshable { await refresh() }
    }

    private func refresh() async {
        let next = await load { try await model.client.api.listAssistantMemories().ok.body.json.memories }
        if case .failed = next, memories.value != nil { return }
        memories = next
        forgotten = (try? await model.client.api.listAssistantMemories(query: .init(forgotten: ._true)).ok.body.json.memories) ?? []
    }

    private func act(_ fallback: String, _ work: () async throws -> Void) async -> Bool {
        do {
            try await work()
            await refresh()
            return true
        } catch {
            model.show(HubError.from(error)?.message ?? fallback)
            return false
        }
    }

    private func save(_ draft: Draft, _ text: String) async -> Bool {
        await act("Couldn't save that.") {
            if let id = draft.memory {
                _ = try await model.client.api.updateAssistantMemory(path: .init(id: id), body: .json(.init(text: text))).ok
            } else {
                _ = try await model.client.api.addAssistantMemory(body: .json(.init(text: text))).created
            }
        }
    }

    private func forget(_ memory: CookieMemory) async {
        if await act("Couldn't forget that.", { _ = try await model.client.api.forgetAssistantMemory(path: .init(id: memory.id)).ok }) {
            model.show("Forgotten. It can be restored for 30 days.")
        }
    }

    private func restore(_ memory: CookieMemory) async {
        _ = await act("Couldn't restore that.") { _ = try await model.client.api.restoreAssistantMemory(path: .init(id: memory.id)).ok }
    }
}

/// Add or edit one fact.
private struct MemoryEditor: View {
    @Environment(\.dismiss) private var dismiss
    let draft: CookieMemoryScreen.Draft
    let save: (String) async -> Bool
    @State private var text = ""
    @State private var saving = false
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("One short fact", text: $text, axis: .vertical)
                        .lineLimit(2...6)
                        .focused($focused)
                        .accessibilityIdentifier("cookieMemoryText")
                } footer: {
                    Text("\(text.count) of \(CookieChat.factLimit) characters")
                        .foregroundStyle(text.count > CookieChat.factLimit ? .red : .secondary)
                }
            }
            .navigationTitle(draft.memory == nil ? "New fact" : "Edit fact")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        guard let fact = CookieChat.fact(text) else { return }
                        saving = true
                        Task {
                            if await save(fact) { dismiss() }
                            saving = false
                        }
                    }
                    .disabled(saving || CookieChat.fact(text) == nil)
                    .accessibilityIdentifier("cookieMemorySave")
                }
            }
            .onAppear {
                text = draft.text
                focused = true
            }
        }
    }
}
