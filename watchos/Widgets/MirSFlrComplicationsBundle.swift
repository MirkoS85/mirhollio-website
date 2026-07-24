import WidgetKit
import SwiftUI

@main
struct MirSFlrComplicationsBundle: WidgetBundle {
    var body: some Widget {
        MirSFlrCapacityComplication()
        MirSFlrFTSOAvailabilityComplication()
        MirSFlrFDCAvailabilityComplication()
        MirSFlrFTSOWeightComplication()
        MirSFlrEpochComplication()
    }
}
