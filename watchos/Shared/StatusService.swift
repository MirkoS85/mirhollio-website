import Foundation

enum StatusServiceError: Error {
    case badResponse
}

actor StatusService {
    static let shared = StatusService()

    private let statusURL = URL(string: "https://www.mirhollio.com/data/watch-status.json")!

    func fetch() async throws -> WatchStatus {
        var request = URLRequest(
            url: statusURL,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: 10
        )
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw StatusServiceError.badResponse
        }
        return try JSONDecoder().decode(WatchStatus.self, from: data)
    }
}
