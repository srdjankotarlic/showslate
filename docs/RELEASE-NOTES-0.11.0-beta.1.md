# ShowSlate Live Compositor 0.11.0 Beta 1

This beta establishes ShowSlate as a local-first live compositor. New installations open with Composer, Preview and Program ready for scene work, while the previous rundown, timer, lower-third, GO transaction and role-based Conference Desk workflow remain available when a production needs them.

## Download

| Platform | Recommended package |
|---|---|
| Apple Silicon Mac (M1 or newer) | [`ShowSlate-0.11.0-beta.1-arm64.dmg`](https://github.com/srdjankotarlic/showslate/releases/download/v0.11.0-beta.1/ShowSlate-0.11.0-beta.1-arm64.dmg) |
| Windows 10/11 x64 | [`ShowSlate-Setup-0.11.0-beta.1.exe`](https://github.com/srdjankotarlic/showslate/releases/download/v0.11.0-beta.1/ShowSlate-Setup-0.11.0-beta.1.exe) |

The [portable Windows EXE](https://github.com/srdjankotarlic/showslate/releases/download/v0.11.0-beta.1/ShowSlate-0.11.0-beta.1-portable.exe) is an advanced no-install option. `SHA256SUMS.txt` is included with the release. The previous [`0.10.0-beta.1`](https://github.com/srdjankotarlic/showslate/releases/tag/v0.10.0-beta.1) packages remain available.

GitHub's automatic **Source code** ZIP and TAR.GZ files are developer archives and will not install ShowSlate. Download one of the named packages above.

## New Composer workflow

- Start in a Composer-first workspace with Preview, Program, scenes, layers and the inspector visible together.
- Choose a 1080p, 720p, square, vertical, UHD or custom Canvas resolution and frame rate.
- Create, duplicate, select and delete reusable scenes from the Composer header.
- Stack pictures, local video, PDF pages, colors, text and the ShowSlate timer as ordered layers.
- Add an application window, entire display, camera or UVC capture card as a live layer.
- Select an optional audio input for a capture device.
- Camera and audio access are requested by separate operator actions; denied permissions produce a bounded, actionable state instead of leaving device discovery running.
- Drag and resize layers in Preview or enter exact position, size, opacity, rotation and fit in the inspector.
- Replace a window or device without losing its layer transform.
- Prepare privately in Preview, then use TAKE to send the complete scene to Program.

The application now uses a layered-canvas icon and a neutral compositor interface. Timing controls remain in a compact strip instead of defining the entire workspace.

## Output and audio safety

Every desktop route can still be fullscreen, windowed, an exact pixel size or a grid cell. New routes start with the active Canvas dimensions. Preflight warns when a destination and Canvas use different aspect ratios.

Preview is always muted. Program audio is off by default and can be enabled on only one local desktop output. This prevents accidental echo and feedback; ShowSlate is not an audio mixer.

## Important limits

- Window/display and camera/capture-card streams are local to the ShowSlate desktop app and its Electron output windows. They do not travel through the browser/OBS URL output.
- Capture source identifiers are machine-local and can change. Re-select live inputs after moving a show to another computer.
- Canvas imports are limited to 200 MB per file.
- Capture cards must appear as standard operating-system video/UVC devices. Real compatibility depends on the device, driver, source format and HDCP status.
- ShowSlate does not encode or stream, route NDI, provide multibus audio mixing, control PTZ/DMX or synchronize multiple rooms.
- External OBS/vMix alpha capture remains uncertified. Test the exact show computer, displays, capture devices and downstream path off-air.

## Public beta warning

The Mac package is not Apple Developer ID signed or notarized, and the Windows package is not Authenticode signed. Operating systems can show an unknown-developer warning. Download only from this repository and verify `SHA256SUMS.txt` when needed.

This is an evaluation beta, not a production-certified release. Keep a fallback rundown/timer and test every live source and destination before doors open.
