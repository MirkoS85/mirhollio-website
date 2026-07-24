import WidgetKit
import SwiftUI

struct MirSFlrEntry: TimelineEntry {
    let date: Date
    let status: WatchStatus
}

struct MirSFlrProvider: TimelineProvider {
    func placeholder(in context: Context) -> MirSFlrEntry {
        MirSFlrEntry(date: Date(), status: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (MirSFlrEntry) -> Void) {
        completion(MirSFlrEntry(date: Date(), status: .sample))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<MirSFlrEntry>) -> Void) {
        Task {
            let status = (try? await StatusService.shared.fetch()) ?? .sample
            let entry = MirSFlrEntry(date: Date(), status: status)
            let refreshDate = Calendar.current.date(byAdding: .minute, value: 5, to: Date()) ?? Date().addingTimeInterval(300)
            completion(Timeline(entries: [entry], policy: .after(refreshDate)))
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
}

private func clampedRatio(_ value: Double?) -> Double {
    guard let value else { return 0 }
    let normalized = value <= 1 ? value : value / 100
    return max(0, min(normalized, 1))
}

struct MirSFlrCapacityView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MirSFlrEntry

    var body: some View {
        switch family {
        case .accessoryCircular, .accessoryCorner:
            Gauge(value: clampedRatio(entry.status.validator.fillPct)) {
                Text("CAP")
            } currentValueLabel: {
                Text(StatusFormat.percent(entry.status.validator.fillPct, decimals: 0))
                    .font(.system(size: 13, weight: .bold))
            }
            .gaugeStyle(.accessoryCircular)
        case .accessoryInline:
            Text("MirSFlr \(StatusFormat.percent(entry.status.validator.fillPct)) full")
        default:
            VStack(alignment: .leading, spacing: 2) {
                Text("Capacity").font(.headline)
                Text("\(StatusFormat.compactBare(entry.status.validator.stake)) / 90M")
                Text("Free \(StatusFormat.compactBare(entry.status.validator.free, decimals: 0))")
                    .foregroundStyle(WatchTone.capacityFree(entry.status.validator.free))
            }
            .containerBackground(.fill.tertiary, for: .widget)
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
            Gauge(value: clampedRatio(availability)) {
                Text("FTSO")
            } currentValueLabel: {
                Text(StatusFormat.percent(availability, decimals: 0))
                    .font(.system(size: 13, weight: .bold))
            }
            .gaugeStyle(.accessoryCircular)
            .tint(WatchTone.availability(availability))
        case .accessoryInline:
            Text("FTSO avail \(StatusFormat.percent(availability))")
        default:
            VStack(alignment: .leading, spacing: 2) {
                Text("FTSO live").font(.headline)
                Text(StatusFormat.percent(availability, decimals: 1))
                    .foregroundStyle(WatchTone.availability(availability))
                Text("Perf \(StatusFormat.percent(entry.status.ftso.performance, decimals: 1))")
            }
            .containerBackground(.fill.tertiary, for: .widget)
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
            Gauge(value: clampedRatio(availability)) {
                Text("FDC")
            } currentValueLabel: {
                Text(StatusFormat.percent(availability, decimals: 0))
                    .font(.system(size: 13, weight: .bold))
            }
            .gaugeStyle(.accessoryCircular)
            .tint(WatchTone.availability(availability))
        case .accessoryInline:
            Text("FDC avail \(StatusFormat.percent(availability))")
        default:
            VStack(alignment: .leading, spacing: 2) {
                Text("FDC live").font(.headline)
                Text(StatusFormat.percent(availability, decimals: 1))
                    .foregroundStyle(WatchTone.availability(availability))
                Text("Epoch \(StatusFormat.percent(fdc?.participation, decimals: 1))")
            }
            .containerBackground(.fill.tertiary, for: .widget)
        }
    }
}

struct MirSFlrFTSOWeightView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MirSFlrEntry

    var body: some View {
        switch family {
        case .accessoryCircular, .accessoryCorner:
            VStack(spacing: 0) {
                Text("W")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                Text(StatusFormat.compactBare(entry.status.ftso.weight, decimals: 0))
                    .font(.system(size: 13, weight: .bold))
                    .minimumScaleFactor(0.7)
            }
        case .accessoryInline:
            Text("FTSO weight \(StatusFormat.compactBare(entry.status.ftso.weight))")
        default:
            VStack(alignment: .leading, spacing: 2) {
                Text("FTSO weight").font(.headline)
                Text(StatusFormat.compactFLR(entry.status.ftso.weight))
                    .foregroundStyle(.pink)
                Text("Live FSE E\(entry.status.ftso.signingPolicyEpoch ?? 0)")
            }
            .containerBackground(.fill.tertiary, for: .widget)
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
            VStack(spacing: 0) {
                Text(isOk ? "OK" : "WARN")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(isOk ? .green : .pink)
                Text("E\(entry.status.ftso.signingPolicyEpoch ?? 0)")
                    .font(.system(size: 10, weight: .semibold))
            }
        case .accessoryInline:
            Text("MirSFlr E\(entry.status.ftso.signingPolicyEpoch ?? 0) \(isOk ? "OK" : "WARN")")
        default:
            VStack(alignment: .leading, spacing: 2) {
                Text("Reward epoch").font(.headline)
                Text("Live E\(entry.status.ftso.signingPolicyEpoch ?? 0)")
                    .foregroundStyle(isOk ? .green : .pink)
                Text("Completed E\(entry.status.ftso.latestCompletedEpoch ?? 0)")
            }
            .containerBackground(.fill.tertiary, for: .widget)
        }
    }
}

struct MirSFlrCapacityComplication: Widget {
    let kind = "MirSFlrCapacityComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrCapacityView(entry: entry)
        }
        .configurationDisplayName("MirSFlr capacity")
        .description("Live validator stake and remaining delegation space.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
    }
}

struct MirSFlrFTSOAvailabilityComplication: Widget {
    let kind = "MirSFlrFTSOAvailabilityComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrFTSOAvailabilityView(entry: entry)
        }
        .configurationDisplayName("MirSFlr FTSO live")
        .description("Live FTSO availability and performance.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
    }
}

struct MirSFlrFDCAvailabilityComplication: Widget {
    let kind = "MirSFlrFDCAvailabilityComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrFDCAvailabilityView(entry: entry)
        }
        .configurationDisplayName("MirSFlr FDC live")
        .description("Live FDC availability and epoch participation.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
    }
}

struct MirSFlrFTSOWeightComplication: Widget {
    let kind = "MirSFlrFTSOWeightComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrFTSOWeightView(entry: entry)
        }
        .configurationDisplayName("MirSFlr weight")
        .description("Live FTSO signing-policy weight from Flare Systems Explorer.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
    }
}

struct MirSFlrEpochComplication: Widget {
    let kind = "MirSFlrEpochComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrEpochView(entry: entry)
        }
        .configurationDisplayName("MirSFlr epoch")
        .description("Live signing-policy epoch and reward status.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
    }
}

#Preview(as: .accessoryRectangular) {
    MirSFlrFTSOWeightComplication()
} timeline: {
    MirSFlrEntry(date: .now, status: .sample)
}
