import HubAPI
import HubKit
import SwiftUI

/// School (intent 0004, ISCH-1): today at school (periods, rooms,
/// teachers), key dates and closures, and links to Veracross. Homework and
/// grades follow the web when M4.3 is built.
struct SchoolScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var calendar
    @Environment(\.openURL) private var openURL

    var body: some View {
        RemoteContent(fetch: {
            async let day = model.client.api.getSchoolDay().ok.body.json.schoolDay
            async let sources = model.client.api.listSources().ok.body.json.sources
            return try await (day: day, portal: sources.first { $0.kind == "veracross" }?.config.string("portalUrl"))
        }) { data in
            List {
                if let day = data.day {
                    Section(day.today ? "Today at school" : "Next school day: \(model.homeTime.dayTitle(day.date))") {
                        ForEach(day.periods, id: \.id) { period in
                            periodRow(period)
                        }
                    }
                } else {
                    Section { Caption("No classes in the next week.") }
                }
                Section("Key dates and closures") {
                    let dates = keyDates
                    if dates.isEmpty { Caption("No closures in the loaded weeks.") }
                    ForEach(dates, id: \.id) { e in
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(e.title)
                                Caption(dateText(e))
                            }
                        } icon: {
                            Image(systemName: e.category.symbol).foregroundStyle(e.category.color)
                        }
                        .accessibilityIdentifier("keyDate")
                    }
                }
                if let portal = data.portal.flatMap(URL.init(string:)), portal.scheme == "https" {
                    Section {
                        Button("Open Veracross") { openURL(portal) }
                    }
                }
            }
            .accessibilityIdentifier("schoolList")
        }
        .navigationTitle("School")
        .task { await calendar.ensureLoaded() }
    }

    @ViewBuilder
    private func periodRow(_ p: Components.Schemas.SchoolPeriod) -> some View {
        let row = TimeRow {
            Text(model.homeTime.time(p.start))
        } content: {
            VStack(alignment: .leading, spacing: 2) {
                Text(p.title).font(.body.weight(.medium))
                let details = [p.room, p.teachers].compactMap { $0 }
                if !details.isEmpty { Caption(details.joined(separator: " · ")) }
                Caption("until \(model.homeTime.time(p.end))")
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("schoolPeriod")
        if let url = p.url.flatMap(URL.init(string:)), url.scheme == "https" {
            Button { openURL(url) } label: { row.contentShape(Rectangle()) }.buttonStyle(.plain)
        } else {
            row
        }
    }

    /// Closures and all-day school events from today on, from the calendar.
    private var keyDates: [CalendarEvent] {
        let today = calendar.today
        return (calendar.index?.payload.events ?? [])
            .filter { $0.allDay && ($0.category == .schoolClosure || $0.category == .schoolClass) && $0.allDayDates.lastExclusive > today }
            .sorted { $0.start < $1.start }
    }

    private func dateText(_ e: CalendarEvent) -> String {
        let d = e.allDayDates
        let last = CalendarDates.add(days: -1, to: d.lastExclusive)
        return last == d.first ? model.homeTime.dayTitle(d.first)
            : "\(model.homeTime.dayTitle(d.first)) – \(model.homeTime.dayTitle(last))"
    }
}
