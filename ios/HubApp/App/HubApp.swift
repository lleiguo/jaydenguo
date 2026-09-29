import HubKit
import SwiftUI

@main
struct HubApp: App {
    @State private var model = AppModel.live()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(model.lock)
                .onOpenURL { model.open($0) }
        }
        .onChange(of: scenePhase) { _, phase in
            model.lock.sceneChanged(phase)
            if phase == .background { model.scheduleRefresh() }
        }
        .backgroundTask(.appRefresh(AppModel.refreshTaskID)) { await model.refreshInBackground() }
    }
}
