import SwiftUI
import WatchKit
import WidgetKit

final class MirSFlrExtensionDelegate: NSObject, WKExtensionDelegate {
    private let defaultRefreshInterval: TimeInterval = 5 * 60
    private let activeRefreshInterval: TimeInterval = 2 * 60

    func applicationDidFinishLaunching() {
        scheduleBackgroundRefresh(after: activeRefreshInterval)
    }

    func applicationDidBecomeActive() {
        WidgetReloader.reloadAll()
        Task { await WidgetReloader.reloadAgainSoon() }
        scheduleBackgroundRefresh(after: activeRefreshInterval)
    }

    func applicationWillResignActive() {
        scheduleBackgroundRefresh(after: activeRefreshInterval)
    }

    func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
        for task in backgroundTasks {
            switch task {
            case let refreshTask as WKApplicationRefreshBackgroundTask:
                Task { @MainActor in
                    _ = try? await StatusService.shared.fetch()
                    WidgetReloader.reloadAll()
                    self.scheduleBackgroundRefresh()
                    refreshTask.setTaskCompletedWithSnapshot(false)
                }
            default:
                task.setTaskCompletedWithSnapshot(false)
            }
        }
    }

    private func scheduleBackgroundRefresh(after interval: TimeInterval? = nil) {
        let preferredDate = Date(timeIntervalSinceNow: interval ?? defaultRefreshInterval)
        WKExtension.shared().scheduleBackgroundRefresh(withPreferredDate: preferredDate, userInfo: nil) { error in
            if let error {
                print("MirSFlr background refresh scheduling failed: \(error.localizedDescription)")
            }
        }
    }
}

enum WidgetReloader {
    private static let kinds = [
        "MirSFlrComplications",
        "MirSFlrFDCBarsComplication",
        "MirSFlrFDCBarsLiveV2Complication",
        "MirSFlrDelegationComplication",
        "MirSFlrFTSOAvailabilityComplication",
        "MirSFlrFDCAvailabilityComplication",
        "MirSFlrFTSOPerformanceBandsV2Complication",
        "MirSFlrCapacityComplication",
        "MirSFlrFTSOWeightComplication",
        "MirSFlrEpochComplication",
        "MirSFlrFreeSpaceComplication",
        "MirSFlrPrimaryPerformanceComplication",
        "MirSFlrSecondaryPerformanceComplication",
        "MirSFlrAPRComplication",
        "MirSFlrFDCParticipationComplication",
        "MirSFlrEdgeFinalV8CapacityComplication",
        "MirSFlrEdgeFinalV8FTSOAvailabilityComplication",
        "MirSFlrEdgeFinalV8FDCAvailabilityComplication",
        "MirSFlrEdgeFinalV8FTSOWeightComplication",
        "MirSFlrEdgeFinalV8EpochComplication",
        "MirSFlrEdgeFinalV8FreeSpaceComplication",
        "MirSFlrEdgeFinalV8DelegationComplication",
        "MirSFlrEdgeFinalV8PrimaryPerformanceComplication",
        "MirSFlrEdgeFinalV8SecondaryPerformanceComplication",
        "MirSFlrEdgeFinalV8APRComplication",
        "MirSFlrEdgeFinalV8FDCParticipationComplication"
    ]

    @MainActor
    static func reloadAll() {
        WidgetCenter.shared.reloadAllTimelines()
        for kind in kinds {
            WidgetCenter.shared.reloadTimelines(ofKind: kind)
        }
    }

    @MainActor
    static func reloadAgainSoon() async {
        try? await Task.sleep(for: .seconds(4))
        reloadAll()
    }
}

@main
struct MirSFlrWatchApp: App {
    @WKExtensionDelegateAdaptor(MirSFlrExtensionDelegate.self) private var extensionDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
