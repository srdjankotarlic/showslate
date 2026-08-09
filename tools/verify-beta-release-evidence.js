#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { validateBetaReleaseEvidence } = require('../src/release/evidence.js');

const args = process.argv.slice(2);
const evidencePath = args[0] ? path.resolve(args[0]) : '';

function value(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : '';
}

function fail(message) {
  console.error(`BETA_RELEASE_EVIDENCE_BLOCKED: ${message}`);
  process.exit(1);
}

function git(...gitArgs) {
  try {
    return execFileSync('git', gitArgs, { cwd: process.cwd(), encoding: 'utf8' }).trim();
  } catch (error) {
    fail(`cannot inspect Git history: ${error.message}`);
  }
}

function filesBelow(root) {
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...filesBelow(absolute));
    else if (entry.isFile()) found.push(absolute);
  }
  return found;
}

function candidateChecksums(root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail('candidate artifact directory does not exist');
  const files = filesBelow(root);
  const lines = [];
  for (const name of Object.keys(document.candidateArtifacts || {})) {
    const matches = files.filter(file => path.basename(file) === name);
    if (matches.length !== 1) fail(`expected exactly one retained candidate artifact named ${name}`);
    const digest = crypto.createHash('sha256').update(fs.readFileSync(matches[0])).digest('hex');
    lines.push(`${digest}  ${name}`);
  }
  return lines.join('\n');
}

if (!evidencePath || !fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) {
  fail('evidence JSON file does not exist');
}

let document;
try {
  document = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
} catch (error) {
  fail(`cannot parse evidence JSON: ${error.message}`);
}

const tagCommit = value('--tag-commit');
let parentCommit = '';
let changedPaths;
if (args.includes('--verify-git')) {
  if (!/^[a-f0-9]{40}$/i.test(tagCommit)) fail('--tag-commit must be a full Git SHA when --verify-git is used');
  const ancestry = git('rev-list', '--parents', '-n', '1', tagCommit).split(/\s+/).filter(Boolean);
  if (ancestry.length !== 2) fail('the beta evidence commit must be a non-merge commit with one direct parent');
  parentCommit = git('rev-parse', `${tagCommit}^`);
  changedPaths = git('diff', '--name-only', parentCommit, tagCommit).split(/\r?\n/).filter(Boolean);
}

const relativeEvidencePath = path.relative(process.cwd(), evidencePath).replace(/\\/g, '/');
const candidateDir = value('--candidate-dir');
const result = validateBetaReleaseEvidence(document, {
  tag: value('--tag'),
  tagCommit,
  parentCommit,
  changedPaths,
  evidencePath: relativeEvidencePath,
  checksums: candidateDir ? candidateChecksums(path.resolve(candidateDir)) : ''
});

if (!result.ok) fail(result.errors.join('; '));
console.log(
  `BETA_RELEASE_EVIDENCE_OK=true tag=${document.releaseTag} testedCommit=${document.testedCommit} `
  + `candidateRunId=${document.candidateRunId} gates=${Object.keys(document.gates).length}`
);
