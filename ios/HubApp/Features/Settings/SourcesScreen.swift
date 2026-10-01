import HubAPI
import HubKit
import SwiftUI

/// Settings → Sources (intent 0004, APP-3, APP-7; SYNC-2, SYNC-4): every
/// source with its state, refresh with live progress, run history, and its
/// main settings. Adding a source and category rules stay on the website.
struct SourcesScreen: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        RemoteContent(fetch: { try await model.client.api.listSources().ok.body.json.sources }) { sources in
            List {
                Section {
                    ForEach(sources, id: \.id) { s in
                        NavigationLink { SourceDetailScreen(id: s.id) } label: { SourceRow(source: s) }
                            .accessibilityIdentifier("source")
                    }
                } footer: {
                    Text("Add a source or change its category rules on the website.")
                }
            }
        }
        .navigationTitle("Sources")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if model.refreshing.contains("all") {
                    ProgressView()
                } else {
                    Button("Refresh all") { Task { await model.refreshAllSources() } }
                }
            }
        }
    }
}

struct SourceRow: View {
    let source: SourceView

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(source.name).font(.headline)
                if !source.enabled { Text("Off").font(.caption).foregroundStyle(.secondary) }
            }
            Caption(source.kindLabel)
            SourceStatus(source: source)
        }
        .accessibilityElement(children: .combine)
    }
}

/// "Syncing…", "Last synced 2 hours ago", or the failure (SYNC-4).
struct SourceStatus: View {
    let source: SourceView

    var body: some View {
        if source.running {
            Label("Syncing…", systemImage: "arrow.triangle.2.circlepath").font(.caption)
        } else if source.failing {
            Label("Failed \(Int(source.consecutiveFailures)) times in a row" + (source.lastRun?.errorMessage.map { ": \($0)" } ?? ""),
                  systemImage: "exclamationmark.triangle.fill")
                .font(.caption).foregroundStyle(.red)
        } else if let last = source.lastSuccessAt.flatMap(HomeTime.parse) {
            Caption("Last synced \(last.formatted(.relative(presentation: .named)))")
        } else {
            Caption("Not synced yet")
        }
    }
}

struct SourceDetailScreen: View {
    @Environment(AppModel.self) private var model
    let id: String

    var body: some View {
        RemoteContent(fetch: {
            async let sources = model.client.api.listSources().ok.body.json.sources
            async let runs = model.client.api.listSourceRuns(path: .init(id: id)).ok.body.json.runs
            return try await (source: sources.first { $0.id == id }, runs: runs)
        }) { data in
            if let s = data.source {
                SourceForm(source: s, runs: data.runs)
            } else {
                ContentUnavailableView("This source was removed", systemImage: "questionmark.folder")
            }
        }
    }
}

private struct SourceForm: View {
    @Environment(AppModel.self) private var model
    let source: SourceView
    let runs: [RunView]
    @State private var name: String
    @State private var category: EventCategory

    init(source: SourceView, runs: [RunView]) {
        self.source = source
        self.runs = runs
        _name = State(initialValue: source.name)
        _category = State(initialValue: EventCategory(rawValue: source.categoryMapping._default.rawValue) ?? .other)
    }

    var body: some View {
        Form {
            Section {
                LabeledContent("Kind", value: source.kindLabel)
                if let account = source.credentialLabel { LabeledContent("Account", value: account) }
                SourceStatus(source: source)
                if let next = source.nextRefreshAt.flatMap(HomeTime.parse), source.enabled {
                    Caption("Next automatic sync \(next.formatted(.relative(presentation: .named)))")
                }
                if model.refreshing.contains(source.id) || source.running {
                    HStack { ProgressView(); Text("Syncing…") }
                } else {
                    Button("Refresh now") { Task { await model.refreshSource(id: source.id, name: source.name) } }
                        .disabled(!source.enabled)
                }
            }
            Section("Settings") {
                Toggle("Sync this source", isOn: Binding(get: { source.enabled }, set: { on in Task { await save(["enabled": .bool(on)], on ? "Switched on." : "Switched off.") } }))
                TextField("Name", text: $name)
                    .onSubmit { Task { await save(["name": .string(name)], "Renamed.") } }
                    .submitLabel(.done)
                Picker("Category", selection: $category) {
                    ForEach(EventCategory.allCases, id: \.self) { Label($0.label, systemImage: $0.symbol).tag($0) }
                }
                .onChange(of: category) { _, c in Task { await saveCategory(c) } }
            }
            Section("Recent syncs") {
                if runs.isEmpty { Caption("None yet.") }
                ForEach(runs, id: \.id) { run in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(HomeTime.parse(run.startedAt).map { $0.formatted(date: .abbreviated, time: .shortened) } ?? run.startedAt)
                            Spacer()
                            Text(run.status).foregroundStyle(run.status == "failed" ? .red : .secondary)
                        }
                        .font(.subheadline)
                        Caption("\(Int(run.added)) added, \(Int(run.changed)) changed, \(Int(run.cancelled)) cancelled · \(run.trigger)")
                        if let error = run.errorMessage { Text(error).font(.caption).foregroundStyle(.red) }
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .navigationTitle(source.name)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func save(_ fields: [String: JSONField], _ done: String) async {
        do {
            try await model.client.patch("/api/v1/sources/\(source.id)", fields)
            model.show(done)
        } catch {
            model.show(HubError.from(error)?.message ?? "Couldn't save that.")
        }
        await model.dataChanged()
    }

    // The mapping is replaced whole: keep its owners and rules.
    private func saveCategory(_ c: EventCategory) async {
        guard c.rawValue != source.categoryMapping._default.rawValue else { return }
        var mapping = source.categoryMapping
        mapping._default = .init(rawValue: c.rawValue)!
        do {
            _ = try await model.client.api.updateSource(path: .init(id: source.id), body: .json(.init(categoryMapping: .init(
                _default: .init(rawValue: c.rawValue)!,
                owners: mapping.owners,
                rules: mapping.rules?.map { r in
                    .init(match: r.match, category: r.category.flatMap { .init(rawValue: $0.rawValue) },
                          attendance: r.attendance.flatMap { .init(rawValue: $0.rawValue) }, owner: r.owner)
                }
            )))).noContent
            model.show("New events from \(source.name) are \(c.label).")
        } catch {
            model.show(HubError.from(error)?.message ?? "Couldn't save that.")
        }
        await model.dataChanged()
    }
}
