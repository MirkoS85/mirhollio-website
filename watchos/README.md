# MirSFlr Apple Watch Starter

This folder contains the Swift source files for the first native Apple Watch
version of MirSFlr. The files read:

https://www.mirhollio.com/data/watch-status.json

Use Xcode to create the actual watchOS project and targets, then add these files
with the target membership described below.

## Files

- `Shared/WatchStatus.swift`
  - Add to the Watch App target and the Widget Extension target.
- `Shared/StatusService.swift`
  - Add to the Watch App target and the Widget Extension target.
- `Shared/StatusFormat.swift`
  - Add to the Watch App target and the Widget Extension target.
- `WatchApp/MirSFlrWatchApp.swift`
  - Add only to the Watch App target.
- `WatchApp/ContentView.swift`
  - Add only to the Watch App target.
- `Widgets/MirSFlrComplication.swift`
  - Add only to the Widget Extension target.

## Xcode setup

1. Open Xcode.
2. File -> New -> Project.
3. Choose watchOS -> App.
4. Product Name: `MirSFlrWatch`.
5. Interface: SwiftUI.
6. Language: Swift.
7. Create the project wherever you want to keep the native app.
8. File -> New -> Target.
9. Choose watchOS -> Widget Extension.
10. Product Name: `MirSFlrComplications`.
11. In Xcode, drag the files from this folder into the project navigator.
12. Check target membership exactly as listed above.
13. Run the Watch App target on your paired Apple Watch Ultra.
14. Add the complication from the Apple Watch face editor.

WidgetKit controls refresh timing. The complication asks for a new timeline
about every 15 minutes, but watchOS may refresh less often to protect battery.
The app screen fetches fresh data whenever it opens.
