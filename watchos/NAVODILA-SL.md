# MirSFlr na Apple Watch Ultra

To so pocasna, tocna navodila za prvi native Apple Watch app in komplikacije.

## Kaj je ze pripravljeno

Na spletni strani je pripravljen feed:

https://www.mirhollio.com/data/watch-status.json

Ta feed vsebuje:

- validator stake
- free space
- live delegation
- self-bond
- FTSO signing-policy epoch
- FTSO weight
- vire podatkov
- warnings

Apple Watch app in komplikacije bodo brale samo ta mali JSON.

## Korak 1: Ustvari Watch app projekt

1. Odpri Xcode.
2. Klikni `File`.
3. Klikni `New`.
4. Klikni `Project`.
5. Izberi `watchOS`.
6. Izberi `App`.
7. Klikni `Next`.
8. Product Name naj bo:

   ```text
   MirSFlrWatch
   ```

9. Interface:

   ```text
   SwiftUI
   ```

10. Language:

   ```text
   Swift
   ```

11. Klikni `Next`.
12. Shrani projekt nekam lokalno, na primer:

   ```text
   /Users/svensekovi/Documents/New project/MirSFlrWatch
   ```

## Korak 2: Dodaj Widget Extension

1. V Xcode klikni ime projekta v levi navigaciji.
2. Klikni `File`.
3. Klikni `New`.
4. Klikni `Target`.
5. Izberi `watchOS`.
6. Izberi `Widget Extension`.
7. Product Name:

   ```text
   MirSFlrComplications
   ```

8. Klikni `Finish`.
9. Ce Xcode vprasa `Activate scheme?`, klikni `Activate`.

## Korak 3: Dodaj pripravljene datoteke

V Finderju odpri:

```text
/Users/svensekovi/Documents/New project/mirhollio-website/watchos
```

V Xcode povleci notri te datoteke:

```text
Shared/WatchStatus.swift
Shared/StatusService.swift
Shared/StatusFormat.swift
WatchApp/MirSFlrWatchApp.swift
WatchApp/ContentView.swift
Widgets/MirSFlrComplication.swift
```

Ko Xcode pokaze dialog za dodajanje datotek:

1. Vklopi `Copy items if needed`.
2. Pri `Add to targets` pazi zelo natancno:

Shared datoteke dodaj v oba targeta:

```text
MirSFlrWatch
MirSFlrComplications
```

To so:

```text
WatchStatus.swift
StatusService.swift
StatusFormat.swift
```

Watch app datoteke dodaj samo v:

```text
MirSFlrWatch
```

To so:

```text
MirSFlrWatchApp.swift
ContentView.swift
```

Widget datoteko dodaj samo v:

```text
MirSFlrComplications
```

To je:

```text
MirSFlrComplication.swift
```

## Korak 4: Odstrani template datoteke

Xcode bo sam ustvaril nekaj zacasnih template datotek.

Ce imas v projektu stare template datoteke z istimi vlogami, jih odstrani:

```text
ContentView.swift
MirSFlrWatchApp.swift
MirSFlrComplications.swift
```

Odstrani samo template kopije, ne nasih novih datotek.

Najbolj vazno:

- v Watch App targetu sme biti samo en `@main`
- v Widget Extension targetu sme biti samo en `@main`

Ce sta dva `@main`, Xcode build pade.

## Korak 5: Preveri permissions

Za branje HTTPS JSON feeda ne rabis posebnih permissions.

V `Info.plist` ne dodajaj App Transport Security izjem, ker uporabljamo:

```text
https://www.mirhollio.com/data/watch-status.json
```

To je HTTPS in je prav.

## Korak 6: Build na simulatorju

1. V zgornjem delu Xcode izberi scheme:

   ```text
   MirSFlrWatch
   ```

2. Izberi Watch simulator, na primer:

   ```text
   Apple Watch Ultra
   ```

3. Klikni `Run`.

Na uri bi moral videti:

```text
MirSFlr
Connected
99.6% full
Free 336.92K FLR
FTSO E418
Weight 21.46M FLR
```

Stevilke se bodo spreminjale glede na `watch-status.json`.

## Korak 7: Build na pravi Apple Watch Ultra

1. Apple Watch naj bo odklenjena.
2. iPhone naj bo zraven Maca.
3. Na iPhonu odpri Watch app in preveri, da je ura paired.
4. V Xcode izberi svojo Apple Watch Ultra kot device.
5. Klikni `Run`.

Ce Xcode zahteva Developer Mode:

1. Na iPhonu pojdi v Settings.
2. Privacy & Security.
3. Developer Mode.
4. Vklopi.
5. Restartaj napravo, ce zahteva.

## Korak 8: Dodaj komplikacijo na watch face

1. Na Apple Watch dolgo pritisni watch face.
2. Tapni `Edit`.
3. Pojdi do `Complications`.
4. Izberi slot.
5. Izberi `MirSFlr`.
6. Izberi komplikacijo.
7. Shrani z Digital Crown.

Priporocam:

```text
Modular Ultra / rectangular slot:
MirSFlr 89.7M / 90M, Free 337K
```

In za majhen okrogel slot:

```text
99.6%
```

## Korak 9: Kaj pricakovati

Watch app:

- osvezi podatke ob odprtju
- pull-to-refresh dela, ce ga watchOS dovoli v tem viewu

Komplikacija/widget:

- prosi za refresh priblizno vsakih 15 minut
- watchOS lahko refresh prestavi zaradi baterije
- to je normalno

Zato komplikacija ni 1-sekundni live dashboard. Za cisto live pogled odpres app.

## Korak 10: Naslednji dober korak

Ko to builda v Xcode, je naslednji korak polish:

- dodati vec komplikacij: `Free space`, `FTSO`, `Validator full`
- dodati rdeci alarm, ko free pade pod 1M
- dodati short notification kasneje, ce validator postane skoraj full ali offline
