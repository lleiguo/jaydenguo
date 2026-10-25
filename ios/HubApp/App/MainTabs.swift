import HubKit
import SwiftUI

/// Today, Calendar, Tennis, Swimming, More (intent 0004, APP-1), with the
/// open-clash count on Calendar, live updates while the app is open
/// (APP-4) and the undo banner over everything (CON-3).
struct MainTabs: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var calendar: CalendarStore?

    var body: some View {
        @Bindable var model = model
        Group {
            if let calendar {
                TabView(selection: $model.selectedTab) {
                    Tab("Today", systemImage: "sun.max", value: Route.Tab.today) {
                        NavigationStack(path: $model.todayPath) {
                            TodayScreen().navigationDestination(for: Route.self) { route in
                                if route == .mail { MailScreen() }
                            }
                        }
                    }
                    Tab("Calendar", systemImage: "calendar", value: Route.Tab.calendar) {
                        NavigationStack { CalendarScreen() }
                    }
                    .badge(model.openClashes)
                    Tab("Tennis", systemImage: "tennisball", value: Route.Tab.tennis) {
                        NavigationStack(path: $model.tennisPath) {
                            TennisScreen().navigationDestination(for: Route.self) { SportDestination(route: $0) }
                        }
                    }
                    Tab("Swimming", systemImage: "figure.pool.swim", value: Route.Tab.swimming) {
                        NavigationStack(path: $model.swimmingPath) {
                            SwimmingScreen().navigationDestination(for: Route.self) { SportDestination(route: $0) }
                        }
                    }
                    Tab("More", systemImage: "ellipsis.circle", value: Route.Tab.more) {
                        NavigationStack(path: $model.morePath) {
                            MoreScreen().navigationDestination(for: Route.self) { MoreDestination(route: $0) }
                        }
                    }
                }
                .environment(calendar)
            } else {
                ProgressView()
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if let since = model.offlineSince { OfflineBanner(since: since) }
        }
        .animation(.snappy, value: model.offlineSince)
        .overlay(alignment: .bottom) {
            if let toast = model.toast {
                UndoBanner(toast: toast).padding(.bottom, 60)
            }
        }
        .animation(.snappy, value: model.toast)
        .onAppear { if calendar == nil { calendar = CalendarStore(model: model) } }
        .task(id: scenePhase == .active) {
            if scenePhase == .active { await model.watchChanges() }
        }
    }
}

/// "Offline, updated 2 hours ago" while screens show cached answers (OFF-1).
struct OfflineBanner: View {
    let since: Date

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { _ in
            Label("Offline, updated \(since.formatted(.relative(presentation: .named)))", systemImage: "wifi.slash")
                .font(.footnote.weight(.medium))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
                .background(.orange.opacity(0.2))
        }
        .accessibilityIdentifier("offlineBanner")
        .transition(.move(edge: .top).combined(with: .opacity))
    }
}
