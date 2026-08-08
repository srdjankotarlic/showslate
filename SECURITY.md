# Security notes

ShowSlate is a local-first desktop app for live production. It is intended to run on a trusted show computer and a trusted production LAN.

## Packaged application hardening

Release packages disable Electron's Run-as-Node, `NODE_OPTIONS` and CLI inspector fuses. They enable embedded ASAR integrity validation and allow application code to load only from `app.asar`. Production BrowserWindows use context isolation with Node integration disabled; the one `webSecurity: false` window is a hidden fixture probe reachable only in the explicit smoke path.

These controls supplement code signing; they do not replace Developer ID/notarization on macOS or Authenticode on Windows.

## Network control

ShowSlate exposes local browser views on the production network:

- `/` and `/output.html` for the screen / OBS output
- `/remote?t=<token>` for phone remote control
- `/backstage` for crew schedule view
- `/signal` for the podium signal light
- `/events` for read-only live state updates
- `/cmd?type=...&t=<token>` for HTTP control integrations
- `/api/status...?...t=<token>` for bounded show/cue/lower-third/content status

Remote, HTTP command, and structured status endpoints require a random per-launch token. Share the remote/API links only with operators who should be allowed to control or inspect the show.

The browser output, backstage, signal, and legacy SSE event endpoints do not require a token. Use them only on networks where showing the timer/rundown state is acceptable. The structured `/api/status` endpoints are token-protected and intentionally exclude the token, private configuration, full rundown, cue notes, media assets, and lower-third template library.

## OSC control

OSC input listens on UDP port `7879` by default and accepts `/showslate/<command>` messages from the LAN. Legacy `/protimer/<command>` aliases remain accepted for existing integrations. OSC does not use the HTTP token because common show-control tools such as Companion, TouchOSC, QLab-style workflows, and hardware bridges often expect simple local UDP control.

Treat OSC as a trusted-LAN integration:

- Do not expose UDP `7879` to the public internet.
- Use a private production Wi-Fi/VLAN when possible.
- Disable untrusted clients on the show network before using OSC control.

## Public sharing

The public sharing/tunnel feature is useful for demos or remote viewing, but it should not be treated as a hardened production access-control system. For confidential or high-stakes shows, prefer local LAN links and only share remote-control URLs deliberately.

## Reporting issues

Do not post vulnerability details in a public issue. Use GitHub's private vulnerability reporting for this repository. Include the affected version, platform, impact and reproduction steps without attaching confidential show data.
