# ShowSlate Live Compositor 0.12.0 Beta 4

Beta 4 is a reliability update for show control, recovery, recording, live-input transport, portable media and mapped Program outputs. Preview/Program safety and the existing operator workflow remain unchanged.

> **Mac-first experimental public beta:** use this build for off-air evaluation and rehearse the exact show computer, displays, media, capture devices, audio route and fallback before an event. Windows packages are experimental and still require physical Windows hardware validation. ShowSlate is not production-certified.

## Download

| Status | Platform | Package |
|---|---|---|
| **Primary tested beta** | Apple Silicon Mac (M1 or newer) | [`ShowSlate-0.12.0-beta.4-arm64.dmg`](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.4/ShowSlate-0.12.0-beta.4-arm64.dmg) |
| **Experimental, physical validation needed** | Windows 10/11 x64 | [`ShowSlate-Setup-0.12.0-beta.4.exe`](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.4/ShowSlate-Setup-0.12.0-beta.4.exe) |

The [portable Windows EXE](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.4/ShowSlate-0.12.0-beta.4-portable.exe) is an advanced no-install option with the same experimental status. [SHA256SUMS.txt](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.4/SHA256SUMS.txt) accompanies the release. The previous [beta 3](https://github.com/srdjankotarlic/showslate/releases/tag/v0.12.0-beta.3) remains available for comparison and rollback.

GitHub's automatic **Source code** ZIP and TAR.GZ files are developer archives and will not install ShowSlate. Most Mac users need only the named DMG above.

## Fixed

- GO and show-file/recovery loads continue when the legacy localStorage cache is full. Authoritative show data is restored directly instead of rereading a stale cache.
- Delayed speaker graphics follow the live cue through rundown reordering. A subsequent GO still cancels the previous pending graphic.
- File and package imports no longer conceal an autosave failure with a saved status or success-only message.
- Repeated crashes retain the original recovery baseline. Corrupt autosaves can fall back to a valid baseline, and failed recovery writes remain retryable.
- Recording stops after a failed disk write and exposes the available incomplete footage without calling it a completed recording. Cancelling preparation waits for capture cleanup.
- Temporary live-input connections retry, incoming ICE candidates survive setup, and removed sources/consumers do not leave stale connection work behind.
- Audio-only live sources remain subscribed on Program. Clearing a selected audio device restores System Default, and paused looping clips do not restart near their OUT point.
- Mapped Program copies remain silent. Mixer controls update the canonical scene; retired scenes release media and cannot reappear during rapid transitions.
- Mapped fades, transparency, destination geometry and live placeholders stay synchronized with the canonical output. Output grids cover remainder pixels.
- Control API count-up status and live/replayed report timing are corrected. Reports match stable cue IDs after reordering, and OSC boolean messages retain explicit ON/OFF behavior.
- Browser/OBS outputs receive the media transport module. Nested library imports no longer reuse an unrelated root file with the same basename.
- Portable graphics handle duplicate-content assets, legacy media IDs and embedded images without rewriting ordinary cue text or inline logos. Conflicting cached media and oversized exports are rejected before replacing a package.
- Live-input status refreshes no longer interrupt layer dragging. Preflight uses the same display-identity rules as actual routing.

Compatible packaging dependency patches and expanded deterministic/hidden-renderer regressions accompany these fixes.

## Verification supporting this update

The September 12 local reliability candidate passed 25 module groups with 262 reported checks, 12 hidden Electron groups with 236 checks, and 40 repeated checks against a fresh local packaged archive. Packaged CLI boot, runtime-file matching, MIT/no-activation inspection, local signature and DMG integrity checks passed. The dependency audit reported zero vulnerabilities at that verification time.

Those checks ran before the final beta 4 version and clean release commit were prepared. They used hidden windows, isolated profiles and synthetic or mocked devices; they are not a new visible physical rehearsal of the exact downloadable artifacts. The [native beta workflow](https://github.com/srdjankotarlic/showslate/actions/workflows/release.yml) separately builds Mac and Windows packages from the release tag, verifies packaged boot and clean-commit provenance, and generates checksums and attestations before publication. See [the retained verification history](https://github.com/srdjankotarlic/showslate/blob/main/docs/PUBLIC-BETA-VERIFICATION.md) for the precise boundaries and older visible Mac tests.

## Important limits

- The Mac package is locally/ad-hoc signed and not Apple Developer ID signed or notarized. Windows packages are unsigned and have not been manually validated on physical Windows hardware.
- This reliability review did not physically validate external HDMI/LED/projector chains, UVC cards or cameras, actual audio-sink switching, or reliable sustained 4K60 capture/recording.
- A previous synthetic 3840x2160/60 capture run did not sustain its certification target. This update does not remove that limitation.
- Preview remains isolated and muted; Program audio is explicit and limited to one local destination. Local capture streams are not sent through browser/OBS URLs.
- ShowSlate is not a streaming encoder, multibus audio mixer, NDI router or redundant broadcast switcher. Keep an independent fallback for show-critical use.

Download only from this repository and verify the checksum and provenance of the exact artifact you install.
