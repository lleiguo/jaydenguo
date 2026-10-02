import HubKit
import SwiftUI

/// The chat with Cookie (intent 0007, CK-4): the conversation so far, a text
/// field, and where each answer came from (CHR-4).
struct CookieChatSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @FocusState private var typing: Bool
    private let bottom = "bottom"

    var body: some View {
        let store = model.cookie
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if store.isLoading {
                            ProgressView().frame(maxWidth: .infinity)
                        } else if let error = store.loadError {
                            Caption(error)
                        }
                        if store.messages.isEmpty, !store.isLoading { CookieHint() }
                        ForEach(store.messages) { message in
                            CookieBubble(message: message)
                            if message.memory != nil { MemoryUndo(message: message) }
                        }
                        if store.isAsking {
                            HStack(spacing: 8) {
                                ProgressView()
                                Text("Cookie is looking…").font(.subheadline).foregroundStyle(.secondary)
                            }
                            .accessibilityElement(children: .combine)
                            .accessibilityIdentifier("cookieLooking")
                        }
                        Color.clear.frame(height: 1).id(bottom)
                    }
                    .padding()
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: store.messages.count) { withAnimation { proxy.scrollTo(bottom, anchor: .bottom) } }
                .onChange(of: store.isAsking) { withAnimation { proxy.scrollTo(bottom, anchor: .bottom) } }
                .onAppear { proxy.scrollTo(bottom, anchor: .bottom) }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { field(store) }
            .navigationTitle("Cookie")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .task { await store.loadIfNeeded() }
    }

    private func field(_ store: CookieStore) -> some View {
        @Bindable var store = store
        let tooLong = store.draft.count > CookieChat.questionLimit
        return VStack(alignment: .leading, spacing: 4) {
            if tooLong {
                Text("That's too long: \(store.draft.count) of \(CookieChat.questionLimit) characters.")
                    .font(.caption).foregroundStyle(.red)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Ask Cookie", text: $store.draft, axis: .vertical)
                    .lineLimit(1...4)
                    .focused($typing)
                    .submitLabel(.send)
                    .onSubmit { send(store) }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 18))
                    .accessibilityIdentifier("cookieField")
                Button { send(store) } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.system(size: 32))
                }
                .disabled(!store.canSend)
                .accessibilityLabel("Send")
                .accessibilityIdentifier("cookieSend")
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.bar)
    }

    private func send(_ store: CookieStore) {
        guard store.canSend else { return }
        Task { await store.send() }
    }
}

/// "Saved to memory · Undo" under an answer, for 10 seconds (MEM-2).
private struct MemoryUndo: View {
    @Environment(AppModel.self) private var model
    let message: CookieMessage
    @State private var expired = false

    var body: some View {
        if let change = message.memory {
            HStack(spacing: 8) {
                Label(change.label, systemImage: change.kind == .saved ? "checkmark.circle" : "trash")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if !expired {
                    Button("Undo") {
                        Task { if let said = await model.cookie.undo(message) { model.show(said) } }
                    }
                    .font(.caption.bold())
                    .accessibilityIdentifier("cookieUndo")
                }
            }
            .padding(.leading, 40)
            .task(id: message.id) {
                try? await Task.sleep(for: .seconds(10))
                expired = true
            }
        }
    }
}

/// Shown before the first question.
private struct CookieHint: View {
    var body: some View {
        VStack(spacing: 10) {
            CookieAvatar(size: 72)
            Text("Ask me about the family's schedule, tennis, swimming, school or videos. In English, 中文, or both.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Text("If I don't know, I'll bark.").font(.footnote).foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
        .accessibilityElement(children: .combine)
    }
}

struct CookieBubble: View {
    let message: CookieMessage

    var body: some View {
        let mine = message.role == .you
        HStack(alignment: .bottom, spacing: 8) {
            if mine { Spacer(minLength: 40) } else { CookieAvatar(size: 28) }
            VStack(alignment: .leading, spacing: 4) {
                Text(message.text)
                    .textSelection(.enabled)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .foregroundStyle(mine ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
                    .background(background(mine), in: RoundedRectangle(cornerRadius: 16))
                if let line = message.sourceLine {
                    Text(line).font(.caption).foregroundStyle(.secondary).padding(.leading, 4)
                }
                ForEach(message.links, id: \.url) { link in
                    Link(destination: link.url) {
                        Label(link.label, systemImage: "arrow.up.right.square").font(.caption)
                    }
                    .padding(.leading, 4)
                }
            }
            if !mine { Spacer(minLength: 40) }
        }
        .accessibilityElement(children: message.links.isEmpty ? .ignore : .contain)
        .accessibilityLabel(message.spokenLabel)
        .accessibilityIdentifier(mine ? "cookieQuestion" : message.kind == .bark ? "cookieBark" : "cookieAnswer")
    }

    private func background(_ mine: Bool) -> AnyShapeStyle {
        if mine { return AnyShapeStyle(.tint) }
        // A limit or an error isn't something she said about the hub.
        return message.kind == .notice ? AnyShapeStyle(.orange.opacity(0.2)) : AnyShapeStyle(.fill.secondary)
    }
}
