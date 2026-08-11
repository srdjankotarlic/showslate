# Public Beta Verification

Verified for the `0.11.0-beta.1` release candidate through 2026-08-11. This page separates what was exercised on the tested Mac from what was only automated, built or structurally inspected.

## 2026-08-11 multi-output mapping update

Targeted source and freshly packaged Apple Silicon checks passed on the explicitly selected `PHL 243V7` display from clean commit `11489f9c3dcbb21cdf8dd90d4beb70704f81e27d`.

- Two output windows received and acknowledged the same Program revision simultaneously.
- The first route used a 1920x1080 Canvas with Fit scaling, four-corner projector warp and a visible 8x6 calibration grid.
- The second route independently used a 1000x1000 Canvas with Cover scaling and no projector warp.
- Both routes reached the real `live` acknowledgement state; the check does not pass on merely open or still-syncing windows.
- Missing-display and exact-display reconnection behavior remained fail-closed.

This proves ShowSlate's per-route configuration, full-Program renderer transform and delivery acknowledgement on the tested Mac. It does not certify alignment, brightness, focus, lens geometry, processor behavior or color on every physical projector or LED installation.

## Physical Mac verification

The complete source smoke and a fresh packaged Apple Silicon `.app` smoke both passed on the explicitly selected `Built-in Retina Display`. The test resolver fails closed if that display is missing or ambiguous and does not fall back to another monitor.

The verified Conference Desk workflow includes:

- visible show-folder import with CSV/TSV schedule parsing and safe media matching;
- an off-air setup result with linked cues, copied assets and an Audience route;
- preflight checks for the show, mapped media, output roles and actual render acknowledgements;
- one atomic GO revision for LIVE cue, timer, linked content and automatic lower third;
- Audience, Confidence, Timer, Stream Graphics and Door Agenda output roles;
- multiple simultaneous fullscreen, window, custom-size and grid routes;
- exact-display reconnection and safe handling of missing displays;
- Live Mode with risky editing locked and GO reachable at 900x600;
- images, logos, PDF navigation, MP4/WebM playback, scenes and linked screen content;
- custom-resolution Canvas scenes with ordered color, picture, video, text and timer layers;
- visible scene controls, layer selection, drag/resize handles, exact transform controls and Preview/TAKE isolation;
- non-native display-fill fullscreen routes that cover the selected display without creating a separate macOS Space;
- Lower Third Studio persistence, drag/resize, selected-cue Preview isolation, LIVE-cue TAKE and HIDE media cleanup;
- PNG/JPG/SVG, MP4, WebM VP8 and WebM VP9 renderer fixtures, including internal alpha-pixel checks;
- local network views, remote/API controls, reports, CSV export, localization, autosave, crash recovery and portable show packages.

Both full smoke runs ended with `SMOKE_OK`: one from source and one from the freshly packaged Apple Silicon `.app`. A targeted lower-third soak completed 150/150 cycles with the expected template, instance, cue and rendered text on every cycle; no first failure was recorded.

The live-input service also passed its targeted synthetic-stream test. A hidden capture hub produced one 1280x720/30 fps video track and one audio track, distributed the stream to Preview and desktop Program consumers over local WebRTC, kept Preview muted and stopped/reconnected cleanly. This proves the internal transport and lifecycle, not compatibility with every physical capture device.

## Automated evidence

- `npm test`: all 16 module scripts passed, together with free-build, icon and public-site checks.
- Visible Electron renderer suite: all eight workflow scripts passed.
- Conference Desk renderer: `13/13` checks passed.
- Canvas/compositor renderer: `16/16` checks passed, including 900x600 reachability, layer order, hidden-source retention, visible privacy-settings recovery actions, transform persistence and Preview/TAKE isolation.
- Targeted live-input and multi-output checks passed, including simultaneous Program routes, fail-closed missing-display handling and the one-Program-audio-route guard.
- Responsive beta usability matrix: `56/56` checks passed at 1440x900, 1280x800, 1024x700 and 900x600.
- Public website renderer: `7/7` desktop/mobile checks passed with no horizontal overflow and all local product images loaded.
- Production dependency audit: zero known vulnerabilities.
- Mac and Windows packaged-content checks: `PACKAGED_FREE_BUILD_OK`, 1,449 archive entries each, MIT package and no activation/private-key files.
- Mac DMG checksum verification: valid.
- Untagged native release rehearsal [GitHub Actions run 31308928626](https://github.com/srdjankotarlic/showslate/actions/runs/31308928626): macOS and Windows jobs both passed from exact clean commit `09f4e7d6c007e364355ade270a092ed11937cca0`; the Windows runner successfully booted the packaged EXE in CLI verification mode. The run produced the Mac DMG, Windows installer and Windows portable artifacts, then correctly skipped publication because no release tag existed.

Release builds record the exact full commit and dirty state. Tagged GitHub builds generate SHA-256 checksums and provenance attestations.

The compositor beta is published as an experimental prerelease after automated checks and native Mac/Windows package builds. Physical window/display capture, UVC capture-card video/audio and Windows GUI evidence are not publication requirements for this beta and are not claimed as proven. The optional record in `release-evidence/beta` remains incomplete.

## Platform truth

### Proven on physical hardware

- Apple Silicon macOS application on the Mac's Built-in Retina Display.
- Source and packaged output routing, custom Canvas/layer composition, local network renderer and lower-third/media workflows.

### Built natively and structurally inspected, not physically certified

- Windows 10/11 x64 NSIS installer and portable package.
- Their PE format and packaged contents were inspected locally, and the native Windows workflow completed package construction plus packaged CLI boot. A clean physical-machine GUI test is still required.

### Still not proven

- Developer ID signing/notarization and Windows Authenticode signing.
- Clean physical Windows install, firewall, multi-display, portable and uninstall workflows.
- Intel Mac support.
- A manual normal-UI run reached the real window/display source picker on 2026-08-09, but macOS Screen Recording access was disabled. The blocked state and its direct System Settings action are verified; a real captured frame is still not claimed until access is enabled and the app is restarted.
- Physical camera or UVC capture-card compatibility, including device audio, drivers, source formats and HDCP behavior.
- External OBS/vMix video-alpha integration. Internal Electron alpha compositing is proven, but that does not certify another application's browser/media pipeline.
- NDI, camera switching, streaming/encoding, multibus audio mixing or cloud collaboration.
- Independent operator adoption or production certification.

Window/display and device capture are local to ShowSlate and its desktop output windows. They are not sent through the browser/OBS URL. Preview is always muted, and only one local Program destination can carry live-input audio at a time.

These gaps are why the release is labelled **public beta**. Test the exact show computer, display chain, network and final media before using it on-air.
