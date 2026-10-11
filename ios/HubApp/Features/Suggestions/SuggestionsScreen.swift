import HubAPI
import HubKit
import SwiftUI

/// Suggestions from coach emails (intent 0004, IEML-1; EML-2..4): each with
/// its quote and the fields the model was unsure about. Approve (after
/// editing, if needed) or reject; swipe to do either.
struct SuggestionsScreen: View {
    @Environment(AppModel.self) private var model
    @State private var selected: Suggestion?

    var body: some View {
        RemoteContent(fetch: { try await model.client.api.listSuggestions().ok.body.json }) { data in
            let pending = data.suggestions.filter { $0.status == "pending" }
            List {
                ForEach(pending, id: \.id) { s in
                    Button { selected = s } label: { SuggestionRow(suggestion: s, homeTime: model.homeTime) }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("suggestion")
                        .swipeActions(edge: .leading) {
                            Button { Task { await approve(s, s.extracted) } } label: { Label("Approve", systemImage: "checkmark") }
                                .tint(.green)
                        }
                        .swipeActions(edge: .trailing) {
                            // Not `.destructive`: that removes the row before the reload does.
                            Button { Task { await reject(s) } } label: { Label("Reject", systemImage: "xmark") }
                                .tint(.red)
                        }
                }
            }
            .overlay {
                if pending.isEmpty {
                    ContentUnavailableView("Nothing to review", systemImage: "envelope.open",
                                           description: Text("New suggestions from coach emails show up here."))
                }
            }
        }
        .navigationTitle("Suggestions")
        .sheet(item: $selected) { s in
            SuggestionSheet(suggestion: s, approve: { fields in await approve(s, fields) }, reject: { await reject(s) })
        }
    }

    /// EML-4: approving adds or changes the event; the server decides which.
    private func approve(_ s: Suggestion, _ f: Components.Schemas.Extracted) async {
        guard let date = f.date else {
            selected = s
            model.show("Give it a date first.")
            return
        }
        do {
            try await model.client.post("/api/v1/suggestions/\(s.id)/approve", [
                "title": .string(f.title),
                "date": .string(date),
                "startTime": f.startTime.map(JSONField.string) ?? .null,
                "endTime": f.endTime.map(JSONField.string) ?? .null,
                "location": .text(f.location),
                "category": .string(f.category),
            ])
            model.show(s.kind == .new ? "Added to the calendar." : "Calendar updated.")
            selected = nil
            await model.dataChanged()
        } catch {
            model.show(HubError.from(error)?.message ?? "Couldn't approve it.")
        }
    }

    private func reject(_ s: Suggestion) async {
        do {
            _ = try await model.client.api.rejectSuggestion(path: .init(id: s.id)).ok
            model.show("Rejected.")
            selected = nil
            await model.dataChanged()
        } catch {
            model.show(HubError.from(error)?.message ?? "Couldn't reject it.")
        }
    }
}

extension Suggestion: @retroactive Identifiable {}

struct SuggestionRow: View {
    let suggestion: Suggestion
    let homeTime: HomeTime

    var body: some View {
        let s = suggestion, f = suggestion.extracted
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(s.kindLabel).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Spacer()
                Text(s.sourceName).font(.caption).foregroundStyle(.secondary)
            }
            Text(f.title).font(.headline)
            Text(SuggestionText.when(f, homeTime: homeTime) + (f.location.map { " · \($0)" } ?? "")).font(.subheadline)
            if let target = s.target {
                Caption("Changes \(target.title), \(homeTime.dayTitle(homeTime.localDate(HomeTime.parse(target.start) ?? .now)))")
            }
            // Intent 0013 (DUP-4): a new event that seems to be there already.
            if let similar = s.similar {
                Label("Already on the calendar: \(similar.title), \(homeTime.dayTitle(homeTime.localDate(HomeTime.parse(similar.start) ?? .now)))", systemImage: "square.on.square")
                    .font(.caption.weight(.medium)).foregroundStyle(.warning)
            }
            Text("“\(s.quote)”").font(.callout).italic().foregroundStyle(.secondary).lineLimit(3)
            if !s.unsure.isEmpty {
                Label("Check the \(s.unsure.joined(separator: ", "))", systemImage: "questionmark.circle")
                    .font(.caption.weight(.medium)).foregroundStyle(.warning)
            }
            Caption("From \(s.from): \(s.subject)")
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

enum SuggestionText {
    static func when(_ f: Components.Schemas.Extracted, homeTime: HomeTime) -> String {
        let day = f.date.map { homeTime.dayTitle($0) } ?? "No date"
        switch (f.startTime, f.endTime) {
        case let (s?, e?): return "\(day), \(s)–\(e)"
        case let (s?, nil): return "\(day), \(s)"
        default: return "\(day), all day"
        }
    }
}

/// A suggestion to check and edit before approving (EML-4).
struct SuggestionSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(AppModel.self) private var model
    let suggestion: Suggestion
    let approve: (Components.Schemas.Extracted) async -> Void
    let reject: () async -> Void

    @State private var title: String
    @State private var date: Date
    @State private var timed: Bool
    @State private var start: Date
    @State private var end: Date
    @State private var location: String
    @State private var category: EventCategory
    @State private var working = false

    init(suggestion: Suggestion, approve: @escaping (Components.Schemas.Extracted) async -> Void, reject: @escaping () async -> Void) {
        self.suggestion = suggestion
        self.approve = approve
        self.reject = reject
        let f = suggestion.extracted
        let utc = TimeZone(identifier: "UTC")!
        func time(_ hhmm: String?, _ fallback: Int) -> Date {
            var c = Calendar(identifier: .gregorian)
            c.timeZone = utc
            let p = (hhmm ?? "").split(separator: ":").compactMap { Int($0) }
            return c.date(bySettingHour: p.first ?? fallback, minute: p.count > 1 ? p[1] : 0, second: 0, of: Date(timeIntervalSince1970: 0))!
        }
        _title = State(initialValue: f.title)
        _date = State(initialValue: f.date.flatMap(CalendarDates.date) ?? .now)
        _timed = State(initialValue: f.startTime != nil)
        _start = State(initialValue: time(f.startTime, 17))
        _end = State(initialValue: time(f.endTime, 18))
        _location = State(initialValue: f.location ?? "")
        _category = State(initialValue: EventCategory(rawValue: f.category) ?? .other)
    }

    var body: some View {
        let s = suggestion
        NavigationStack {
            Form {
                Section {
                    Text("“\(s.quote)”").italic()
                    LabeledContent("From", value: s.from)
                    LabeledContent("Subject", value: s.subject)
                    if let url = URL(string: s.messageUrl), url.scheme == "https" {
                        Button("Open the email") { openURL(url) }
                    }
                    if !s.unsure.isEmpty {
                        Label("The \(s.unsure.joined(separator: ", ")) may be wrong: check before approving.", systemImage: "questionmark.circle")
                            .foregroundStyle(.warning)
                    }
                }
                Section(s.kind == .new ? "The event" : "The change") {
                    TextField("Title", text: $title)
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                        .environment(\.timeZone, TimeZone(identifier: "UTC")!)
                    Toggle("At a set time", isOn: $timed)
                    if timed {
                        DatePicker("Starts", selection: $start, displayedComponents: .hourAndMinute)
                            .environment(\.timeZone, TimeZone(identifier: "UTC")!)
                        DatePicker("Ends", selection: $end, displayedComponents: .hourAndMinute)
                            .environment(\.timeZone, TimeZone(identifier: "UTC")!)
                    }
                    TextField("Place", text: $location)
                    Picker("Category", selection: $category) {
                        ForEach(EventCategory.allCases, id: \.self) { Label($0.label, systemImage: $0.symbol).tag($0) }
                    }
                }
                Section {
                    Button("Approve") { Task { working = true; await approve(fields); working = false } }
                        .disabled(working || title.trimmingCharacters(in: .whitespaces).isEmpty)
                    Button("Reject", role: .destructive) { Task { working = true; await reject(); working = false } }
                        .disabled(working)
                }
            }
            .navigationTitle(s.kindLabel)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private var fields: Components.Schemas.Extracted {
        var f = suggestion.extracted
        f.title = title.trimmingCharacters(in: .whitespaces)
        f.date = CalendarDates.string(date)
        f.startTime = timed ? hhmm(start) : nil
        f.endTime = timed ? hhmm(end) : nil
        f.location = location.trimmingCharacters(in: .whitespaces).isEmpty ? nil : location
        f.category = category.rawValue
        return f
    }

    private func hhmm(_ d: Date) -> String {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        let parts = c.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", parts.hour!, parts.minute!)
    }
}
