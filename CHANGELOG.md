# Changelog

All notable changes to ShowSlate are documented here.

## 0.12.0-beta.1 - 2026-08-16

### Added

- Added a multi-surface projector-mapping workflow with separate **Input Selection** and **Output Mapping** stages.
- Added perspective and bounded 4 x 4 linear-mesh warp, draggable mesh points, polygon masks, surface Solo/visibility/opacity and per-surface output placement.
- Added continuous Grid, Checker and Crosshair calibration patterns with optional surface identification labels.
- Added manual edge-overlap, blend-gamma and black-level controls for adjacent projector alignment.
- Added clean local Program recording from the main header, with elapsed status and incremental writes to disk.
- Added recording settings for destination folder, filename prefix, Program/1080p/1440p/4K/custom resolution, frame rate, format, quality, video bitrate, Program audio and audio bitrate.
- Added a compact Live Mode performance deck backed by the same compositions, scenes, sources, Preview/Program renderer and rundown as Composer.
- Added show-file save/load, professional video transport, explicit Preview/Program audio routing, large disk-linked media streaming and UHD/4K60 source profiles.

### Fixed

- Kept composition and mapping object references stable so duplicated surfaces no longer overwrite the selected source surface.
- Kept calibration patterns continuous across mesh cells and applied polygon/edge masks once to the mapped surface.
- Kept the mapping inspector fully hidden when the active composition has no projector surfaces, including the 900x600 layout.
- Made explicit smoke-test display environment settings override an older local display configuration.
- Synchronized video transport between Preview and Program while preserving independent Preview safety.
- Routed mixer volume and mute controls into the live Program audio graph.
- Kept GO NEXT advancing through the saved rundown order and source visibility aligned with the visible layer controls.
- Kept the complete settings and timing controls reachable in the 900x600 compact drawer.

## 0.11.0-beta.1 - 2026-08-11

### Added

- Added a custom-resolution Canvas with 1080p, 720p, vertical, square, UHD and bounded custom presets.
- Added reusable scenes with ordered picture, video, PDF, color, text, timer, window/display and camera/UVC capture layers.
- Added one hidden capture hub that acquires each live source once and distributes it to Preview and local desktop Program outputs through local WebRTC.
- Added optional capture-device audio, muted Preview monitoring and a single-Program-audio-route safety guard.
- Added visible scene controls, exact layer inspector fields, drag/resize handles, source replacement and live input status.
- Added Canvas/output aspect-ratio preflight warnings and targeted compositor, live-input and multi-output checks.
- Added independent output Canvas settings so simultaneous destinations can use different resolutions, frame rates and Fit/Cover/Fill scaling.
- Added four-corner projector mapping, adjustable calibration grids and soft-edge controls for simple irregular projection surfaces.
- Added a direct **Map projector** action from every eligible output route and applied mapping to the complete Program renderer.

### Changed

- Reframed the global product identity as **ShowSlate Live Compositor**; Conference Desk remains an included room workflow instead of the application-wide identity.
- New installations open directly into the Composer with Preview, Program, scenes, layers and the inspector visible; timing controls remain available in a compact operator strip.
- Replaced the timer-like application icon with a restrained layered-canvas mark and a single Program tally accent.
- Updated the website, README, release documentation and primary product image around the compositor workflow.
- Canvas media now uses the same 200 MB per-file safety limit as show-folder assets.
- New output routes default to the active Canvas dimensions.
- Multiple output routes now keep independent Canvas and projector-mapping configuration while receiving the same acknowledged Program revision.
- Preview and Program monitors now follow square, vertical and custom Canvas aspect ratios reliably at every supported controller size.
- Preview and Program text-layer padding now scales with the rendered canvas so narrow text layers remain visually consistent.
- Live-input smoke waits for actual media-time progression instead of relying on a fixed delay.

### Fixed

- Replacing a window or device source preserves layer position, size, opacity, rotation and stack position.
- Layer transforms update the inspector while dragging or resizing and finish safely even when pointer capture is lost.
- Live input reconnect stops sibling media tracks and preserves complete status details.
- Capture permissions and media-save IPC are restricted to their intended renderer boundaries.

### Scope

- Local live sources render only in the desktop app and Electron desktop output windows; browser/OBS URL outputs do not receive local capture streams.
- ShowSlate remains a room-display compositor, not a streaming encoder, multibus audio mixer, NDI router or advanced broadcast switcher.
- Physical capture-card compatibility and physical Windows operation require device-specific testing; synthetic and packaged checks do not certify every hardware/driver combination.

## 0.10.0-beta.1 - 2026-08-08

### Added

- Added safe show-folder import for CSV/TSV schedules and supported media, with conservative cue-to-asset matching and bounded scan limits.
- Added Audience, Confidence, Timer, Stream Graphics and Door Agenda output roles.
- Added per-route Program revision dispatch and renderer acknowledgement shown as SYNCING or RENDER CONFIRMED.
- Added conference-specific preflight checks for Audience routing, display assignments, cue actions, media mapping and output delivery.
- Added a visible Live Mode and a built-in six-cue conference demo.
- Added the Conference Desk workflow reference, source-user sample folder and desktop/mobile public-site renderer checks.

### Changed

- Repositioned the product as ShowSlate Conference Desk for one local conference room while retaining the ShowSlate executable and user-data identity.
- GO now sends the LIVE cue, timer, linked content and immediate automatic lower third in one Program revision.
- Rebuilt the public website, metadata, social preview, README and download guidance around the Conference Desk workflow.

### Fixed

- Stream Graphics now remains fully transparent during state changes and does not acknowledge a revision until transparency and the expected lower third are rendered.
- Live Mode commands remain readable and reachable at 900x600.
- Conference UI tests now finish autosave before removing their isolated profile.

### Scope

- Direct Excel workbook parsing, camera switching, audio, NDI, encoding, PTZ, DMX, cloud collaboration and multi-room synchronization remain outside this beta.
- External OBS/vMix alpha capture and physical Windows operation remain unproven until separately tested.

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
