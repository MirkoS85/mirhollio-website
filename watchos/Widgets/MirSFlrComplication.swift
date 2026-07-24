import SwiftUI
import WidgetKit

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
            let refresh = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date().addingTimeInterval(900)
            completion(Timeline(entries: [entry], policy: .after(refresh)))
        }
    }
}

struct MirSFlrComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MirSFlrEntry

    var body: some View {
        switch family {
        case .accessoryCircular, .accessoryCorner:
            circular
        case .accessoryInline:
            inline
        default:
            rectangular
        }
    }

    private var circular: some View {
        let fill = max(0, min((entry.status.validator.fillPct ?? 0) / 100, 1))

        return Gauge(value: fill) {
            Text("M")
        } currentValueLabel: {
            Text(StatusFormat.percent(entry.status.validator.fillPct, decimals: 0))
                .font(.system(size: 13, weight: .bold))
        }
        .gaugeStyle(.accessoryCircular)
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("MirSFlr")
                .font(.headline)
            Text("\(StatusFormat.compactBare(entry.status.validator.stake)) / 90M")
            Text("Free \(StatusFormat.compactBare(entry.status.validator.free, decimals: 0))")
                .foregroundStyle((entry.status.validator.free ?? 0) < 1_000_000 ? .pink : .green)
        }
    }

    private var inline: some View {
        Text("MirSFlr \(StatusFormat.percent(entry.status.validator.fillPct)) full")
    }
}

@main
struct MirSFlrComplication: Widget {
    let kind = "MirSFlrComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MirSFlrProvider()) { entry in
            MirSFlrComplicationView(entry: entry)
        }
        .configurationDisplayName("MirSFlr")
        .description("Validator stake, free space, and FTSO status.")
        .supportedFamilies([
            .accessoryCircular,
            .accessoryRectangular,
            .accessoryInline,
            .accessoryCorner
        ])
    }
}
