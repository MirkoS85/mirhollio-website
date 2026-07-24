import Foundation

struct WatchStatus: Codable, Equatable {
    let schema: String
    let generatedAt: String
    let updatedAt: String
    let provider: Provider
    let summary: Summary
    let validator: Validator
    let ftso: FTSO
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
        let availability: Double?
    }

    struct Sources: Codable, Equatable {
        let provider: String?
        let validator: String?
        let ftso: String?
    }
}

extension WatchStatus {
    static let sample = WatchStatus(
        schema: "mirsflr-watch-status/v1",
        generatedAt: "2026-07-24T19:59:23.221Z",
        updatedAt: "2026-07-24T19:59:23.221Z",
        provider: Provider(
            name: "MirSFlr",
            voterAddress: "0xb5a081dec72c8c87256b7e14cfadcbc342bdeac3",
            delegationAddress: "0xad9105bef5e5df2eacbe2de9037a96695b00cade",
            nodeId: "NodeID-8dNfgpspPNDrZD2ksKCRJoGe4Xqe6qVtz"
        ),
        summary: Summary(
            validatorLabel: "99.6% full",
            ftsoLabel: "FTSO E418"
        ),
        validator: Validator(
            status: "connected",
            stake: 89_663_081,
            capacity: 90_000_000,
            fillPct: 99.6256,
            free: 336_919,
            delegation: 83_663_081,
            selfBond: 6_000_000,
            delegationCount: 12,
            stakeEnd: "2026-10-19T10:00:00Z",
            topDelegations: []
        ),
        ftso: FTSO(
            status: "ok",
            latestCompletedEpoch: 417,
            signingPolicyEpoch: 418,
            weight: 21_463_183.597,
            delegatedWeight: 103_643.597,
            cappedDelegatedWeight: 103_643.597,
            stakingWeight: 21_359_540,
            delegationFeeBips: 2000,
            rewardRate: 2.5367,
            performance: nil,
            availability: nil
        ),
        sources: Sources(
            provider: "oracle-daemon-v2",
            validator: "oracle-daemon-v1",
            ftso: "flare-systems-explorer"
        ),
        warnings: []
    )
}
