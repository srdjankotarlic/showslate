# ShowSlate Live Compositor 0.12.0 Beta 1

This beta adds clean local Program recording and completes a substantial operator-workflow update. ShowSlate can now build and run layered scenes, switch Preview to Program, route independent display canvases, operate a compact Live Mode deck and record the resulting Program with enabled Program audio.

> **Work in progress:** this is an evaluation build for off-air testing. It is not production-certified. Rehearse the exact computer, displays, storage, media, capture devices, audio route and fallback before a live event.

## Download

| Platform | Recommended package |
|---|---|
| Apple Silicon Mac (M1 or newer) | [`ShowSlate-0.12.0-beta.1-arm64.dmg`](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.1/ShowSlate-0.12.0-beta.1-arm64.dmg) |
| Windows 10/11 x64 | [`ShowSlate-Setup-0.12.0-beta.1.exe`](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.1/ShowSlate-Setup-0.12.0-beta.1.exe) |

The [portable Windows EXE](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.1/ShowSlate-0.12.0-beta.1-portable.exe) is an advanced no-install option. `SHA256SUMS.txt` is included with the release. The previous [`0.11.0-beta.1`](https://github.com/srdjankotarlic/showslate/releases/tag/v0.11.0-beta.1) packages remain available for comparison and rollback.

GitHub's automatic **Source code** ZIP and TAR.GZ files are developer archives and will not install ShowSlate. Download one of the named packages above.

## Record Program

- Start and stop a clean Program recording from the visible **Record Program** control in the main header.
- Capture the Program canvas without Preview, the controller interface or operator overlays.
- Choose the save folder, filename prefix, Program/1080p/1440p/4K/custom resolution, 24/25/30/50/60 fps, quality and bitrate under **Settings > Recording**.
- Use Automatic format selection, explicit MP4/H.264 or WebM. Automatic prefers MP4 when the current encoder supports it and otherwise falls back to WebM.
- Include the enabled Program audio mix at a selectable audio bitrate.
- See elapsed time while recording, last-file status after stopping and free disk space before starting.
- Stream recording chunks directly to disk instead of retaining the complete recording in memory.

## Live operation and media

- A compact Live Mode performance deck exposes the same compositions, scenes and source layers without creating a separate project state.
- Scene and source visibility, drag ordering, Preview, TAKE, GO NEXT and Program-layer actions follow the operator's visible state.
- Video transport supports Preview, Program or Both targeting, play/pause/restart/stop, IN and OUT points, loop/hold behavior, speed and restart-on-TAKE.
- Program and Preview playback stay synchronized while audio routing remains explicit and off by default.
- Audio mixer faders and mute controls now update the live media graph.
- Large media is linked and byte-range streamed from disk; ShowSlate does not impose the previous 200 MB playback limit or silently recompress originals.
- UHD source profiles and 4K60 validation are available where the source device, codec, computer and outputs can sustain them.
- Show files can be saved and loaded while preserving compositions, scenes and operator state.

## Composition and outputs

- Advanced projector mapping separates Input Selection from Output Mapping.
- A destination can show the normal Program without mapping, or use one or more named mapping surfaces.
- Surfaces support four-corner perspective, bounded linear mesh, polygon masks, calibration patterns and manual edge-blend controls.
- Multiple surfaces can target one output, and several independently configured destinations can receive the same Program.
- Compact and resized layouts keep Preview, Program, scenes, layers, inspector, mixer and primary commands reachable.

## Verification completed for this beta

- Source display smoke completed with `SMOKE_OK`.
- The packaged Apple Silicon application completed the full display smoke with `SMOKE_OK`.
- Recording model tests completed `5/5`; Composer renderer tests completed `68/68`; all eight renderer suites passed.
- A real packaged-app operator run recorded the exact Program test pattern as a 1920x1080 MP4/H.264 file with AAC stereo audio at 48 kHz. The 37.9-second file was decoded and inspected independently with FFmpeg.
- The installed Desktop application reports `0.12.0-beta.1` and passes strict local code-signature verification.

## Important limits

- The Mac package is ad-hoc signed and not notarized. The Windows packages are unsigned. Operating systems can show an unknown-developer warning.
- Windows packages are produced and tested in native CI, but this release still needs broader physical Windows operator and hardware feedback.
- Recording codecs depend on the encoders available through Electron and the operating system. Test the exact requested format before relying on it.
- Record Program creates one composited Program file. It is not multitrack recording, replay, streaming or redundant broadcast capture.
- 4K, 50/60 fps, several simultaneous videos and multiple outputs can exceed the practical limits of a given computer or drive.
- Window/display and camera/UVC streams remain local to the desktop app and its Electron output windows. Browser/OBS URL outputs do not receive those local streams.
- Physical projector alignment, every UVC capture card, every codec and external OBS/vMix alpha behavior are not universally certified.
- ShowSlate is not an NDI router, multibus audio mixer, PTZ/DMX controller or multi-room synchronization platform.

Download only from this repository, verify `SHA256SUMS.txt` when needed and keep an independent fallback for show-critical use.
