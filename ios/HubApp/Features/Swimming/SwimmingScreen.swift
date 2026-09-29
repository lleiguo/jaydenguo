import HubAPI
import HubKit
import SwiftUI

/// Swimming (intent 0004, ISWM-1; SWM-2, SWM-6): upcoming meets with
/// sessions and entries, the PB table per course, and past meets.
struct SwimmingScreen: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        RemoteContent(fetch: {
            async let meets = model.client.api.listMeets().ok.body.json
            async let pbs = model.client.api.listPersonalBests().ok.body.json.pbs
            return try await (meets: meets, pbs: pbs)
        }) { data in
            List {
                Section("Upcoming meets") {
                    if data.meets.upcoming.isEmpty { Caption("No upcoming meets.") }
                    ForEach(data.meets.upcoming, id: \.id) { MeetRow(meet: $0) }
                }
                pbSections(data.pbs)
                Section("Past meets") {
                    if data.meets.past.isEmpty { Caption("No past meets.") }
                    ForEach(data.meets.past, id: \.id) { MeetRow(meet: $0) }
                }
            }
            .accessibilityIdentifier("swimList")
        }
        .navigationTitle("Swimming")
        .toolbar { ToolbarItem(placement: .primaryAction) { RefreshSourcesButton(kind: "commit_swim", site: "Commit Swimming") } }
    }

    // SWM-6: one table per course; SCM and LCM are never mixed.
    @ViewBuilder
    private func pbSections(_ pbs: [Components.Schemas.SwimPbsResponse.PbsPayloadPayload]) -> some View {
        if pbs.isEmpty {
            Section("Personal bests") { Caption("No results yet.") }
        }
        let courses = pbs.reduce(into: [String]()) { if !$0.contains($1.course.rawValue) { $0.append($1.course.rawValue) } }
        ForEach(courses, id: \.self) { course in
            Section("Personal bests · \(SwimFormat.course(course))") {
                ForEach(pbs.filter { $0.course.rawValue == course }, id: \.key) { p in
                    NavigationLink(value: Route.swimEvent(key: p.key)) {
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(SwimFormat.event(distance: p.distance, stroke: p.stroke.rawValue)).font(.body.weight(.medium))
                                Caption([p.swimDate, p.meetName].compactMap { $0 }.joined(separator: " · "))
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(SwimFormat.time(p.timeMs)).font(.body.weight(.semibold).monospacedDigit())
                                Caption("\(Int(p.swims)) swim\(p.swims == 1 ? "" : "s")")
                            }
                        }
                    }
                    .accessibilityIdentifier("pbRow")
                }
            }
        }
    }
}

/// A meet in a list: dates, course and place, sessions and entries before
/// it, swims and PBs after.
struct MeetRow: View {
    let meet: MeetView

    var body: some View {
        NavigationLink(value: Route.meet(id: meet.id)) {
            VStack(alignment: .leading, spacing: 3) {
                Text(meet.name).font(.headline)
                Caption(([meet.dates, meet.courseCode, meet.venue, meet.city].compactMap { $0 }.filter { !$0.isEmpty }
                    + (meet.awaitingSignup ? ["not signed up yet"] : []))
                    .joined(separator: " · "))
                if meet.swims == 0 {
                    if !meet.sessions.isEmpty {
                        Text("\(meet.sessions.count == 1 ? "Session" : "Sessions"): \(meet.sessions.map { SwimFormat.session(date: $0.date, time: $0.time) }.joined(separator: ", "))")
                            .font(.subheadline)
                    }
                    if !meet.entries.isEmpty {
                        Text("Entered: " + meet.entries.map { e in
                            SwimFormat.event(distance: e.distance, stroke: e.stroke.rawValue)
                                + (e.seedTimeMs.map { " (seed \(SwimFormat.time($0)))" } ?? "")
                        }.joined(separator: ", "))
                        .font(.subheadline)
                    }
                } else {
                    Text("\(Int(meet.swims)) swim\(meet.swims == 1 ? "" : "s")" + (meet.pbs > 0 ? " · ★ \(Int(meet.pbs)) PB\(meet.pbs == 1 ? "" : "s")" : ""))
                        .font(.subheadline)
                }
            }
        }
        .accessibilityIdentifier("meet")
    }
}

/// One meet (SWM-2, SWM-3): sessions, entries, and his results.
struct MeetScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    let id: String
    @State private var selected: SwimResult?

    var body: some View {
        RemoteContent(fetch: { try await model.client.api.getMeet(path: .init(id: id)).ok.body.json }) { data in
            let m = data.meet
            List {
                Section {
                    Caption([m.dates, m.courseCode.map(SwimFormat.course), m.venue, m.city]
                        .compactMap { $0 }.joined(separator: " · "))
                    ForEach(m.sessions, id: \.self) { s in
                        Label(SwimFormat.session(date: s.date, time: s.time), systemImage: "clock")
                    }
                    if let url = m.sourceUrl.flatMap(URL.init(string:)), url.scheme == "https" {
                        Button("Open on Commit Swimming") { openURL(url) }
                    }
                }
                if !m.entries.isEmpty {
                    Section("Entered") {
                        ForEach(m.entries, id: \.key) { e in
                            LabeledContent(SwimFormat.event(distance: e.distance, stroke: e.stroke.rawValue)) {
                                Text([e.seedTimeMs.map { "seed \(SwimFormat.time($0))" }, e.session.map { SwimFormat.session(date: $0.date, time: $0.time) }]
                                    .compactMap { $0 }.joined(separator: " · "))
                            }
                        }
                    }
                }
                Section("Results") {
                    if data.results.isEmpty { Caption("No swims yet.") }
                    ForEach(data.results, id: \.id) { r in
                        Button { selected = r } label: { SwimResultRow(result: r, shows: .meet) }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("swimResult")
                    }
                }
            }
            .navigationTitle(m.name)
        }
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $selected) { r in
            SwimResultSheet(result: r) { model.swimmingPath.append($0) }
        }
    }
}
