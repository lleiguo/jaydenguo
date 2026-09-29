import HubAPI
import HubKit
import SwiftUI

extension SwimResult: @retroactive Identifiable {}

/// One swim (SWM-3): time or DQ, the PB flag, the change from the best
/// before, the place, and the correction notes. Tapping opens the sheet.
struct SwimResultRow: View {
    enum Shows { case meet, event }

    let result: SwimResult
    let shows: Shows

    var body: some View {
        let r = result
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(heading).font(.subheadline.weight(.medium))
                if let dq = r.dqReason { Caption(dq) }
                CorrectionNotes(corrected: r.corrected, manual: r.origin == .manual, disagrees: r.sourceDisagrees,
                                siteSays: r.siteSays, site: "Commit Swimming")
                if !r.legs.isEmpty {
                    Caption("Splits: " + r.legs.map { "\($0.metres) m \(SwimFormat.time($0.total))" }.joined(separator: ", "))
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 3) {
                HStack(spacing: 6) {
                    if r.isPb {
                        Text("★ PB").font(.caption.bold())
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(Color.yellow.opacity(0.3), in: RoundedRectangle(cornerRadius: 4))
                    }
                    Text(r.shownTime).font(.body.weight(.semibold).monospacedDigit())
                }
                Text(change).font(.caption.monospacedDigit())
                    .foregroundStyle((r.changeMs ?? 0) < 0 ? .green : .secondary)
                if let place = r.place { Caption("Place \(Int(place))") }
            }
        }
        // The whole row takes the tap, not only its text.
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
    }

    private var heading: String {
        let r = result
        let base = shows == .meet
            ? SwimFormat.event(distance: r.distance, stroke: r.stroke.rawValue, course: r.course.rawValue)
            : [r.swimDate, r.meetName].compactMap { $0 }.joined(separator: " · ")
        guard let stage = r.stage, stage != "Final" else { return base }
        return "\(base) · \(stage)"
    }

    private var change: String {
        if let c = result.changeMs { return SwimFormat.change(c) }
        return result.timeMs != nil ? "first swim" : "—"
    }

    private var accessibilityText: String {
        let r = result
        var parts = [heading, r.dqReason != nil ? "disqualified" : SwimFormat.time(r.timeMs)]
        if r.isPb { parts.append("personal best") }
        if r.changeMs != nil { parts.append("\(change) against the best before") }
        if let place = r.place { parts.append("place \(Int(place))") }
        if r.corrected { parts.append("corrected by you") }
        if r.sourceDisagrees { parts.append("Commit Swimming disagrees") }
        return parts.joined(separator: ", ")
    }
}

/// A swim's details and the owner's corrections (SWM-7): time, DQ reason
/// and place; back to Commit Swimming's version; delete.
struct SwimResultSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let result: SwimResult
    let open: (Route) -> Void

    @State private var time: String
    @State private var dq: String
    @State private var place: String
    @State private var error: String?
    @State private var saving = false
    @State private var confirmDelete = false

    init(result: SwimResult, open: @escaping (Route) -> Void) {
        self.result = result
        self.open = open
        _time = State(initialValue: result.timeMs == nil ? "" : SwimFormat.time(result.timeMs))
        _dq = State(initialValue: result.dqReason ?? "")
        _place = State(initialValue: result.place.map { String(Int($0)) } ?? "")
    }

    var body: some View {
        let r = result
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Date", value: r.swimDate)
                    LabeledContent("Time", value: r.shownTime)
                    if r.isPb { Label("Personal best", systemImage: "star.fill") }
                    if let meet = r.meetName, let id = r.meetId {
                        Button { go(.meet(id: id)) } label: { LabeledContent("Meet", value: meet) }
                    }
                    Button { go(.swimEvent(key: r.key)) } label: {
                        Label("Progression in \(r.label)", systemImage: "chart.xyaxis.line")
                    }
                    CorrectionNotes(corrected: r.corrected, manual: r.origin == .manual, disagrees: r.sourceDisagrees,
                                    siteSays: r.siteSays, site: "Commit Swimming")
                    ForEach(r.legs, id: \.metres) { l in
                        LabeledContent("\(l.metres) m", value: "\(SwimFormat.time(l.total)) (\(SwimFormat.time(l.leg)))")
                    }
                }
                Section {
                    HStack {
                        Text("Time")
                        TextField("Time", text: $time, prompt: Text("1:02.35"))
                            .multilineTextAlignment(.trailing)
                            .keyboardType(.numbersAndPunctuation)
                            .accessibilityIdentifier("timeField")
                    }
                    HStack {
                        Text("DQ reason")
                        TextField("DQ reason", text: $dq, prompt: Text("None"))
                            .multilineTextAlignment(.trailing)
                    }
                    HStack {
                        Text("Place")
                        TextField("Place", text: $place, prompt: Text("—"))
                            .multilineTextAlignment(.trailing)
                            .keyboardType(.numberPad)
                    }
                    if let error { Text(error).foregroundStyle(.red).font(.callout) }
                    Button("Save correction") { Task { await save() } }.disabled(saving)
                } header: {
                    Text("Correct it")
                } footer: {
                    Text("Your correction stays through future syncs.")
                }
                Section {
                    if r.corrected, let site = r.siteSays {
                        Button("Use Commit's \(site)") { Task { await useSite() } }
                    }
                    Button("Delete swim", role: .destructive) { confirmDelete = true }
                }
            }
            .navigationTitle(r.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                // The keyboard covers the form's button while typing.
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Save correction") { Task { await save() } }.disabled(saving)
                }
            }
            .confirmationDialog("Delete this swim?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) { Task { await delete() } }
            }
        }
    }

    private func go(_ route: Route) {
        dismiss()
        open(route)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        error = nil
        let placeText = place.trimmingCharacters(in: .whitespaces)
        guard placeText.isEmpty || Int(placeText) != nil else {
            error = "Write the place as a number."
            return
        }
        do {
            try await model.client.patch("/api/v1/swim/results/\(result.id)", [
                "time": .string(time.trimmingCharacters(in: .whitespaces)),
                "dqReason": .text(dq),
                "place": Int(placeText).map(JSONField.int) ?? .null,
            ])
            model.show("Saved. Your correction stays through future syncs.")
            await model.dataChanged()
            dismiss()
        } catch {
            self.error = HubError.from(error)?.message ?? "Couldn't save. Check your connection and try again."
        }
    }

    private func useSite() async {
        do {
            _ = try await model.client.api.useSourceSwimResult(path: .init(id: result.id)).noContent
            model.show("Now showing Commit Swimming's version.")
            await model.dataChanged()
            dismiss()
        } catch {
            self.error = HubError.from(error)?.message ?? "Couldn't change that."
        }
    }

    private func delete() async {
        do {
            let undo = try await model.client.api.deleteSwimResult(path: .init(id: result.id)).ok.body.json.undo
            model.show("Swim deleted.", undo: undo)
            await model.dataChanged()
            dismiss()
        } catch {
            self.error = HubError.from(error)?.message ?? "Couldn't delete it."
        }
    }
}
