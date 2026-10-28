import CoreLocation
import Foundation
import HubAPI
import HubKit
import Observation

/// "Time to leave" (intent 0027, TRF-A1, TRF-A2): while this phone has the
/// kind on, it tells the hub where it is: on launch and each time it comes
/// to the front, and, with "Always", on iOS's significant location changes
/// (about 500 m), which also wake the app in the background. The hub keeps
/// only the latest place, rounded to about 100 m, for a day.
@MainActor @Observable
final class LeaveLocation: NSObject, CLLocationManagerDelegate {
    private(set) var status: CLAuthorizationStatus
    @ObservationIgnored private let manager = CLLocationManager()
    @ObservationIgnored private let client: HubClient
    @ObservationIgnored private var lastSent: Date?
    /// Remembered so a background relaunch for a location change keeps
    /// monitoring before the settings have loaded.
    @ObservationIgnored private var on: Bool {
        get { UserDefaults.standard.bool(forKey: "leaveOn") }
        set { UserDefaults.standard.set(newValue, forKey: "leaveOn") }
    }

    /// At most one report per 5 minutes (TRF-A2).
    private static let every: TimeInterval = 5 * 60

    init(client: HubClient) {
        self.client = client
        status = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        if on { start() }
    }

    /// Follows the kind's switch: on asks for location the first time,
    /// then reports (at most every 5 minutes).
    func sync(on wanted: Bool) {
        if wanted {
            on = true
            start()
        } else if on {
            on = false
            stop()
        }
    }

    /// The app came to the front.
    func report() {
        guard on, isAllowed else { return }
        manager.requestLocation()
    }

    /// "Always" makes running late work while the app is closed (T-2).
    func askAlways() { manager.requestAlwaysAuthorization() }

    var isAllowed: Bool { status == .authorizedWhenInUse || status == .authorizedAlways }

    private func start() {
        switch status {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways:
            manager.startMonitoringSignificantLocationChanges()
            manager.requestLocation()
        case .authorizedWhenInUse:
            manager.requestLocation()
        default:
            break
        }
    }

    private func stop() {
        manager.stopMonitoringSignificantLocationChanges()
        lastSent = nil
        // The hub forgot the place when the kind went off; this is belt and braces.
        Task { _ = try? await client.api.forgetDeviceLocation().ok }
    }

    private func send(_ location: CLLocation) {
        guard on else { return }
        if let lastSent, Date.now.timeIntervalSince(lastSent) < Self.every { return }
        lastSent = .now
        let body = Operations.SaveDeviceLocation.Input.Body.JsonPayload(
            lat: location.coordinate.latitude,
            lng: location.coordinate.longitude,
            accuracyM: location.horizontalAccuracy >= 0 ? Int(location.horizontalAccuracy.rounded()) : nil
        )
        Task { _ = try? await client.api.saveDeviceLocation(body: .json(body)).ok }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            self.status = status
            if self.on { self.start() }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else { return }
        Task { @MainActor in self.send(last) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}
