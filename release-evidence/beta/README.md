# Beta release evidence

This optional checklist records physical live-source and installation testing for a ShowSlate compositor beta. It is not required to publish an explicitly experimental prerelease, and an incomplete file must never be presented as certification.

## Process

1. Run the release workflow manually for the exact candidate commit. This builds native Mac and Windows packages without publishing them.
2. Test those candidate artifacts on physical Mac and Windows systems. Work through `example.json`, including real window/display capture and a physical UVC capture card with audio.
3. Copy `example.json` to `<version>.json`, for example `0.11.0-beta.1.json`. Record the exact tested commit, candidate run and retained evidence.
4. Keep failed or untested gates false. Use `tools/verify-beta-release-evidence.js` only when every gate is genuinely complete.

The evidence file is intentionally strict. A synthetic stream proves internal transport but cannot satisfy physical camera, capture-card or capture-card-audio gates. A blocked permission screen does not satisfy window or display capture. Keep evidence in a durable repository path, issue or discussion and exclude customer data, private media, local IP addresses and access tokens.

Experimental beta tags may publish without this optional physical record. Their release notes and limitations must state exactly which hardware workflows remain unverified. Stable releases continue to use the mandatory evidence gate in the parent directory.
