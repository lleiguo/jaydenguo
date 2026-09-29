import HubAPI
import HubKit
import SwiftUI

/// Month (ICAL-1): category dots per day; tap a day to open it.
struct MonthView: View {
    @Bindable var store: CalendarStore

    private let letters = ["M", "T", "W", "T", "F", "S", "S"]

    var body: some View {
        let month = CalendarDates.monthStart(store.anchor)
        ScrollView {
            VStack(spacing: 6) {
                Text(monthTitle(month)).font(.title3.bold()).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal)
                HStack(spacing: 0) {
                    ForEach(Array(letters.enumerated()), id: \.offset) { _, l in
                        Text(l).font(.caption2).foregroundStyle(.secondary).frame(maxWidth: .infinity)
                    }
                }
                ForEach(CalendarDates.monthGrid(month), id: \.first) { week in
                    HStack(spacing: 0) {
                        ForEach(week, id: \.self) { date in
                            dayCell(date, inMonth: date.hasPrefix(String(month.prefix(7))))
                        }
                    }
                }
            }
            .padding(.vertical, 8)
        }
        .task(id: month) {
            // The month may reach past the loaded window.
            await store.ensureLoaded()
        }
    }

    private func dayCell(_ date: String, inMonth: Bool) -> some View {
        let items = store.items(on: date)
        let events = items.allDay + items.timed + (items.school?.classes.prefix(1).map { $0 } ?? [])
        let categories = Array(NSOrderedSet(array: events.map(\.category.rawValue))).compactMap { $0 as? String }.compactMap(EventCategory.init(rawValue:))
        let clash = events.contains { store.mark($0) == .clash }
        return Button {
            store.anchor = date
            store.mode = .day
        } label: {
            VStack(spacing: 4) {
                Text(String(Int(date.suffix(2)) ?? 0))
                    .font(.subheadline.weight(date == store.today ? .bold : .regular))
                    .foregroundStyle(date == store.today ? Color.white : inMonth ? .primary : .secondary)
                    .frame(width: 30, height: 30)
                    .background(date == store.today ? Circle().fill(Color.accentColor) : nil)
                HStack(spacing: 2) {
                    ForEach(categories.prefix(4), id: \.self) { c in
                        Circle().fill(c.color).frame(width: 6, height: 6)
                    }
                }
                .frame(height: 6)
                if clash {
                    Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 9)).foregroundStyle(.red)
                } else {
                    Color.clear.frame(height: 9)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(store.closures.contains(date) ? Color.secondary.opacity(0.1) : .clear)
            .opacity(inMonth ? 1 : 0.5)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel(date, count: events.count, categories: categories, clash: clash))
    }

    private func accessibilityLabel(_ date: String, count: Int, categories: [EventCategory], clash: Bool) -> String {
        var parts = [store.homeTime.dayTitle(date)]
        parts.append(count == 0 ? "nothing on" : "\(count) events: \(categories.map(\.label).joined(separator: ", "))")
        if clash { parts.append("has a clash") }
        if store.closures.contains(date) { parts.append("school closed") }
        return parts.joined(separator: ", ")
    }

    private func monthTitle(_ month: String) -> String {
        guard let d = store.homeTime.startOfDay(month) else { return month }
        return d.formatted(Date.FormatStyle(timeZone: store.homeTime.timeZone).month(.wide).year())
    }
}
