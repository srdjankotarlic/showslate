# Contributing

Thanks for helping make ShowSlate more reliable for real events.

## Before coding

- Search existing issues and discussions.
- Use an issue for a bug or focused change before opening a large pull request.
- Keep timer, GO, Program and output behavior backward-compatible unless the issue explicitly changes that contract.
- Do not reintroduce an activation gate, trial watermark or proprietary dependency into the free build.

## Setup

```bash
git clone https://github.com/srdjankotarlic/showslate.git
cd showslate
npm ci
npm test
npm start
```

## Tests

Every pull request must pass:

```bash
npm run check:free
npm audit
npm test
```

Visual Electron tests require an explicit safe display. Configure `.showslate-smoke-display.json` locally (it is ignored) or pass a display label:

```bash
node tools/run-smoke-on-display.js --display "Your test monitor" --source
```

Never run display tests on a monitor another person is actively using.

## Pull requests

- Keep changes focused and explain user-visible behavior.
- Add focused tests for shared models, storage, imports, APIs or output routing.
- Include screenshots for UI changes at 1440x900, 1024x700 and 900x600.
- Do not commit build outputs, user shows, network tokens or private media.
- Confirm the app remains usable with English as the default language.

By contributing, you agree that your contribution is licensed under the repository's MIT License.
