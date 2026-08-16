# ShowSlate Live Compositor public beta plan

The immediate objective is not a large download number. It is to learn whether a real single-room operator can prepare, preflight and run a conference without manually synchronizing a spreadsheet, timer, media folder and speaker graphics.

## First validation cohort

Recruit 8 to 10 people from these roles:

- freelance AV technicians who run corporate conferences;
- in-house conference-center or hotel AV operators;
- university or training-room technicians;
- small production teams using a projector plus confidence monitor;
- one OBS/vMix operator who can evaluate Stream Graphics off-air;
- at least one Windows operator with two physical displays.

At least three should complete the room workflow below. At least one independent operator must complete a documented beta with no unresolved release blocker before any stable claim.

## Operator task

1. Install the beta on a non-critical computer.
2. Create a Canvas scene with a color layer, picture and video with audio; reorder and resize the layers, save, close and reopen the show.
3. Add a real application window and a real display as separate sources. Confirm Preview does not change Program, then TAKE each source and reconnect it once.
4. Add a camera, then a physical UVC capture card carrying video and embedded audio. Confirm the requested format, Preview mute, Program audio and media cleanup after HIDE/stop.
5. Open two local Program destinations. Confirm only one carries audio and the second audio route is visibly blocked.
6. Resize the operator window from 1440x900 down to 900x600 and confirm Composer, layers, source inspector, TAKE and Outputs remain reachable.
7. Run **Load conference demo** and identify the attached displays.
8. Assign Audience and Confidence roles, then run **Test outputs**.
9. Select NEXT and complete three GO transitions. Confirm linked content, speaker timing and lower third stay on the same cue.
10. Send and clear one presenter message, disconnect/reconnect one output display and confirm fail-safe behavior.
11. Import a small real or anonymized CSV/media folder, then export and reopen a `.showslate-show` package.
12. Report the first confusing step, any incorrect output and whether this would replace part of the current room workflow.

Ask for app version, OS, CPU, display arrangement and exact reproduction steps. Never ask testers to publish client names, speaker data, private IP addresses, tokens or confidential media.

## Natural outreach copy

### Suggested Reddit title

`Free offline conference room control app - looking for AV operators to test it off-air`

### Suggested post

I built ShowSlate as a local live compositor for small productions that need layered media and live inputs, Preview/Program switching and controlled display outputs. It also includes a Conference Desk workflow for rundowns, speaker timing and cue-driven graphics.

Import a CSV/TSV and its media, assign Audience/Confidence/Timer/Stream/Door outputs, run preflight, then use one GO to update the live cue, timer, linked content and lower third.

It is free, open source and local-first. Apple Silicon Mac is the primary tested beta; the Windows x64 build is experimental and still needs physical hardware validation:
https://srdjankotarlic.github.io/showslate/

I am looking for room operators willing to try the built-in demo off-air and tell me where the workflow is unclear or wrong. It is a public beta, unsigned, and external OBS/vMix alpha capture is not certified.

Use the current social preview with the post:

![ShowSlate Live Compositor preview](../site/assets/social-preview.png)

## Feedback and metrics

- Bugs: GitHub bug-report form.
- Setup questions and workflow feedback: [GitHub Discussions](https://github.com/srdjankotarlic/showslate/discussions).
- Private security issues: GitHub private vulnerability reporting.
- Weekly signals: completed operator workflows, first-run blockers, unresolved defects, repository visitors/clones and release-asset counters.

GitHub asset counters are aggregate downloads, not verified people, installations or successful room tests. The primary success metric is a completed independent workflow with enough evidence to reproduce and fix failures.

## Weekly loop

1. Invite a small relevant group instead of repeating the same post broadly.
2. Reproduce every credible issue on the same viewport/output role before changing the product.
3. Fix setup and live-output blockers before adding features.
4. Publish a beta only after source, packaged and designated-display gates pass.
5. Ask the original reporter to retry the exact failed step.
6. Stop expanding scope if operators do not value the Conference Desk workflow after three complete pilots.

## Optional physical QA record

A native package rehearsal plus automated checks can publish an explicitly experimental beta. Use [`release-evidence/beta`](../release-evidence/beta/README.md) to retain physical QA when the required hardware and Windows system are available; it remains mandatory before making any physical-certification claim.

Synthetic capture tests, a permission warning or a natively built Windows executable do not count as physical source or Windows GUI proof. Leave those gates failed until the real workflow is observed and retained, and state the gap in public beta notes.
