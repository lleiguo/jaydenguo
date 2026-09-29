import HubKit
import SwiftUI
import WidgetKit

/// Widgets (intent 0004, EXT-1, EXT-2): "Next up" on the home screen and
/// lock screen, and "Today". They read the snapshot the app writes next to
/// the offline cache and never call the API. Content is privacy-sensitive,
/// so iOS can hide it on a locked phone.
@main
struct HubWidgets: WidgetBundle {
    var body: some Widget {
        NextUpWidget()
        TodayWidget()
    }
}

// MARK: Timeline

struct HubEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

struct HubProvider: TimelineProvider {
    private var snapshot: WidgetSnapshot? {
        WidgetSnapshot.load(from: .shared(appGroup: ResponseCache.bundleAppGroup))
    }

    func placeholder(in context: Context) -> HubEntry { HubEntry(date: .now, snapshot: .sample) }

    func getSnapshot(in context: Context, completion: @escaping (HubEntry) -> Void) {
        completion(HubEntry(date: .now, snapshot: context.isPreview ? .sample : snapshot))
    }

    // Redraw at each event's end (the next one moves up) and at midnight;
    // the app reloads the timeline whenever the data changes.
    func getTimeline(in context: Context, completion: @escaping (Timeline<HubEntry>) -> Void) {
        let snapshot = snapshot
        let dates = snapshot?.timelineDates(from: .now) ?? [.now]
        let entries = dates.map { HubEntry(date: $0, snapshot: snapshot) }
        completion(Timeline(entries: entries, policy: .after(dates.last ?? .now.addingTimeInterval(3600))))
    }
}

// MARK: Next up

struct NextUpWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NextUp", provider: HubProvider()) { entry in
            NextUpView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: "jaydenguohub://open/today"))
        }
        .configurationDisplayName("Next up")
        .description("What's next for the people you picked in the app.")
        .supportedFamilies([.systemSmall, .accessoryRectangular, .accessoryInline])
    }
}

struct NextUpView: View {
    @Environment(\.widgetFamily) private var family
    let entry: HubEntry

    var body: some View {
        if let snapshot = entry.snapshot {
            let upcoming = snapshot.upcoming(at: entry.date)
            switch family {
            case .accessoryInline:
                Text(snapshot.inlineText(at: entry.date)).privacySensitive()
            case .accessoryRectangular:
                rectangular(upcoming.first, snapshot)
            default:
                small(upcoming, snapshot)
            }
        } else {
            SignedOutView()
        }
    }

    private func small(_ upcoming: [WidgetSnapshot.Item], _ snapshot: WidgetSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Next up").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            if let next = upcoming.first {
                ItemLabel(item: next).font(.headline).lineLimit(2)
                Text(WidgetText.when(next, now: entry.date, snapshot: snapshot))
                    .font(.subheadline.monospacedDigit())
                    .minimumScaleFactor(0.8)
                if next.clash { ClashLabel() }
                Spacer(minLength: 0)
                if let then = upcoming.dropFirst().first {
                    Text("Then \(then.title), \(WidgetText.start(then, now: entry.date, snapshot: snapshot))")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            } else {
                Text("Nothing else coming up").font(.subheadline)
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .privacySensitive()
    }

    private func rectangular(_ next: WidgetSnapshot.Item?, _ snapshot: WidgetSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            if let next {
                HStack(spacing: 4) {
                    ItemLabel(item: next).font(.headline)
                    if next.clash { Image(systemName: "exclamationmark.triangle.fill").accessibilityLabel("Clash") }
                }
                Text(WidgetText.when(next, now: entry.date, snapshot: snapshot)).font(.caption.monospacedDigit())
            } else {
                Text("Nothing else coming up").font(.caption)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .privacySensitive()
    }
}

// MARK: Today

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "Today", provider: HubProvider()) { entry in
            TodayView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: "jaydenguohub://open/calendar"))
        }
        .configurationDisplayName("Today")
        .description("The rest of today, with clashes marked.")
        .supportedFamilies([.systemMedium])
    }
}

struct TodayView: View {
    let entry: HubEntry

    var body: some View {
        if let snapshot = entry.snapshot {
            let items = snapshot.today(at: entry.date)
            VStack(alignment: .leading, spacing: 5) {
                Text(snapshot.homeTime.dayTitle(snapshot.homeTime.localDate(entry.date)))
                    .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                if items.isEmpty { Text("Nothing else today").font(.subheadline) }
                ForEach(items.prefix(4), id: \.self) { item in
                    HStack(spacing: 8) {
                        Text(item.allDay ? "All day" : snapshot.homeTime.time(item.start))
                            .font(.caption.monospacedDigit())
                            .frame(width: 58, alignment: .leading)
                        ItemLabel(item: item).font(.subheadline).lineLimit(1)
                        if item.clash {
                            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red).accessibilityLabel("Clash")
                        }
                    }
                }
                if items.count > 4 { Text("+\(items.count - 4) more").font(.caption).foregroundStyle(.secondary) }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .privacySensitive()
        } else {
            SignedOutView()
        }
    }
}

// MARK: Pieces

struct ItemLabel: View {
    let item: WidgetSnapshot.Item

    var body: some View {
        Label { Text(item.title) } icon: { Image(systemName: item.symbol) }
    }
}

struct ClashLabel: View {
    var body: some View {
        Label("Clash", systemImage: "exclamationmark.triangle.fill").font(.caption.weight(.semibold)).foregroundStyle(.red)
    }
}

struct SignedOutView: View {
    var body: some View {
        Text("Open Hub to load your schedule").font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
    }
}

enum WidgetText {
    /// "Now until 19:10", "17:30 – 19:00", or "Tomorrow 09:00".
    static func when(_ item: WidgetSnapshot.Item, now: Date, snapshot: WidgetSnapshot) -> String {
        let home = snapshot.homeTime
        if item.start <= now { return "Now until \(home.time(item.end))" }
        let day = dayPrefix(item, now: now, snapshot: snapshot)
        return day + home.range(item.start, item.end)
    }

    /// "18:00", or "Tomorrow 09:00".
    static func start(_ item: WidgetSnapshot.Item, now: Date, snapshot: WidgetSnapshot) -> String {
        dayPrefix(item, now: now, snapshot: snapshot) + snapshot.homeTime.time(item.start)
    }

    private static func dayPrefix(_ item: WidgetSnapshot.Item, now: Date, snapshot: WidgetSnapshot) -> String {
        let home = snapshot.homeTime
        let today = home.localDate(now), day = home.localDate(item.start)
        if day == today { return "" }
        if day == CalendarDates.add(days: 1, to: today) { return "Tomorrow " }
        return (home.startOfDay(day)?.formatted(Date.FormatStyle(timeZone: home.timeZone).weekday(.abbreviated)) ?? day) + " "
    }
}

extension WidgetSnapshot {
    /// Made-up events for the widget gallery and previews.
    static var sample: WidgetSnapshot {
        let now = Date.now
        func at(_ minutes: Double) -> Date { now.addingTimeInterval(minutes * 60) }
        return WidgetSnapshot(timeZone: TimeZone.current.identifier, items: [
            .init(title: "Swim squad", symbol: "figure.pool.swim", category: "swimming", start: at(30), end: at(120),
                  allDay: false, clash: false, place: "Birch Aquatic Centre"),
            .init(title: "Tennis lesson", symbol: "tennisball.fill", category: "tennis", start: at(150), end: at(210),
                  allDay: false, clash: true, place: "Maple Tennis Club"),
            .init(title: "Fitness class", symbol: "figure.strengthtraining.traditional", category: "fitness",
                  start: at(190), end: at(250), allDay: false, clash: true, place: nil),
        ])
    }
}

#Preview("Next up", as: .systemSmall) {
    NextUpWidget()
} timeline: {
    HubEntry(date: .now, snapshot: .sample)
    HubEntry(date: .now, snapshot: nil)
}

#Preview("Today", as: .systemMedium) {
    TodayWidget()
} timeline: {
    HubEntry(date: .now, snapshot: .sample)
}

#Preview("Lock screen", as: .accessoryRectangular) {
    NextUpWidget()
} timeline: {
    HubEntry(date: .now, snapshot: .sample)
}
