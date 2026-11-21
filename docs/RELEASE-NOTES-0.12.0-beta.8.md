# ShowSlate 0.12.0 Beta 8

I’m Srdjan Kotarlic. ShowSlate is my hobby project for experimenting with live production workflows inspired by OBS Studio and Resolume Arena. It brings together layered scenes, Preview/Program switching, recording, room displays and event cues.

This is an unfinished public beta. I’m sharing the program and code so we can test and improve it together. Try it off-air and tell me what breaks, what is confusing and what you expected to happen. Include your version, operating system, media and display setup, and steps I can repeat. [Report an issue](https://github.com/srdjankotarlic/showslate/issues/new?template=bug_report.yml) · [Share feedback](https://github.com/srdjankotarlic/showslate/discussions) · [Contribute code](https://github.com/srdjankotarlic/showslate/blob/main/CONTRIBUTING.md)

## Changes

- The rundown editor rejects malformed durations and zero-length cues when adding or editing an item.
- Archive and packaging dependencies were updated following npm audit.
- The README and bug form explain the project’s beta status and invite feedback across all parts of the app.

## Downloads

- [Apple Silicon Mac DMG](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.8/ShowSlate-0.12.0-beta.8-arm64.dmg)
- [Experimental Windows x64 Setup](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.8/ShowSlate-Setup-0.12.0-beta.8.exe)
- [Experimental Windows portable](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.8/ShowSlate-0.12.0-beta.8-portable.exe)
- [SHA-256 checksums](https://github.com/srdjankotarlic/showslate/releases/download/v0.12.0-beta.8/SHA256SUMS.txt)

GitHub’s **Source code** ZIP and TAR.GZ archives will not install ShowSlate. [Beta 7](https://github.com/srdjankotarlic/showslate/releases/tag/v0.12.0-beta.7) remains available for rollback.

Mac packages use ad-hoc signing. Windows physical hardware, UVC capture devices, venue LED/projector chains and sustained 4K60 require separate testing.

The November 21 rehearsal used a separate PHL 243V7 monitor and generated media. It covered Preview/Program, cue control, local and browser outputs, video, PDF, lower thirds, saving and show recovery. The baseline rehearsal passed 323 checks. Duration validation has a dedicated renderer regression.
