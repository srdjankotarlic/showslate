# Public Beta Verification

Verified for `0.9.0-beta.3` on 2026-08-08. This page separates what was physically exercised from what was only built or checked in automation.

## Mac display regression

The complete source Electron suite passed on the built-in Retina display, and the fresh packaged suite passed on a physical `PHL 243V7` display. Both runs used an explicitly selected display and failed closed when that requested display was unavailable.

Covered workflows include:

- rundown selection, LIVE state, GO transaction, timer continuity, reports and CSV;
- responsive operator access from 1440x900 down to 900x600;
- multiple fullscreen, window, custom-size and grid output routes;
- missing-display fail-safe behavior and exact-display reconnection;
- screen content, image/logo media, PDF, MP4 and browser outputs;
- Lower Third Studio visibility, template persistence, drag/resize, Preview isolation, TAKE from the LIVE cue and HIDE cleanup;
- PNG/JPG/SVG, MP4, WebM VP8 and WebM VP9 renderer fixtures, including internal alpha-pixel checks;
- local network views, remote/API controls, localization, autosave, crash recovery and portable show packages.

The packaged run used a fresh isolated profile and a newly built Apple Silicon application. A separate real-user pass used only visible controls and the macOS file picker to exercise Rundown/Slides navigation, both side panels, window resizing, output routing and the complete Lower Third Save/Preview/Take/Hide/reopen workflow with a transparent WebM asset. Chromium cookie encryption is deliberately disabled because ShowSlate has no account or cookie-based login; this also prevents an unnecessary macOS Safe Storage Keychain prompt.

## Headless and repository checks

- `npm test`: all 13 module scripts passed, together with free-build, icon and public-site checks.
- The public site includes canonical metadata, Open Graph/Twitter data, SoftwareApplication and FAQ structured data, sitemap, robots file and local screenshots.
- Release builds record the exact full commit and dirty state.
- Packaged-content checks reject activation modules, license generators and private keys from the public MIT build.
- Beta workflow artifacts receive SHA-256 checksums and GitHub provenance attestations.

## Platform truth

### Proven on physical hardware

- Apple Silicon macOS build, built-in Retina and physical Philips display paths, local network renderer and packaged lower-third/media workflows.

### Built and inspected in CI, not physically certified

- Windows 10/11 x64 installer and portable package.

### Still not proven

- Developer ID signing/notarization and Windows Authenticode signing.
- Clean physical Windows install, firewall, multi-display, portable and uninstall workflows.
- Intel Mac support.
- External OBS/vMix video-alpha integration. Internal Electron alpha compositing is proven, but that does not certify another application's browser/media pipeline.
- NDI, window capture, streaming/encoding, audio mixing or cloud collaboration.
- Independent operator adoption or production certification.

These gaps are why the release is labelled **public beta**. Test the exact show computer, display chain, network and media before using it on-air.
