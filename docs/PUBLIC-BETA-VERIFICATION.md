# Public Beta Verification

Verified for `0.10.0-beta.1` on 2026-08-08. This page separates what was physically exercised from what was only built or inspected.

## Physical Mac verification

The complete source smoke and a fresh packaged Apple Silicon `.app` smoke both passed on the explicitly selected physical `PHL 243V7` display. The test resolver fails closed if that display is missing or ambiguous and does not fall back to another monitor.

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
- Lower Third Studio persistence, drag/resize, selected-cue Preview isolation, LIVE-cue TAKE and HIDE media cleanup;
- PNG/JPG/SVG, MP4, WebM VP8 and WebM VP9 renderer fixtures, including internal alpha-pixel checks;
- local network views, remote/API controls, reports, CSV export, localization, autosave, crash recovery and portable show packages.

Both full smoke runs ended with `SMOKE_OK`. A targeted lower-third soak completed 150/150 cycles with the expected template, instance, cue and rendered text on every cycle; no first failure was recorded.

## Automated evidence

- `npm test`: all 15 module scripts passed, together with free-build, icon and public-site checks.
- Visible Electron renderer suite: all seven workflow scripts passed.
- Conference Desk renderer: `13/13` checks passed.
- Responsive beta usability matrix: `55/55` checks passed at 1440x900, 1280x800, 1024x700 and 900x600.
- Public website renderer: `7/7` desktop/mobile checks passed with no horizontal overflow and all local product images loaded.
- Production dependency audit: zero known vulnerabilities.
- Mac and Windows packaged-content checks: `PACKAGED_FREE_BUILD_OK`, 1,441 archive entries each, MIT package and no activation/private-key files.
- Mac DMG checksum verification: valid.

Release builds record the exact full commit and dirty state. Tagged GitHub builds generate SHA-256 checksums and provenance attestations.

## Platform truth

### Proven on physical hardware

- Apple Silicon macOS application on a physical Philips display.
- Source and packaged output routing, local network renderer and lower-third/media workflows.

### Built and structurally inspected, not physically certified

- Windows 10/11 x64 NSIS installer and portable package.
- Their PE format and packaged application contents were inspected locally; native Windows execution still requires the Windows CI run and a clean physical-machine beta test.

### Still not proven

- Developer ID signing/notarization and Windows Authenticode signing.
- Clean physical Windows install, firewall, multi-display, portable and uninstall workflows.
- Intel Mac support.
- External OBS/vMix video-alpha integration. Internal Electron alpha compositing is proven, but that does not certify another application's browser/media pipeline.
- NDI, window capture, camera switching, streaming/encoding, audio mixing or cloud collaboration.
- Independent operator adoption or production certification.

These gaps are why the release is labelled **public beta**. Test the exact show computer, display chain, network and final media before using it on-air.
