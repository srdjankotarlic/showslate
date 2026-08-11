# ShowSlate Live Compositor 0.11.0 Beta 1

This beta establishes ShowSlate as a local-first live compositor. New installations open with Composer, Preview and Program ready for scene work, while the previous rundown, timer, lower-third, GO transaction and role-based Conference Desk workflow remain available when a production needs them.

> **Work in progress:** this is an evaluation build for off-air testing. Expect bugs and unfinished hardware-specific behavior. It is not production-certified; always test the exact show computer and signal chain and keep a fallback.

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
- Camera and audio access are requested by separate operator actions; denied permissions produce a bounded, actionable state with a direct shortcut to the matching macOS Privacy setting instead of leaving device discovery running.
- Drag and resize layers in Preview or enter exact position, size, opacity, rotation and fit in the inspector.
- Replace a window or device without losing its layer transform.
- Prepare privately in Preview, then use TAKE to send the complete scene to Program.

The application now uses a layered-canvas icon and a neutral compositor interface. Timing remains available as an optional scene source and under **Settings > Timing**, while the permanent live workspace is reserved for Preview, Program, transitions, GO and scene composition.

## Multi-output, projector mapping and audio safety

Every desktop route can be fullscreen, windowed, an exact pixel size or a grid cell. Multiple routes can receive the same Program at once while keeping independent standard or custom output Canvas dimensions, frame rate and Fit/Cover/Fill scaling.

For a projector or LED processor, **Map projector** opens the Composition workspace for that destination. The operator can move four corner points, enable an adjustable calibration grid and set soft-edge values for a simple irregular surface. The transform is applied to the complete Program, including scene media, timer, text, logos and lower thirds.

New routes start with the active Canvas dimensions. Preflight warns when a destination and Canvas use different aspect ratios. A route is not reported as live until its renderer acknowledges the current Program revision.

Preview is always muted. Program audio is off by default and can be enabled on only one local desktop output. This prevents accidental echo and feedback; ShowSlate is not an audio mixer.

## Important limits

- Window/display and camera/capture-card streams are local to the ShowSlate desktop app and its Electron output windows. They do not travel through the browser/OBS URL output.
- Capture source identifiers are machine-local and can change. Re-select live inputs after moving a show to another computer.
- Canvas imports are limited to 200 MB per file.
- Capture cards must appear as standard operating-system video/UVC devices. Real compatibility depends on the device, driver, source format and HDCP status.
- ShowSlate does not encode or stream, route NDI, provide multibus audio mixing, control PTZ/DMX or synchronize multiple rooms.
- Projector mapping currently provides four-corner correction and a calibration grid. It does not provide arbitrary mesh warping, masks, automatic camera calibration or projector color matching.
- External OBS/vMix alpha capture remains uncertified. Test the exact show computer, displays, capture devices and downstream path off-air.

## Public beta warning

The Mac package is not Apple Developer ID signed or notarized, and the Windows package is not Authenticode signed. Operating systems can show an unknown-developer warning. Download only from this repository and verify `SHA256SUMS.txt` when needed.

This build passed automated source and packaged checks plus native Mac and Windows package construction. Targeted source and packaged routing checks confirmed two simultaneous acknowledged Program destinations with independent 1920x1080 and 1000x1000 canvases; the first used four-corner mapping and a visible calibration grid. Physical projector geometry, physical UVC capture-card video/audio and the Windows GUI were not certified across venue hardware. These remain evaluation features in this beta.

This is an evaluation beta, not a production-certified release. Keep a fallback rundown/timer and test every live source and destination before doors open.
