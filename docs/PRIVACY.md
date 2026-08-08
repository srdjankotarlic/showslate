# Privacy Notice

Effective date: 2026-07-12

ShowSlate is designed as a local-first desktop application. It does not require an account for normal operation and does not include product analytics, advertising trackers or behavioral telemetry.

## Data stored on the computer

The app may store the following in the operating system's application-data directory:

- interface preferences and language;
- current show, autosave state and bounded backups;
- imported media used by shows and lower-third templates;
- recent operational state needed for recovery.

Portable `.showslate-show` and `.showslate-lt` files are created only when the user exports them. They may contain show names, cue text, speaker details, logos and referenced media chosen by the user. Legacy `.protimer-show` and `.protimer-lt` packages can still be imported.

## Local network data

When running, the app starts local web and OSC services for output screens, phone remote, backstage, Signal Light and integrations. Show state is transmitted to devices that connect to those local addresses. Some read-only views are not password protected; use them only on a trusted production LAN.

Remote and structured control URLs use a random per-launch token. The app does not intentionally include the complete private template/media library in structured status responses.

## Optional public sharing

Public sharing is off until the user starts it. When enabled, the app uses the third-party `localtunnel` service to expose the local web service through an internet URL. Network metadata and any content requested through that URL pass through infrastructure outside ShowSlate's control. Do not enable public sharing for confidential shows without assessing that risk.

## GitHub and support

GitHub hosts the source, releases, issues and discussions under GitHub's own privacy terms. Issue reports may include contact details, logs, screenshots or show information that the user chooses to submit. Remove confidential client, speaker, network-token and venue data before posting diagnostic material.

## Retention and deletion

Local show data remains on the user's computer until the user removes it or uninstalls and deletes application data. Public GitHub content can be edited or deleted through the user's GitHub account and GitHub support processes.

## Security

No software or network path can be guaranteed completely secure. Operators are responsible for protecting the show computer, production LAN, exported packages and remote-control URLs.

Questions can be opened in GitHub Discussions. Security reports must use private vulnerability reporting.
