import SwiftUI

/// Layouts that hold up at every text size (intent 0004, APP-6).

/// A list row with a time column: side by side, the column growing with
/// the text size; at the accessibility sizes the time goes above the rest,
/// so neither has to break words to fit.
/// The category's colour bar sits between the two, or beside both.
struct TimeRow<Time: View, Content: View>: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .subheadline) private var column: CGFloat = 70
    var bar: Color?
    @ViewBuilder let time: Time
    @ViewBuilder let content: Content

    var body: some View {
        if typeSize.isAccessibilitySize {
            HStack(alignment: .top, spacing: 12) {
                barView
                VStack(alignment: .leading, spacing: 4) {
                    time.font(.subheadline.monospacedDigit())
                    content
                }
                Spacer(minLength: 0)
            }
        } else {
            HStack(alignment: .top, spacing: 12) {
                time
                    .font(.subheadline.monospacedDigit())
                    .frame(width: column, alignment: .leading)
                barView
                content
                Spacer(minLength: 0)
            }
        }
    }

    @ViewBuilder private var barView: some View {
        if let bar { RoundedRectangle(cornerRadius: 2).fill(bar).frame(width: 4) }
    }
}

/// A full-screen layout that scrolls when large text makes it taller than
/// the screen, instead of cutting its text short.
struct FullHeightScroll<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                content.frame(minHeight: geo.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
    }
}

/// Text colours that keep 4.5:1 contrast on white (APP-6): the system's
/// orange and green are too light for text in light mode, so these are
/// darker there and the system colours in dark mode.
extension ShapeStyle where Self == Color {
    static var warning: Color { Color(UIColor { $0.userInterfaceStyle == .dark ? .systemOrange : UIColor(red: 0.66, green: 0.31, blue: 0, alpha: 1) }) }
    static var good: Color { Color(UIColor { $0.userInterfaceStyle == .dark ? .systemGreen : UIColor(red: 0.11, green: 0.47, blue: 0.2, alpha: 1) }) }
}
