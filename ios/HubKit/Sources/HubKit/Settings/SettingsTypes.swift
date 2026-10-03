import Foundation
import HubAPI
import OpenAPIRuntime

public typealias SourceView = Components.Schemas.SourcesResponse.SourcesPayloadPayload
public typealias RunView = Components.Schemas.RunView
public typealias CredentialView = Components.Schemas.CredentialView
public typealias Suggestion = Components.Schemas.SuggestionView
public typealias ClashWithEvents = Components.Schemas.ClashWithEvents
public typealias CostsView = Components.Schemas.CostsView
public typealias SchoolDay = Components.Schemas.SchoolDay

extension OpenAPIValueContainer {
    /// A field of a JSON object, if this is one.
    public subscript(key: String) -> (any Sendable)? {
        (value as? [String: (any Sendable)?])?[key] ?? nil
    }

    public func string(_ key: String) -> String? { self[key] as? String }
}

extension SourceView {
    /// What kind of source it is, in words (SRC-1..8).
    public var kindLabel: String { SourceKinds.label(kind) }
    public var failing: Bool { consecutiveFailures >= 3 }
}

public enum SourceKinds {
    public static func label(_ kind: String) -> String {
        switch kind {
        case "google_calendar": "Google Calendar"
        case "ical": "Calendar link"
        case "commit_swim": "Commit Swimming"
        case "tennis_tc": "Tennis Canada"
        case "school_dates": "School dates page"
        case "veracross": "Veracross"
        case "gmail": "Coach emails"
        default: kind
        }
    }
}

/// The accounts the hub signs in with (CRED-1, CRED-4). Secrets are
/// write-only: the API never returns them.
public enum Providers {
    public struct Provider: Sendable, Identifiable, Hashable {
        public let id: String
        public let name: String
        /// "password" (a login) and/or "secret_url" (a private calendar link).
        public let kinds: [String]
    }

    public static let all: [Provider] = [
        Provider(id: "teamsnap", name: "TeamSnap", kinds: ["secret_url", "password"]),
        Provider(id: "spordle", name: "Spordle", kinds: ["secret_url", "password"]),
        Provider(id: "veracross", name: "Veracross", kinds: ["secret_url", "password"]),
        Provider(id: "tennis_tc", name: "Tennis Canada tournaments", kinds: ["password"]),
        Provider(id: "commit_swim", name: "Commit Swimming", kinds: ["password"]),
        Provider(id: "ical", name: "Other calendar link", kinds: ["secret_url"]),
    ]

    public static func kindLabel(_ kind: String) -> String {
        switch kind {
        case "password": "Login"
        case "secret_url": "Private calendar link"
        case "oauth": "Google access"
        default: kind
        }
    }

    /// The Google features connected through the website's Google flow.
    public static let googleFeatures: [(feature: String, label: String)] = [
        ("calendar", "Google Calendar"),
        // Cookie adds events she's asked for to the household calendar (intent 0008, GCW-3).
        ("calendar_write", "Let Cookie add events"),
        ("classroom", "School account (Classroom)"),
        ("gmail", "Gmail (coach emails)"),
        ("videos", "Drive and Photos (videos)"),
    ]
}

extension CredentialView {
    /// A sign-in is waiting for the code the site emailed (Veracross).
    public var waitingForCode: Bool { meta.string("codeRequestedAt") != nil }
    public var needsAttention: Bool { lastTestOk == false || status != "active" }
}

extension Suggestion {
    /// Fields the model was unsure about, to mark in the list (EML-3).
    public var unsure: [String] {
        var out: [String] = []
        if confidence.title == .low { out.append("title") }
        if confidence.date == .low { out.append("date") }
        if confidence.time == .low { out.append("time") }
        if confidence.location == .low { out.append("place") }
        return out
    }

    public var kindLabel: String {
        switch kind {
        case .new: "New event"
        case .change: "Change"
        case .cancel: "Cancellation"
        }
    }
}
