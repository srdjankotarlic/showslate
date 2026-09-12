# ShowSlate Live Compositor 0.12.0 Beta 5

Beta 5 makes the Live performance deck easier to read and more predictable to operate. It retains the existing interface and all beta 4 reliability fixes.

> **Mac-first experimental public beta:** evaluate off-air and rehearse the exact computer, displays, media, capture devices, audio route and fallback before an event. Windows packages are experimental and still require physical Windows hardware validation. ShowSlate is not production-certified.

## Download

| Status | Platform | Package |
|---|---|---|
| **Primary tested beta** | Apple Silicon Mac (M1 or newer) | [ShowSlate-0.12.0-beta.5-arm64.dmg](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.5/ShowSlate-0.12.0-beta.5-arm64.dmg) |
| **Experimental, physical validation needed** | Windows 10/11 x64 | [ShowSlate-Setup-0.12.0-beta.5.exe](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.5/ShowSlate-Setup-0.12.0-beta.5.exe) |

The [portable Windows EXE](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.5/ShowSlate-0.12.0-beta.5-portable.exe) is an advanced no-install option with the same experimental status. [SHA256SUMS.txt](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.5/SHA256SUMS.txt) accompanies the release. [Beta 4](https://github.com/srdjankotarlic/showslate/releases/tag/v0.12.0-beta.4) remains available for rollback.

GitHub's automatic **Source code** ZIP and TAR.GZ files are developer archives and will not install ShowSlate. Most Mac users need only the DMG above.

## Improved

- Image and video thumbnails occupy their proper region instead of being hidden by footer styling. Text, timer and color layers show recognizable content; unavailable media has a readable fallback.
- Larger labels and responsive columns make the deck easier to read. Preview/Program labels and a MIX indicator distinguish a scene from a mixed live composition.
- Live TAKE CLIP replaces one top-first layer row instead of accumulating cross-scene layers. Other rows keep playing. Studio's additive individual-layer TAKE behavior is unchanged.
- PIN keeps the row when launching another scene/column, including existing video timing and lower-third animation. An explicit TAKE CLIP can replace the pin.
- Preview First selection never triggers Program. In Direct mode the thumbnail triggers, while clicking the name only selects.
- Arrow keys move clip focus; Enter/Space activates without leaking into timer or transform shortcuts. Focus survives deck updates.
- Duplicate layer IDs in different scenes no longer make Program transport target the wrong video. Preview and Program restart together from the clip's IN point.
- Thumbnail decoding is bounded and sequential, muted and paused. Leaving a deck cancels stale work. Live stills use an already-attached muted monitor stream without starting another capture.

## Verification and limits

The September 12 local candidate passed 26 module groups, 265 hidden renderer checks and 39 checks against a fresh clean packaged Mac archive. Actual image/H.264/VP8 fixtures, native keyboard input, source provenance, PIN/lower-third continuity and 1440×900/1024×700/900×600 bounds were covered. Packaged boot, runtime identity, local signature, DMG integrity and dependency audit also passed.

Those checks used an isolated local candidate before beta 5 release metadata was finalized. The native beta workflow separately rebuilds Mac and Windows packages from the tag and validates packaged provenance. See the [verification history](https://github.com/srdjankotarlic/showslate/blob/main/docs/PUBLIC-BETA-VERIFICATION.md) for precise evidence boundaries.

- Mac packages are locally/ad-hoc signed, not Apple Developer ID signed or notarized. Windows packages are unsigned and not physically validated.
- External HDMI/LED/projector chains, UVC cards/cameras, real audio-device switching and sustained 4K60 remain unverified. A previous synthetic 4K60 run did not meet its certification target.
- Preview stays muted and Program audio is limited to one local route. Browser/OBS URLs do not carry local capture streams.
- Keep an independent fallback for show-critical use. This release does not claim flawless operation or production certification.

![Live performance deck with test media at 1440×900](https://raw.githubusercontent.com/srdjankotarlic/showslate/v0.12.0-beta.5/docs/images/live-deck-1440x900.png)
