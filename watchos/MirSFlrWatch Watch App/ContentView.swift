import SwiftUI
import UserNotifications
import WidgetKit

private enum OpsTone {
    static let pink = Color(red: 1.0, green: 0.22, blue: 0.46)
    static let amber = Color(red: 1.0, green: 0.72, blue: 0.25)
    static let panel = Color.white.opacity(0.08)
    static let border = Color.white.opacity(0.12)

    static func availability(_ value: Double?) -> Color {
        guard let value else { return .secondary }
        let pct = value <= 1 ? value * 100 : value
        if pct >= 98 { return .green }
        if pct >= 95 { return .yellow }
        return .pink
    }

    static func freeSpace(_ value: Double?) -> Color {
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
}

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase

    @State private var status: WatchStatus?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var notificationsAuthorized = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                header

                if let status {
                    opsHero(status)
                    validatorSection(status)
                    delegationsSection(status)
                    alertsSection(status)
                    ftsoSection(status)
                    fdcSection(status)
                    footer(status)
                } else if isLoading {
                    ProgressView("Loading")
                        .frame(maxWidth: .infinity, minHeight: 110)
                } else {
                    Text(errorMessage ?? "No data")
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, minHeight: 110)
                }
            }
            .padding(.vertical, 8)
        }
        .background(Color.black)
        .task {
            await requestNotificationAccess()
            await refresh()
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(90))
                guard !Task.isCancelled, scenePhase == .active else { return }
                await refresh(showLoading: false)
            }
        }
        .refreshable {
            await refresh()
        }
    }

    private var header: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 0) {
                Text("MirSFlr")
                    .font(.system(size: 18, weight: .black, design: .rounded))
                Text("OPS Watch")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(OpsTone.pink)
            }
            Spacer()
            Image(systemName: notificationsAuthorized ? "bell.badge.fill" : "bell.slash.fill")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(notificationsAuthorized ? .green : .secondary)
            Button {
                Task { await refresh() }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 15, weight: .bold))
            }
            .buttonStyle(.borderless)
        }
    }

    private func opsHero(_ status: WatchStatus) -> some View {
        let fill = clamped((status.validator.fillPct ?? 0) / 100)
        let freeColor = OpsTone.freeSpace(status.validator.free)
        let isConnected = status.validator.status.lowercased() == "connected"

        return opsCard(spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        Circle()
                            .fill(isConnected ? .green : .yellow)
                            .frame(width: 7, height: 7)
                        Text(isConnected ? "CONNECTED" : status.validator.status.uppercased())
                            .font(.system(size: 10, weight: .black, design: .rounded))
                            .foregroundStyle(isConnected ? .green : .yellow)
                    }
                    Text("\(StatusFormat.compactBare(status.validator.stake)) / \(StatusFormat.compactBare(status.validator.capacity, decimals: 0)) FLR")
                        .font(.system(size: 15, weight: .black, design: .rounded))
                        .lineLimit(1)
                        .minimumScaleFactor(0.55)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 0) {
                    Text(StatusFormat.percent(status.validator.fillPct))
                        .font(.system(size: 18, weight: .black, design: .rounded))
                        .foregroundStyle(freeColor)
                    Text("FULL")
                        .font(.system(size: 8, weight: .heavy, design: .rounded))
                        .foregroundStyle(.secondary)
                }
            }

            ProgressView(value: fill)
                .tint(freeColor)

            HStack(spacing: 8) {
                miniMetric("FREE", StatusFormat.compactFLR(status.validator.free, decimals: 1), freeColor)
                miniMetric("LIVE DEL", StatusFormat.compactFLR(status.validator.delegation), OpsTone.amber)
            }
        }
    }

    private func validatorSection(_ status: WatchStatus) -> some View {
        opsCard(spacing: 8) {
            sectionHeader("VALIDATOR", sourceBadge(status.sources?.validator), status.validator.status == "connected" ? .green : .yellow)
            LazyVGrid(columns: twoColumns, spacing: 7) {
                metricTile("SELF", StatusFormat.compactFLR(status.validator.selfBond), "operator stake", .white)
                metricTile("DELEG", "\(status.validator.delegationCount ?? 0)", "addresses", OpsTone.amber)
                metricTile("ENDS", daysLeft(from: status.validator.stakeEnd), "stake period", .white)
                metricTile("FREE", StatusFormat.compactFLR(status.validator.free, decimals: 1), "headroom", OpsTone.freeSpace(status.validator.free))
            }
        }
    }

    private func ftsoSection(_ status: WatchStatus) -> some View {
        opsCard(spacing: 8) {
            sectionHeader("FTSO PROVIDER", sourceBadge(status.sources?.ftso), status.ftso.status == "ok" ? .green : .yellow)
            LazyVGrid(columns: twoColumns, spacing: 7) {
                metricTile("WGT", StatusFormat.compactFLR(status.ftso.weight), "live FSE", OpsTone.pink)
                metricTile("STAKED", StatusFormat.compactFLR(status.ftso.stakingWeight), "self + FF", .white)
                metricTile("AVAIL", StatusFormat.percent(status.ftso.availability), "now", OpsTone.availability(status.ftso.availability))
                metricTile("APR", StatusFormat.percent(status.ftso.rewardRate, decimals: 2), "reward rate", OpsTone.amber)
                metricTile("PRI", StatusFormat.percent(status.ftso.primaryPerformance), "primary", OpsTone.performance(status.ftso.primaryPerformance))
                metricTile("SEC", StatusFormat.percent(status.ftso.secondaryPerformance), "secondary", OpsTone.performance(status.ftso.secondaryPerformance))
            }
        }
    }

    private func fdcSection(_ status: WatchStatus) -> some View {
        let fdc = status.fdc
        let ok = fdc?.conditionMet ?? false

        return opsCard(spacing: 8) {
            sectionHeader("FDC", sourceBadge(status.sources?.fdc ?? status.sources?.provider), ok ? .green : OpsTone.pink)
            LazyVGrid(columns: twoColumns, spacing: 7) {
                metricTile("AVAIL", StatusFormat.percent(fdc?.availability), "now", OpsTone.availability(fdc?.availability))
                metricTile("24H", StatusFormat.percent(fdc?.availability24h), "avg", OpsTone.availability(fdc?.availability24h))
                metricTile("EPOCH", StatusFormat.percent(fdc?.participation), ok ? "condition OK" : "warning", ok ? OpsTone.performance(fdc?.participation) : OpsTone.pink)
                metricTile("ROUNDS", roundsText(fdc), "rewarded", .white)
            }
        }
    }

    private func delegationsSection(_ status: WatchStatus) -> some View {
        let top = Array(status.validator.topDelegations.prefix(3))

        return opsCard(spacing: 7) {
            sectionHeader("TOP INPUTS", "live validator", OpsTone.amber)
            if top.isEmpty {
                Text("No delegation rows")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(top.enumerated()), id: \.offset) { index, item in
                    HStack(spacing: 6) {
                        Text("#\(index + 1)")
                            .font(.system(size: 9, weight: .black, design: .rounded))
                            .foregroundStyle(.secondary)
                            .frame(width: 18, alignment: .leading)
                        Text(StatusFormat.compactFLR(item.amount))
                            .font(.system(size: 12, weight: .black, design: .rounded))
                            .lineLimit(1)
                        Spacer()
                        Text(daysLeft(from: item.end))
                            .font(.system(size: 9, weight: .bold, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func alertsSection(_ status: WatchStatus) -> some View {
        let alerts = alertReasons(for: status)

        return opsCard(spacing: 7) {
            sectionHeader("ALERTS", notificationsAuthorized ? "notifications" : "permission", alerts.isEmpty ? .green : OpsTone.pink)
            if alerts.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                    Text("Validator, FTSO and FDC are OK")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            } else {
                ForEach(alerts.prefix(3), id: \.key) { alert in
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 10, weight: .black))
                            .foregroundStyle(OpsTone.pink)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(alert.title)
                                .font(.system(size: 10, weight: .black, design: .rounded))
                                .foregroundStyle(.white)
                            Text(alert.detail)
                                .font(.system(size: 8, weight: .bold, design: .rounded))
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                    }
                }
            }
        }
    }

    private func footer(_ status: WatchStatus) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text("Updated \(StatusFormat.age(from: status.updatedAt))")
                Spacer()
                Text("E\(status.ftso.signingPolicyEpoch ?? 0)")
            }
            if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.yellow)
            }
            if let firstWarning = status.warnings.first {
                Text(firstWarning)
                    .foregroundStyle(.yellow)
            }
        }
        .font(.system(size: 9, weight: .bold, design: .rounded))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 2)
    }

    private var twoColumns: [GridItem] {
        [
            GridItem(.flexible(), spacing: 7),
            GridItem(.flexible(), spacing: 7)
        ]
    }

    private func opsCard<Content: View>(spacing: CGFloat, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: spacing) {
            content()
        }
        .padding(9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(OpsTone.panel)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(OpsTone.border, lineWidth: 1)
        )
    }

    private func sectionHeader(_ title: String, _ source: String, _ color: Color) -> some View {
        HStack(spacing: 6) {
            Text(title)
                .font(.system(size: 11, weight: .black, design: .rounded))
                .foregroundStyle(OpsTone.pink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer()
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
            Text(source.uppercased())
                .font(.system(size: 8, weight: .heavy, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
    }

    private func metricTile(_ label: String, _ value: String, _ detail: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label)
                .font(.system(size: 8, weight: .black, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Text(value)
                .font(.system(size: 13, weight: .black, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.55)
            Text(detail)
                .font(.system(size: 7.5, weight: .bold, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func miniMetric(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label)
                .font(.system(size: 8, weight: .black, design: .rounded))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 12, weight: .black, design: .rounded))
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.55)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func roundsText(_ fdc: WatchStatus.FDC?) -> String {
        guard let rewarded = fdc?.rewardedVotingRounds, let total = fdc?.totalRewardedVotingRounds else {
            return "-"
        }
        return "\(Int(rewarded))/\(Int(total))"
    }

    private func daysLeft(from isoString: String?) -> String {
        guard let isoString, let date = parseDate(isoString) else { return "-" }
        let seconds = max(0, Int(date.timeIntervalSince(Date())))
        if seconds < 3_600 { return "\(seconds / 60)m" }
        if seconds < 86_400 { return "\(seconds / 3_600)h" }
        return "\(seconds / 86_400)d"
    }

    private func sourceBadge(_ source: String?) -> String {
        guard let source else { return "-" }
        if source.contains("flare-systems-explorer") { return "FSE live" }
        if source.contains("live-validator") { return "Val live" }
        if source.contains("live-performance") { return "Perf live" }
        if source.contains("snapshot") { return "Snapshot" }
        return "Live"
    }

    private func clamped(_ value: Double) -> Double {
        max(0, min(value, 1))
    }

    private func parseDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) {
            return date
        }

        let fallback = ISO8601DateFormatter()
        fallback.formatOptions = [.withInternetDateTime]
        return fallback.date(from: value)
    }

    private func requestNotificationAccess() async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        if settings.authorizationStatus == .notDetermined {
            do {
                notificationsAuthorized = try await center.requestAuthorization(options: [.alert, .sound])
            } catch {
                notificationsAuthorized = false
            }
        } else {
            notificationsAuthorized = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
        }
    }

    private func refresh(showLoading: Bool = true) async {
        if showLoading {
            isLoading = true
        }
        errorMessage = nil
        do {
            let newStatus = try await StatusService.shared.fetch()
            status = newStatus
            WidgetReloader.reloadAll()
            Task { await WidgetReloader.reloadAgainSoon() }
            await notifyIfNeeded(for: newStatus)
        } catch {
            let fallbackStatus = StatusService.shared.cachedStatus() ?? status ?? .sample
            status = fallbackStatus
            errorMessage = "Using cached status"
            WidgetReloader.reloadAll()
            Task { await WidgetReloader.reloadAgainSoon() }
            await notifyStatusFetchFailure()
        }
        if showLoading {
            isLoading = false
        }
    }

    private func notifyIfNeeded(for status: WatchStatus) async {
        guard notificationsAuthorized else { return }
        let alerts = alertReasons(for: status)
        guard let first = alerts.first else {
            UserDefaults.standard.removeObject(forKey: "lastAlertSignature")
            return
        }

        let signature = alerts.map(\.key).joined(separator: "|")
        guard UserDefaults.standard.string(forKey: "lastAlertSignature") != signature else { return }
        UserDefaults.standard.set(signature, forKey: "lastAlertSignature")
        await scheduleNotification(title: first.title, body: first.detail)
    }

    private func notifyStatusFetchFailure() async {
        guard notificationsAuthorized else { return }
        let signature = "feed-fetch-failed"
        guard UserDefaults.standard.string(forKey: "lastAlertSignature") != signature else { return }
        UserDefaults.standard.set(signature, forKey: "lastAlertSignature")
        await scheduleNotification(
            title: "MirSFlr feed unreachable",
            body: "Watch app could not load validator, FTSO or FDC status."
        )
    }

    private func scheduleNotification(title: String, body: String) async {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "mirsflr.ops.alert",
            content: content,
            trigger: nil
        )
        try? await UNUserNotificationCenter.current().add(request)
    }

    private func alertReasons(for status: WatchStatus) -> [OpsAlert] {
        var alerts: [OpsAlert] = []

        if let updatedAt = parseDate(status.updatedAt), Date().timeIntervalSince(updatedAt) > 10 * 60 {
            alerts.append(OpsAlert(
                key: "stale-feed",
                title: "MirSFlr feed stale",
                detail: "Status feed is older than 10 minutes."
            ))
        }

        if status.validator.status.lowercased() != "connected" {
            alerts.append(OpsAlert(
                key: "validator-\(status.validator.status.lowercased())",
                title: "Validator disconnected",
                detail: "Validator status is \(status.validator.status.uppercased())."
            ))
        }

        if status.ftso.status.lowercased() != "ok" {
            alerts.append(OpsAlert(
                key: "ftso-status-\(status.ftso.status.lowercased())",
                title: "FTSO status warning",
                detail: "FTSO provider status is \(status.ftso.status.uppercased())."
            ))
        }

        if percentValue(status.ftso.availability) < 95 {
            alerts.append(OpsAlert(
                key: "ftso-availability",
                title: "FTSO availability low",
                detail: "FTSO availability is \(StatusFormat.percent(status.ftso.availability))."
            ))
        }

        if status.fdc?.status.lowercased() != "ok" {
            alerts.append(OpsAlert(
                key: "fdc-status-\((status.fdc?.status ?? "missing").lowercased())",
                title: "FDC status warning",
                detail: "FDC status is \((status.fdc?.status ?? "missing").uppercased())."
            ))
        }

        if status.fdc?.conditionMet == false {
            alerts.append(OpsAlert(
                key: "fdc-condition",
                title: "FDC condition failed",
                detail: "FDC epoch participation condition is not met."
            ))
        }

        if percentValue(status.fdc?.availability) < 95 {
            alerts.append(OpsAlert(
                key: "fdc-availability",
                title: "FDC availability low",
                detail: "FDC availability is \(StatusFormat.percent(status.fdc?.availability))."
            ))
        }

        return alerts
    }

    private func percentValue(_ value: Double?) -> Double {
        guard let value else { return 0 }
        return value <= 1 ? value * 100 : value
    }
}

private struct OpsAlert {
    let key: String
    let title: String
    let detail: String
}
