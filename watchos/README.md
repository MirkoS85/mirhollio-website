> **This folder is a read-only mirror.**
>
> Nothing here is compiled. The Xcode project that actually builds and ships
> the watch app lives outside this repository, at
> `~/Desktop/Apps/MirSFlrWatch/MirSFlrWatch.xcodeproj`, and it keeps its own
> copies of every file below. Editing anything here changes nothing on the
> watch — patch the project instead, then copy the files back here so the
> mirror stays honest. The folder names match the project's two targets.
>
> Xcode is installed but `xcode-select` points at the Command Line Tools, so
> builds need the developer directory named explicitly:
>
> ```
> DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild build \
>   -project MirSFlrWatch.xcodeproj -scheme "MirSFlrWatch Watch App" \
>   -destination 'generic/platform=watchOS Simulator' CODE_SIGNING_ALLOWED=NO
> ```

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

## Freshness badge

Complications carry no badge while the reading is current, so a clean face
means live data. Past 20 minutes - the normal gap between a five-minute feed
and a fifteen-minute complication reload - the age appears in orange next to
the label, and past 45 minutes in red.

The age is measured against the timeline entry's own timestamp rather than the
current clock. Entries are pre-rendered hours ahead, so when watchOS stops
granting reloads the face advances through them and the age keeps climbing: a
frozen complication reports its own staleness instead of showing an hours-old
number that still looks current.
