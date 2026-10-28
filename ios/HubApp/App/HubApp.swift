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
            if phase == .active {
                model.pickUpSharedReview()
                model.leave.report()
            }
            if phase == .background {
                model.scheduleRefresh()
                // Cookie stops listening and speaking when the app leaves the screen.
                model.cookieTalk.reset()
            }
        }
        .backgroundTask(.appRefresh(AppModel.refreshTaskID)) { await model.refreshInBackground() }
    }
}
