# ShowSlate 0.9.0 Beta 3

This release gives the event-control app a distinct identity under the name **ShowSlate**. It keeps the existing operator workflow while making the difference from the smaller ProTimer timer clear.

## Download the app

Download exactly one recommended installer. GitHub's automatic **Source code** ZIP and TAR.GZ files are developer archives and will not install ShowSlate.

| Platform | Recommended file |
|---|---|
| Apple Silicon Mac (M1 or newer) | [`ShowSlate-0.9.0-beta.3-arm64.dmg`](https://github.com/srdjankotarlic/showslate/releases/download/v0.9.0-beta.3/ShowSlate-0.9.0-beta.3-arm64.dmg) |
| Windows 10/11 x64 | [`ShowSlate-Setup-0.9.0-beta.3.exe`](https://github.com/srdjankotarlic/showslate/releases/download/v0.9.0-beta.3/ShowSlate-Setup-0.9.0-beta.3.exe) |

The [portable Windows EXE](https://github.com/srdjankotarlic/showslate/releases/download/v0.9.0-beta.3/ShowSlate-0.9.0-beta.3-portable.exe) is an advanced no-install option. `SHA256SUMS.txt` is available with the release for optional integrity verification.

## What changed

- App, installer, package, website and repository identity changed to ShowSlate.
- Existing local projects and settings are copied safely from the former app on first launch; old data is not deleted or overwritten.
- New portable show and lower-third packages use `.showslate-show` and `.showslate-lt`.
- Existing `.protimer-show` and `.protimer-lt` packages remain importable.
- HTTP and OSC examples now use the ShowSlate name while legacy OSC aliases remain accepted.
- Responsive operator checks now wait for the actual settled UI state instead of relying on a fixed animation delay.
- Public documentation and download guidance now distinguish ShowSlate from the smaller ProTimer app.

## Beta limitations

The public beta is unsigned. macOS may require **Open Anyway** in Privacy & Security, and Windows may show an Unknown publisher warning. Windows packages are built on a native GitHub runner, but physical Windows operator testing remains required. External OBS/vMix video-alpha workflows are not certified.

Test the exact show computer, displays, network and media path off-air before a live event. See the [product page](https://srdjankotarlic.github.io/showslate/), [known limitations](KNOWN-LIMITATIONS.md) and [verification evidence](PUBLIC-BETA-VERIFICATION.md).
