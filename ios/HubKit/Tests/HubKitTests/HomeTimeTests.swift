import Foundation
import Testing
@testable import HubKit

@Suite struct HomeTimeTests {
    let toronto = HomeTime(identifier: "America/Toronto", locale: Locale(identifier: "en_CA"))

    @Test func parsesTheServersISOStrings() {
        #expect(HomeTime.parse("2026-09-29T21:30:00.000Z") != nil)
        #expect(HomeTime.parse("2026-09-29T21:30:00Z") != nil)
        #expect(HomeTime.parse("tomorrow") == nil)
    }

    @Test func usesTheHomeDateNotThePhones() {
        // 03:00 UTC is still the evening before in Toronto.
        #expect(toronto.localDate(HomeTime.parse("2026-09-30T03:00:00.000Z")!) == "2026-09-29")
    }

    @Test func handlesTheDaylightSavingChange() {
        // 1 November 2026: 1:30 happens twice in Toronto.
        let edt = toronto.time("2026-11-01T05:30:00.000Z")
        let est = toronto.time("2026-11-01T06:30:00.000Z")
        #expect(edt == est, "both are 1:30 local")
        #expect(toronto.localDate(HomeTime.parse("2026-11-01T06:30:00.000Z")!) == "2026-11-01")
        let midnight = toronto.startOfDay("2026-11-02")!
        #expect(midnight == HomeTime.parse("2026-11-02T05:00:00.000Z"))
    }

    @Test func titlesADay() {
        #expect(toronto.dayTitle("2026-09-29").contains("Tuesday"))
    }
}
