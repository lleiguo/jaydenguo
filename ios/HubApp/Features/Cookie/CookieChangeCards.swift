import HubKit
import SwiftUI

/// The events one of Cookie's answers added, as cards under it, and Undo
/// for ten minutes (intent 0008, ACT-1, ACT-3). Shown in the chat and in
/// the bubble by her button; read from the store, so a card that says
/// "Being added…" changes when the worker is done.
struct CookieChangeCards: View {
    @Environment(AppModel.self) private var model
    let turnId: String
    @State private var now = Date.now
    @State private var undoing = false

    var body: some View {
        if let changes = model.cookie.changes(of: turnId) {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(changes.cards) { card in row(card) }
                if changes.canUndo(now: now) {
                    Button {
                        undoing = true
                        Task {
                            model.show(await model.cookie.undoChanges(changes))
                            undoing = false
                            await model.dataChanged()
                        }
                    } label: {
                        Label("Undo", systemImage: "arrow.uturn.backward")
                    }
                    .font(.caption.bold())
                    .disabled(undoing)
                    .accessibilityLabel(undoLabel(changes))
                    .accessibilityIdentifier("cookieChangeUndo")
                }
            }
            // Undo goes when its ten minutes are up.
            .task(id: changes.undoUntil) {
                now = .now
                guard let until = changes.undoUntil, until > now else { return }
                try? await Task.sleep(for: .seconds(until.timeIntervalSince(now)))
                now = .now
            }
            .task(id: changes.isSettling) {
                guard changes.isSettling else { return }
                await model.cookie.settle()
                // The event's own screen loses its "being added" mark.
                await model.dataChanged()
            }
        }
    }

    private func row(_ card: CookieChanges.Card) -> some View {
        Button {
            guard let id = card.eventId, card.opens else { return }
            Task { await model.openEvent(id: id, day: day(card)) }
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: symbol(card))
                    .font(.title3)
                    .foregroundStyle(tint(card.state))
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(card.title).font(.subheadline.weight(.semibold))
                        .strikethrough(card.state == .undone || card.state == .failed || card.change == .cancelled)
                    Text(card.whenLine(model.homeTime)).font(.caption)
                    if let who = card.whoLine { Text(who).font(.caption).foregroundStyle(.secondary) }
                    HStack(spacing: 4) {
                        if card.state == .adding { ProgressView().controlSize(.mini) }
                        Text(card.stateLine)
                    }
                    .font(.caption2)
                    .foregroundStyle(card.state == .failed ? AnyShapeStyle(.red) : AnyShapeStyle(.secondary))
                }
                Spacer(minLength: 0)
                if card.opens { Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary) }
            }
            .padding(10)
            .frame(maxWidth: 300, alignment: .leading)
            .background(.background.secondary, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(.separator, lineWidth: 0.5))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!card.opens)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(card.spokenLabel(model.homeTime))
        .accessibilityHint(card.opens ? "Opens the event" : "")
        .accessibilityAddTraits(card.opens ? .isButton : [])
        .accessibilityIdentifier("cookieCard")
    }

    /// The event's home date, so the calendar loads the right week.
    private func day(_ card: CookieChanges.Card) -> String {
        if card.allDay { return String(card.start.prefix(10)) }
        return HomeTime.parse(card.start).map(model.homeTime.localDate) ?? model.homeTime.localDate(.now)
    }

    private func symbol(_ card: CookieChanges.Card) -> String {
        switch (card.state, card.change) {
        case (.adding, _): "calendar.badge.clock"
        case (.added, .added): "calendar.badge.checkmark"
        case (.added, .moved): "calendar.badge.clock"
        case (.added, .cancelled): "calendar.badge.minus"
        case (.failed, _): "calendar.badge.exclamationmark"
        case (.undone, _): "calendar.badge.minus"
        }
    }

    private func undoLabel(_ changes: CookieChanges) -> String {
        guard changes.cards.count == 1, let card = changes.cards.first else { return "Undo these changes" }
        switch card.change {
        case .added: return "Undo adding \(card.title)"
        case .moved: return "Undo moving \(card.title)"
        case .cancelled: return "Undo cancelling \(card.title)"
        }
    }

    private func tint(_ state: CookieChanges.Card.State) -> Color {
        switch state {
        case .adding, .added: .accentColor
        case .failed: .red
        case .undone: .secondary
        }
    }
}
