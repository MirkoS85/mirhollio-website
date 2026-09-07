import Foundation

enum StatusServiceError: Error {
    case badResponse
    case noData
}

@MainActor
final class StatusService {
    static let shared = StatusService()

    // The site's own feed leads: it is the one this project controls, is
    // regenerated every five minutes by CI, and is served from the same host
    // the rest of the product depends on. The scratch host stays as a backup.
    private let liveStatusURL = URL(string: "https://www.mirhollio.com/data/watch-status.json")!
    private let fallbackStatusURLs = [
        URL(string: "https://mirhollio.com/data/watch-status.json")!,
        URL(string: "https://mirsflr-live-status.svensekmir.chatgpt.site/watch-status.json")!
    ]
    private let livePerformanceURL = URL(string: "https://api.oracle-daemon.com/v2/flare/providers")!
    private let cacheKey = "mirsflr.watchStatus.lastGood"
    private let targetVoter = "0xb5a081dec72c8c87256b7e14cfadcbc342bdeac3"
    private let targetDelegation = "0xad9105bef5e5df2eacbe2de9037a96695b00cade"

    func fetch() async throws -> WatchStatus {
        var lastError: Error?

        do {
            let status = try await fetch(from: cacheBusted(liveStatusURL))
            cache(status)
            return status
        } catch {
            lastError = error
        }

        for url in fallbackStatusURLs {
            do {
                let status = try await fetch(from: cacheBusted(url))
                cache(status)
                return status
            } catch {
                lastError = error
            }
        }

        if let cachedStatus = cached() {
            return cachedStatus
        }

        throw lastError ?? StatusServiceError.noData
    }

    func cachedStatus() -> WatchStatus? {
        cached()
    }

    private func cacheBusted(_ url: URL, date: Date = Date()) -> URL {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        let minuteBucket = Int(date.timeIntervalSince1970 / 60)
        components.queryItems = [URLQueryItem(name: "t", value: String(minuteBucket))]
        return components.url ?? url
    }

    private func fetch(from url: URL) async throws -> WatchStatus {
        var request = URLRequest(
            url: url,
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

    private func withLivePerformance(_ status: WatchStatus) async -> WatchStatus {
        guard let live = try? await fetchLivePerformance() else { return status }
        return merge(status, live: live)
    }

    private struct LivePerformance {
        let ftsoAvailability: Double?
        let ftsoAvailabilityHourly: [Double]
        let performance: Double?
        let performanceHourly: [Double]
        let primaryPerformance: Double?
        let primaryPerformanceHourly: [Double]
        let secondaryPerformance: Double?
        let secondaryPerformanceHourly: [Double]
        let fdcAvailability: Double?
        let fdcAvailabilityHourly: [Double]
    }

    private func fetchLivePerformance() async throws -> LivePerformance {
        var request = URLRequest(
            url: livePerformanceURL,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: 10
        )
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("MirSFlrWatch/1.0", forHTTPHeaderField: "User-Agent")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw StatusServiceError.badResponse
        }

        let root = try JSONSerialization.jsonObject(with: data)
        guard let provider = findMirProvider(in: root) else {
            throw StatusServiceError.noData
        }

        let ftso = provider["ftsoPerformance"] as? [String: Any]
        let fdc = provider["fdcPerformance"] as? [String: Any]

        return LivePerformance(
            ftsoAvailability: number(ftso?["availability"]),
            ftsoAvailabilityHourly: Array(numberArray(ftso?["availability1h"]).suffix(24)),
            performance: number(ftso?["performance"]),
            performanceHourly: Array(numberArray(ftso?["performance1h"]).suffix(24)),
            primaryPerformance: number(ftso?["performance1"]),
            primaryPerformanceHourly: Array(numberArray(ftso?["performance1_1h"]).suffix(24)),
            secondaryPerformance: number(ftso?["performance2"]),
            secondaryPerformanceHourly: Array(numberArray(ftso?["performance2_1h"]).suffix(24)),
            fdcAvailability: number(fdc?["availability"]),
            fdcAvailabilityHourly: Array(numberArray(fdc?["availability1h"]).suffix(24))
        )
    }

    private func merge(_ status: WatchStatus, live: LivePerformance) -> WatchStatus {
        let previousFTSO = status.ftso
        let ftsoAvailabilityHourly = live.ftsoAvailabilityHourly.isEmpty ? previousFTSO.availabilityHourly24h ?? [] : live.ftsoAvailabilityHourly
        let performanceHourly = live.performanceHourly.isEmpty ? previousFTSO.performanceHourly24h ?? [] : live.performanceHourly
        let primaryHourly = live.primaryPerformanceHourly.isEmpty ? previousFTSO.primaryPerformanceHourly24h ?? [] : live.primaryPerformanceHourly
        let secondaryHourly = live.secondaryPerformanceHourly.isEmpty ? previousFTSO.secondaryPerformanceHourly24h ?? [] : live.secondaryPerformanceHourly

        let ftso = WatchStatus.FTSO(
            status: previousFTSO.status,
            latestCompletedEpoch: previousFTSO.latestCompletedEpoch,
            signingPolicyEpoch: previousFTSO.signingPolicyEpoch,
            weight: previousFTSO.weight,
            delegatedWeight: previousFTSO.delegatedWeight,
            cappedDelegatedWeight: previousFTSO.cappedDelegatedWeight,
            stakingWeight: previousFTSO.stakingWeight,
            delegationFeeBips: previousFTSO.delegationFeeBips,
            rewardRate: previousFTSO.rewardRate,
            performance: live.performance ?? performanceHourly.last ?? previousFTSO.performance,
            primaryPerformance: live.primaryPerformance ?? primaryHourly.last ?? previousFTSO.primaryPerformance,
            secondaryPerformance: live.secondaryPerformance ?? secondaryHourly.last ?? previousFTSO.secondaryPerformance,
            performanceHourly24h: performanceHourly.isEmpty ? previousFTSO.performanceHourly24h : performanceHourly,
            primaryPerformanceHourly24h: primaryHourly.isEmpty ? previousFTSO.primaryPerformanceHourly24h : primaryHourly,
            secondaryPerformanceHourly24h: secondaryHourly.isEmpty ? previousFTSO.secondaryPerformanceHourly24h : secondaryHourly,
            availability: live.ftsoAvailability ?? ftsoAvailabilityHourly.last ?? previousFTSO.availability,
            availability6h: recentAverage(ftsoAvailabilityHourly, hours: 6) ?? previousFTSO.availability6h,
            availability24h: recentAverage(ftsoAvailabilityHourly, hours: 24) ?? previousFTSO.availability24h,
            availabilityHourly24h: ftsoAvailabilityHourly.isEmpty ? previousFTSO.availabilityHourly24h : ftsoAvailabilityHourly
        )

        let previous = status.fdc
        let hourly = live.fdcAvailabilityHourly.isEmpty ? previous?.availabilityHourly24h ?? [] : live.fdcAvailabilityHourly
        let availability = live.fdcAvailability ?? hourly.last ?? previous?.availability
        let fdc = WatchStatus.FDC(
            status: previous?.status ?? "ok",
            availability: availability,
            availability6h: recentAverage(hourly, hours: 6) ?? previous?.availability6h,
            availability24h: recentAverage(hourly, hours: 24) ?? previous?.availability24h,
            availabilityHourly24h: hourly.isEmpty ? previous?.availabilityHourly24h : hourly,
            participation: previous?.participation,
            conditionMet: previous?.conditionMet,
            rewardedVotingRounds: previous?.rewardedVotingRounds,
            totalRewardedVotingRounds: previous?.totalRewardedVotingRounds
        )
        let sources = WatchStatus.Sources(
            provider: status.sources?.provider,
            validator: status.sources?.validator,
            ftso: status.sources?.ftso,
            fdc: "oracle-daemon-v2-live-performance"
        )

        return WatchStatus(
            schema: status.schema,
            generatedAt: status.generatedAt,
            updatedAt: ISO8601DateFormatter().string(from: Date()),
            provider: status.provider,
            summary: status.summary,
            validator: status.validator,
            ftso: ftso,
            fdc: fdc,
            sources: sources,
            warnings: status.warnings
        )
    }

    private func recentAverage(_ values: [Double], hours: Int) -> Double? {
        let slice = Array(values.suffix(hours))
        guard !slice.isEmpty else { return nil }
        return slice.reduce(0, +) / Double(slice.count)
    }

    private func findMirProvider(in value: Any) -> [String: Any]? {
        if let dict = value as? [String: Any] {
            if isMirProvider(dict) { return dict }
            for child in dict.values {
                if let match = findMirProvider(in: child) { return match }
            }
        } else if let array = value as? [Any] {
            for child in array {
                if let match = findMirProvider(in: child) { return match }
            }
        }
        return nil
    }

    private func isMirProvider(_ dict: [String: Any]) -> Bool {
        let voter = normalized(dict["voterAddress"] ?? dict["m_sVoterAddress"] ?? dict["address"])
        let delegation = normalized(dict["delegationAddress"] ?? dict["m_sDelegationAddress"])
        let name = normalized(dict["dataProviderName"] ?? dict["name"] ?? dict["m_sName"])
        return voter == targetVoter || delegation == targetDelegation || name.contains("mirsflr")
    }

    private func normalized(_ value: Any?) -> String {
        String(describing: value ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
    }

    private func numberArray(_ value: Any?) -> [Double] {
        guard let array = value as? [Any] else { return [] }
        return array.compactMap(number)
    }

    private func number(_ value: Any?) -> Double? {
        if let number = value as? NSNumber { return number.doubleValue }
        if let string = value as? String { return Double(string) }
        return nil
    }

    private func cache(_ status: WatchStatus) {
        guard let data = try? JSONEncoder().encode(status) else { return }
        UserDefaults.standard.set(data, forKey: cacheKey)
    }

    private func cached() -> WatchStatus? {
        guard let data = UserDefaults.standard.data(forKey: cacheKey) else { return nil }
        return try? JSONDecoder().decode(WatchStatus.self, from: data)
    }
}
