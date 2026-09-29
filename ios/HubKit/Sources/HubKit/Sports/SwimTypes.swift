import Foundation
import HubAPI

public typealias MeetView = Components.Schemas.MeetView
public typealias SwimResult = Components.Schemas.ResultView
public typealias SwimEventDetail = Components.Schemas.EventDetail
public typealias ForecastPoint = Components.Schemas.ForecastPoint

public enum SwimFormat {
    /// "1:02.35" or "32.10", as the web shows it; "—" without a time.
    public static func time(_ ms: Double?) -> String {
        guard let ms, ms.isFinite else { return "—" }
        let cs = Int((ms / 10).rounded())
        let minutes = cs / 6000
        let seconds = (cs % 6000) / 100
        let ss = String(format: "%d.%02d", seconds, cs % 100)
        return minutes > 0 ? "\(minutes):" + (seconds < 10 ? "0" : "") + ss : ss
    }

    /// Signed change from the best before: "−1.23", "+0.45", "±0.00".
    public static func change(_ ms: Double?) -> String {
        guard let ms else { return "—" }
        if ms == 0 { return "±0.00" }
        return (ms < 0 ? "−" : "+") + time(abs(ms))
    }

    public static func stroke(_ raw: String) -> String {
        switch raw {
        case "free": "Free"
        case "back": "Back"
        case "breast": "Breast"
        case "fly": "Fly"
        case "im": "IM"
        default: raw
        }
    }

    public static func course(_ raw: String) -> String {
        switch raw {
        case "SCM": "Short course metres"
        case "LCM": "Long course metres"
        case "SCY": "Short course yards"
        default: raw
        }
    }

    /// "50 Free SCM", or "50 Free" without the course.
    public static func event(distance: Double, stroke: String, course: String? = nil) -> String {
        let base = "\(Int(distance)) \(self.stroke(stroke))"
        return course.map { "\(base) \($0)" } ?? base
    }

    /// "Sat 2026-10-17 08:30".
    public static func session(date: String, time: String) -> String {
        guard let d = CalendarDates.date(date) else { return "\(date) \(time)" }
        let day = d.formatted(Date.FormatStyle(timeZone: TimeZone(identifier: "UTC")!).weekday(.abbreviated))
        return "\(day) \(date) \(time)"
    }

    /// Seconds, for charts.
    public static func seconds(_ ms: Double) -> Double { ms / 1000 }
}

extension SwimResult {
    public var label: String { SwimFormat.event(distance: distance, stroke: stroke.rawValue, course: course.rawValue) }
    /// "DQ" or the time.
    public var shownTime: String { dqReason != nil ? "DQ" : SwimFormat.time(timeMs) }

    /// What Commit Swimming says when it disagrees with his correction (SWM-7).
    public var siteSays: String? {
        guard let s = source else { return nil }
        return s.dqReason != nil ? "DQ" : SwimFormat.time(s.timeMs)
    }

    /// Running distance and time at the end of each leg.
    public var legs: [(metres: Int, total: Double, leg: Double)] {
        var out: [(Int, Double, Double)] = []
        for s in splits {
            let prev = out.last
            out.append(((prev?.0 ?? 0) + Int(s.distance), (prev?.1 ?? 0) + s.ms, s.ms))
        }
        return out
    }
}

extension MeetView {
    public var dates: String { startDate == endDate ? startDate : "\(startDate) – \(endDate)" }
    /// "SCM", or nil when the meet doesn't say.
    public var courseCode: String? { course.map(\.rawValue).flatMap { $0.isEmpty ? nil : $0 } }
    /// Not signed up yet on Commit Swimming (a meet added by hand never is).
    public var awaitingSignup: Bool { (signup == nil || signup?.rawValue == "") && !manual }
}

extension SwimEventDetail {
    public var label: String { SwimFormat.event(distance: event.distance, stroke: event.stroke.rawValue, course: event.course.rawValue) }
    /// The forecast when there is one (SWM-5).
    public var estimate: Components.Schemas.Forecast2.Value1Payload? { forecast.value1 }
    /// Why there's no forecast yet.
    public var noEstimateReason: String? { forecast.value1 == nil ? forecast.value2?.reason : nil }
}
