import Foundation

struct WatchStatus: Codable, Equatable {
    let schema: String
    let generatedAt: String
    let updatedAt: String
    let provider: Provider
    let summary: Summary
    let validator: Validator
    let ftso: FTSO
    let fdc: FDC?
    let sources: Sources?
    let warnings: [String]

    struct Provider: Codable, Equatable {
        let name: String
        let voterAddress: String
        let delegationAddress: String
        let nodeId: String
    }

    struct Summary: Codable, Equatable {
        let validatorLabel: String?
        let ftsoLabel: String?
    }

    struct Validator: Codable, Equatable {
        let status: String
        let stake: Double?
        let capacity: Double?
        let fillPct: Double?
        let free: Double?
        let delegation: Double?
        let selfBond: Double?
        let delegationCount: Int?
        let stakeEnd: String?
        let topDelegations: [Delegation]
    }

    struct Delegation: Codable, Equatable, Identifiable {
        var id: String {
            [
                address ?? "unknown",
                String(Int(amount ?? 0)),
                start ?? "",
                end ?? ""
            ].joined(separator: "-")
        }

        let address: String?
        let amount: Double?
        let start: String?
        let end: String?
    }

    struct FTSO: Codable, Equatable {
        let status: String
        let latestCompletedEpoch: Int?
        let signingPolicyEpoch: Int?
        let weight: Double?
        let delegatedWeight: Double?
        let cappedDelegatedWeight: Double?
        let stakingWeight: Double?
        let delegationFeeBips: Int?
        let rewardRate: Double?
        let performance: Double?
        let primaryPerformance: Double?
        let secondaryPerformance: Double?
        let performanceHourly24h: [Double]?
        let primaryPerformanceHourly24h: [Double]?
        let secondaryPerformanceHourly24h: [Double]?
        let availability: Double?
        let availability6h: Double?
        let availability24h: Double?
        let availabilityHourly24h: [Double]?
    }

    struct FDC: Codable, Equatable {
        let status: String
        let availability: Double?
        let availability6h: Double?
        let availability24h: Double?
        let availabilityHourly24h: [Double]?
        let participation: Double?
        let conditionMet: Bool?
        let rewardedVotingRounds: Double?
        let totalRewardedVotingRounds: Double?
    }

    struct Sources: Codable, Equatable {
        let provider: String?
        let validator: String?
        let ftso: String?
        let fdc: String?
    }
}

extension WatchStatus {
    static let sample = WatchStatus(
        schema: "mirsflr-watch-status/v1",
        generatedAt: "2026-07-26T11:58:25.820Z",
        updatedAt: "2026-07-26T11:58:25.820Z",
        provider: Provider(
            name: "MirSFlr",
            voterAddress: "0xb5a081dec72c8c87256b7e14cfadcbc342bdeac3",
            delegationAddress: "0xad9105bef5e5df2eacbe2de9037a96695b00cade",
            nodeId: "NodeID-8dNfgpspPNDrZD2ksKCRJoGe4Xqe6qVtz"
        ),
        summary: Summary(
            validatorLabel: "100.0% full",
            ftsoLabel: "FTSO E418"
        ),
        validator: Validator(
            status: "connected",
            stake: 89_993_340,
            capacity: 90_000_000,
            fillPct: 99.9926,
            free: 6_660,
            delegation: 83_993_340,
            selfBond: 6_000_000,
            delegationCount: 13,
            stakeEnd: "2026-10-19T10:00:00Z",
            topDelegations: []
        ),
        ftso: FTSO(
            status: "ok",
            latestCompletedEpoch: 417,
            signingPolicyEpoch: 418,
            weight: 21_463_183.597250707,
            delegatedWeight: 103_643.59725070628,
            cappedDelegatedWeight: 103_643.59725070628,
            stakingWeight: 21_359_539.999999996,
            delegationFeeBips: 2000,
            rewardRate: 2.5366954759974143,
            performance: 0.7430657121104521,
            primaryPerformance: 0.47716294632860534,
            secondaryPerformance: 0.9203342226316833,
            performanceHourly24h: [
                0.736, 0.740, 0.738, 0.740, 0.707, 0.746,
                0.747, 0.749, 0.741, 0.739, 0.742, 0.738,
                0.742, 0.736, 0.711, 0.725, 0.748, 0.741,
                0.735, 0.745, 0.758, 0.745, 0.739, 0.733
            ],
            primaryPerformanceHourly24h: [
                0.367, 0.378, 0.367, 0.369, 0.343, 0.380,
                0.392, 0.379, 0.381, 0.368, 0.403, 0.382,
                0.382, 0.358, 0.332, 0.362, 0.388, 0.387,
                0.375, 0.378, 0.409, 0.382, 0.372, 0.352
            ],
            secondaryPerformanceHourly24h: [
                0.983, 0.981, 0.986, 0.987, 0.949, 0.989,
                0.984, 0.995, 0.980, 0.986, 0.967, 0.976,
                0.983, 0.987, 0.964, 0.967, 0.988, 0.978,
                0.974, 0.990, 0.991, 0.986, 0.983, 0.987
            ],
            availability: 1,
            availability6h: 1,
            availability24h: 1,
            availabilityHourly24h: Array(repeating: 1, count: 24)
        ),
        fdc: FDC(
            status: "ok",
            availability: 0.9812167757819932,
            availability6h: 0.9788377192982457,
            availability24h: 0.9834175031982051,
            availabilityHourly24h: [
                0.982, 0.958, 0.994, 0.979, 0.987, 0.994,
                0.983, 0.994, 0.966, 0.991, 0.981, 0.950,
                0.988, 0.978, 0.977, 0.993, 0.994, 0.972,
                0.934, 0.981, 0.987, 0.950, 0.980, 0.993
            ],
            participation: 92.5,
            conditionMet: true,
            rewardedVotingRounds: 3108,
            totalRewardedVotingRounds: 3360
        ),
        sources: Sources(
            provider: "oracle-daemon-v2-live-performance",
            validator: "oracle-daemon-v1-live-validator",
            ftso: "flare-systems-explorer-live-signing-policy",
            fdc: "oracle-daemon-v2-live-performance"
        ),
        warnings: []
    )
}
