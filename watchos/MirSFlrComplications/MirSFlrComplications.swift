import WidgetKit
import SwiftUI

struct MirSFlrEntry: TimelineEntry {
    let date: Date
    let status: WatchStatus
    /// Gallery previews render the bundled sample, whose timestamp is ancient.
    /// Flag those so the picker does not show every complication as stale.
    var isPlaceholder: Bool = false
}

/// How old the reading on screen is, measured against the timeline entry's own
/// timestamp rather than the current clock.
///
/// That distinction is the whole point. Entries are pre-rendered for the hours
/// ahead, so when watchOS stops granting reloads the face keeps advancing
/// through them and the age keeps climbing. A complication frozen on old data
/// therefore says so by itself, instead of showing a confident number that
/// happens to be hours out of date.
struct MirFreshness {
    var generatedAt: String?
    var asOf: Date
    var isPlaceholder: Bool = false

    init(entry: MirSFlrEntry) {
        self.generatedAt = entry.status.generatedAt
        self.asOf = entry.date
        self.isPlaceholder = entry.isPlaceholder
    }

    init(generatedAt: String?, asOf: Date, isPlaceholder: Bool = false) {
        self.generatedAt = generatedAt
        self.asOf = asOf
        self.isPlaceholder = isPlaceholder
    }

    private var ageSeconds: Int? {
        guard let generatedAt else { return nil }
        let seconds = StatusFormat.ageSeconds(from: generatedAt, now: asOf)
        return seconds >= 0 ? seconds : nil
    }

    /// The feed republishes every five minutes and watchOS grants a complication
    /// reload roughly every fifteen, so up to twenty minutes is simply the gap
    /// between updates. Past that, something in the chain has stopped.
    var isBehind: Bool {
        if isPlaceholder { return false }
        guard let ageSeconds else { return true }
        return ageSeconds > 20 * 60
    }

    var isStale: Bool {
        if isPlaceholder { return false }
        guard let ageSeconds else { return true }
        return ageSeconds > 45 * 60
    }

    /// Always shown, so the face answers "are these numbers current?" outright
    /// instead of only warning once they are not. Absence of a warning is not
    /// the same as confirmation: it looks identical to a complication that has
    /// quietly stopped, which is the thing this is here to rule out.
    ///
    /// Nil only for gallery placeholders, whose bundled sample has no
    /// meaningful timestamp.
    var badge: String? {
        if isPlaceholder { return nil }
        // A missing or unparseable timestamp has to read as a warning, not as a
        // dash: "-" looks like an empty metric, which is the one impression this
        // badge must never give.
        guard ageSeconds != nil, let generatedAt else { return "?" }
        return StatusFormat.compactAge(from: generatedAt, now: asOf)
    }

    var tint: Color {
        isStale ? .red : .orange
    }

    /// Grey while current so it reads as a quiet footnote, and only takes on
    /// colour once the age actually means something.
    var labelColor: Color {
        isBehind ? tint : Color.secondary
    }

    func label(_ base: String) -> String {
        guard let badge else { return base }
        return "\(base) \(badge)"
    }

    func detail(_ base: String) -> String {
        guard let badge else { return base }
        return base.isEmpty ? badge : "\(base) - \(badge)"
    }

    /// The inline family is a single system-styled line with no separate label
    /// slot, so the age has to ride along in the text itself.
    var inlineSuffix: String {
        guard let badge else { return "" }
        return " - \(badge)"
    }
}

private struct MirFreshnessKey: EnvironmentKey {
    // Unknown freshness must never read as current, so the default carries no
    // timestamp and resolves to a warning badge.
    static let defaultValue = MirFreshness(generatedAt: nil, asOf: Date())
}

extension EnvironmentValues {
    var mirFreshness: MirFreshness {
        get { self[MirFreshnessKey.self] }
        set { self[MirFreshnessKey.self] = newValue }
    }
}

struct MirSFlrProvider: TimelineProvider {
    func placeholder(in context: Context) -> MirSFlrEntry {
        MirSFlrEntry(date: Date(), status: .sample, isPlaceholder: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (MirSFlrEntry) -> Void) {
        completion(MirSFlrEntry(date: Date(), status: .sample, isPlaceholder: true))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<MirSFlrEntry>) -> Void) {
        Task {
            let status = (try? await StatusService.shared.fetch()) ?? .sample
            let now = Date()

            // Asking for a reload every two minutes is 720 requests a day, far
            // past what watchOS grants a complication. The system honours a few,
            // throttles, then stops refreshing altogether — which is how the face
            // ended up frozen on hours-old data while every feed was current.
            //
            // Ask for a realistic cadence instead, and hand back a series of
            // entries carrying the same reading at later timestamps. The age
            // label then keeps counting up on its own between network reloads
            // rather than freezing at whatever it last saw.
            // Carry on well past the next reload. If watchOS stops granting
            // them, these later entries are what keep the age badge climbing
            // instead of the face settling on a stale number that looks fine.
            var entries: [MirSFlrEntry] = []
            var steps = Array(stride(from: 0, through: 60, by: 5))
            steps += [75, 90, 105, 120, 150, 180, 240, 300, 360]
            for step in steps {
                let date = now.addingTimeInterval(TimeInterval(step * 60))
                entries.append(MirSFlrEntry(date: date, status: status))
            }
            let refreshDate = now.addingTimeInterval(15 * 60)
            completion(Timeline(entries: entries, policy: .after(refreshDate)))
        }
    }
}

private enum WatchTone {
    static func availability(_ value: Double?) -> Color {
        guard let value else { return .secondary }
        let pct = value <= 1 ? value * 100 : value
        if pct >= 98 { return .green }
        if pct >= 95 { return .yellow }
        return .pink
    }

    static func capacityFree(_ value: Double?) -> Color {
        guard let value else { return .secondary }
        if value >= 1_000_000 { return .green }
        if value >= 250_000 { return .yellow }
        return .pink
    }

    static func performance(_ value: Double?) -> Color {
        guard let value else { return .secondary }
        let pct = value <= 1 ? value * 100 : value
        if pct >= 90 { return .green }
        if pct >= 75 { return .yellow }
        return .pink
    }

    static func rewardRate(_ value: Double?) -> Color {
        guard let value else { return .secondary }
        if value >= 3 { return .green }
        if value >= 2 { return .yellow }
        return .pink
    }
}

private func clampedRatio(_ value: Double?) -> Double {
    guard let value else { return 0 }
    let normalized = value <= 1 ? value : value / 100
    return max(0, min(normalized, 1))
}

private func validatorTotalStake(_ validator: WatchStatus.Validator) -> Double? {
    if let stake = validator.stake {
        return stake
    }

    let delegation = validator.delegation ?? 0
    let selfBond = validator.selfBond ?? 0
    let total = delegation + selfBond
    return total > 0 ? total : nil
}

struct MirSFlrPlainAccessoryMetric: View {
    @Environment(\.mirFreshness) private var freshness

    let label: String
    let value: String
    let color: Color

    var body: some View {
        VStack(spacing: -4) {
            Text(freshness.label(label))
                .font(.system(size: 9.4, weight: .black, design: .rounded))
                .foregroundStyle(freshness.labelColor)
                .lineLimit(1)
                .minimumScaleFactor(0.65)
            Text(value)
                .font(.system(size: value.count > 4 ? 14 : 16.5, weight: .black, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.48)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .widgetAccentable()
    }
}

struct MirSFlrAccessoryMetric: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.mirFreshness) private var freshness

    let label: String
    let value: String
    let color: Color
    let ratio: Double

    var body: some View {
        if family == .accessoryCorner {
            cornerLinearBody
        } else {
            circularBody
        }
    }

    private var circularBody: some View {
        Gauge(value: ratio) {
            Text(label)
        } currentValueLabel: {
            VStack(spacing: -5) {
                Text(freshness.label(label))
                    .font(.system(size: labelSize, weight: .black, design: .rounded))
                    .foregroundStyle(freshness.labelColor)
                    .minimumScaleFactor(0.62)
                Text(value)
                    .font(.system(size: valueSize, weight: .black, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(color)
                    .minimumScaleFactor(0.46)
                    .offset(y: valueYOffset)
            }
            .lineLimit(1)
            .offset(y: centerYOffset)
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .tint(color)
        .widgetAccentable()
    }

    private var cornerLinearBody: some View {
        Gauge(value: clampedRatio(ratio)) {
            Text(cornerTitle)
        } currentValueLabel: {
            Text(value)
                .font(.system(size: cornerGaugeValueSize, weight: .black, design: .rounded))
                .monospacedDigit()
                .minimumScaleFactor(0.55)
                .lineLimit(1)
        }
        .gaugeStyle(.accessoryLinearCapacity)
        .tint(color)
        .widgetLabel {
            Text(freshness.label(cornerTitle))
                .font(.system(size: cornerLabelSize, weight: .heavy, design: .rounded))
                .foregroundStyle(freshness.labelColor)
                .minimumScaleFactor(0.65)
                .lineLimit(1)
        }
        .widgetAccentable()
    }

    private var cornerTitle: String {
        switch label {
        case "CAP": return "CAPACITY"
        case "FTSO": return "FTSO AV"
        case "FDC": return "FDC AV"
        case "WGT": return "WEIGHT"
        case "FREE": return "FREE"
        case "DEL": return "DELEG."
        case "PRI": return "PRIMARY"
        case "SEC": return "SECOND."
        case "FDE": return "FDC EPO"
        default: return label
        }
    }

    private var valueSize: CGFloat {
        return value.count > 4 ? 13.8 : 16.4
    }

    private var labelSize: CGFloat {
        9.4
    }

    private var centerYOffset: CGFloat {
        1.2
    }

    private var valueYOffset: CGFloat {
        1.2
    }

    private var cornerValueSize: CGFloat {
        value.count > 4 ? 16.2 : 18.4
    }

    private var cornerInlineValueSize: CGFloat {
        value.count > 4 ? 15.2 : 17
    }

    private var cornerLabelSize: CGFloat {
        cornerTitle.count > 7 ? 11.2 : 12.2
    }

    private var cornerGaugeValueSize: CGFloat {
        value.count > 5 ? 20 : 23
    }
}

struct MirSFlrRectMetric: View {
    @Environment(\.mirFreshness) private var freshness

    let label: String
    let value: String
    let detail: String
    let color: Color
    let ratio: Double

    init(label: String, value: String, detail: String, color: Color, ratio: Double = 1) {
        self.label = label
        self.value = value
        self.detail = detail
        self.color = color
        self.ratio = ratio
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label)
                .font(.system(size: 9.5, weight: .black, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Text(value)
                .font(.system(size: 19, weight: .black, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.52)
            Text(freshness.detail(detail))
                .font(.system(size: 9.5, weight: .bold, design: .rounded))
                .foregroundStyle(freshness.labelColor)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(.secondary.opacity(0.24))
                    Capsule()
                        .fill(color)
                        .frame(width: proxy.size.width * clampedRatio(ratio))
                }
            }
            .frame(height: 3)
        }
        .widgetAccentable()
    }
}

struct MirSFlrPlainRectMetric: View {
    @Environment(\.mirFreshness) private var freshness

    let label: String
    let value: String
    let detail: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label)
                .font(.system(size: 9.5, weight: .black, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Text(value)
                .font(.system(size: 20, weight: .black, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.50)
            Text(freshness.detail(detail))
                .font(.system(size: 9.5, weight: .bold, design: .rounded))
                .foregroundStyle(freshness.labelColor)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .widgetAccentable()
    }
}

private struct MirSFlrAvailabilityCurvesRect: View {
    let entry: MirSFlrEntry

    private let fdcColor = Color.yellow
    private let ftsoColor = Color.green
    private let targetColor = Color.pink

    var body: some View {
        let fdcValues = hourlyValues(
            entry.status.fdc?.availabilityHourly24h,
            current: entry.status.fdc?.availability,
            sixHour: entry.status.fdc?.availability6h,
            day: entry.status.fdc?.availability24h,
            defaultPercent: 97
        )
        let ftsoValues = hourlyValues(
            entry.status.ftso.availabilityHourly24h,
            current: entry.status.ftso.availability,
            sixHour: entry.status.ftso.availability6h,
            day: entry.status.ftso.availability24h,
            defaultPercent: 100
        )
        let fdcLatest = fdcValues.last ?? percentValue(entry.status.fdc?.availability)
        let fdcSixHour = percentValue(entry.status.fdc?.availability6h) ?? average(Array(fdcValues.suffix(6)))
        let fdcDayAverage = percentValue(entry.status.fdc?.availability24h) ?? average(fdcValues)
        let ftsoLatest = ftsoValues.last ?? percentValue(entry.status.ftso.availability)

        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 2) {
                readout("FDC", fdcLatest, fdcColor)
                readout("6H", fdcSixHour, .white)
                readout("24H", fdcDayAverage, .white)
                readout("FTSO", ftsoLatest, ftsoColor, decimals: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            GeometryReader { proxy in
                let width = max(1, proxy.size.width)
                let height = max(1, proxy.size.height)
                let bounds = chartBounds(fdcValues: fdcValues)
                let axisWidth = min(27, max(23, width * 0.19))
                let plotWidth = max(1, width - axisWidth - 1)
                let ftsoLaneHeight = min(13, max(10, height * 0.24))
                let laneGap: CGFloat = 4
                let fdcRect = CGRect(
                    x: axisWidth,
                    y: 1,
                    width: plotWidth,
                    height: max(1, height - ftsoLaneHeight - laneGap - 3)
                )
                let ftsoRect = CGRect(
                    x: axisWidth,
                    y: fdcRect.maxY + laneGap,
                    width: plotWidth,
                    height: ftsoLaneHeight
                )

                ZStack(alignment: .leading) {
                    axisLabels(min: bounds.min, max: bounds.max)
                        .frame(width: axisWidth - 2, height: fdcRect.height, alignment: .leading)
                        .offset(x: 0, y: fdcRect.minY)

                    guideLine(in: fdcRect, position: 0)
                    guideLine(in: fdcRect, position: 0.5)
                    guideLine(in: fdcRect, position: 1)
                    targetLine(in: fdcRect, value: 97, bounds: bounds)

                    availabilityPath(values: fdcValues, bounds: bounds, in: fdcRect)
                        .stroke(fdcColor.opacity(0.26), style: StrokeStyle(lineWidth: 6, lineCap: .round, lineJoin: .round))
                    availabilityPath(values: fdcValues, bounds: bounds, in: fdcRect)
                        .stroke(fdcColor, style: StrokeStyle(lineWidth: 3.2, lineCap: .round, lineJoin: .round))

                    markerDots(values: fdcValues, bounds: bounds, in: fdcRect)
                    endpointDot(values: fdcValues, bounds: bounds, in: fdcRect, color: fdcColor)

                    ftsoLane(in: ftsoRect)
                    ftsoPath(values: ftsoValues, in: ftsoRect)
                        .stroke(ftsoColor.opacity(0.98), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                    ftsoBottomBadge(value: ftsoLatest, in: ftsoRect, axisWidth: axisWidth)
                }
                .frame(width: width, height: height, alignment: .leading)
            }
        }
        .padding(.horizontal, 1)
        .padding(.vertical, 1)
        .widgetAccentable()
    }

    private func readout(_ title: String, _ value: Double?, _ color: Color, decimals: Int = 1) -> some View {
        VStack(alignment: .leading, spacing: -2) {
            Text(title)
                .font(.system(size: 6.4, weight: .black, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Text(shortPercent(value, decimals: decimals))
                .font(.system(size: 9.2, weight: .black, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.58)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func axisLabels(min: Double, max: Double) -> some View {
        VStack(alignment: .trailing, spacing: 0) {
            Text(axisPercent(max))
            Spacer(minLength: 0)
            Text(axisPercent(min))
                .padding(.bottom, 5)
        }
        .font(.system(size: 6.8, weight: .heavy, design: .rounded))
        .monospacedDigit()
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .minimumScaleFactor(0.62)
    }

    private func guideLine(in rect: CGRect, position: Double) -> some View {
        Path { path in
            let y = rect.minY + rect.height * CGFloat(max(0, min(1, position)))
            path.move(to: CGPoint(x: rect.minX, y: y))
            path.addLine(to: CGPoint(x: rect.maxX, y: y))
        }
        .stroke(.secondary.opacity(0.14), style: StrokeStyle(lineWidth: 1, dash: [2, 4]))
    }

    private func targetLine(in rect: CGRect, value: Double, bounds: (min: Double, max: Double)) -> some View {
        Path { path in
            let y = chartY(value: value, bounds: bounds, rect: rect)
            path.move(to: CGPoint(x: rect.minX, y: y))
            path.addLine(to: CGPoint(x: rect.maxX, y: y))
        }
        .stroke(targetColor.opacity(0.42), style: StrokeStyle(lineWidth: 1, dash: [5, 5]))
    }

    private func markerDots(values: [Double], bounds: (min: Double, max: Double), in rect: CGRect) -> some View {
        ForEach(markerIndexes(count: values.count), id: \.self) { index in
            Circle()
                .fill(fdcColor)
                .frame(width: index == values.count - 1 ? 5.4 : 3.4, height: index == values.count - 1 ? 5.4 : 3.4)
                .position(chartPoint(index: index, value: values[index], count: values.count, bounds: bounds, rect: rect))
        }
    }

    private func endpointDot(values: [Double], bounds: (min: Double, max: Double), in rect: CGRect, color: Color) -> some View {
        let point = chartPoint(index: values.count - 1, value: values.last ?? 0, count: values.count, bounds: bounds, rect: rect)

        return Circle()
            .fill(color)
            .frame(width: 5.4, height: 5.4)
            .position(point)
    }

    private func ftsoLane(in rect: CGRect) -> some View {
        Path { path in
            let y = rect.minY + 3
            path.move(to: CGPoint(x: rect.minX, y: y))
            path.addLine(to: CGPoint(x: rect.maxX, y: y))
        }
        .stroke(ftsoColor.opacity(0.22), style: StrokeStyle(lineWidth: 5, lineCap: .round))
    }

    private func ftsoBottomBadge(value: Double?, in rect: CGRect, axisWidth: CGFloat) -> some View {
        Text("FTSO \(shortPercent(value, decimals: 0))")
            .font(.system(size: 6.4, weight: .black, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(ftsoColor)
            .lineLimit(1)
            .minimumScaleFactor(0.65)
            .frame(width: axisWidth + 31, alignment: .leading)
            .position(x: (axisWidth + 31) / 2, y: rect.maxY - 3.4)
    }

    private func availabilityPath(values: [Double], bounds: (min: Double, max: Double), in rect: CGRect) -> Path {
        var path = Path()
        guard !values.isEmpty else { return path }

        for (index, value) in values.enumerated() {
            let point = chartPoint(index: index, value: value, count: values.count, bounds: bounds, rect: rect)
            if index == 0 {
                path.move(to: point)
            } else {
                path.addLine(to: point)
            }
        }

        return path
    }

    private func ftsoPath(values: [Double], in rect: CGRect) -> Path {
        let safeValues = values.isEmpty ? [100, 100] : values
        let low = safeValues.min() ?? 100
        let high = safeValues.max() ?? 100
        let range = high - low
        let centerY = rect.minY + 3
        let usableHeight = max(1, rect.height * 0.28)
        var path = Path()

        for (index, value) in safeValues.enumerated() {
            let denominator = max(1, safeValues.count - 1)
            let x = rect.minX + rect.width * CGFloat(index) / CGFloat(denominator)
            let y: CGFloat
            if range < 0.01 {
                y = centerY
            } else {
                let ratio = max(0, min(1, (value - low) / range))
                y = centerY + usableHeight * CGFloat(0.5 - ratio)
            }
            let point = CGPoint(x: x, y: y)

            if index == 0 {
                path.move(to: point)
            } else {
                path.addLine(to: point)
            }
        }

        return path
    }

    private func chartPoint(index: Int, value: Double, count: Int, bounds: (min: Double, max: Double), rect: CGRect) -> CGPoint {
        let denominator = max(1, count - 1)
        let x = rect.minX + rect.width * CGFloat(index) / CGFloat(denominator)
        let y = chartY(value: value, bounds: bounds, rect: rect)
        return CGPoint(x: x, y: y)
    }

    private func chartY(value: Double, bounds: (min: Double, max: Double), rect: CGRect) -> CGFloat {
        let range = max(0.01, bounds.max - bounds.min)
        let ratio = max(0, min(1, (value - bounds.min) / range))
        return rect.maxY - rect.height * CGFloat(ratio)
    }

    private func hourlyValues(_ values: [Double]?, current: Double?, sixHour: Double?, day: Double?, defaultPercent: Double) -> [Double] {
        let hourly = Array((values ?? []).compactMap { percentValue($0) }.suffix(24))
        if hourly.count >= 4 {
            return hourly
        }

        let now = percentValue(current)
        let six = percentValue(sixHour)
        let twentyFour = percentValue(day)
        let fallback = now ?? six ?? twentyFour ?? defaultPercent

        return [
            twentyFour ?? fallback,
            six ?? fallback,
            now ?? fallback
        ]
    }

    private func markerIndexes(count: Int) -> [Int] {
        guard count > 0 else { return [] }
        let step = max(1, count / 8)
        var indexes = Array(stride(from: 0, to: count, by: step))
        if indexes.last != count - 1 {
            indexes.append(count - 1)
        }
        return indexes
    }

    private func chartBounds(fdcValues: [Double]) -> (min: Double, max: Double) {
        let allValues = fdcValues + [97, 100]
        let low = allValues.min() ?? 97
        let fdcLow = fdcValues.min() ?? low
        let high = allValues.max() ?? 100
        let maxValue = min(100, max(100, high))
        var minValue = max(0, min(97, floor((fdcLow - 0.45) * 10) / 10))

        if maxValue - minValue < 1.2 {
            minValue = max(0, maxValue - 1.2)
        }

        return (minValue, maxValue)
    }

    private func percentValue(_ value: Double?) -> Double? {
        guard let value else { return nil }
        return value <= 1 ? value * 100 : value
    }

    private func average(_ values: [Double]) -> Double? {
        guard !values.isEmpty else { return nil }
        return values.reduce(0, +) / Double(values.count)
    }

    private func shortPercent(_ value: Double?, decimals: Int = 1) -> String {
        guard let value else { return "-" }
        return "\(fixed(value, decimals: decimals))%"
    }

    private func axisPercent(_ value: Double) -> String {
        "\(fixed(value, decimals: 1))%"
    }

    private func fixed(_ value: Double, decimals: Int) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }
}

private struct MirSFlrFDCBarsRect: View {
    let entry: MirSFlrEntry

    private let goodColor = Color.green
    private let fdcColor = Color.yellow
    private let warningColor = Color.red
    private let outageColor = Color.black
    private let labelColor = Color.white.opacity(0.72)
    private let valueColor = Color.white.opacity(0.95)

    var body: some View {
        let values = hourlyValues(
            entry.status.fdc?.availabilityHourly24h,
            current: entry.status.fdc?.availability,
            sixHour: entry.status.fdc?.availability6h,
            day: entry.status.fdc?.availability24h,
            defaultPercent: 97
        )
        let latest = percentValue(entry.status.fdc?.availability) ?? values.last
        let dayAverage = percentValue(entry.status.fdc?.availability24h) ?? average(values)
        let low = values.min()
        let bounds = chartBounds(values: values)
        let chartValues = Array(values.reversed())
        let ageSeconds = StatusFormat.ageSeconds(from: entry.status.updatedAt, now: entry.date)
        let updateLabel = ageSeconds >= 3_600
            ? "OLD \(StatusFormat.compactAge(from: entry.status.updatedAt, now: entry.date))"
            : "UPD \(StatusFormat.compactAge(from: entry.status.updatedAt, now: entry.date))"

        VStack(alignment: .leading, spacing: 1) {
            HStack(alignment: .top, spacing: 3) {
                readout("FDC", latest, barColor(latest ?? 100))
                readout("24H", dayAverage, valueColor)
                readout("LOW", low, labelColor)

                Spacer(minLength: 0)

                legend(color: goodColor, text: "98+")
                legend(color: fdcColor, text: "80+")
                legend(color: warningColor, text: "<80")
                legend(color: outageColor, text: "<50")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)

            GeometryReader { proxy in
                let width = max(1, proxy.size.width)
                let height = max(1, proxy.size.height)
                let axisWidth = min(25, max(21, width * 0.17))
                let footerHeight: CGFloat = 9
                let plotRect = CGRect(
                    x: axisWidth,
                    y: 1,
                    width: max(1, width - axisWidth - 1),
                    height: max(1, height - footerHeight - 2)
                )

                ZStack(alignment: .topLeading) {
                    axisLabels(bounds: bounds)
                        .frame(width: axisWidth - 2, height: plotRect.height, alignment: .leading)
                        .offset(x: 0, y: plotRect.minY)

                    guideLine(in: plotRect, value: bounds.max, bounds: bounds)
                    guideLine(in: plotRect, value: 95, bounds: bounds)
                    guideLine(in: plotRect, value: bounds.min, bounds: bounds)

                    bars(values: chartValues, bounds: bounds, in: plotRect)

                    xLabel("23h", x: plotRect.minX, y: plotRect.maxY + 5, alignment: .leading)
                    xLabel(updateLabel, x: plotRect.midX, y: plotRect.maxY + 5, alignment: .center)
                    xLabel("now", x: plotRect.maxX, y: plotRect.maxY + 5, alignment: .trailing)
                }
                .frame(width: width, height: height, alignment: .leading)
            }
        }
        .padding(.horizontal, 1)
        .padding(.vertical, 1)
        .unredacted()
        .privacySensitive(false)
    }

    private func readout(_ title: String, _ value: Double?, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: -2) {
            Text(title)
                .font(.system(size: 6.1, weight: .black, design: .rounded))
                .foregroundStyle(labelColor)
                .lineLimit(1)
                .unredacted()
                .privacySensitive(false)
            Text(shortPercent(value))
                .font(.system(size: 8.9, weight: .black, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
                .unredacted()
                .privacySensitive(false)
        }
        .frame(width: 31, alignment: .leading)
        .unredacted()
        .privacySensitive(false)
    }

    private func legend(color: Color, text: String) -> some View {
        HStack(spacing: 1) {
            RoundedRectangle(cornerRadius: 1, style: .continuous)
                .fill(color)
                .overlay(
                    RoundedRectangle(cornerRadius: 1, style: .continuous)
                        .stroke(Color.white.opacity(color == outageColor ? 0.42 : 0.18), lineWidth: 0.45)
                )
                .frame(width: 4, height: 7)
            Text(text)
                .font(.system(size: 5.8, weight: .black, design: .rounded))
                .foregroundStyle(labelColor)
                .lineLimit(1)
                .minimumScaleFactor(0.82)
                .unredacted()
                .privacySensitive(false)
        }
    }

    private func axisLabels(bounds: (min: Double, max: Double)) -> some View {
        VStack(alignment: .trailing, spacing: 0) {
            Text(axisPercent(bounds.max))
            Spacer(minLength: 0)
            Text("95%")
            Spacer(minLength: 0)
            Text(axisPercent(bounds.min))
                .padding(.bottom, 1)
        }
        .font(.system(size: 6.9, weight: .heavy, design: .rounded))
        .monospacedDigit()
        .foregroundStyle(labelColor)
        .lineLimit(1)
        .minimumScaleFactor(0.78)
        .unredacted()
        .privacySensitive(false)
    }

    private func guideLine(in rect: CGRect, value: Double, bounds: (min: Double, max: Double)) -> some View {
        Path { path in
            let y = chartY(value: value, bounds: bounds, rect: rect)
            path.move(to: CGPoint(x: rect.minX, y: y))
            path.addLine(to: CGPoint(x: rect.maxX, y: y))
        }
        .stroke(.secondary.opacity(value == 95 ? 0.23 : 0.13), style: StrokeStyle(lineWidth: 1, dash: [2, 4]))
    }

    private func bars(values: [Double], bounds: (min: Double, max: Double), in rect: CGRect) -> some View {
        let safeValues = values.isEmpty ? [bounds.min] : values
        let count = safeValues.count
        let baseGap = rect.width / CGFloat(max(1, count))
        let gap = min(2, max(0.75, baseGap * 0.22))
        let barWidth = max(2, (rect.width - gap * CGFloat(max(0, count - 1))) / CGFloat(max(1, count)))

        return ZStack {
            ForEach(safeValues.indices, id: \.self) { index in
                let value = safeValues[index]
                let barHeight = max(2.4, rect.maxY - chartY(value: value, bounds: bounds, rect: rect))
                let x = rect.minX + CGFloat(index) * (barWidth + gap) + barWidth / 2
                let y = rect.maxY - barHeight / 2
                let color = barColor(value)

                RoundedRectangle(cornerRadius: min(2.5, barWidth / 2), style: .continuous)
                    .fill(color.opacity(0.9))
                    .overlay(
                        RoundedRectangle(cornerRadius: min(2.5, barWidth / 2), style: .continuous)
                            .stroke(barStrokeColor(value), lineWidth: value < 50 ? 0.9 : 0.7)
                    )
                    .frame(width: barWidth, height: barHeight)
                    .position(x: x, y: y)
            }
        }
    }

    private func xLabel(_ text: String, x: CGFloat, y: CGFloat, alignment: Alignment) -> some View {
        Text(text)
            .font(.system(size: 6.4, weight: .heavy, design: .rounded))
            .foregroundStyle(labelColor)
            .lineLimit(1)
            .minimumScaleFactor(0.72)
            .frame(width: text.hasPrefix("UPD") || text.hasPrefix("OLD") ? 48 : 24, alignment: alignment)
            .position(x: x, y: y)
            .unredacted()
            .privacySensitive(false)
    }

    private func barColor(_ value: Double) -> Color {
        if value >= 98 { return goodColor }
        if value >= 80 { return fdcColor }
        if value >= 50 { return warningColor }
        return outageColor
    }

    private func barStrokeColor(_ value: Double) -> Color {
        if value < 50 { return .secondary.opacity(0.8) }
        return barColor(value).opacity(0.48)
    }

    private func chartY(value: Double, bounds: (min: Double, max: Double), rect: CGRect) -> CGFloat {
        let range = max(0.01, bounds.max - bounds.min)
        let ratio = max(0, min(1, (value - bounds.min) / range))
        return rect.maxY - rect.height * CGFloat(ratio)
    }

    private func chartBounds(values: [Double]) -> (min: Double, max: Double) {
        let low = values.min() ?? 95
        let minValue = max(0, min(90, floor((low - 0.4) * 10) / 10))
        return (minValue, 100)
    }

    private func hourlyValues(_ values: [Double]?, current: Double?, sixHour: Double?, day: Double?, defaultPercent: Double) -> [Double] {
        let hourly = Array((values ?? []).compactMap { percentValue($0) }.suffix(24))
        if hourly.count >= 4 {
            return hourly
        }

        let now = percentValue(current)
        let six = percentValue(sixHour)
        let twentyFour = percentValue(day)
        let fallback = now ?? six ?? twentyFour ?? defaultPercent

        return [
            twentyFour ?? fallback,
            six ?? fallback,
            now ?? fallback
        ]
    }

    private func percentValue(_ value: Double?) -> Double? {
        guard let value else { return nil }
        return value <= 1 ? value * 100 : value
    }

    private func average(_ values: [Double]) -> Double? {
        guard !values.isEmpty else { return nil }
        return values.reduce(0, +) / Double(values.count)
    }

    private func shortPercent(_ value: Double?) -> String {
        guard let value else { return "-" }
        return "\(fixed(value, decimals: 1))%"
    }

    private func axisPercent(_ value: Double) -> String {
        "\(fixed(value, decimals: value.rounded() == value ? 0 : 1))%"
    }

    private func fixed(_ value: Double, decimals: Int) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }
}

/// Rectangular complication: FTSO performance, primary and secondary over 24h.
///
/// The previous layout autoscaled each lane to its own min/max, so 0.3% of
/// noise filled a lane exactly like a 3% climb and there was no way to tell a
/// drift from a flat line. This version answers that question three ways at
/// once: a signed delta in the header, a dashed baseline at the 24h-ago value
/// so "above the line" reads as risen, and a filled area so the eye follows a
/// shape rather than a thin wiggle.
private struct MirSFlrFTSOPerformanceBandsRect: View {
    let entry: MirSFlrEntry

    private let performanceColor = Color.green
    private let primaryColor = Color(red: 1.0, green: 0.34, blue: 0.85)
    private let secondaryColor = Color(red: 0.24, green: 0.62, blue: 1.0)
    private let labelColor = Color.white.opacity(0.62)

    private struct Lane {
        let title: String
        let color: Color
        let values: [Double]
        let latest: Double?
        let dashed: Bool
    }

    var body: some View {
        let perf = series(entry.status.ftso.performanceHourly24h, entry.status.ftso.performance, 72)
        let pri  = series(entry.status.ftso.primaryPerformanceHourly24h, entry.status.ftso.primaryPerformance, 38)
        let sec  = series(entry.status.ftso.secondaryPerformanceHourly24h, entry.status.ftso.secondaryPerformance, 98)

        let lanes = [
            Lane(title: "SEC", color: secondaryColor, values: sec,
                 latest: percentValue(entry.status.ftso.secondaryPerformance) ?? sec.last, dashed: false),
            Lane(title: "PERF", color: performanceColor, values: perf,
                 latest: percentValue(entry.status.ftso.performance) ?? perf.last, dashed: false),
            Lane(title: "PRI", color: primaryColor, values: pri,
                 latest: percentValue(entry.status.ftso.primaryPerformance) ?? pri.last, dashed: true),
        ]

        let ageSeconds = StatusFormat.ageSeconds(from: entry.status.updatedAt, now: entry.date)
        let stale = ageSeconds >= 3_600
        let ageText = StatusFormat.compactAge(from: entry.status.updatedAt, now: entry.date)

        VStack(spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                readout(lanes[0])
                Spacer(minLength: 3)
                readout(lanes[1])
                Spacer(minLength: 3)
                readout(lanes[2])
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            GeometryReader { proxy in
                let w = max(1, proxy.size.width)
                let h = max(1, proxy.size.height)
                let footer: CGFloat = 7.5
                let gap: CGFloat = 2
                let laneH = max(1, (h - footer - gap * 2) / 3)

                ZStack(alignment: .topLeading) {
                    ForEach(Array(lanes.enumerated()), id: \.offset) { i, lane in
                        let rect = CGRect(x: 0, y: (laneH + gap) * CGFloat(i), width: w, height: laneH)
                        laneView(lane, in: rect)
                    }
                    footerRow(stale: stale, ageText: ageText, width: w, y: h - footer / 2 - 1)
                }
                .frame(width: w, height: h, alignment: .topLeading)
            }
        }
        .padding(.horizontal, 1)
        .padding(.vertical, 1)
        .unredacted()
        .privacySensitive(false)
    }

    // MARK: header

    private func readout(_ lane: Lane) -> some View {
        let delta = trend(lane.values)
        return HStack(spacing: 1.5) {
            Text(lane.title)
                .font(.system(size: 5.9, weight: .black, design: .rounded))
                .foregroundStyle(labelColor)
            Text(shortPercent(lane.latest))
                .font(.system(size: 8.8, weight: .black, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(lane.color)
            Text(deltaText(delta))
                .font(.system(size: 6.0, weight: .black, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(deltaColor(delta, lane.color))
        }
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .fixedSize()
    }

    /// Change across the visible window, in percentage points.
    private func trend(_ values: [Double]) -> Double? {
        guard let first = values.first, let last = values.last, values.count > 1 else { return nil }
        return last - first
    }

    private func deltaText(_ d: Double?) -> String {
        guard let d else { return "" }
        if abs(d) < 0.15 { return "▬" }
        return String(format: "%@%.1f", d > 0 ? "▲" : "▼", abs(d))
    }

    private func deltaColor(_ d: Double?, _ base: Color) -> Color {
        guard let d, abs(d) >= 0.15 else { return labelColor }
        return base.opacity(0.92)
    }

    // MARK: lanes

    private func laneView(_ lane: Lane, in rect: CGRect) -> some View {
        let b = bounds(lane.values)
        let baseline = lane.values.first
        return ZStack(alignment: .topLeading) {
            areaPath(lane.values, b, rect)
                .fill(LinearGradient(
                    colors: [lane.color.opacity(0.16), lane.color.opacity(0.0)],
                    startPoint: .top, endPoint: .bottom))

            if let baseline {
                Path { p in
                    let y = yPos(baseline, b, rect)
                    p.move(to: CGPoint(x: rect.minX, y: y))
                    p.addLine(to: CGPoint(x: rect.maxX - 16, y: y))
                }
                .stroke(lane.color.opacity(0.55), style: StrokeStyle(lineWidth: 0.7, dash: [2, 2.5]))
            }

            linePath(lane.values, b, rect)
                .stroke(lane.color, style: StrokeStyle(
                    lineWidth: 2.0, lineCap: .round, lineJoin: .round,
                    dash: lane.dashed ? [3.5, 2.5] : []))

            if let last = lane.values.last {
                Circle()
                    .fill(lane.color)
                    .frame(width: 3.4, height: 3.4)
                    .position(x: rect.maxX - 17, y: yPos(last, b, rect))
            }

            Text(spanText(b))
                .font(.system(size: 5.2, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(labelColor)
                .frame(width: 15, alignment: .trailing)
                .position(x: rect.maxX - 7.5, y: rect.midY)
        }
    }

    private func footerRow(stale: Bool, ageText: String, width: CGFloat, y: CGFloat) -> some View {
        HStack(spacing: 0) {
            Text("24h")
            Spacer(minLength: 0)
            HStack(spacing: 2) {
                Circle()
                    .fill(stale ? Color.orange : Color.white.opacity(0.5))
                    .frame(width: 3, height: 3)
                Text(ageText)
            }
            Spacer(minLength: 0)
            Text("now")
        }
        .font(.system(size: 6.0, weight: .heavy, design: .rounded))
        .monospacedDigit()
        .foregroundStyle(stale ? Color.orange.opacity(0.9) : labelColor)
        .lineLimit(1)
        .frame(width: width - 17, alignment: .leading)
        .position(x: (width - 17) / 2, y: y)
    }

    // MARK: geometry

    /// Centre on the window mean with a floor on the span, so a genuinely flat
    /// series renders flat instead of being stretched into fake drama.
    private func bounds(_ v: [Double]) -> (min: Double, max: Double) {
        guard let lo = v.min(), let hi = v.max() else { return (0, 1) }
        let mid = (lo + hi) / 2
        let span = max(hi - lo, 3.0)
        let pad = span * 0.62
        return (mid - pad, mid + pad)
    }

    private func yPos(_ value: Double, _ b: (min: Double, max: Double), _ r: CGRect) -> CGFloat {
        let range = max(0.0001, b.max - b.min)
        let t = (value - b.min) / range
        return r.maxY - CGFloat(t) * r.height
    }

    private func xPos(_ i: Int, _ count: Int, _ r: CGRect) -> CGFloat {
        guard count > 1 else { return r.minX }
        let usable = r.width - 18
        return r.minX + usable * CGFloat(i) / CGFloat(count - 1)
    }

    private func linePath(_ v: [Double], _ b: (min: Double, max: Double), _ r: CGRect) -> Path {
        var p = Path()
        guard !v.isEmpty else { return p }
        for (i, value) in v.enumerated() {
            let pt = CGPoint(x: xPos(i, v.count, r), y: yPos(value, b, r))
            i == 0 ? p.move(to: pt) : p.addLine(to: pt)
        }
        return p
    }

    private func areaPath(_ v: [Double], _ b: (min: Double, max: Double), _ r: CGRect) -> Path {
        var p = linePath(v, b, r)
        guard !v.isEmpty else { return p }
        p.addLine(to: CGPoint(x: xPos(v.count - 1, v.count, r), y: r.maxY))
        p.addLine(to: CGPoint(x: xPos(0, v.count, r), y: r.maxY))
        p.closeSubpath()
        return p
    }

    // MARK: values

    /// The feed carries these newest-first — checked against the current value,
    /// which sits at index 0 — so reverse into oldest-to-newest for drawing
    /// left to right. Getting this backwards silently inverts the trend arrow.
    private func series(_ hourly: [Double]?, _ current: Double?, _ fallback: Double) -> [Double] {
        let v = (hourly ?? []).compactMap { percentValue($0) }.prefix(24)
        if v.count >= 4 { return Array(v.reversed()) }
        return [percentValue(current) ?? fallback]
    }

    private func percentValue(_ v: Double?) -> Double? {
        guard let v, v.isFinite else { return nil }
        return v <= 1 ? v * 100 : v
    }

    private func shortPercent(_ v: Double?) -> String {
        guard let v else { return "–" }
        return String(format: "%.0f", v)
    }

    private func spanText(_ b: (min: Double, max: Double)) -> String {
        String(format: "±%.1f", (b.max - b.min) / 2)
    }
}


struct MirSFlrCornerStripMetric: View {
    let title: String
    let value: String
    let color: Color
    let ratio: Double

    var body: some View {
        GeometryReader { proxy in
            let width = max(30, proxy.size.width)
            let trackWidth = min(34, max(22, width * 0.66))

            VStack(alignment: .trailing, spacing: -1) {
                Text(value)
                    .font(.system(size: valueSize, weight: .black, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(color)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)

                HStack(alignment: .center, spacing: 3) {
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(color.opacity(0.28))
                        Capsule()
                            .fill(color)
                            .frame(width: trackWidth * max(0.08, clampedRatio(ratio)))
                    }
                    .frame(width: trackWidth, height: 5)

                    Text(shortTitle)
                        .font(.system(size: titleSize, weight: .black, design: .rounded))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.65)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            .padding(.leading, 5)
            .padding(.trailing, 1)
        }
        .widgetAccentable()
    }

    private var shortTitle: String {
        switch title {
        case "CAPACITY": return "CAP"
        case "PRIMARY": return "PRI"
        case "SECOND.": return "SEC"
        case "FTSO AV": return "FTSO"
        case "FDC AV": return "FDC"
        case "FDC EPO": return "FDE"
        default: return title
        }
    }

    private var titleSize: CGFloat {
        shortTitle.count > 4 ? 7.4 : 8.4
    }

    private var valueSize: CGFloat {
        value.count > 4 ? 17 : 20.5
    }
}

struct MirSFlrCornerWeatherArcMetric: View {
    let title: String
    let value: String
    let color: Color
    let ratio: Double

    var body: some View {
        GeometryReader { proxy in
            let width = max(36, proxy.size.width)
            let height = max(34, proxy.size.height)
            let scale = min(width / 56, height / 46)

            ZStack(alignment: .topTrailing) {
                Path { path in
                    let start = CGPoint(x: width * 0.05, y: height * 0.70)
                    let control = CGPoint(x: width * 0.46, y: height * 0.36)
                    let end = CGPoint(x: width * 0.96, y: height * 0.59)
                    path.move(to: start)
                    path.addQuadCurve(to: end, control: control)
                }
                .stroke(color.opacity(0.25), style: StrokeStyle(lineWidth: 7 * scale, lineCap: .round))

                Path { path in
                    let start = CGPoint(x: width * 0.05, y: height * 0.70)
                    let control = CGPoint(x: width * 0.46, y: height * 0.36)
                    let fullEnd = CGPoint(x: width * 0.96, y: height * 0.59)
                    let progress = max(0.10, clampedRatio(ratio))
                    let end = quadraticPoint(start: start, control: control, end: fullEnd, t: progress)
                    let adjustedControl = quadraticPoint(start: start, control: control, end: fullEnd, t: progress * 0.58)
                    path.move(to: start)
                    path.addQuadCurve(to: end, control: adjustedControl)
                }
                .stroke(color, style: StrokeStyle(lineWidth: 7 * scale, lineCap: .round))

                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text(shortTitle)
                        .font(.system(size: 9.0 * scale, weight: .black, design: .rounded))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.62)
                    Text(value)
                        .font(.system(size: valueSize * scale, weight: .black, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.50)
                }
                .frame(maxWidth: width, alignment: .trailing)
                .offset(x: -1, y: -1)
            }
            .frame(width: width, height: height, alignment: .topTrailing)
            .padding(.leading, 2)
            .padding(.trailing, 1)
        }
        .widgetAccentable()
    }

    private var shortTitle: String {
        switch title {
        case "CAPACITY": return "CAP"
        case "PRIMARY": return "PRI"
        case "SECOND.": return "SEC"
        case "FTSO AV": return "FTSO"
        case "FDC AV": return "FDC"
        case "FDC EPO": return "FDE"
        default: return title
        }
    }

    private var valueSize: CGFloat {
        value.count > 4 ? 22 : 25
    }

    private func quadraticPoint(start: CGPoint, control: CGPoint, end: CGPoint, t: Double) -> CGPoint {
        let u = 1 - t
        let x = u * u * start.x + 2 * u * t * control.x + t * t * end.x
        let y = u * u * start.y + 2 * u * t * control.y + t * t * end.y
        return CGPoint(x: x, y: y)
    }
}

struct MirSFlrCornerPlainMetric: View {
    @Environment(\.mirFreshness) private var freshness

    let title: String
    let value: String
    let color: Color

    var body: some View {
        GeometryReader { proxy in
            let width = max(36, proxy.size.width)
            let height = max(32, proxy.size.height)
            let scale = min(width / 54, height / 44)

            VStack(alignment: .trailing, spacing: -2 * scale) {
                Text(freshness.label(shortTitle))
                    .font(.system(size: 9.2 * scale, weight: .black, design: .rounded))
                    .foregroundStyle(freshness.labelColor)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)

                Text(value)
                    .font(.system(size: valueSize * scale, weight: .black, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(color)
                    .lineLimit(1)
                    .minimumScaleFactor(0.50)
            }
            .frame(width: width, height: height, alignment: .topTrailing)
            .rotationEffect(.degrees(-10), anchor: .center)
            .offset(x: -1 * scale, y: 6 * scale)
            .padding(.top, 3)
            .padding(.leading, 4)
            .padding(.trailing, 1)
        }
        .widgetAccentable()
    }

    private var shortTitle: String {
        switch title {
        case "CAPACITY": return "CAP"
        case "PRIMARY": return "PRI"
        case "SECOND.": return "SEC"
        case "FTSO AV": return "FTSO"
        case "FDC AV": return "FDC"
        case "FDC EPO": return "FDE"
        default: return title
        }
    }

    private var valueSize: CGFloat {
        value.count > 4 ? 20.5 : 23.5
    }
}

struct MirSFlrCapacityView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MirSFlrEntry

    var body: some View {
        switch family {
        case .accessoryCircular, .accessoryCorner:
            MirSFlrAccessoryMetric(
                label: "CAP",
                value: StatusFormat.percent(entry.status.validator.fillPct, decimals: 0),
                color: WatchTone.capacityFree(entry.status.validator.free),
                ratio: clampedRatio(entry.status.validator.fillPct)
            )
        case .accessoryInline:
            Text("CAP \(StatusFormat.percent(entry.status.validator.fillPct))\(MirFreshness(entry: entry).inlineSuffix)")
        default:
            MirSFlrRectMetric(
                label: "CAP",
                value: "\(StatusFormat.compactBare(entry.status.validator.stake)) / 90M",
                detail: "FREE \(StatusFormat.compactBare(entry.status.validator.free, decimals: 0))",
                color: WatchTone.capacityFree(entry.status.validator.free),
                ratio: clampedRatio(entry.status.validator.fillPct)
            )
        }
    }
}

struct MirSFlrFTSOAvailabilityView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MirSFlrEntry

    var body: some View {
        let availability = entry.status.ftso.availability
        switch family {
        case .accessoryCircular, .accessoryCorner:
            MirSFlrAccessoryMetric(
                label: "FTSO",
                value: StatusFormat.percent(availability, decimals: 0),
                color: WatchTone.availability(availability),
                ratio: clampedRatio(availability)
            )
        case .accessoryInline:
            Text("FTSO \(StatusFormat.percent(availability))\(MirFreshness(entry: entry).inlineSuffix)")
        default:
            MirSFlrRectMetric(
                label: "FTSO",
                value: StatusFormat.percent(availability, decimals: 1),
                detail: "PERF \(StatusFormat.percent(entry.status.ftso.performance, decimals: 1))",
                color: WatchTone.availability(availability),
                ratio: clampedRatio(availability)
            )
        }
    }
}

struct MirSFlrFDCAvailabilityView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MirSFlrEntry

    var body: some View {
        let fdc = entry.status.fdc
        let availability = fdc?.availability
        switch family {
        case .accessoryCircular, .accessoryCorner:
            MirSFlrAccessoryMetric(
                label: "FDC",
                value: StatusFormat.percent(availability, decimals: 0),
                color: WatchTone.availability(availability),
                ratio: clampedRatio(availability)
            )
        case .accessoryInline:
            Text("FDC \(StatusFormat.percent(availability))\(MirFreshness(entry: entry).inlineSuffix)")
        default:
            MirSFlrRectMetric(
                label: "FDC",
                value: StatusFormat.percent(availability, decimals: 1),
                detail: "PART \(StatusFormat.percent(fdc?.participation, decimals: 1))",
                color: WatchTone.availability(availability),
                ratio: clampedRatio(availability)
            )
        }
    }
}

struct MirSFlrFTSOWeightView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MirSFlrEntry

    var body: some View {
        switch family {
        case .accessoryCircular:
            MirSFlrPlainAccessoryMetric(
                label: "WGT",
                value: StatusFormat.compactBare(entry.status.ftso.weight, decimals: 0),
                color: .pink
            )
        case .accessoryCorner:
            MirSFlrCornerPlainMetric(
                title: "WEIGHT",
                value: StatusFormat.compactBare(entry.status.ftso.weight, decimals: 0),
                color: .pink
            )
        case .accessoryInline:
            Text("WGT \(StatusFormat.compactBare(entry.status.ftso.weight))\(MirFreshness(entry: entry).inlineSuffix)")
        default:
            MirSFlrPlainRectMetric(
                label: "WGT",
                value: StatusFormat.compactFLR(entry.status.ftso.weight),
                detail: "FSE E\(entry.status.ftso.signingPolicyEpoch ?? 0)",
                color: .pink
            )
        }
    }
}

struct MirSFlrEpochView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MirSFlrEntry

    var body: some View {
        let isOk = entry.status.ftso.status == "ok" && (entry.status.fdc?.conditionMet ?? true)
        switch family {
        case .accessoryCircular, .accessoryCorner:
            MirSFlrAccessoryMetric(
                label: isOk ? "EPO" : "WARN",
                value: "E\(entry.status.ftso.signingPolicyEpoch ?? 0)",
                color: isOk ? .green : .pink,
                ratio: isOk ? 1 : 0.25
            )
        case .accessoryInline:
            Text("EPO E\(entry.status.ftso.signingPolicyEpoch ?? 0) \(isOk ? "OK" : "WARN")\(MirFreshness(entry: entry).inlineSuffix)")
        default:
            MirSFlrRectMetric(
                label: isOk ? "EPO" : "WARN",
                value: "LIVE E\(entry.status.ftso.signingPolicyEpoch ?? 0)",
                detail: "DONE E\(entry.status.ftso.latestCompletedEpoch ?? 0)",
                color: isOk ? .green : .pink,
                ratio: isOk ? 1 : 0.25
            )
        }
    }
}

struct MirSFlrFreeSpaceView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MirSFlrEntry

    var body: some View {
        let free = entry.status.validator.free
        let ratio = (free ?? 0) / (entry.status.validator.capacity ?? 90_000_000)
        switch family {
        case .accessoryCircular, .accessoryCorner:
            MirSFlrAccessoryMetric(
                label: "FREE",
                value: StatusFormat.compactBare(free, decimals: 1),
                color: WatchTone.capacityFree(free),
                ratio: clampedRatio(ratio)
            )
        case .accessoryInline:
            Text("FREE \(StatusFormat.compactBare(free, decimals: 1))\(MirFreshness(entry: entry).inlineSuffix)")
        default:
            MirSFlrRectMetric(
                label: "FREE",
                value: StatusFormat.compactFLR(free, decimals: 1),
                detail: "CAP \(StatusFormat.percent(entry.status.validator.fillPct))",
                color: WatchTone.capacityFree(free),
                ratio: clampedRatio(ratio)
            )
        }
    }
}

struct MirSFlrDelegationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MirSFlrEntry

    var body: some View {
        let stake = validatorTotalStake(entry.status.validator)
        let ratio = (stake ?? 0) / (entry.status.validator.capacity ?? 90_000_000)
        switch family {
        case .accessoryCircular, .accessoryCorner:
            MirSFlrAccessoryMetric(
                label: "DEL",
                value: StatusFormat.compactBare(stake, decimals: 0),
                color: .pink,
                ratio: clampedRatio(ratio)
            )
        case .accessoryInline:
            Text("FTSO \(StatusFormat.percent(entry.status.ftso.availability, decimals: 0)) · FDC \(StatusFormat.percent(entry.status.fdc?.availability, decimals: 1))\(MirFreshness(entry: entry).inlineSuffix)")
        default:
            MirSFlrAvailabilityCurvesRect(entry: entry)
        }
    }
}

struct MirSFlrPrimaryPerformanceView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MirSFlrEntry

    var body: some View {
        let performance = entry.status.ftso.primaryPerformance
        switch family {
        case .accessoryCircular, .accessoryCorner:
            MirSFlrAccessoryMetric(
                label: "PRI",
                value: StatusFormat.percent(performance, decimals: 0),
                color: WatchTone.performance(performance),
                ratio: clampedRatio(performance)
            )
        case .accessoryInline:
            Text("PRI \(StatusFormat.percent(performance))\(MirFreshness(entry: entry).inlineSuffix)")
        default:
            MirSFlrRectMetric(
                label: "PRI",
                value: StatusFormat.percent(performance, decimals: 1),
                detail: "FTSO primary",
                color: WatchTone.performance(performance),
                ratio: clampedRatio(performance)
            )
        }
    }
}

struct MirSFlrSecondaryPerformanceView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MirSFlrEntry

    var body: some View {
        let performance = entry.status.ftso.secondaryPerformance
        switch family {
        case .accessoryCircular, .accessoryCorner:
            MirSFlrAccessoryMetric(
                label: "SEC",
                value: StatusFormat.percent(performance, decimals: 0),
                color: WatchTone.performance(performance),
                ratio: clampedRatio(performance)
            )
        case .accessoryInline:
            Text("SEC \(StatusFormat.percent(performance))\(MirFreshness(entry: entry).inlineSuffix)")
        default:
            MirSFlrRectMetric(
                label: "SEC",
                value: StatusFormat.percent(performance, decimals: 1),
                detail: "FTSO secondary",
                color: WatchTone.performance(performance),
                ratio: clampedRatio(performance)
            )
        }
    }
}

struct MirSFlrAPRView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MirSFlrEntry

    var body: some View {
        let rewardRate = entry.status.ftso.rewardRate
        switch family {
        case .accessoryCircular, .accessoryCorner:
            MirSFlrAccessoryMetric(
                label: "APR",
                value: StatusFormat.percent(rewardRate, decimals: 1),
                color: WatchTone.rewardRate(rewardRate),
                ratio: clampedRatio((rewardRate ?? 0) / 5)
            )
        case .accessoryInline:
            Text("APR \(StatusFormat.percent(rewardRate))\(MirFreshness(entry: entry).inlineSuffix)")
        default:
            MirSFlrRectMetric(
                label: "APR",
                value: StatusFormat.percent(rewardRate, decimals: 2),
                detail: "Reward rate",
                color: WatchTone.rewardRate(rewardRate),
                ratio: clampedRatio((rewardRate ?? 0) / 5)
            )
        }
    }
}

struct MirSFlrFDCParticipationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MirSFlrEntry

    var body: some View {
        let participation = entry.status.fdc?.participation
        let conditionMet = entry.status.fdc?.conditionMet ?? false
        switch family {
        case .accessoryCircular, .accessoryCorner:
            MirSFlrAccessoryMetric(
                label: "FDE",
                value: StatusFormat.percent(participation, decimals: 0),
                color: conditionMet ? WatchTone.performance(participation) : .pink,
                ratio: clampedRatio(participation)
            )
        case .accessoryInline:
            Text("FDE \(StatusFormat.percent(participation)) \(conditionMet ? "OK" : "WARN")\(MirFreshness(entry: entry).inlineSuffix)")
        default:
            MirSFlrRectMetric(
                label: "FDE",
                value: StatusFormat.percent(participation, decimals: 1),
                detail: conditionMet ? "FDC epoch OK" : "FDC warning",
                color: conditionMet ? WatchTone.performance(participation) : .pink,
                ratio: conditionMet ? clampedRatio(participation) : 0.25
            )
        }
    }
}

struct MirSFlrCapacityComplication: Widget {
    let kind = "MirSFlrCapacityComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrCapacityView(entry: entry)
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("MID CAP - validator capacity")
        .description("Sredinski widget. Validator stake proti 90M limitu. Uporabi za hiter pogled, koliko prostora se je se na voljo.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
        .contentMarginsDisabled()
    }
}

struct MirSFlrLegacyFTSOComplication: Widget {
    let kind = "MirSFlrComplications"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrFTSOAvailabilityView(entry: entry)
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("FTSO availability")
        .description("Compatibility widget for older MirSFlr watch face slots.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
        .contentMarginsDisabled()
    }
}

struct MirSFlrFTSOAvailabilityComplication: Widget {
    let kind = "MirSFlrFTSOAvailabilityComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrFTSOAvailabilityView(entry: entry)
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("MID FTSO - oracle availability")
        .description("Sredinski widget. Live FTSO availability v procentih. Zeleno pri zelo dobrem stanju, rumeno pri opozorilu, pink pri problemu.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
        .contentMarginsDisabled()
    }
}

struct MirSFlrFDCAvailabilityComplication: Widget {
    let kind = "MirSFlrFDCAvailabilityComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrFDCAvailabilityView(entry: entry)
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("MID FDC - data availability")
        .description("Sredinski widget. Live FDC availability. Najboljsi hiter signal, ali FDC infrastruktura normalno dela.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
        .contentMarginsDisabled()
    }
}

struct MirSFlrFTSOWeightComplication: Widget {
    let kind = "MirSFlrFTSOWeightComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrFTSOWeightView(entry: entry)
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("MID WGT - live FTSO weight")
        .description("Sredinski widget. Live FTSO weight iz FSE/externih virov, ne samo iz Oracle Daemona, ki lahko kaze epoho nazaj.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
        .contentMarginsDisabled()
    }
}

struct MirSFlrEpochComplication: Widget {
    let kind = "MirSFlrEpochComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrEpochView(entry: entry)
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("MID EPO - epoch status")
        .description("Sredinski widget. Live signing-policy epoch in OK/WARN stanje za FTSO/FDC reward pogoje.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
        .contentMarginsDisabled()
    }
}

struct MirSFlrFreeSpaceComplication: Widget {
    let kind = "MirSFlrFreeSpaceComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrFreeSpaceView(entry: entry)
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("MID FREE - validator headroom")
        .description("Sredinski widget. Preostali validator prostor do 90M. Kriticno, ko si zelo blizu full capacity.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
        .contentMarginsDisabled()
    }
}

struct MirSFlrDelegationComplication: Widget {
    let kind = "MirSFlrDelegationComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrDelegationView(entry: entry)
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("MID FTSO/FDC - live curves")
        .description("Sredinski widget. Dve krivulji: FDC availability zgoraj, FTSO availability spodaj, z minimalnimi oznakami in procenti.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
        .contentMarginsDisabled()
    }
}

struct MirSFlrFDCBarsComplication: Widget {
    let kind = "MirSFlrFDCBarsComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrFDCBarsRect(entry: entry)
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("MID FDC BARS - hourly availability")
        .description("Sredinski widget. Stolpci FDC availability za zadnjih 24 ur, z levo skalo in barvno legendo kot na Oracle Daemon pogledu.")
        .supportedFamilies([.accessoryRectangular])
        .contentMarginsDisabled()
    }
}

struct MirSFlrFDCBarsLiveComplication: Widget {
    let kind = "MirSFlrFDCBarsLiveV2Complication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrFDCBarsRect(entry: entry)
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("MID FDC BARS LIVE")
        .description("Sredinski widget. Sveza V2 verzija stolpcev FDC availability z UPD starostjo podatkov, da watchOS ne reciklira starega cachea.")
        .supportedFamilies([.accessoryRectangular])
        .contentMarginsDisabled()
    }
}

struct MirSFlrFTSOPerformanceBandsComplication: Widget {
    let kind = "MirSFlrFTSOPerformanceBandsV2Complication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrFTSOPerformanceBandsRect(entry: entry)
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("MID FTSO PERF - hourly bands")
        .description("Sredinski widget. V2 FTSO performance, primary band/IQR in secondary band za zadnjih 24 ur z osvezitvijo na par minut.")
        .supportedFamilies([.accessoryRectangular])
        .contentMarginsDisabled()
    }
}

struct MirSFlrPrimaryPerformanceComplication: Widget {
    let kind = "MirSFlrPrimaryPerformanceComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrPrimaryPerformanceView(entry: entry)
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("MID PRI - primary FTSO")
        .description("Sredinski widget. Live primary FTSO performance. Posebej uporabno za preverjanje primarnega price providerja.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
        .contentMarginsDisabled()
    }
}

struct MirSFlrSecondaryPerformanceComplication: Widget {
    let kind = "MirSFlrSecondaryPerformanceComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrSecondaryPerformanceView(entry: entry)
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("MID SEC - secondary FTSO")
        .description("Sredinski widget. Live secondary FTSO performance. Dober signal, ali backup pot dela normalno.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
        .contentMarginsDisabled()
    }
}

struct MirSFlrAPRComplication: Widget {
    let kind = "MirSFlrAPRComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrAPRView(entry: entry)
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("MID APR - reward rate")
        .description("Sredinski widget. Trenutni FTSO reward rate/APR. Ni alarmni signal, bolj poslovni pogled.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
        .contentMarginsDisabled()
    }
}

struct MirSFlrFDCParticipationComplication: Widget {
    let kind = "MirSFlrFDCParticipationComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrFDCParticipationView(entry: entry)
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("MID FDE - FDC epoch condition")
        .description("Sredinski widget. FDC epoch participation in condition status. Izberi, ce zelis hitro videti ali FDC izpolnjuje reward pogoje.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
        .contentMarginsDisabled()
    }
}

struct MirSFlrEdgeCapacityComplication: Widget {
    let kind = "MirSFlrEdgeFinalV8CapacityComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrCornerPlainMetric(
                title: "CAPACITY",
                value: StatusFormat.percent(entry.status.validator.fillPct, decimals: 0),
                color: WatchTone.capacityFree(entry.status.validator.free)
            )
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("EDGE FINAL CAP - capacity")
        .description("Robni widget. Minimalen prikaz: CAP in velik procent, brez trakov in brez kroga.")
        .supportedFamilies([.accessoryCorner])
        .contentMarginsDisabled()
    }
}

struct MirSFlrEdgeFTSOAvailabilityComplication: Widget {
    let kind = "MirSFlrEdgeFinalV8FTSOAvailabilityComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrCornerPlainMetric(
                title: "FTSO AV",
                value: StatusFormat.percent(entry.status.ftso.availability, decimals: 0),
                color: WatchTone.availability(entry.status.ftso.availability)
            )
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("EDGE FINAL FTSO - availability")
        .description("Robni widget. Minimalen prikaz: FTSO in velik procent, brez trakov in brez kroga.")
        .supportedFamilies([.accessoryCorner])
        .contentMarginsDisabled()
    }
}

struct MirSFlrEdgeFDCAvailabilityComplication: Widget {
    let kind = "MirSFlrEdgeFinalV8FDCAvailabilityComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrCornerPlainMetric(
                title: "FDC AV",
                value: StatusFormat.percent(entry.status.fdc?.availability, decimals: 0),
                color: WatchTone.availability(entry.status.fdc?.availability)
            )
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("EDGE FINAL FDC - availability")
        .description("Robni widget. Minimalen prikaz: FDC in velik procent, brez trakov in brez kroga.")
        .supportedFamilies([.accessoryCorner])
        .contentMarginsDisabled()
    }
}

struct MirSFlrEdgeFTSOWeightComplication: Widget {
    let kind = "MirSFlrEdgeFinalV8FTSOWeightComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrCornerPlainMetric(
                title: "WEIGHT",
                value: StatusFormat.compactBare(entry.status.ftso.weight, decimals: 0),
                color: .pink
            )
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("EDGE FINAL WGT - FTSO weight")
        .description("Robni widget. Minimalen prikaz: WEIGHT in velika kompaktna vrednost, brez trakov in brez kroga.")
        .supportedFamilies([.accessoryCorner])
        .contentMarginsDisabled()
    }
}

struct MirSFlrEdgeEpochComplication: Widget {
    let kind = "MirSFlrEdgeFinalV8EpochComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            let isOk = entry.status.ftso.status == "ok" && (entry.status.fdc?.conditionMet ?? true)
            MirSFlrCornerPlainMetric(
                title: isOk ? "EPOCH" : "WARN",
                value: "E\(entry.status.ftso.signingPolicyEpoch ?? 0)",
                color: isOk ? .green : .pink
            )
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("EDGE FINAL EPO - live epoch")
        .description("Robni widget. Minimalen prikaz: EPOCH/WARN in live epoch, brez trakov in brez kroga.")
        .supportedFamilies([.accessoryCorner])
        .contentMarginsDisabled()
    }
}

struct MirSFlrEdgeFreeSpaceComplication: Widget {
    let kind = "MirSFlrEdgeFinalV8FreeSpaceComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            let free = entry.status.validator.free
            MirSFlrCornerPlainMetric(
                title: "FREE",
                value: StatusFormat.compactBare(free, decimals: 1),
                color: WatchTone.capacityFree(free)
            )
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("EDGE FINAL FREE - headroom")
        .description("Robni widget. Minimalen prikaz: FREE in headroom, brez trakov in brez kroga.")
        .supportedFamilies([.accessoryCorner])
        .contentMarginsDisabled()
    }
}

struct MirSFlrEdgeDelegationComplication: Widget {
    let kind = "MirSFlrEdgeFinalV8DelegationComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            let stake = validatorTotalStake(entry.status.validator)
            MirSFlrCornerPlainMetric(
                title: "DELEG.",
                value: StatusFormat.compactBare(stake, decimals: 0),
                color: .pink
            )
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("EDGE FINAL DEL - delegation")
        .description("Robni widget. Minimalen prikaz: DELEG. in live delegacije, brez trakov in brez kroga.")
        .supportedFamilies([.accessoryCorner])
        .contentMarginsDisabled()
    }
}

struct MirSFlrEdgePrimaryPerformanceComplication: Widget {
    let kind = "MirSFlrEdgeFinalV8PrimaryPerformanceComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrCornerPlainMetric(
                title: "PRIMARY",
                value: StatusFormat.percent(entry.status.ftso.primaryPerformance, decimals: 0),
                color: WatchTone.performance(entry.status.ftso.primaryPerformance)
            )
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("EDGE FINAL PRI - primary performance")
        .description("Robni widget. Minimalen prikaz: PRI in velik procent, brez trakov in brez kroga.")
        .supportedFamilies([.accessoryCorner])
        .contentMarginsDisabled()
    }
}

struct MirSFlrEdgeSecondaryPerformanceComplication: Widget {
    let kind = "MirSFlrEdgeFinalV8SecondaryPerformanceComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrCornerPlainMetric(
                title: "SECOND.",
                value: StatusFormat.percent(entry.status.ftso.secondaryPerformance, decimals: 0),
                color: WatchTone.performance(entry.status.ftso.secondaryPerformance)
            )
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("EDGE FINAL SEC - secondary performance")
        .description("Robni widget. Minimalen prikaz: SEC in velik procent, brez trakov in brez kroga.")
        .supportedFamilies([.accessoryCorner])
        .contentMarginsDisabled()
    }
}

struct MirSFlrEdgeAPRComplication: Widget {
    let kind = "MirSFlrEdgeFinalV8APRComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrCornerPlainMetric(
                title: "APR",
                value: StatusFormat.percent(entry.status.ftso.rewardRate, decimals: 1),
                color: WatchTone.rewardRate(entry.status.ftso.rewardRate)
            )
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("EDGE FINAL APR - reward rate")
        .description("Robni widget. Minimalen prikaz: APR in reward rate, brez trakov in brez kroga.")
        .supportedFamilies([.accessoryCorner])
        .contentMarginsDisabled()
    }
}

struct MirSFlrEdgeFDCParticipationComplication: Widget {
    let kind = "MirSFlrEdgeFinalV8FDCParticipationComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            let participation = entry.status.fdc?.participation
            let conditionMet = entry.status.fdc?.conditionMet ?? false
            MirSFlrCornerPlainMetric(
                title: "FDC EPO",
                value: StatusFormat.percent(participation, decimals: 0),
                color: conditionMet ? WatchTone.performance(participation) : .pink
            )
                .containerBackground(.clear, for: .widget)
                .environment(\.mirFreshness, MirFreshness(entry: entry))
        }
        .configurationDisplayName("EDGE FINAL FDE - FDC epoch")
        .description("Robni widget. Minimalen prikaz: FDE in FDC epoch participation, brez trakov in brez kroga.")
        .supportedFamilies([.accessoryCorner])
        .contentMarginsDisabled()
    }
}
