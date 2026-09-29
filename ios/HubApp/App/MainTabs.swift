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
                        NavigationStack { TodayScreen() }
                    }
                    Tab("Calendar", systemImage: "calendar", value: Route.Tab.calendar) {
                        NavigationStack { CalendarScreen() }
                    }
                    .badge(model.openClashes)
                    Tab("Tennis", systemImage: "tennisball", value: Route.Tab.tennis) {
                        NavigationStack { TennisScreen() }
                    }
                    Tab("Swimming", systemImage: "figure.pool.swim", value: Route.Tab.swimming) {
                        NavigationStack { SwimmingScreen() }
                    }
                    Tab("More", systemImage: "ellipsis.circle", value: Route.Tab.more) {
                        NavigationStack { MoreScreen() }
                    }
                }
                .environment(calendar)
            } else {
                ProgressView()
            }
        }
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
