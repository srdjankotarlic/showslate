# System Requirements

## Release status

ShowSlate Live Compositor `0.12.0-beta.2` targets Apple Silicon Macs and Windows x64. Windows packages are produced in CI but still need broader real-hardware feedback.

## macOS release candidate

- Apple Silicon Mac (`arm64`).
- macOS 13 Ventura or later recommended.
- 8 GB RAM minimum; 16 GB recommended, and 32 GB recommended for UHD/large stills, several video layers or multiple outputs.
- 500 MB free disk space for the app, plus space for show media, backups and Program recordings. High-bitrate or long recordings can require many gigabytes.
- 1280x800 recommended controller workspace; the responsive UI is tested down to 900x600.
- One or more external displays for speaker, confidence or venue output workflows.
- A dedicated show computer is strongly recommended when several output roles or video/PDF media are active.
- Window/display capture requires macOS Screen Recording permission. Camera and audio-input access are requested separately from the capture-device picker; macOS can require ShowSlate to be restarted after changing a denied permission in System Settings.

Intel Macs are not part of the current release candidate.

## Windows candidate

- Windows 10 or Windows 11, 64-bit.
- 8 GB RAM minimum; 16 GB recommended.
- 500 MB free disk space, plus show media and Program recordings.
- 1280x800 recommended controller workspace.

Windows is a beta target. Verify the installer or portable build on the exact show computer before using it at an event.

For live video input, use a camera or capture card exposed to the operating system as a standard UVC/video-input device. Audio must be exposed as a selectable system audio-input device. Vendor drivers and copy-protected HDMI sources can prevent capture even when the hardware is connected.

## Network

The controller, browser outputs, remote, backstage and Signal Light are designed for a trusted local production network.

- TCP `7878` is the preferred local web port. If occupied, the app tries the next ports up to `7888`.
- UDP `7879` is the default OSC control port.
- Allow the app through the operating-system firewall on private networks.
- Put the show computer and browser devices on the same wired LAN or private production Wi-Fi.
- Do not expose the local ports directly to the public internet.
- Optional online sharing uses an external tunnel and therefore requires internet access; it is not required for normal local operation.

## Media

Show-folder, screen content and Canvas media accept PNG, JPEG, GIF, WebP, AVIF, BMP, SVG, MP4, M4V, MOV, WebM, OGV and PDF files. Lower Third Studio accepts the same image/video containers except PDF.

Live playback has no fixed app-level file-size cap. ShowSlate preserves original bytes, manages files up to 512 MB in its profile and links larger files at their original path. The local media service supports byte-range seeking above 4 GB, so a multi-gigabyte video is not read into memory as one object. Use a fast local SSD or high-throughput external SSD; avoid network, cloud-synchronized and slow removable locations for show-critical media.

Container support does not guarantee every codec profile. Hardware-decodable MP4/H.264 is the safest broad choice; HEVC availability varies by operating system and hardware. Large still images are decoded into memory, so their pixel dimensions can matter more than compressed file size. Portable `.showslate-show` and `.showslate-lt` packages allow at most 200 MB per embedded asset and do not embed linked originals.

Schedules must be CSV, TSV or text. Export an Excel workbook to CSV/TSV or paste its rows into the setup wizard.

Codec support is not the same as guaranteed alpha behavior in every external production application. Test every final media asset on the actual show computer and output path before doors open.

## Program recording

ShowSlate records the Program canvas through the encoders exposed by the bundled Electron/operating-system media stack. Automatic mode prefers MP4/H.264 and falls back to WebM when MP4 is unavailable. Exact format support can therefore differ by platform and hardware.

Recording 1080p30 is the practical starting point. 1440p, 4K and 50/60 fps require substantially more GPU, CPU, storage throughput and free disk space, especially while decoding several videos or driving multiple outputs. Use a fast local SSD, close non-show applications and make a timed rehearsal with the final Canvas, media, audio route and expected show duration.

## Production recommendation

Use a dedicated show computer, wired power, disabled sleep/automatic updates and a tested backup plan. Run Preflight after displays and media are connected, then verify every Program destination before the audience enters.
