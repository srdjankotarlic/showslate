'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  classifyTag,
  expectedArtifactNames,
  parseChecksums,
  validateReleaseEvidence,
  validateBetaReleaseEvidence
} = require('../src/release/evidence.js');

const tag = 'v1.0.0';
const commit = 'a'.repeat(40);
const artifacts = expectedArtifactNames(tag);
const hashes = {
  [artifacts[0]]: '1'.repeat(64),
  [artifacts[1]]: '2'.repeat(64),
  [artifacts[2]]: '3'.repeat(64)
};
const checksums = Object.entries(hashes).map(([name, hash]) => `${hash}  ${name}`).join('\n');

function completeEvidence() {
  return {
    schemaVersion: 1,
    releaseTag: tag,
    commit,
    candidateRunId: 123456,
    verifiedAt: '2026-07-20T18:00:00Z',
    artifacts: { ...hashes },
    gates: {
      sourceDisplaySmoke: {
        passed: true,
        completedAt: '2026-07-20T12:00:00Z',
        display: 'PHL 243V7',
        evidence: 'artifacts/release/source-smoke.txt'
      },
      packagedDisplaySmoke: {
        passed: true,
        completedAt: '2026-07-20T12:30:00Z',
        display: 'PHL 243V7',
        evidence: 'artifacts/release/packaged-smoke.txt'
      },
      macCleanInstall: {
        passed: true,
        completedAt: '2026-07-20T14:00:00Z',
        evidence: 'release-qa/mac-signed-candidate.md',
        os: 'macOS 15.5 clean account',
        hardware: 'MacBook Pro Apple Silicon',
        artifact: artifacts[0],
        checks: { install: true, launch: true, gatekeeper: true, multiDisplay: true, networkViews: true, quit: true }
      },
      windowsCleanInstall: {
        passed: true,
        completedAt: '2026-07-20T15:00:00Z',
        evidence: 'release-qa/windows-signed-candidate.md',
        os: 'Windows 11 24H2 clean VM',
        hardware: 'x64 PC with two displays',
        artifacts: artifacts.slice(1),
        checks: { installer: true, portable: true, launch: true, firewall: true, multiDisplay: true, uninstall: true }
      },
      externalOperatorBeta: {
        passed: true,
        completedAt: '2026-07-20T16:00:00Z',
        evidence: 'https://github.com/example/project/issues/10',
        operators: 2,
        releaseBlockers: 0
      },
      releaseDocsReview: {
        passed: true,
        completedAt: '2026-07-20T17:00:00Z',
        evidence: 'release-qa/docs-review.md',
        files: ['README.md', 'docs/KNOWN-LIMITATIONS.md', 'docs/SYSTEM-REQUIREMENTS.md', 'docs/PRIVACY.md']
      }
    }
  };
}

const betaTag = 'v0.11.0-beta.1';
const betaTestedCommit = 'c'.repeat(40);
const betaTagCommit = 'd'.repeat(40);
const betaEvidencePath = 'release-evidence/beta/0.11.0-beta.1.json';
const betaArtifacts = Object.fromEntries(expectedArtifactNames(betaTag).map((name, index) => [name, String(index + 4).repeat(64)]));

function passedGate(extra = {}) {
  return {
    passed: true,
    completedAt: '2026-08-09T10:00:00Z',
    evidence: 'artifacts/beta/manual-qa.md',
    ...extra
  };
}

function completeBetaEvidence() {
  return {
    schemaVersion: 1,
    releaseTag: betaTag,
    testedCommit: betaTestedCommit,
    candidateRunId: 31308928626,
    verifiedAt: '2026-08-09T12:00:00Z',
    candidateArtifacts: { ...betaArtifacts },
    gates: {
      sourceDisplaySmoke: passedGate({ display: 'Built-in Retina Display' }),
      packagedDisplaySmoke: passedGate({ display: 'Built-in Retina Display' }),
      macCleanInstall: passedGate({
        os: 'macOS 15.5', hardware: 'Apple Silicon MacBook Pro with two displays',
        artifact: expectedArtifactNames(betaTag)[0],
        checks: { install: true, launch: true, permissions: true, multiDisplay: true, quit: true }
      }),
      windowsCleanInstall: passedGate({
        os: 'Windows 11 24H2', hardware: 'Physical x64 PC with two displays',
        artifacts: expectedArtifactNames(betaTag).slice(1),
        checks: { installer: true, portable: true, launch: true, permissions: true, multiDisplay: true, uninstall: true }
      }),
      imageColorVideoCanvas: passedGate({
        assets: 'PNG, JPG and MP4 with stereo audio',
        checks: { image: true, color: true, video: true, videoAudio: true, layering: true }
      }),
      windowCapture: passedGate({
        platform: 'macOS 15.5 ShowSlate candidate', source: 'Safari browser window',
        checks: { preview: true, take: true, program: true, reconnect: true }
      }),
      displayCapture: passedGate({
        platform: 'Windows 11 ShowSlate candidate', source: 'Physical HDMI display 2',
        checks: { preview: true, take: true, program: true, reconnect: true }
      }),
      cameraCapture: passedGate({
        device: 'FaceTime HD Camera', format: '1280x720 at 30 fps',
        checks: { preview: true, take: true, program: true, reconnect: true }
      }),
      captureCardVideo: passedGate({
        device: 'Blackmagic UVC capture card with HDMI camera', format: '1920x1080 at 30 fps',
        checks: { preview: true, take: true, program: true, resolution: true, reconnect: true }
      }),
      captureCardAudio: passedGate({
        device: 'Blackmagic UVC capture card with HDMI camera', audioDevice: 'Capture card embedded stereo audio',
        checks: { programAudible: true, previewMuted: true, stopCleanup: true }
      }),
      previewMuted: passedGate({
        scenario: 'Headphones monitoring Preview and Program routes',
        checks: { videoFile: true, window: true, display: true, camera: true, captureCard: true }
      }),
      oneProgramAudioRoute: passedGate({
        scenario: 'Two simultaneous local Program destinations',
        checks: { singleRouteAudible: true, secondRouteBlocked: true, cleanup: true }
      }),
      previewTakeIsolation: passedGate({
        scenario: 'Preview, TAKE and HIDE sequence with live video',
        checks: { previewOnlyNoLiveChange: true, takeMatchesPreview: true, hideStopsMedia: true }
      }),
      resizeAndPersistence: passedGate({
        viewports: '1440x900, 1280x800, 1024x700 and 900x600',
        checks: { resize: true, dragResize: true, saveReopen: true }
      }),
      outputRouting: passedGate({
        displays: 'Built-in Retina Display and external HDMI display',
        checks: { fullscreen: true, window: true, custom: true, multiOutput: true, missingDisplaySafe: true }
      }),
      releaseDocsReview: passedGate({
        files: [
          'README.md', 'docs/KNOWN-LIMITATIONS.md', 'docs/SYSTEM-REQUIREMENTS.md',
          'docs/PRIVACY.md', 'docs/PUBLIC-BETA-VERIFICATION.md', 'docs/BETA-ADOPTION.md'
        ]
      })
    }
  };
}

function expectFailure(label, mutate, pattern) {
  const evidence = completeEvidence();
  mutate(evidence);
  const result = validateReleaseEvidence(evidence, { tag, commit, checksums });
  assert.strictEqual(result.ok, false, `${label} unexpectedly passed`);
  assert.match(result.errors.join('\n'), pattern);
  console.log(`${label}=true`);
}

assert.strictEqual(classifyTag('v1.0.0'), 'stable');
assert.strictEqual(classifyTag('v1.0.0-beta.2'), 'beta');
assert.strictEqual(classifyTag('v1.0.0-rc.1'), 'invalid');
console.log('RELEASE_POLICY_TAG_CLASSES_OK=true');

const parsed = parseChecksums(checksums);
assert.deepStrictEqual(parsed.errors, []);
assert.deepStrictEqual(parsed.checksums, hashes);
console.log('RELEASE_POLICY_CHECKSUM_PARSE_OK=true');

const valid = validateReleaseEvidence(completeEvidence(), { tag, commit, checksums });
assert.deepStrictEqual(valid, { ok: true, errors: [] });
console.log('RELEASE_POLICY_COMPLETE_EVIDENCE_OK=true');

expectFailure('RELEASE_POLICY_TAG_COMMIT_BINDING_OK', evidence => {
  evidence.releaseTag = 'v1.0.1';
  evidence.commit = 'b'.repeat(40);
}, /releaseTag must equal|commit must equal/);

expectFailure('RELEASE_POLICY_ALL_GATES_REQUIRED_OK', evidence => {
  delete evidence.gates.windowsCleanInstall;
}, /missing gate: windowsCleanInstall/);

expectFailure('RELEASE_POLICY_PHYSICAL_CHECKLIST_REQUIRED_OK', evidence => {
  evidence.gates.sourceDisplaySmoke.display = 'any';
  evidence.gates.windowsCleanInstall.checks.uninstall = false;
}, /exact tested display|uninstall must be true/);

expectFailure('RELEASE_POLICY_EXTERNAL_BETA_EVIDENCE_REQUIRED_OK', evidence => {
  evidence.gates.externalOperatorBeta.operators = 0;
  evidence.gates.externalOperatorBeta.releaseBlockers = 1;
  evidence.gates.externalOperatorBeta.evidence = '[REPLACE_ME]';
}, /operators must be at least 1|releaseBlockers must be 0|real retained evidence/);

expectFailure('RELEASE_POLICY_ARTIFACT_DIGEST_BINDING_OK', evidence => {
  evidence.artifacts[artifacts[0]] = 'f'.repeat(64);
}, /checksum mismatch/);

const betaValid = validateBetaReleaseEvidence(completeBetaEvidence(), {
  tag: betaTag,
  tagCommit: betaTagCommit,
  parentCommit: betaTestedCommit,
  changedPaths: [betaEvidencePath],
  evidencePath: betaEvidencePath,
  checksums: Object.entries(betaArtifacts).map(([name, hash]) => `${hash}  ${name}`).join('\n')
});
assert.deepStrictEqual(betaValid, { ok: true, errors: [] });
console.log('BETA_RELEASE_POLICY_COMPLETE_EVIDENCE_OK=true');

const betaCliRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'showslate-beta-evidence-'));
const betaCliEvidence = completeBetaEvidence();
for (const [index, name] of expectedArtifactNames(betaTag).entries()) {
  const content = Buffer.from(`native-candidate-${index}`);
  fs.writeFileSync(path.join(betaCliRoot, name), content);
  betaCliEvidence.candidateArtifacts[name] = crypto.createHash('sha256').update(content).digest('hex');
}
const betaCliEvidencePath = path.join(betaCliRoot, 'evidence.json');
fs.writeFileSync(betaCliEvidencePath, JSON.stringify(betaCliEvidence));
const betaCliOutput = execFileSync(process.execPath, [
  path.join(__dirname, '..', 'tools', 'verify-beta-release-evidence.js'),
  betaCliEvidencePath, '--tag', betaTag, '--candidate-dir', betaCliRoot
], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
assert.match(betaCliOutput, /BETA_RELEASE_EVIDENCE_OK=true/);
fs.rmSync(betaCliRoot, { recursive: true, force: true });
console.log('BETA_RELEASE_POLICY_CANDIDATE_HASH_BINDING_OK=true');

const betaMissingHardware = completeBetaEvidence();
delete betaMissingHardware.gates.captureCardAudio;
const betaMissingHardwareResult = validateBetaReleaseEvidence(betaMissingHardware, { tag: betaTag });
assert.strictEqual(betaMissingHardwareResult.ok, false);
assert.match(betaMissingHardwareResult.errors.join('\n'), /missing gate: captureCardAudio/);
console.log('BETA_RELEASE_POLICY_PHYSICAL_INPUT_GATES_REQUIRED_OK=true');

const betaSyntheticHardware = completeBetaEvidence();
betaSyntheticHardware.gates.captureCardVideo.device = 'synthetic';
betaSyntheticHardware.gates.windowCapture.checks.program = false;
const betaSyntheticHardwareResult = validateBetaReleaseEvidence(betaSyntheticHardware, { tag: betaTag });
assert.strictEqual(betaSyntheticHardwareResult.ok, false);
assert.match(betaSyntheticHardwareResult.errors.join('\n'), /captureCardVideo.device|windowCapture.checks.program/);
console.log('BETA_RELEASE_POLICY_REAL_SOURCE_DETAILS_REQUIRED_OK=true');

const betaMixedCommit = validateBetaReleaseEvidence(completeBetaEvidence(), {
  tag: betaTag,
  tagCommit: betaTagCommit,
  parentCommit: 'e'.repeat(40),
  changedPaths: [betaEvidencePath, 'controller.html'],
  evidencePath: betaEvidencePath
});
assert.strictEqual(betaMixedCommit.ok, false);
assert.match(betaMixedCommit.errors.join('\n'), /parent must equal testedCommit|must change only/);
console.log('BETA_RELEASE_POLICY_EVIDENCE_ONLY_COMMIT_OK=true');

const workflowRoot = path.join(__dirname, '..', '.github', 'workflows');
const betaWorkflow = fs.readFileSync(path.join(workflowRoot, 'release.yml'), 'utf8');
const candidateWorkflow = fs.readFileSync(path.join(workflowRoot, 'stable-release.yml'), 'utf8');
const publishWorkflow = fs.readFileSync(path.join(workflowRoot, 'publish-stable.yml'), 'utf8');

assert.match(betaWorkflow, /v\*\.\*\.\*-beta\.\*/);
assert.doesNotMatch(betaWorkflow, /^\s*-\s+["']?v\*["']?\s*$/m);
assert.match(betaWorkflow, /--notes-file/);
assert.match(betaWorkflow, /RELEASE-NOTES-\$\{GITHUB_REF_NAME#v\}\.md/);
assert.doesNotMatch(betaWorkflow, /RELEASE-NOTES-0\.9\.0-beta\.1/);
assert.match(betaWorkflow, /commitFull/);
assert.match(betaWorkflow, /buildInfo\.dirty/);
assert.match(betaWorkflow, /assert-release-tag\.js beta/);
assert.match(betaWorkflow, /merge-base --is-ancestor HEAD origin\/main/);
assert.doesNotMatch(betaWorkflow, /verify-beta-release-evidence\.js/);
assert.doesNotMatch(betaWorkflow, /release-evidence\/beta/);
assert.match(betaWorkflow, /macos-arm64/);
assert.match(betaWorkflow, /windows-x64/);
console.log('RELEASE_POLICY_BETA_TAG_ISOLATED_OK=true');

assert.match(candidateWorkflow, /confirmation must be BUILD/);
assert.match(candidateWorkflow, /--draft\b/);
assert.doesNotMatch(candidateWorkflow, /--draft=false/);
assert.match(candidateWorkflow, /commitFull/);
assert.match(candidateWorkflow, /buildInfo\.dirty/);
console.log('RELEASE_POLICY_STABLE_CANDIDATE_DRAFT_ONLY_OK=true');

assert.match(publishWorkflow, /verify-release-evidence\.js/);
assert.match(publishWorkflow, /--draft=false/);
assert.match(publishWorkflow, /release-evidence\/\$\{RELEASE_TAG#v\}\.json/);
console.log('RELEASE_POLICY_PUBLICATION_EVIDENCE_GATE_OK=true');

assert.match(publishWorkflow, /--signer-workflow/);
assert.match(publishWorkflow, /--source-digest/);
console.log('RELEASE_POLICY_EXACT_PROVENANCE_OK=true');

console.log('RELEASE_EVIDENCE_TESTS_OK count=17');
