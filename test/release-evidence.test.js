'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  classifyTag,
  expectedArtifactNames,
  parseChecksums,
  validateReleaseEvidence
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

const workflowRoot = path.join(__dirname, '..', '.github', 'workflows');
const betaWorkflow = fs.readFileSync(path.join(workflowRoot, 'release.yml'), 'utf8');
const candidateWorkflow = fs.readFileSync(path.join(workflowRoot, 'stable-release.yml'), 'utf8');
const publishWorkflow = fs.readFileSync(path.join(workflowRoot, 'publish-stable.yml'), 'utf8');

assert.match(betaWorkflow, /v\*\.\*\.\*-beta\.\*/);
assert.doesNotMatch(betaWorkflow, /^\s*-\s+["']?v\*["']?\s*$/m);
assert.match(betaWorkflow, /--generate-notes/);
assert.doesNotMatch(betaWorkflow, /RELEASE-NOTES-0\.9\.0-beta\.1/);
assert.match(betaWorkflow, /commitFull/);
assert.match(betaWorkflow, /buildInfo\.dirty/);
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

console.log('RELEASE_EVIDENCE_TESTS_OK count=12');
