# ShowSlate Live Compositor 0.12.0 Beta 3

Beta 3 is an operator-safety and first-run usability update. It keeps the existing compositor, rundown, recording, lower-third, live-input and output-routing feature set while making the workflows needed before doors open easier to find and safer by default.

> **Mac-first work in progress:** this is an evaluation build for off-air testing. The Apple Silicon Mac package has completed the automated and packaged checks described below. Windows packages are built in native CI but still require physical Windows GUI and hardware validation. ShowSlate is not production-certified; rehearse the exact computer, displays, media, capture devices, audio route and fallback before a live event.

## Download

| Status | Platform | Package |
|---|---|---|
| **Primary tested beta** | Apple Silicon Mac (M1 or newer) | [`ShowSlate-0.12.0-beta.3-arm64.dmg`](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.3/ShowSlate-0.12.0-beta.3-arm64.dmg) |
| **Experimental, physical validation needed** | Windows 10/11 x64 | [`ShowSlate-Setup-0.12.0-beta.3.exe`](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.3/ShowSlate-Setup-0.12.0-beta.3.exe) |

The [portable Windows EXE](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.3/ShowSlate-0.12.0-beta.3-portable.exe) is an advanced no-install option with the same experimental status. `SHA256SUMS.txt` is included with the release. The previous [`0.12.0-beta.2`](https://github.com/srdjankotarlic/showslate/releases/tag/v0.12.0-beta.2) packages remain available for comparison and rollback.

GitHub's automatic **Source code** ZIP and TAR.GZ files are developer archives and will not install ShowSlate. Most Mac users need only the named DMG above.

## Operator workflow fixes

- **New Show**, **Import Show Folder**, **Open**, **Save**, **Save As** and **Preflight** now share one visible Show menu.
- A new show no longer tries to take the control display fullscreen. When no separate audience display is connected, it creates a safe 16:9 window route capped at 1280x720 and 80% of the control display.
- The setup wizard now starts with a neutral `Starter Template` lower third instead of inheriting the previously active development template.
- Preflight reports lower-third templates by readable name rather than an internal identifier.
- Output Routing always opens at the first destination. Its fixed safety actions remain visible while per-output Canvas controls are available through local scrolling.
- Scene rename, rundown move/skip/delete controls, planned show start and Settings close now have localized titles and accessibility labels.

## Verification completed for this beta

- All module suites passed, including free-build, icon, public-site, storage, recording, output-routing, localization and release-policy checks.
- All eight Electron renderer suites passed.
- Composer renderer checks completed `69/69`.
- Responsive beta usability checks completed `56/56` at 1440x900, 1280x800, 1024x700 and 900x600.
- The complete source display smoke ended with `SMOKE_OK` on the explicitly selected Built-in Retina Display.
- Targeted Full-HD synthetic live-input and output-routing checks passed.
- A fresh Apple Silicon package completed the packaged checks listed in [Public Beta Verification](PUBLIC-BETA-VERIFICATION.md).

## Important limits

- A targeted synthetic 3840x2160/60 live-input run did not sustain the 55 rendered-fps certification target. Full-HD transport passed, but 4K60 live capture is **not certified** in this beta.
- This beta 3 review did not use a physical external HDMI display, LED processor, projector or UVC capture card. Automated behavior does not replace an off-air test with the actual venue chain.
- The Mac package is ad-hoc signed and not notarized. Windows packages are unsigned and have not been manually validated on physical Windows hardware.
- Preview remains isolated and muted. Program audio is explicit and can feed only one local destination to reduce echo and feedback risk.
- ShowSlate is not an NDI router, streaming encoder, multibus audio mixer, PTZ/DMX controller or redundant broadcast switcher.

Download only from this repository, verify `SHA256SUMS.txt` when needed and keep an independent fallback for show-critical use.
