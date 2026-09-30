import Foundation
import Testing
@testable import HubKit

/// Video reviews (intent 0004, IVID-1, IVID-2) against the seed's debate.
@Suite struct VideoTests {
    let client = testClient()

    var review: VideoDetail {
        get async throws { try await client.api.getVideoReview(path: .init(id: "x")).ok.body.json }
    }

    @Test func decodesTheCombinedAdvice() async throws {
        let advice = try #require(try await review.advice)
        #expect(!advice.summary.isEmpty)
        #expect(!advice.fix.isEmpty && !advice.drills.isEmpty)
        #expect(advice.fix.allSatisfy { $0.status == "agreed" || $0.status == "disputed" })
        #expect(advice.fix.contains { $0.disputed && $0.sides != nil }, "a disputed point carries both sides")
    }

    @Test func eachModelsReviewAndTheJudging() async throws {
        let r = try await review
        #expect(r.review(by: .gemini)?.summary.contains("[gemini-review]") == true)
        #expect(r.review(by: .claude)?.summary.contains("[claude-review]") == true)
        let first = r.scores(round: "critique")
        #expect(first.count == 4, "two judges, two reviews each")
        #expect(first.first { $0.judge == .gemini && $0.of == .claude }?.scores.sum == 15)
        #expect(r.critiques.count == 4)
        #expect(r.rebuttals.count == 2)
    }

    @Test func timelineAsOnTheWeb() async throws {
        let points = VideoTimeline.points(try #require(try await review.advice))
        #expect(points.map(\.seconds) == points.map(\.seconds).sorted())
        #expect(VideoTimeline.seconds("0:04-0:06") == 4)
        #expect(VideoTimeline.seconds("00:07.5") == 7.5)
        #expect(VideoTimeline.seconds("no time") == nil)
        let p = [VideoTimeline.Point(id: "fix-1", good: false, text: "Finish", seconds: 4, disputed: true)]
        #expect(VideoTimeline.active(p, at: 5.5)?.label == "Fix 2 (disputed)")
        #expect(VideoTimeline.active(p, at: 6.1) == nil)
        #expect(VideoTimeline.clock(65.4) == "1:05")
    }

    @Test func segmentTimesParse() {
        #expect(VideoTimeline.parse("") == .some(nil))
        #expect(VideoTimeline.parse("1:05") == .some(65))
        #expect(VideoTimeline.parse("12") == .some(12))
        #expect(VideoTimeline.parse("1:75") == nil)
        #expect(VideoTimeline.parse("abc") == nil)
    }

    @Test func statusesInWords() {
        #expect(VideoStatus.label("picking") == "Waiting for your pick")
        #expect(VideoStatus.running("analysing"))
        #expect(!VideoStatus.running("done"))
    }

    /// intent 0005, SPT-4: where the sport came from.
    @Test func sportInWords() async throws {
        let list = try await client.api.listVideoReviews().ok.body.json.reviews
        let older = try #require(list.first { $0.mode == .gemini })
        #expect(VideoSport.text(older.sport.rawValue, source: older.sportSource.rawValue) == "Tennis (detected)")
        #expect(VideoSport.text("other", source: "unsure") == "Sport not set")
        #expect(VideoSport.text("hockey", source: "chosen") == "Hockey")
        #expect(VideoSport.unset(source: "detecting", running: false))
        #expect(!VideoSport.unset(source: "detecting", running: true))
    }
}
