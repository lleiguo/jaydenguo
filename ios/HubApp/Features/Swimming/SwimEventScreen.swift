import Charts
import HubAPI
import HubKit
import SwiftUI

/// One event and course (SWM-4, SWM-5): the progression chart with the
/// estimate, the same values as a table (NFR-9), and every swim.
struct SwimEventScreen: View {
    @Environment(AppModel.self) private var model
    let key: String
    @State private var selected: SwimResult?

    var body: some View {
        RemoteContent(fetch: { try await model.client.api.getSwimEvent(path: .init(key: key)).ok.body.json }) { data in
            List {
                Section {
                    Text("\(SwimFormat.course(data.event.course.rawValue)) only; other courses are never mixed in."
                        + (data.pbSteps.last.map { " Best: \(SwimFormat.time($0.timeMs)) on \($0.swimDate)." } ?? ""))
                        .font(.subheadline)
                    if data.points.isEmpty {
                        Caption("No timed swims yet.")
                    } else {
                        ProgressionChart(data: data)
                            .frame(height: 260)
                            .listRowInsets(EdgeInsets(top: 12, leading: 8, bottom: 12, trailing: 12))
                    }
                }
                estimateSection(data)
                if !data.points.isEmpty { valuesSection(data) }
                Section("Every swim") {
                    if data.swims.isEmpty { Caption("No swims yet.") }
                    ForEach(data.swims, id: \.id) { r in
                        Button { selected = r } label: { SwimResultRow(result: r, shows: .event) }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("swimResult")
                    }
                }
            }
            .navigationTitle(data.label)
        }
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $selected) { r in
            SwimResultSheet(result: r) { model.swimmingPath.append($0) }
        }
    }

    // SWM-5: the forecast in words, labelled "Estimate".
    @ViewBuilder
    private func estimateSection(_ data: SwimEventDetail) -> some View {
        Section {
            if let e = data.estimate {
                ForEach(e.points, id: \.months) { p in
                    Text("In \(Int(p.months)) months (\(p.date)): about **\(SwimFormat.time(p.timeMs))**, likely between \(SwimFormat.time(p.lowMs)) and \(SwimFormat.time(p.highMs)).")
                        .font(.subheadline)
                }
                Caption("Fitted to his \(Int(e.swims)) swims in this event, with improvement slowing over time. Children this age can improve in jumps (growth spurts, new technique), so treat this as a rough guide.")
            } else {
                Text("No estimate yet: \(data.noEstimateReason ?? "not enough swims")").font(.subheadline)
            }
        } header: {
            Text("Estimate")
        }
        .accessibilityIdentifier("estimate")
    }

    // NFR-9, APP-6: every value in the chart, as rows VoiceOver reads.
    private func valuesSection(_ data: SwimEventDetail) -> some View {
        Section("Chart values") {
            ForEach(data.points, id: \.id) { p in
                LabeledContent(p.swimDate) {
                    Text(SwimFormat.time(p.timeMs) + (p.isPb ? " ★ PB" : "")).monospacedDigit()
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(p.swimDate): \(SwimFormat.time(p.timeMs))\(p.isPb ? ", personal best" : "")")
                .accessibilityIdentifier("chartValue")
            }
            ForEach(data.estimate?.points ?? [], id: \.months) { p in
                LabeledContent("Estimate, \(p.date)") {
                    Text("≈ \(SwimFormat.time(p.timeMs)) (\(SwimFormat.time(p.lowMs))–\(SwimFormat.time(p.highMs)))").monospacedDigit()
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Estimate for \(p.date): about \(SwimFormat.time(p.timeMs)), likely between \(SwimFormat.time(p.lowMs)) and \(SwimFormat.time(p.highMs))")
                .accessibilityIdentifier("chartValue")
            }
        }
    }
}

/// Swims, the PB line, and the estimate with its likely range. Faster is
/// higher. One event and course only, so SCM and LCM never share a line.
struct ProgressionChart: View {
    let data: SwimEventDetail

    private func day(_ s: String) -> Date { CalendarDates.date(s) ?? .now }
    private func sec(_ ms: Double) -> Double { ms / 1000 }

    var body: some View {
        let estimate = data.estimate
        let lastSwim = data.points.last.map { day($0.swimDate) }
        Chart {
            if let estimate {
                ForEach(estimate.points, id: \.months) { p in
                    AreaMark(
                        x: .value("Date", day(p.date)),
                        yStart: .value("Likely fastest", sec(p.lowMs)),
                        yEnd: .value("Likely slowest", sec(p.highMs))
                    )
                    .foregroundStyle(by: .value("Series", "Estimate"))
                    .opacity(0.2)
                }
                ForEach(estimate.curve, id: \.date) { c in
                    LineMark(x: .value("Date", day(c.date)), y: .value("Time", sec(c.timeMs)), series: .value("Line", "Estimate"))
                        .foregroundStyle(by: .value("Series", "Estimate"))
                        .lineStyle(StrokeStyle(lineWidth: 2, dash: [5, 4]))
                }
            }
            ForEach(Array(data.pbSteps.enumerated()), id: \.offset) { i, s in
                LineMark(x: .value("Date", day(s.swimDate)), y: .value("Time", sec(s.timeMs)), series: .value("Line", "PB"))
                    .interpolationMethod(.stepEnd)
                    .foregroundStyle(by: .value("Series", "Personal best"))
                if i == data.pbSteps.count - 1, let lastSwim, lastSwim > day(s.swimDate) {
                    LineMark(x: .value("Date", lastSwim), y: .value("Time", sec(s.timeMs)), series: .value("Line", "PB"))
                        .foregroundStyle(by: .value("Series", "Personal best"))
                }
            }
            ForEach(data.points, id: \.id) { p in
                PointMark(x: .value("Date", day(p.swimDate)), y: .value("Time", sec(p.timeMs)))
                    .foregroundStyle(by: .value("Series", "Swims"))
                    .symbol(p.isPb ? .diamond : .circle)
                    .symbolSize(p.isPb ? 70 : 40)
            }
            RuleMark(x: .value("Today", day(data.today)))
                .foregroundStyle(.secondary)
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 3]))
                .annotation(position: .top, alignment: .leading, spacing: 2,
                            overflowResolution: .init(x: .fit(to: .chart), y: .fit(to: .chart))) {
                    Text("Today").font(.caption2).foregroundStyle(.secondary)
                }
        }
        .chartForegroundStyleScale([
            "Swims": Color.blue,
            "Personal best": Color.orange,
            "Estimate": Color.purple,
        ])
        .chartYScale(domain: .automatic(includesZero: false, reversed: true))
        .chartYAxis {
            AxisMarks { value in
                AxisGridLine()
                AxisValueLabel { if let s = value.as(Double.self) { Text(SwimFormat.time(s * 1000)) } }
            }
        }
        .chartLegend(position: .bottom, alignment: .leading)
        .accessibilityLabel("\(data.label): \(data.points.count) swims\(estimate != nil ? ", with an estimate" : ""). Faster is higher. The values are in the table below.")
    }
}
