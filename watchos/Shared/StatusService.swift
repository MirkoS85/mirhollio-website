import Foundation

enum StatusServiceError: Error {
    case notHTTP
    case badStatus(Int)
}

/// Loads the published status feed.
///
/// Deliberately *not* `@MainActor`: nothing here touches UI, and a widget
/// extension's timeline reload runs off the main actor under a tight time
/// budget, so hopping actors only added latency and a chance of being cut off.
final class StatusService {
    static let shared = StatusService()

    private let statusURL = URL(string: "https://www.mirhollio.com/data/watch-status.json")!

    private let cacheURL: URL = {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("mirsflr-watch-status.json")
    }()

    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 10
        config.timeoutIntervalForResource = 15
        return URLSession(configuration: config)
    }()

    /// The last status that decoded successfully, or nil if none was ever stored.
    /// Used instead of `.sample` when a refresh fails, so the face keeps showing
    /// real numbers rather than convincing fake ones.
    var cached: WatchStatus? {
        guard let data = try? Data(contentsOf: cacheURL) else { return nil }
        return try? JSONDecoder().decode(WatchStatus.self, from: data)
    }

    @discardableResult
    func fetch() async throws -> WatchStatus {
        var request = URLRequest(
            url: statusURL,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: 10
        )
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw StatusServiceError.notHTTP
        }
        guard (200..<300).contains(http.statusCode) else {
            throw StatusServiceError.badStatus(http.statusCode)
        }

        let status = try JSONDecoder().decode(WatchStatus.self, from: data)
        try? data.write(to: cacheURL, options: .atomic)
        return status
    }
}
