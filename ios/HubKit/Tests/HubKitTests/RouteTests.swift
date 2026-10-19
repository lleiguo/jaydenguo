import Foundation
import Testing
@testable import HubKit

@Suite struct RouteTests {
    @Test(arguments: [
        ("jaydenguohub://open/today", Route.today),
        ("jaydenguohub://open/events/abc", .event(id: "abc")),
        ("https://jaydenguo.com/tennis/tournaments/t1", .tournament(id: "t1")),
        ("https://jaydenguo.com/tennis/results", .tennisResults),
        ("jaydenguohub://open/tennis/accuracy", .tennisAccuracy),
        ("https://jaydenguo.com/settings/clashes", .clashes),
        ("https://jaydenguo.com/", .today),
        ("jaydenguohub://open/calendar?date=2026-10-01", .calendar(date: "2026-10-01")),
    ])
    func maps(_ link: String, _ route: Route) {
        #expect(Route(url: URL(string: link)!) == route)
    }

    @Test func refusesOtherHostsAndUnknownPages() {
        #expect(Route(url: URL(string: "https://evil.example/tennis")!) == nil)
        #expect(Route(url: URL(string: "jaydenguohub://auth?code=x")!) == nil)
        #expect(Route(url: URL(string: "https://jaydenguo.com/nope/nope/nope")!) == nil)
    }

    @Test func knowsItsTab() {
        #expect(Route.meet(id: "m").tab == .swimming)
        #expect(Route.video(id: "v").tab == .more)
        #expect(Route.clash(eventId: "e").tab == .more)
    }

    @Test func clashPushOpensTheClash() {
        #expect(Route(url: URL(string: "jaydenguohub://open/clashes/e1")!) == .clash(eventId: "e1"))
        #expect(Push.route(target: "events/e1", kind: "clash") == .clash(eventId: "e1"))
        #expect(Push.route(target: "events/e1", kind: "suggestion") == .event(id: "e1"))
        #expect(Push.route(target: "tennis/entries/n1", kind: "entry_change") == .tennisEntry(id: "n1"))
        #expect(Push.route(target: "swimming/meets/m1", kind: "swim") == .meet(id: "m1"))
    }
}

@Suite struct LockPolicyTests {
    let now = Date(timeIntervalSince1970: 1_000_000)

    @Test func locksOnLaunchAndAfterFiveMinutes() {
        #expect(LockPolicy.shouldLock(enabled: true, backgroundedAt: nil, now: now))
        #expect(!LockPolicy.shouldLock(enabled: true, backgroundedAt: now.addingTimeInterval(-299), now: now))
        #expect(LockPolicy.shouldLock(enabled: true, backgroundedAt: now.addingTimeInterval(-300), now: now))
    }

    @Test func neverLocksWhenTurnedOff() {
        #expect(!LockPolicy.shouldLock(enabled: false, backgroundedAt: nil, now: now))
    }
}
