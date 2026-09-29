import HubAPI
import HubKit
import SwiftUI

/// Today (intent 0004, APP-2). N2 shows today's events and the basics; the
/// full set of cards comes in N3.
struct TodayScreen: View {
    @Environment(AppModel.self) private var model
    @State private var state: Loadable<Components.Schemas.TodayView> = .loading

    var body: some View {
        LoadableView(state: state) { today in
            List {
                if !today.waiting.failingSources.isEmpty || today.waiting.suggestions > 0 || !today.waiting.entries.isEmpty {
                    Section("Waiting on you") {
                        if today.waiting.suggestions > 0 {
                            Label("\(today.waiting.suggestions) suggestions to review", systemImage: "envelope.badge")
                        }
                        ForEach(today.waiting.entries, id: \.id) { entry in
                            Label("Finish entering \(entry.tournamentName)", systemImage: "tennisball")
                        }
                        ForEach(today.waiting.failingSources, id: \.id) { source in
                            Label("\(source.name) isn't syncing", systemImage: "exclamationmark.arrow.triangle.2.circlepath")
                                .foregroundStyle(.red)
                        }
                    }
                }
                Section(model.homeTime.dayTitle(today.date)) {
                    if today.events.isEmpty {
                        Text("Nothing on today.").foregroundStyle(.secondary)
                    }
                    ForEach(today.events, id: \.id) { event in
                        EventRow(event: event, homeTime: model.homeTime)
                    }
                }
                if let school = today.schoolDay {
                    Section(school.today ? "Today at school" : "Next school day") {
                        ForEach(school.periods, id: \.id) { period in
                            LabeledContent(period.title, value: model.homeTime.range(period.start, period.end))
                        }
                    }
                }
                if !today.clashes.isEmpty {
                    Section("Clashes this week") {
                        ForEach(today.clashes, id: \.a) { clash in
                            Label("\(clash.eventA.title) and \(clash.eventB.title)", systemImage: "exclamationmark.triangle.fill")
                                .foregroundStyle(.red)
                        }
                    }
                }
            }
            .accessibilityIdentifier("todayList")
        }
        .navigationTitle("Today")
        .task { await refresh() }
        .refreshable { await refresh() }
    }

    private func refresh() async {
        let next = await load { try await model.client.api.getToday().ok.body.json }
        if case .failed = next, state.value != nil { return }
        state = next
    }
}

struct EventRow: View {
    let event: Components.Schemas.EventView
    let homeTime: HomeTime

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(event.allDay ? "All day" : homeTime.time(event.start))
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 72, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(event.title).strikethrough(event.status == .cancelled)
                if let place = event.locationName {
                    Text(place).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}
