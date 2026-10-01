import HubKit
import SwiftUI

@main
struct HubApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = AppModel.live()

    init() {
        // IVID-2: no clip outlives the screen that played it.
        ClipPlayer.removeLeftovers()
    }
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
            if phase == .active { model.pickUpSharedReview() }
            if phase == .background { model.scheduleRefresh() }
        }
        .backgroundTask(.appRefresh(AppModel.refreshTaskID)) { await model.refreshInBackground() }
    }
}
