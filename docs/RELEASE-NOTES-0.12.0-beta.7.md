# ShowSlate Live Compositor 0.12.0 Beta 7

Playback and recording reliability update. Includes the previous beta 6 fixes and preserves the existing show format and interface.

## Fixed

- Adding a caption or changing layer geometry in CUT mode keeps an unchanged Program video playing instead of recreating its decoder and rewinding it.
- Single-frame seeks at 60 fps are no longer ignored by a 35 ms tolerance. Trimmed playback no longer stops up to 35 ms before OUT.
- Recording preparation waits for loaded images, a painted Program frame and a stable Program revision before capture starts, addressing cold-start black frames.
- Compatible dependencies and Electron 43.8.4 include current patch fixes; the local dependency audit reports no vulnerabilities.

## Downloads

- [Apple Silicon Mac DMG](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.7/ShowSlate-0.12.0-beta.7-arm64.dmg)
- [Experimental Windows x64 Setup](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.7/ShowSlate-Setup-0.12.0-beta.7.exe)
- [Experimental Windows portable](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.7/ShowSlate-0.12.0-beta.7-portable.exe)
- [SHA-256 checksums](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.7/SHA256SUMS.txt)

[Beta 6](https://github.com/srdjankotarlic/showslate/releases/tag/v0.12.0-beta.6) remains available for rollback. GitHub's automatic **Source code** ZIP and TAR.GZ archives will not install ShowSlate; use a platform installer above.

## Verification

October 30 review covered the native controller with a disposable profile: text creation, TAKE/HIDE, Live Mode, TAKE CLIP and rundown GO. All 26 module groups and 13 hidden renderer groups passed on Electron 43.8.4. Packaged renderer checks covered actual H.264 playback continuity. Actual local MP4/H.264 and WebM/VP8 recordings were finalized and replayed; first-frame inspection confirmed the Program fixture after the recording paint fix. See [operator review](OPERATOR-REVIEW-2026-10-30.md) and [verification history](PUBLIC-BETA-VERIFICATION.md).

Native CI separately builds the tagged Mac and Windows artifacts and verifies packaged provenance. Local review builds and CI downloads have different build timestamps and hashes, while sharing the release source.

This is a Mac-first experimental beta. Mac packages are ad-hoc signed, without Developer ID notarization. Windows packages require physical Windows validation. Venue HDMI/LED/projector chains, UVC devices, real audio-device switching and sustained 4K60 remain unverified. Browser/OBS outputs do not carry local capture streams. Rehearse the final media and devices before show use.
