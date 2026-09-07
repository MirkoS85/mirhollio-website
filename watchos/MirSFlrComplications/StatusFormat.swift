import Foundation

enum StatusFormat {
    static func compactFLR(_ value: Double?, decimals: Int = 2) -> String {
        guard let value else { return "-" }
        let absValue = abs(value)
        if absValue >= 1_000_000_000 {
            return "\(fixed(value / 1_000_000_000, decimals: decimals))B FLR"
        }
        if absValue >= 1_000_000 {
            return "\(fixed(value / 1_000_000, decimals: decimals))M FLR"
        }
        if absValue >= 1_000 {
            return "\(fixed(value / 1_000, decimals: decimals))K FLR"
        }
        return "\(fixed(value, decimals: 0)) FLR"
    }

    static func compactBare(_ value: Double?, decimals: Int = 1) -> String {
        guard let value else { return "-" }
        let absValue = abs(value)
        if absValue >= 1_000_000_000 {
            return "\(fixed(value / 1_000_000_000, decimals: decimals))B"
        }
        if absValue >= 1_000_000 {
            return "\(fixed(value / 1_000_000, decimals: decimals))M"
        }
        if absValue >= 1_000 {
            return "\(fixed(value / 1_000, decimals: decimals))K"
        }
        return fixed(value, decimals: 0)
    }

    static func percent(_ value: Double?, decimals: Int = 1) -> String {
        guard let value else { return "-" }
        let pct = value <= 1 ? value * 100 : value
        return "\(fixed(pct, decimals: decimals))%"
    }

    static func compactAge(from isoString: String, now: Date = Date()) -> String {
        let seconds = ageSeconds(from: isoString, now: now)
        guard seconds >= 0 else { return "-" }
        if seconds < 60 { return "\(max(1, seconds))s" }
        if seconds < 3_600 { return "\(seconds / 60)m" }
        return "\(seconds / 3_600)h"
    }

    static func ageSeconds(from isoString: String, now: Date = Date()) -> Int {
        guard let date = parseDate(isoString) else { return -1 }
        return max(0, Int(now.timeIntervalSince(date)))
    }

    private static func fixed(_ value: Double, decimals: Int) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    private static func parseDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) {
            return date
        }

        let fallback = ISO8601DateFormatter()
        fallback.formatOptions = [.withInternetDateTime]
        return fallback.date(from: value)
    }
}
