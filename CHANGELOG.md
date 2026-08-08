# Changelog

All notable changes to ShowSlate are documented here.

## Unreleased

## 0.9.0-beta.3 - 2026-08-08

### Changed

- Renamed the app, installers, website and repository from ProTimer Studio to ShowSlate.
- Added idempotent migration of existing local projects and settings without deleting legacy data.
- Changed new portable package extensions to `.showslate-show` and `.showslate-lt` while retaining legacy import compatibility.
- Stabilized responsive UI verification by waiting for settled visual state instead of a fixed animation delay.

## 0.9.0-beta.2 - 2026-07-21

### Added

- Added persistent left and right sidebar toggles plus responsive drawers so rundown, slides, messages, settings and outputs remain reachable from 1440x900 down to 900x600.
- Added release provenance, artifact attestations and fail-closed signed-candidate workflows for future stable packages.
- Added deterministic package checks that reject activation code, private keys and unsafe release metadata from the public MIT build.

### Changed

- Upgraded the development runtime from Electron 42.6.1 to current stable Electron 43.1.1.
- Upgraded the ZIP package stack to Archiver 8.0.0 and yauzl 3.4.0 while preserving show/template package validation contracts.
- Added explicit macOS Hardened Runtime entitlements while keeping Chromium cookie encryption disabled because the app has no account or cookie-based login.
- Restricted unsigned publication to exact beta tags and separated future signed candidates from the stable publication gate.
- Removed stale paid-tier labels from the free UI and added a headless 37-pack localization/fallback contract.
- Build metadata now discloses dirty source state and records the full commit, preventing local modified packages from masquerading as exact release builds.
- Replaced old product screenshots with current verified operator and Lower Third Studio views.

### Fixed

- Fixed rundown badge, schedule and duration overlap in dense cue rows.
- Fixed drag state and resize access regressions in the operator workspace.
- Fixed packaged image/video media loading being blocked by an unnecessary macOS Safe Storage Keychain prompt.
- Isolated smoke-test browser profiles and artifact directories so source and packaged evidence cannot contaminate each other.

### Verified

- The complete 320-check source and packaged regression passed on the designated PHL 243V7 display with no test window on the HP display.
- Packaged MP4 playback and WebM VP8/VP9 alpha compositing passed in Electron; external OBS/vMix alpha integration remains uncertified.
- The Apple Silicon app passed package boot, DMG integrity, ad-hoc signature, Electron fuse and public MIT/free-build checks.
- Windows x64 installer and portable packages remain CI-built beta artifacts and still require physical Windows validation.

## 0.9.0-beta.1 - Public beta

### Added

- Rundown-first timer workflow with explicit selected, NEXT and LIVE cue states.
- Multiple simultaneous Program destinations with fullscreen, window, exact custom-size and grid placement.
- Lower Third Studio templates with dynamic/static text, shapes, logos, image/video media, Preview, Take and Hide.
- Screen content workflow for images, video, PDF, text, logos, timer and blank items.
- Local browser output, phone remote, backstage view and podium Signal Light.
- Atomic autosave, crash recovery, portable show/template packages and preflight.
- HTTP/OSC control surface and post-show timing report/CSV export.
- English and Serbian full localization plus 35 labeled core language packs.

### Changed

- Rebuilt the operator workspace for consistent responsive access from 1440x900 down to 900x600.
- Unified the original product identity, icon, package names and release metadata under its former ProTimer Studio name.
- Hardened display identity and output reconnection so missing routes never move silently to another monitor.
- Upgraded the runtime from end-of-support Electron 39 to supported Electron 42.6.1.
- Hardened packaged Electron fuses and enforced embedded ASAR integrity on macOS and Windows.
- Removed the activation/trial gate and released the project under the MIT License.

### Release blockers

- Public macOS distribution still requires Developer ID signing, notarization and clean-machine validation.
- Windows artifacts require Authenticode signing and physical Windows QA.
- Electron 42.6.1 still requires the complete designated-display source and packaged regression pass.
- External OBS/vMix alpha workflows are not certified.
