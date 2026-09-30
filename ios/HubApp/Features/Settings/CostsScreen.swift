import Charts
import HubAPI
import HubKit
import SwiftUI

/// Settings → Costs (APP-3; COST-1..4): this month so far, the forecast and
/// budgets, daily spend (Swift Charts, with the same numbers as rows for
/// VoiceOver), by service, and what the AI features cost.
struct CostsScreen: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        RemoteContent(fetch: { try await model.client.api.getCosts().ok.body.json }) { c in
            let money = FloatingPointFormatStyle<Double>.Currency(code: c.currency)
            List {
                if !c.configured {
                    Section { Caption("Billing export isn't set up yet, so infrastructure costs are missing. AI costs are counted as they happen.") }
                }
                Section("This month") {
                    LabeledContent("So far", value: c.summary.monthToDate.total.formatted(money))
                    LabeledContent("Infrastructure", value: c.summary.monthToDate.infra.formatted(money))
                    LabeledContent("AI", value: c.summary.monthToDate.ai.formatted(money))
                    if let f = c.summary.forecast {
                        LabeledContent("Forecast", value: "\(f.total.total.formatted(money)) (\(f.total.low.formatted(money))–\(f.total.high.formatted(money)))")
                    }
                    if let last = c.summary.lastMonth {
                        LabeledContent("Last month", value: "\(last.total.formatted(money)); \(last.toSameDay.formatted(money)) by this day")
                    }
                    if let b = c.summary.budgets.project { budget("Budget", b, money) }
                    if let b = c.summary.budgets.ai { budget("AI budget", b, money) }
                }
                Section("Last 30 days") {
                    let days = Array(c.summary.days.suffix(30))
                    Chart(days, id: \.day) { d in
                        BarMark(x: .value("Day", CalendarDates.date(d.day) ?? .now, unit: .day), y: .value("Infrastructure", d.infra))
                            .foregroundStyle(by: .value("Kind", "Infrastructure"))
                        BarMark(x: .value("Day", CalendarDates.date(d.day) ?? .now, unit: .day), y: .value("AI", d.ai))
                            .foregroundStyle(by: .value("Kind", "AI"))
                    }
                    .chartForegroundStyleScale(["Infrastructure": Color.blue, "AI": Color.purple])
                    .frame(height: 180)
                    .accessibilityLabel("Daily costs for the last 30 days. The values are in the rows below.")
                    DisclosureGroup("Each day") {
                        ForEach(days.reversed(), id: \.day) { d in
                            LabeledContent(d.day, value: "\(d.total.formatted(money)) (AI \(d.ai.formatted(money)))")
                                .accessibilityIdentifier("costDay")
                        }
                    }
                }
                if !c.summary.services.isEmpty {
                    Section("By service this month") {
                        ForEach(c.summary.services, id: \.service) { s in
                            LabeledContent(s.service + (s.ai ? " (AI)" : ""), value: s.cost.formatted(money))
                        }
                    }
                }
                Section("AI features this month") {
                    LabeledContent("Video reviews", value: c.features.month.video.formatted(money))
                    LabeledContent("Email suggestions", value: c.features.month.email.formatted(money))
                    LabeledContent("Match explanations", value: c.features.month.explanation.formatted(money))
                }
                Section {
                    Button("Refresh costs") { Task { await refresh() } }
                    if let last = c.sync.lastRunAt.flatMap(HomeTime.parse) {
                        Caption("Updated \(last.formatted(.relative(presentation: .named)))")
                    }
                    if let error = c.sync.lastError { Text(error).font(.caption).foregroundStyle(.red) }
                }
            }
            .accessibilityIdentifier("costsList")
        }
        .navigationTitle("Costs")
    }

    private func budget(_ name: String, _ b: Components.Schemas.Budget, _ money: FloatingPointFormatStyle<Double>.Currency) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            LabeledContent(name, value: "\(b.spent.formatted(money)) of \(b.amount.formatted(money))")
            ProgressView(value: min(b.percent / 100, 1))
                .tint(b.percent >= 100 ? .red : b.percent >= 80 ? .orange : .accentColor)
                .accessibilityLabel("\(Int(b.percent)) percent used")
        }
    }

    private func refresh() async {
        do {
            _ = try await model.client.api.refreshCosts().accepted
            model.show("Refreshing costs. This takes a minute.")
        } catch {
            model.show(HubError.from(error)?.message ?? "Couldn't refresh the costs.")
        }
    }
}
