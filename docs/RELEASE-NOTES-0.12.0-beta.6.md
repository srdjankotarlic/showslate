# ShowSlate Live Compositor 0.12.0 Beta 6

Reliability update for the existing Mac-first Live compositor. The interface and saved-show format remain compatible.

## Fixed

- CUT now cuts instead of inheriting the saved fade time. Live TAKE CLIP follows the selected transition.
- Studio layer TAKE cannot overwrite an unrelated source just because another scene reused its layer ID.
- PIN retains the on-air capture configuration across scene launches.
- Moving/resizing/selecting a monitor video no longer recreates its decoder. Removed monitor media releases playback and transport resources.
- Audio fader/routing changes do not rewind an unchanged video transport. Trimmed OUT checks also run on decoded frames.
- Recording a timer, still or silent scene with Include Audio enabled now has a silent audio clock; the encoder no longer waits indefinitely for an empty mix.
- Program recordings use a rectangular capture window, without the macOS rounded-corner black mask. The recording smoke checks all four decoded corners.

## Downloads

- [Apple Silicon Mac DMG](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.6/ShowSlate-0.12.0-beta.6-arm64.dmg)
- [Experimental Windows x64 Setup](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.6/ShowSlate-Setup-0.12.0-beta.6.exe)
- [Experimental Windows portable](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.6/ShowSlate-0.12.0-beta.6-portable.exe)
- [SHA-256 checksums](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.6/SHA256SUMS.txt)

[Beta 5](https://github.com/srdjankotarlic/showslate/releases/tag/v0.12.0-beta.5) remains available for rollback. GitHub's automatic **Source code** ZIP and TAR.GZ archives will not install ShowSlate; use the DMG or Windows Setup above.

## Verification and limits

The September 27 source candidate passed all 26 module groups, 13 hidden renderer groups and 12 display renderer groups. Full application smoke on the explicitly selected PHL 243V7 monitor passed 323 checks, including timer/GO, Preview/Program, lower thirds, layout, HTTP/OSC and output geometry. MP4/H.264 and WebM/VP8 recordings at 640×360/30 fps were created through the actual recording IPC/capture/encoder path, finalized and decoded again. FFprobe independently confirmed H.264 plus 48 kHz stereo AAC in the MP4. This short silent-scene test is not long-duration or external audio validation.

Tests use isolated profiles and generated fixtures, not customer shows. Native CI separately rebuilds Mac and Windows downloads from the release tag and checks packaged provenance. See [verification history](PUBLIC-BETA-VERIFICATION.md) for local versus tagged-artifact boundaries.

This remains an experimental beta, not a promise that every function works perfectly on every system. Mac packages are ad-hoc signed, not Developer ID signed/notarized; Windows packages are unsigned and not physically tested. Venue HDMI/LED/projector chains, UVC devices, external audio-device switching and sustained 4K60 remain unverified. Browser/OBS outputs do not carry local capture streams. Rehearse your actual show and keep an independent fallback.
