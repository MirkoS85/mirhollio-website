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
                    WidgetReloader.reloadAll(force: true)
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
    /// WidgetKit hands a complication only a few dozen timeline reloads a day
    /// and spends one whether or not the request was useful. Past that it
    /// throttles, then stops refreshing altogether - which looks exactly like a
    /// frozen complication, the very thing these calls exist to prevent.
    ///
    /// This used to call reloadAllTimelines() and then loop over all 26 kinds,
    /// so every installed complication was asked to reload twice; becoming
    /// active did that, then did it again four seconds later, for four requests
    /// per app open where one does the same work. reloadAllTimelines() already
    /// covers every widget this app vends, so the loop was pure duplication.
    @MainActor private static var lastReload = Date.distantPast
    private static let minimumInterval: TimeInterval = 60

    /// - Parameter force: skip the coalescing window. Pass it when genuinely new
    ///   data has just been fetched; leave it off for UI events such as the app
    ///   becoming active, which a user can trigger repeatedly.
    @MainActor
    static func reloadAll(force: Bool = false) {
        let now = Date()
        guard force || now.timeIntervalSince(lastReload) >= minimumInterval else { return }
        lastReload = now
        WidgetCenter.shared.reloadAllTimelines()
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
