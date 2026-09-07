//
//  MirSFlrComplicationsBundle.swift
//  MirSFlrComplications
//
//  Created by Mirko Svenšek on 24. 7. 2026.
//

import WidgetKit
import SwiftUI

@main
struct MirSFlrComplicationsBundle: WidgetBundle {
    var body: some Widget {
        MirSFlrLegacyFTSOComplication()
        MirSFlrCapacityComplication()
        MirSFlrFTSOAvailabilityComplication()
        MirSFlrFDCAvailabilityComplication()
        MirSFlrFTSOWeightComplication()
        MirSFlrEpochComplication()
        MirSFlrFreeSpaceComplication()
        MirSFlrDelegationComplication()
        MirSFlrFDCBarsComplication()
        MirSFlrFDCBarsLiveComplication()
        MirSFlrFTSOPerformanceBandsComplication()
        MirSFlrPrimaryPerformanceComplication()
        MirSFlrSecondaryPerformanceComplication()
        MirSFlrAPRComplication()
        MirSFlrFDCParticipationComplication()
        MirSFlrEdgeCapacityComplication()
        MirSFlrEdgeFTSOAvailabilityComplication()
        MirSFlrEdgeFDCAvailabilityComplication()
        MirSFlrEdgeFTSOWeightComplication()
        MirSFlrEdgeEpochComplication()
        MirSFlrEdgeFreeSpaceComplication()
        MirSFlrEdgeDelegationComplication()
        MirSFlrEdgePrimaryPerformanceComplication()
        MirSFlrEdgeSecondaryPerformanceComplication()
        MirSFlrEdgeAPRComplication()
        MirSFlrEdgeFDCParticipationComplication()
    }
}
