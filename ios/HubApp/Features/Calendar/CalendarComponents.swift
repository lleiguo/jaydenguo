import HubAPI
import HubKit
import SwiftUI

extension CalendarEvent.CategoryPayload {
    /// A colour per category (CAL-1); every use also shows the symbol.
    var color: Color {
        switch self {
        case .tennis: .green
        case .swimming: .blue
        case .soccer: .orange
        case .hockey: .indigo
        case .math: .purple
        case .chinese: .red
        case .fitness: .pink
        case .schoolClass: .brown
        case .schoolClosure: .gray
        case .other: .teal
        }
    }
}

/// The red outline and warning symbol for a clash (CON-2).
struct ClashSymbol: View {
    let mark: ClashMark

    var body: some View {
        switch mark {
        case .none:
            EmptyView()
        case .clash:
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
                .accessibilityLabel("Clash")
        case .withHiddenEvent:
            Image(systemName: "exclamationmark.triangle")
                .foregroundStyle(.red)
                .accessibilityLabel("Clash with a hidden event")
        }
    }
}

/// One event in a list: time, category, title, place, whose, and state.
struct CalendarEventRow: View {
    let event: CalendarEvent
    let homeTime: HomeTime
    var mark: ClashMark = .none
    var owners: String?

    var body: some View {
        TimeRow(bar: event.category.color) {
            if event.allDay {
                Text("All day")
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    Text(homeTime.time(event.start))
                    Text(homeTime.time(event.end)).foregroundStyle(.secondary)
                }
            }
        } content: {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Image(systemName: event.category.symbol)
                        .foregroundStyle(event.category.color)
                        .accessibilityLabel(event.category.label)
                    Text(event.title)
                        .font(.body.weight(.medium))
                        .strikethrough(event.isCancelled || event.isSkipped)
                    ClashSymbol(mark: mark)
                }
                let details = [event.locationName, owners].compactMap { $0 }
                if !details.isEmpty {
                    Text(details.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                }
                if let state = stateLine {
                    Text(state).font(.caption.weight(.medium)).foregroundStyle(.warning)
                }
            }
        }
        .padding(.vertical, 2)
        // The whole row takes the tap, not only its text.
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var stateLine: String? {
        if event.isCancelled { return "Cancelled by the source" }
        if event.isSkipped { return "Skipped" }
        if event.override?.sourceChangedAt != nil { return "Source changed since you moved this" }
        if event.override?.moved == true { return "Moved here" }
        if event.attendance == .optional { return "Optional" }
        if event.schoolClosed { return "School closed" }
        return nil
    }
}

/// People chips (CAL-3a): show or hide each person's events with one tap.
struct PeopleChips: View {
    let people: [Person]
    @Binding var hidden: Set<String>

    var body: some View {
        if people.count > 1 {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(people, id: \.id) { person in
                        let on = !hidden.contains(person.id)
                        Button {
                            if on { hidden.insert(person.id) } else { hidden.remove(person.id) }
                        } label: {
                            Label(person.name, systemImage: on ? "checkmark.circle.fill" : "circle")
                                .font(.subheadline)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(on ? Color.accentColor.opacity(0.15) : Color.secondary.opacity(0.1), in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(on ? .isSelected : [])
                        .accessibilityHint(on ? "Hides \(person.name)'s events" : "Shows \(person.name)'s events")
                    }
                }
                .padding(.horizontal)
            }
        }
    }
}

/// The 10-second undo banner (CON-3).
struct UndoBanner: View {
    @Environment(AppModel.self) private var model
    let toast: Toast

    var body: some View {
        HStack(spacing: 16) {
            Text(toast.message).font(.subheadline)
            Spacer(minLength: 0)
            if toast.undo != nil {
                Button("Undo") { Task { await model.runUndo(toast) } }
                    .font(.subheadline.bold())
                    .accessibilityIdentifier("undo")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.thickMaterial, in: RoundedRectangle(cornerRadius: 14))
        .shadow(radius: 6, y: 2)
        .padding(.horizontal)
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .task(id: toast.id) {
            try? await Task.sleep(for: .seconds(10))
            if model.toast == toast { model.toast = nil }
        }
        .sensoryFeedback(.success, trigger: toast.id)
        .accessibilityElement(children: .contain)
    }
}
