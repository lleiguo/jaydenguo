import HubKit
import SwiftUI

/// Today, Calendar, Tennis, Swimming, More (intent 0004, APP-1).
struct MainTabs: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        TabView(selection: $model.selectedTab) {
            Tab("Today", systemImage: "sun.max", value: Route.Tab.today) {
                NavigationStack { TodayScreen() }
            }
            Tab("Calendar", systemImage: "calendar", value: Route.Tab.calendar) {
                NavigationStack { CalendarScreen() }
            }
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
    }
}
