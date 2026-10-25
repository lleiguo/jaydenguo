import HubAPI
import HubKit
import SwiftUI

/// Today's mail (intent 0025, MD-5, MT-2..4, MG-3, MN-1): the open to-dos,
/// then today's emails by topic, each with its summary, newsletter picks,
/// its calendar suggestion and a link to Gmail, then the earlier days kept.
struct MailScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var calendar
    @State private var state: Loadable<MailView> = .loading
    @State private var markedRead: Set<String> = []

    var body: some View {
        @Bindable var calendar = calendar
        LoadableView(state: state) { mail in
            List {
                if calendar.people.count > 1 {
                    PeopleChips(people: calendar.people, hidden: $calendar.filters.hiddenPeople)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
                if !mail.connected {
                    Label("Gmail isn't set up for reading mail. Add it under More → Sources.", systemImage: "envelope.badge.shield.half.filled")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if let run = mail.lastRun, run.status == "failed" {
                    Label("Couldn't read the mail at the last try. Pull to try again.", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                }
                todosSection(mail)
                ForEach(mail.days, id: \.day) { day in
                    if day.day == mail.today {
                        daySections(day, hidden: calendar.filters.hiddenPeople)
                    } else {
                        Section {
                            DisclosureGroup(model.homeTime.dayTitle(day.day)) {
                                ForEach(MailGroups.byTopic(day.items, hiddenPeople: calendar.filters.hiddenPeople), id: \.topic) { group in
                                    ForEach(group.items, id: \.id) { MailRow(item: $0, approve: approve) }
                                }
                                othersRow(day.items)
                            }
                        }
                    }
                }
                if mail.days.isEmpty {
                    Text("No mail read in the last two weeks.").foregroundStyle(.secondary)
                }
            }
            .accessibilityIdentifier("mailList")
        }
        .navigationTitle("Today's mail")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { Task { await model.mailPlayer.play() } } label: { Label("Play", systemImage: "play.fill") }
                    .accessibilityIdentifier("mailPlay")
                    .disabled(model.mailPlayer.isLoading)
            }
        }
        .safeAreaInset(edge: .bottom) { MailMiniPlayer() }
        .task { await reload() }
        .refreshable {
            do {
                _ = try await model.client.api.refreshMail().accepted
                model.show("Reading the mail. It shows here in a minute.")
            } catch {
                model.show(HubError.from(error)?.message ?? "Couldn't read the mail now.")
            }
            await reload()
        }
        .onChange(of: model.changes) { Task { await reload() } }
    }

    private func reload() async {
        let next = await load { try await model.client.api.getMail().ok.body.json }
        if case .failed = next, state.value != nil { return }
        state = next
        if let mail = next.value { await markShownRead(mail) }
    }

    /// MD-6: today's summaries count as read once they've been on screen.
    private func markShownRead(_ mail: MailView) async {
        let shown = mail.days.first { $0.day == mail.today }?.items.filter { $0.isReadable && !$0.read && !markedRead.contains($0.id) } ?? []
        for item in shown {
            markedRead.insert(item.id)
            _ = try? await model.client.api.markMailRead(path: .init(id: item.id)).noContent
        }
    }

    // MARK: Sections

    @ViewBuilder
    private func todosSection(_ mail: MailView) -> some View {
        if !mail.todos.isEmpty {
            Section("To do") {
                ForEach(mail.todos, id: \.id) { todo in
                    Button { Task { await toggle(todo) } } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Image(systemName: todo.done ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(todo.done ? Color.green : Color.secondary)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(todo.text).strikethrough(todo.done)
                                Text([todo.dueOn.map { "Due \(model.homeTime.dayTitle($0))" }, todo.subject].compactMap { $0 }.joined(separator: " · "))
                                    .font(.caption)
                                    .foregroundStyle(todo.overdue ? Color.red : Color.secondary)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("mailTodo")
                    .accessibilityAddTraits(todo.done ? .isSelected : [])
                }
            }
        }
    }

    @ViewBuilder
    private func daySections(_ day: MailDay, hidden: Set<String>) -> some View {
        let groups = MailGroups.byTopic(day.items, hiddenPeople: hidden)
        if groups.isEmpty {
            Section(model.homeTime.dayTitle(day.day)) { Text("Nothing to read today.").foregroundStyle(.secondary) }
        }
        ForEach(groups, id: \.topic) { group in
            Section {
                ForEach(group.items, id: \.id) { MailRow(item: $0, approve: approve) }
            } header: {
                Label(group.topic.label, systemImage: group.topic.symbol)
            }
        }
        Section { othersRow(day.items) }
    }

    @ViewBuilder
    private func othersRow(_ items: [MailItem]) -> some View {
        let others = MailGroups.others(items)
        if !others.isEmpty {
            DisclosureGroup("Also came in (\(others.count))") {
                ForEach(others, id: \.id) { item in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.subject)
                        Text([item.senderName, MailGroups.skippedReason(item)].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .accessibilityIdentifier("mailOthers")
        }
    }

    // MARK: Actions

    private func toggle(_ todo: MailTodo) async {
        do {
            _ = try await model.client.api.setMailTodo(path: .init(id: todo.id), body: .json(.init(done: !todo.done))).ok
            await reload()
        } catch {
            model.show(HubError.from(error)?.message ?? "Couldn't save that.")
        }
    }

    /// MT-3: the suggestion made from the same email, approved as it is.
    private func approve(_ suggestionId: String) async {
        do {
            try await model.client.post("/api/v1/suggestions/\(suggestionId)/approve", [:])
            model.show("Added to the calendar.")
            await model.dataChanged()
        } catch {
            model.show(HubError.from(error)?.message ?? "Couldn't add it. Check it under Suggestions.")
        }
    }
}

/// One email: who and when, the summary, a newsletter's picks, the
/// calendar suggestion and a link to the email.
struct MailRow: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    let item: MailItem
    let approve: (String) async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(item.senderName).font(.subheadline.weight(.semibold))
                Spacer()
                Text(model.homeTime.time(item.receivedAt)).font(.caption).foregroundStyle(.secondary)
            }
            Text(item.subject).font(.headline)
            if let summary = item.summary { Text(summary) }
            if let news = item.newsletter, !news.others.isEmpty {
                DisclosureGroup("\(news.others.count) other items") {
                    ForEach(news.others, id: \.self) { Text($0).font(.callout).foregroundStyle(.secondary) }
                }
                .font(.callout)
            }
            if let s = item.suggestion {
                HStack {
                    Label("Calendar: \(s.title)\(s.date.map { ", \(model.homeTime.dayTitle($0))" } ?? "")", systemImage: "calendar.badge.plus")
                        .font(.callout)
                    Spacer()
                    if s.status == "pending" {
                        Button("Approve") { Task { await approve(s.id) } }
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("mailApprove")
                    } else {
                        Text(s.status == "approved" ? "Added" : "Rejected").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if let url = URL(string: item.messageUrl), url.scheme == "https" {
                Button { openURL(url) } label: { Label("Open in Gmail", systemImage: "arrow.up.right.square") }
                    .font(.caption)
                    .buttonStyle(.borderless)
            }
        }
        .padding(.vertical, 2)
    }
}

/// Today's card (MD-6): how much mail, what's left to do, and Play.
struct MailCard: View {
    @Environment(AppModel.self) private var model
    let mail: MailView

    var body: some View {
        Section {
            HStack(spacing: 12) {
                Button { model.go(.mail) } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Today's mail").font(.headline)
                            Text(MailGroups.cardLine(mail)).font(.subheadline).foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: mail.unread > 0 ? "envelope.badge" : "envelope.open")
                    }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("mailCard")
                Spacer()
                Button {
                    Task { await model.mailPlayer.play() }
                } label: {
                    Image(systemName: "play.circle.fill").font(.title)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Play today's mail")
                .accessibilityIdentifier("mailCardPlay")
            }
        }
    }
}

/// While the day is being read: what's playing, back, pause, next, stop.
struct MailMiniPlayer: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let player = model.mailPlayer
        if let part = player.current, let queue = player.queue {
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(part.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text("\(queue.index + 1) of \(queue.parts.count)").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button { player.previous() } label: { Image(systemName: "backward.fill") }
                    .disabled(!queue.hasPrevious)
                    .accessibilityLabel("Back")
                Button { player.togglePause() } label: { Image(systemName: player.isPlaying ? "pause.fill" : "play.fill") }
                    .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
                    .accessibilityIdentifier("mailPause")
                Button { player.next() } label: { Image(systemName: "forward.fill") }
                    .accessibilityLabel("Next")
                    .accessibilityIdentifier("mailNext")
                Button { player.stop() } label: { Image(systemName: "xmark") }
                    .accessibilityLabel("Stop")
            }
            .font(.title3)
            .padding(.horizontal)
            .padding(.vertical, 10)
            .background(.bar)
            .accessibilityIdentifier("mailPlayer")
        }
    }
}
