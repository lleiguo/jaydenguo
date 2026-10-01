import Foundation
import Testing
@testable import HubKit

/// Shortcuts and the share sheet (intent 0004, EXT-3, EXT-4).
@Suite struct ShortcutTests {
    let home = HomeTime(identifier: "America/Toronto")
    // 2026-10-03 10:00 in Toronto.
    var now: Date { home.date("2026-10-03", hhmm: "10:00")! }

    func item(_ title: String, _ day: String, _ from: String, _ to: String, place: String? = nil, clash: Bool = false) -> WidgetSnapshot.Item {
        .init(title: title, symbol: "circle", category: "other", start: home.date(day, hhmm: from)!,
              end: home.date(day, hhmm: to)!, allDay: false, clash: clash, place: place)
    }

    @Test func whatsNext() {
        var s = WidgetSnapshot(timeZone: home.timeZone.identifier, items: [
            item("Tennis lesson", "2026-10-03", "09:30", "10:30", place: "Maple Tennis Club"),
            item("Swim practice", "2026-10-03", "17:30", "18:30"),
        ])
        #expect(s.spokenNext(at: now).hasPrefix("Tennis lesson, now until"))
        #expect(s.spokenNext(at: now).hasSuffix("at Maple Tennis Club."))
        s.items.removeFirst()
        #expect(s.spokenNext(at: now).hasPrefix("Swim practice at "))
        s.items = [item("Game", "2026-10-04", "09:00", "10:00")]
        #expect(s.spokenNext(at: now).hasPrefix("Game tomorrow at "))
        s.items = []
        #expect(s.spokenNext(at: now) == "Nothing else is coming up in the next few days.")
    }

    @Test func todaysSchedule() {
        let s = WidgetSnapshot(timeZone: home.timeZone.identifier, items: [
            item("Swim practice", "2026-10-03", "17:30", "18:30", clash: true),
            item("Breakfast club", "2026-10-03", "07:00", "08:00"),
            item("Game", "2026-10-04", "09:00", "10:00"),
        ])
        let lines = s.spokenToday(at: now).split(separator: "\n")
        #expect(lines.count == 1, "what's over and tomorrow are left out")
        #expect(lines[0].hasSuffix("Swim practice (clash)"))
        #expect(WidgetSnapshot(timeZone: home.timeZone.identifier, items: []).spokenToday(at: now) == "Nothing else today.")
    }

    @Test func photosShareLinksAreHandedToTheApp() {
        #expect(VideoLink.isPhotosShare(URL(string: "https://photos.app.goo.gl/AbCdEf123")!))
        #expect(VideoLink.isPhotosShare(URL(string: "https://photos.google.com/share/xyz")!))
        #expect(!VideoLink.isPhotosShare(URL(string: "https://drive.google.com/file/d/1/view")!))
        #expect(!VideoLink.isPhotosShare(URL(string: "https://youtu.be/dQw4w9WgXcQ")!))
    }

    @Test func daysRoundTripInThePhonesCalendar() throws {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "America/Toronto")!
        let d = try #require(VideoLink.date("2026-09-27", calendar: cal))
        #expect(VideoLink.day(d, calendar: cal) == "2026-09-27")
    }

    @Test func aSharedPhotosReviewIsKeptUntilTheAppTakesIt() {
        let suite = "test.\(UUID().uuidString)"
        let shared = SharedSettings(appGroup: suite)
        #expect(shared.pendingPhotosReview == nil)
        shared.pendingPhotosReview = PendingReview(sport: "auto", note: "second serve", filmedOn: "2026-09-27")
        #expect(SharedSettings(appGroup: suite).pendingPhotosReview?.note == "second serve")
        shared.pendingPhotosReview = nil
        #expect(shared.pendingPhotosReview == nil)
        UserDefaults().removePersistentDomain(forName: suite)
    }
}
