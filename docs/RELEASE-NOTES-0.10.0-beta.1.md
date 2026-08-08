# ShowSlate Conference Desk 0.10.0 Beta 1

This beta turns ShowSlate into a focused, local-first **Conference Desk** for one room operator. The app now imports a schedule and media folder, assigns purpose-built output roles, runs conference-specific preflight and applies the prepared cue through one GO transaction.

## Download the app

Download exactly one recommended installer. GitHub's automatic **Source code** ZIP and TAR.GZ files are developer archives and will not install ShowSlate.

| Platform | Recommended file |
|---|---|
| Apple Silicon Mac (M1 or newer) | [`ShowSlate-0.10.0-beta.1-arm64.dmg`](https://github.com/srdjankotarlic/showslate/releases/download/v0.10.0-beta.1/ShowSlate-0.10.0-beta.1-arm64.dmg) |
| Windows 10/11 x64 | [`ShowSlate-Setup-0.10.0-beta.1.exe`](https://github.com/srdjankotarlic/showslate/releases/download/v0.10.0-beta.1/ShowSlate-Setup-0.10.0-beta.1.exe) |

The [portable Windows EXE](https://github.com/srdjankotarlic/showslate/releases/download/v0.10.0-beta.1/ShowSlate-0.10.0-beta.1-portable.exe) is an advanced no-install option. `SHA256SUMS.txt` is included with the release.

## New Conference Desk workflow

- **Import Show Folder** scans CSV/TSV plus supported media, copies assets into private app storage and conservatively matches them by explicit filename or exact cue title.
- The setup wizard builds linked content scenes, cue actions and an Audience output while keeping the new show paused and off external displays.
- Outputs now have explicit **Audience, Confidence, Timer, Stream Graphics and Door Agenda** roles.
- GO creates one transaction for the LIVE cue, timer, linked content and immediate automatic lower third, then sends one consistent Program revision to every route.
- Output status remains **SYNCING** until the renderer confirms the expected revision and cue state.
- Conference preflight checks the Audience route, display assignments, cue actions, media mapping and render delivery.
- **Live Mode** keeps GO and live controls available while disabling show import and rundown editing.
- A built-in conference demo provides six cues, linked visuals and speaker data without opening external outputs automatically.

## Import behavior

Supported show-folder assets include PNG, JPEG, WebP, GIF, SVG, MP4, WebM, MOV, M4V and PDF. Import is limited to 500 files, 1 GB total, 200 MB per asset and 5 MB for the schedule. Hidden files and symbolic links are skipped.

Excel workbooks are not parsed directly. Export the rundown sheet as CSV/TSV or paste its rows into the wizard. See the [Conference Desk workflow](CONFERENCE-DESK.md) for the exact format.

## Compatibility

The executable and user-data identity remain **ShowSlate**, so existing ShowSlate shows, media, templates and preferences continue in place. Portable `.showslate-show` and `.showslate-lt` packages remain compatible, and legacy `.protimer-show` and `.protimer-lt` packages remain importable.

## Beta limitations

The beta is unsigned. macOS may require **Open Anyway** in Privacy & Security, and Windows may show an Unknown publisher warning. Windows packages are built on a native GitHub runner, but broader physical Windows operator testing remains required.

ShowSlate Conference Desk is not a camera switcher, audio mixer, encoder, NDI router or cloud multi-room platform. Stream Graphics transparency is tested inside Electron; external OBS/vMix alpha capture is not certified. Test the exact show computer, displays, network, media and capture path off-air before a live event.
