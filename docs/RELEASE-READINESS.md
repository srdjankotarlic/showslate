# Release readiness

Status audited against the `0.9.0-beta.3` release candidate on 2026-08-08. `PROVEN` means current retained evidence covers the claim; `PENDING` means the requirement is not complete and must not be marketed as complete.

| Requirement | Status | Current evidence | Remaining gate |
|---|---|---|---|
| Public source and usage rights | PROVEN | Public GitHub repository, MIT `LICENSE`, source and packaged free-build checks. | None for beta use. |
| Recoverable source history | PROVEN | Public and original private repositories are pushed; complete local Git bundles were created, verified and checksummed outside the repositories. | Copy the bundle set to a second physical/cloud location for disaster recovery. |
| Lower Third Studio implementation | PROVEN ON TESTED MAC | Template/layer editor, Preview/Take/Hide, package validation and runtime renderer passed source and packaged regression plus a visible-control real-user workflow. | Independent operators and external production integrations remain pending. |
| Lower-third codec behavior | PARTIAL | MP4/H.264 and WebM VP8/VP9 decode/runtime and internal alpha-pixel tests passed in source and packaged Electron. | External OBS/vMix alpha workflow remains uncertified. |
| Multi-output routing model | PROVEN ON TESTED MAC | Exact-display identity, no-fallback behavior, fullscreen/window/custom/grid geometry and simultaneous route state passed source and packaged Mac regression. | Clean physical Windows and additional real venue display chains. |
| Operator UI and branding | PROVEN FOR CURRENT SCREENSHOTS | Responsive viewport matrix, sidebar/drawers, current icon and retained operator/Lower Third Studio screenshots passed on Electron 43. | Broader accessibility and independent operator feedback. |
| Localization | PARTIAL | English and Serbian are maintained as `FULL`; 35 packs are labelled `CORE`, use English fallback and retain RTL direction where required. | Native-language editorial review is required before any CORE pack is promoted to FULL. |
| Headless correctness | PROVEN | All 12 deterministic module scripts pass locally and run in GitHub CI. | Headless tests do not replace visible or physical QA. |
| Native unsigned packaging | PROVEN | Apple Silicon package passed local package/DMG/fuse checks; GitHub macOS and Windows runners build and inspect platform artifacts. | Packages remain unsigned public-beta artifacts. |
| Public beta distribution | READY TO PUBLISH | Landing page, release workflow, checksums, provenance attestations, DMG, Windows installer and portable downloads are configured for Beta 3. | Verify the public tag assets and links after publication. |
| Stable signing automation | IMPLEMENTED | Candidate workflow verifies Developer ID/notarization and Authenticode/timestamps; publication is a separate exact-artifact evidence gate. | Signing secrets are not configured, so no signed stable candidate exists. |
| macOS stable release | PENDING | Local ad-hoc DMG/CLI/fuse checks pass. | Developer ID, notarization, signed-candidate clean install and Gatekeeper/multi-display evidence. |
| Windows stable release | PENDING | Native CI produces and inspects unsigned x64 packages. | Authenticode certificate, signed clean-machine installer/portable/firewall/multi-display/uninstall evidence. |
| External operator validation | PENDING | Public feedback channels exist. | At least one independent operator must complete a documented beta with zero open release blockers. |
| Adoption or sales result | NOT PROVEN | GitHub exposes aggregate asset counters only; they do not identify unique external users. | Recruit and document real operators; do not infer adoption from self-downloads or CI artifacts. |

## Current decision

`0.9.0-beta.3` is suitable for an honest public evaluation release. It is not ready to be called stable or production-certified.

The Electron 43 source and packaged display gates passed on explicitly selected Mac displays. Do not publish a stable release until the signed draft candidate passes every machine-readable gate in [release-evidence](../release-evidence/README.md), physical Windows QA and independent operator validation.

The public MIT decision supersedes the earlier proprietary-license plan for this repository. Do not reintroduce activation, trial watermarking or paid-license keys into this free build.
