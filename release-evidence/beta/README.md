# Beta release evidence

ShowSlate compositor betas are published only after the exact candidate has passed the live-source and installation checks in this directory.

## Process

1. Finish the candidate on `main` and run the release workflow manually. This builds native Mac and Windows packages without publishing them.
2. Test those candidate artifacts on physical Mac and Windows systems. Complete every gate in `example.json`, including real window/display capture and a physical UVC capture card with audio.
3. Copy `example.json` to `<version>.json`, for example `0.11.0-beta.1.json`. Set `testedCommit` to the exact commit used by the successful manual workflow run and record that run as `candidateRunId`.
4. Commit only that completed evidence file. The evidence commit must have the tested candidate as its direct parent; do not mix code or documentation changes into it.
5. Tag the evidence-only commit. The beta workflow verifies the evidence, candidate run, Git history and retained artifacts before it builds or publishes anything.

The evidence file is intentionally strict. A synthetic stream proves internal transport but cannot satisfy physical camera, capture-card or capture-card-audio gates. A blocked permission screen does not satisfy window or display capture. Keep evidence in a durable repository path, issue or discussion and exclude customer data, private media, local IP addresses and access tokens.

Manual workflow dispatches remain available for package rehearsals without an evidence file. Only a beta tag can publish a prerelease.
