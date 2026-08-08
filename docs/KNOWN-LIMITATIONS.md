# ShowSlate Conference Desk Public Beta Known Limitations

- The public Mac beta has an ad-hoc bundle signature and is not Apple Developer ID signed or notarized. macOS can require explicit approval in Privacy & Security on first launch.
- The Mac beta is Apple Silicon only. Intel Mac packages are not currently published.
- The public Windows x64 installer and portable app are unsigned. Windows SmartScreen can show an Unknown publisher warning, and broader physical Windows hardware testing is still required.
- `0.10.0-beta.1` uses Electron 43.1.1. Local source and packaged evidence is limited to the displays and hardware listed in [PUBLIC-BETA-VERIFICATION.md](PUBLIC-BETA-VERIFICATION.md); this does not replace physical Windows or additional venue display-chain testing.
- Fail-closed stable candidate and publication workflows are present, but no signed stable artifact exists until real Apple and Windows credentials pass native verification and exact candidate artifacts pass the retained hardware/operator evidence gate.
- OBS and vMix browser-source workflows have not received a complete manual integration pass. Do not treat them as certified integrations.
- MP4 playback and WebM VP8/VP9 decode and internal alpha compositing are covered by source and packaged Electron tests. Reliable alpha in external production software still depends on that application's codec and browser pipeline and is not certified in this beta.
- NDI, window capture, streaming/encoding, audio mixing and cloud collaboration are intentionally outside this beta scope.
- The product coordinates one conference room. Multi-room synchronization, registration systems, camera switching, audio mixing, PTZ, DMX and streaming are not included.
- Show-folder import reads CSV, TSV or text schedules. Excel `.xlsx`/`.xls` files must be exported to CSV/TSV or pasted into the wizard.
- Automatic media matching is intentionally conservative. Confirm every matched and unmatched asset before GO.
- Output render acknowledgement proves the expected state reached ShowSlate's renderer; it cannot prove that a downstream projector, capture card or external application displays the signal correctly.
- The app is designed for local/offline event operation. Online sharing through a tunnel depends on network access and the external tunnel service.
- Operators should run preflight and verify every physical display, media asset and lower-third animation before doors open.
