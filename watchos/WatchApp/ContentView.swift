import SwiftUI

struct ContentView: View {
    @State private var status: WatchStatus?
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                header

                if let status {
                    validatorBlock(status)
                    ftsoBlock(status)
                    footer(status)
                } else if isLoading {
                    ProgressView("Loading")
                } else {
                    Text(errorMessage ?? "No data")
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 8)
        }
        .task {
            await refresh()
        }
        .refreshable {
            await refresh()
        }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("MirSFlr")
                    .font(.headline)
                Text("Validator")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                Task { await refresh() }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.borderless)
        }
    }

    private func validatorBlock(_ status: WatchStatus) -> some View {
        let fill = max(0, min((status.validator.fillPct ?? 0) / 100, 1))

        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(status.validator.status.capitalized)
                    .foregroundStyle(status.validator.status == "connected" ? .green : .yellow)
                Spacer()
                Text(StatusFormat.percent(status.validator.fillPct))
                    .fontWeight(.semibold)
            }

            ProgressView(value: fill)
                .tint(fill > 0.985 ? .pink : .green)

            Text("\(StatusFormat.compactFLR(status.validator.stake)) / \(StatusFormat.compactFLR(status.validator.capacity, decimals: 0))")
                .font(.caption)

            Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 6) {
                GridRow {
                    metric("Free", StatusFormat.compactFLR(status.validator.free))
                    metric("Live del.", StatusFormat.compactFLR(status.validator.delegation))
                }
                GridRow {
                    metric("Self-bond", StatusFormat.compactFLR(status.validator.selfBond))
                    metric("Delegators", "\(status.validator.delegationCount ?? 0)")
                }
            }
        }
        .padding(.vertical, 6)
    }

    private func ftsoBlock(_ status: WatchStatus) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(status.summary.ftsoLabel ?? "FTSO")
                    .fontWeight(.semibold)
                Spacer()
                Text(status.ftso.status.uppercased())
                    .foregroundStyle(status.ftso.status == "ok" ? .green : .yellow)
            }

            Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 6) {
                GridRow {
                    metric("Weight", StatusFormat.compactFLR(status.ftso.weight))
                    metric("Deleg.", StatusFormat.compactFLR(status.ftso.delegatedWeight))
                }
                GridRow {
                    metric("Stake wt.", StatusFormat.compactFLR(status.ftso.stakingWeight))
                    metric("Fee", feeText(status.ftso.delegationFeeBips))
                }
            }
        }
        .padding(.vertical, 6)
    }

    private func footer(_ status: WatchStatus) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("Updated \(StatusFormat.age(from: status.updatedAt))")
            if let firstWarning = status.warnings.first {
                Text(firstWarning)
                    .foregroundStyle(.yellow)
            }
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
    }

    private func metric(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label.uppercased())
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption)
                .fontWeight(.semibold)
        }
    }

    private func feeText(_ bips: Int?) -> String {
        guard let bips else { return "-" }
        return StatusFormat.percent(Double(bips) / 100)
    }

    private func refresh() async {
        isLoading = true
        errorMessage = nil
        do {
            status = try await StatusService.shared.fetch()
        } catch {
            errorMessage = "Status unavailable"
        }
        isLoading = false
    }
}
