import HubAPI
import HubKit
import SwiftUI

/// Day and week views (ICAL-1): a time grid in the home time zone. Long-press
/// an event and drag it to move it, with a tick every 15 minutes (ICAL-4);
/// in the week view it can go to another day too.
struct TimeGridView: View {
    @Bindable var store: CalendarStore
    let days: [String]
    @Binding var selected: EventRef?

    private let hourHeight: CGFloat = 56
    private let gutter: CGFloat = 44
    @State private var drag: DragState?

    struct DragState: Equatable {
        let eventId: String
        var minuteDelta: Double
        var dayDelta: Int
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            allDayRow
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    GeometryReader { geo in
                        let columnWidth = (geo.size.width - gutter) / CGFloat(days.count)
                        ZStack(alignment: .topLeading) {
                            // One anchor per hour, so the grid can open at 7:00.
                            VStack(spacing: 0) {
                                ForEach(0..<24) { h in Color.clear.frame(height: hourHeight).id(h) }
                            }
                            hourLines(width: geo.size.width)
                            ForEach(Array(days.enumerated()), id: \.element) { i, date in
                                dayColumn(date: date, index: i, width: columnWidth)
                                    .offset(x: gutter + CGFloat(i) * columnWidth)
                            }
                            nowLine(columnWidth: columnWidth)
                        }
                    }
                    .frame(height: hourHeight * 24)
                }
                .onAppear { proxy.scrollTo(7, anchor: .top) }
            }
        }
        .sensoryFeedback(.selection, trigger: drag.map { Int($0.minuteDelta) * 10 + $0.dayDelta })
    }

    // MARK: Header and all-day row

    private var header: some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: gutter, height: 1)
            ForEach(days, id: \.self) { date in
                Button {
                    store.anchor = date
                    store.mode = .day
                } label: {
                    VStack(spacing: 2) {
                        Text(weekdayLetter(date)).font(.caption2).foregroundStyle(.secondary)
                        Text(String(Int(date.suffix(2)) ?? 0))
                            .font(.subheadline.weight(date == store.today ? .bold : .regular))
                            .foregroundStyle(date == store.today ? Color.accentColor : .primary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 4)
                    .background(store.closures.contains(date) ? Color.secondary.opacity(0.12) : .clear)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(store.homeTime.dayTitle(date))
            }
        }
    }

    @ViewBuilder private var allDayRow: some View {
        let lists = days.map { store.items(on: $0).allDay }
        if lists.contains(where: { !$0.isEmpty }) || days.contains(where: store.closures.contains) {
            HStack(alignment: .top, spacing: 0) {
                Text("all day").font(.caption2).foregroundStyle(.secondary).frame(width: gutter)
                ForEach(Array(days.enumerated()), id: \.element) { i, date in
                    VStack(spacing: 2) {
                        if store.closures.contains(date) && days.count == 1 {
                            Label("School closed", systemImage: "xmark.octagon.fill").font(.caption).foregroundStyle(.secondary)
                        }
                        ForEach(lists[i], id: \.id) { e in
                            Button { selected = EventRef(id: e.id) } label: {
                                chip(e, compact: days.count > 1)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .padding(.vertical, 4)
        }
    }

    // MARK: Grid

    private func hourLines(width: CGFloat) -> some View {
        ForEach(0..<24) { h in
            HStack(alignment: .top, spacing: 4) {
                Text(hourLabel(h))
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .frame(width: gutter - 4, alignment: .trailing)
                    .offset(y: -6)
                Rectangle().fill(Color.secondary.opacity(0.2)).frame(height: 0.5)
            }
            .frame(width: width, alignment: .leading)
            .offset(y: CGFloat(h) * hourHeight)
        }
    }

    @ViewBuilder
    private func nowLine(columnWidth: CGFloat) -> some View {
        if let i = days.firstIndex(of: store.today), let midnight = store.homeTime.startOfDay(store.today) {
            let minutes = Date.now.timeIntervalSince(midnight) / 60
            Rectangle()
                .fill(.red)
                .frame(width: columnWidth, height: 1.5)
                .offset(x: gutter + CGFloat(i) * columnWidth, y: CGFloat(minutes / 60) * hourHeight)
                .accessibilityHidden(true)
        }
    }

    private func dayColumn(date: String, index: Int, width: CGFloat) -> some View {
        let items = store.items(on: date)
        let placed = DayLayout.place(items.timed, on: date, homeTime: store.homeTime, start: \.startDate, end: \.endDate)
        return ZStack(alignment: .topLeading) {
            if store.closures.contains(date) {
                Rectangle().fill(Color.secondary.opacity(0.06)).frame(width: width, height: hourHeight * 24)
            }
            if let school = items.school,
               let p = DayLayout.place([school], on: date, homeTime: store.homeTime, start: { HomeTime.parse($0.start) }, end: { HomeTime.parse($0.end) }).first {
                Button { store.expandedSchoolDays.insert(date) } label: {
                    block(tint: EventCategory.schoolClass.color, title: "School", subtitle: "\(school.classes.count) classes", mark: store.mark(school), compact: days.count > 1)
                }
                .buttonStyle(.plain)
                .frame(width: width - 2, height: height(p))
                .offset(y: y(p.startMinute))
                .accessibilityHint("Shows each class")
            }
            ForEach(placed, id: \.item.id) { p in
                eventBlock(p, date: date, dayIndex: index, columnWidth: width)
            }
        }
        .frame(width: width, height: hourHeight * 24, alignment: .topLeading)
    }

    private func eventBlock(_ p: DayLayout.Placed<CalendarEvent>, date: String, dayIndex: Int, columnWidth: CGFloat) -> some View {
        let e = p.item
        let slotWidth = columnWidth / CGFloat(p.columns)
        let dragging = drag?.eventId == e.id
        let dx = dragging ? CGFloat(drag!.dayDelta) * columnWidth : 0
        let dy = dragging ? CGFloat(drag!.minuteDelta / 60) * hourHeight : 0
        return block(
            tint: e.category.color,
            title: e.title,
            subtitle: days.count == 1 ? store.homeTime.range(e.start, e.end) : nil,
            mark: store.mark(e),
            compact: days.count > 1,
            faded: e.isSkipped || e.isCancelled,
            // Too narrow for words: just the category's symbol.
            symbol: slotWidth < 40 ? e.category.symbol : nil
        )
        .frame(width: slotWidth - 2, height: height(p))
        .scaleEffect(dragging ? 1.04 : 1)
        .shadow(radius: dragging ? 6 : 0)
        .zIndex(dragging ? 1 : 0)
        .offset(x: CGFloat(p.column) * slotWidth + dx, y: y(p.startMinute) + dy)
        .onTapGesture { selected = EventRef(id: e.id) }
        .gesture(moveGesture(for: e, date: date, dayIndex: dayIndex, columnWidth: columnWidth), including: e.status == .active ? .all : .subviews)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(e.title), \(store.homeTime.range(e.start, e.end))")
        .accessibilityHint("Double-tap for details and Move to…")
        .accessibilityAddTraits(.isButton)
    }

    private func moveGesture(for e: CalendarEvent, date: String, dayIndex: Int, columnWidth: CGFloat) -> some Gesture {
        LongPressGesture(minimumDuration: 0.35)
            .sequenced(before: DragGesture(minimumDistance: 0))
            .onChanged { value in
                guard case .second(true, let dragValue) = value else { return }
                let minutes = EventMove.snap(Double((dragValue?.translation.height ?? 0) / hourHeight * 60))
                let maxDay = days.count - 1 - dayIndex
                let dayDelta = days.count > 1
                    ? min(max(Int(((dragValue?.translation.width ?? 0) / columnWidth).rounded()), -dayIndex), maxDay)
                    : 0
                drag = DragState(eventId: e.id, minuteDelta: minutes, dayDelta: dayDelta)
            }
            .onEnded { _ in
                guard let d = drag, d.eventId == e.id else { return }
                drag = nil
                guard d.minuteDelta != 0 || d.dayDelta != 0,
                      let start = e.startDate, let midnight = store.homeTime.startOfDay(date)
                else { return }
                let startMinute = start.timeIntervalSince(midnight) / 60
                let target = days[dayIndex + d.dayDelta]
                if let span = EventMove.timed(e, to: target, minute: startMinute + d.minuteDelta, homeTime: store.homeTime) {
                    Task { await store.move(e, to: span) }
                }
            }
    }

    // MARK: Pieces

    private func block(tint: Color, title: String, subtitle: String?, mark: ClashMark, compact: Bool, faded: Bool = false, symbol: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            if let symbol {
                Image(systemName: symbol).font(.caption2).foregroundStyle(tint)
                if mark != .none { ClashSymbol(mark: mark).font(.caption2) }
            } else {
                HStack(spacing: 2) {
                    Text(title).font(compact ? .caption2.weight(.semibold) : .caption.weight(.semibold)).lineLimit(compact ? 3 : 2)
                    if mark != .none { ClashSymbol(mark: mark).font(.caption2) }
                }
                if let subtitle, !compact { Text(subtitle).font(.caption2).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 0)
        }
        .padding(compact ? 2 : 4)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(tint.opacity(faded ? 0.08 : 0.2), in: RoundedRectangle(cornerRadius: 5))
        .overlay(
            RoundedRectangle(cornerRadius: 5)
                .strokeBorder(mark == .clash ? Color.red : tint.opacity(0.6), lineWidth: mark == .clash ? 2 : 1)
        )
        .opacity(faded ? 0.6 : 1)
    }

    private func chip(_ e: CalendarEvent, compact: Bool) -> some View {
        HStack(spacing: 3) {
            Image(systemName: e.category.symbol).font(.caption2)
            if !compact { Text(e.title).font(.caption).lineLimit(1) }
            ClashSymbol(mark: store.mark(e)).font(.caption2)
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 2)
        .frame(maxWidth: .infinity)
        .background(e.category.color.opacity(0.2), in: RoundedRectangle(cornerRadius: 4))
        .accessibilityLabel(e.title)
    }

    private func y(_ minute: Double) -> CGFloat { CGFloat(minute / 60) * hourHeight }
    private func height<T>(_ p: DayLayout.Placed<T>) -> CGFloat { max(22, CGFloat((p.endMinute - p.startMinute) / 60) * hourHeight - 2) }

    private func hourLabel(_ h: Int) -> String {
        var c = DateComponents()
        c.hour = h
        let d = Calendar.current.date(from: c) ?? .now
        return d.formatted(.dateTime.hour())
    }

    private func weekdayLetter(_ date: String) -> String {
        guard let d = store.homeTime.startOfDay(date) else { return "" }
        return d.formatted(Date.FormatStyle(timeZone: store.homeTime.timeZone).weekday(.abbreviated))
    }
}
