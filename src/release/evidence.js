'use strict';

const REQUIRED_DOCS = [
  'README.md',
  'docs/KNOWN-LIMITATIONS.md',
  'docs/SYSTEM-REQUIREMENTS.md',
  'docs/PRIVACY.md'
];

const REQUIRED_GATES = [
  'sourceDisplaySmoke',
  'packagedDisplaySmoke',
  'macCleanInstall',
  'windowsCleanInstall',
  'externalOperatorBeta',
  'releaseDocsReview'
];

function classifyTag(tag) {
  if (/^v\d+\.\d+\.\d+$/.test(tag || '')) return 'stable';
  if (/^v\d+\.\d+\.\d+-beta\.\d+$/.test(tag || '')) return 'beta';
  return 'invalid';
}

function expectedArtifactNames(tag) {
  const version = String(tag || '').replace(/^v/, '');
  return [
    `ShowSlate-${version}-arm64.dmg`,
    `ShowSlate-Setup-${version}.exe`,
    `ShowSlate-${version}-portable.exe`
  ];
}

function parseChecksums(source) {
  const result = {};
  const errors = [];
  for (const rawLine of String(source || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?([^/\\]+)$/);
    if (!match) {
      errors.push(`invalid checksum line: ${line}`);
      continue;
    }
    const name = match[2];
    if (Object.prototype.hasOwnProperty.call(result, name)) {
      errors.push(`duplicate checksum entry: ${name}`);
      continue;
    }
    result[name] = match[1].toLowerCase();
  }
  return { checksums: result, errors };
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDate(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function hasRealEvidence(value) {
  return typeof value === 'string'
    && value.trim().length >= 8
    && !/(?:\bTODO\b|\bTBD\b|placeholder|replace[_ -]?me|\[[A-Z0-9_ -]+\])/i.test(value);
}

function checkBooleanMap(errors, gateName, checks, required) {
  if (!isObject(checks)) {
    errors.push(`${gateName}.checks must be an object`);
    return;
  }
  for (const key of required) {
    if (checks[key] !== true) errors.push(`${gateName}.checks.${key} must be true`);
  }
}

function validateReleaseEvidence(document, options = {}) {
  const errors = [];
  const expectedTag = options.tag;
  const expectedCommit = String(options.commit || '').toLowerCase();

  if (!isObject(document)) return { ok: false, errors: ['evidence must be a JSON object'] };
  if (document.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (classifyTag(document.releaseTag) !== 'stable') errors.push('releaseTag must be a stable vMAJOR.MINOR.PATCH tag');
  if (expectedTag && document.releaseTag !== expectedTag) errors.push(`releaseTag must equal ${expectedTag}`);
  if (!/^[a-f0-9]{40}$/i.test(document.commit || '')) errors.push('commit must be a full 40-character Git SHA');
  if (expectedCommit && String(document.commit || '').toLowerCase() !== expectedCommit) {
    errors.push(`commit must equal ${expectedCommit}`);
  }
  if (!Number.isSafeInteger(document.candidateRunId) || document.candidateRunId <= 0) {
    errors.push('candidateRunId must be a positive integer');
  }
  if (!isIsoDate(document.verifiedAt)) errors.push('verifiedAt must be an ISO-8601 UTC timestamp');

  const expectedArtifacts = expectedArtifactNames(document.releaseTag);
  if (!isObject(document.artifacts)) {
    errors.push('artifacts must be an object');
  } else {
    const actualNames = Object.keys(document.artifacts).sort();
    const wantedNames = [...expectedArtifacts].sort();
    if (JSON.stringify(actualNames) !== JSON.stringify(wantedNames)) {
      errors.push(`artifacts must contain exactly: ${wantedNames.join(', ')}`);
    }
    for (const name of expectedArtifacts) {
      if (!/^[a-f0-9]{64}$/i.test(document.artifacts[name] || '')) {
        errors.push(`artifacts.${name} must be a SHA-256 digest`);
      }
    }
  }

  if (options.checksums) {
    const parsed = parseChecksums(options.checksums);
    errors.push(...parsed.errors);
    for (const name of expectedArtifacts) {
      const recorded = String(document.artifacts && document.artifacts[name] || '').toLowerCase();
      if (!parsed.checksums[name]) errors.push(`checksum manifest is missing ${name}`);
      else if (parsed.checksums[name] !== recorded) errors.push(`checksum mismatch for ${name}`);
    }
    const extras = Object.keys(parsed.checksums).filter(name => !expectedArtifacts.includes(name));
    if (extras.length) errors.push(`checksum manifest has unexpected artifacts: ${extras.join(', ')}`);
  }

  if (!isObject(document.gates)) {
    errors.push('gates must be an object');
    return { ok: false, errors };
  }

  for (const gateName of REQUIRED_GATES) {
    const gate = document.gates[gateName];
    if (!isObject(gate)) {
      errors.push(`missing gate: ${gateName}`);
      continue;
    }
    if (gate.passed !== true) errors.push(`${gateName}.passed must be true`);
    if (!isIsoDate(gate.completedAt)) errors.push(`${gateName}.completedAt must be an ISO-8601 UTC timestamp`);
    if (!hasRealEvidence(gate.evidence)) errors.push(`${gateName}.evidence must identify real retained evidence`);
  }

  for (const gateName of ['sourceDisplaySmoke', 'packagedDisplaySmoke']) {
    const gate = document.gates[gateName];
    if (isObject(gate) && !hasRealEvidence(gate.display)) {
      errors.push(`${gateName}.display must identify the exact tested display`);
    }
  }

  const mac = document.gates.macCleanInstall;
  if (isObject(mac)) {
    if (!hasRealEvidence(mac.os)) errors.push('macCleanInstall.os is required');
    if (!hasRealEvidence(mac.hardware)) errors.push('macCleanInstall.hardware is required');
    if (mac.artifact !== expectedArtifacts[0]) errors.push(`macCleanInstall.artifact must equal ${expectedArtifacts[0]}`);
    checkBooleanMap(errors, 'macCleanInstall', mac.checks, ['install', 'launch', 'gatekeeper', 'multiDisplay', 'networkViews', 'quit']);
  }

  const windows = document.gates.windowsCleanInstall;
  if (isObject(windows)) {
    if (!hasRealEvidence(windows.os)) errors.push('windowsCleanInstall.os is required');
    if (!hasRealEvidence(windows.hardware)) errors.push('windowsCleanInstall.hardware is required');
    const actual = Array.isArray(windows.artifacts) ? [...windows.artifacts].sort() : [];
    const wanted = expectedArtifacts.slice(1).sort();
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      errors.push(`windowsCleanInstall.artifacts must contain ${wanted.join(' and ')}`);
    }
    checkBooleanMap(errors, 'windowsCleanInstall', windows.checks, ['installer', 'portable', 'launch', 'firewall', 'multiDisplay', 'uninstall']);
  }

  const beta = document.gates.externalOperatorBeta;
  if (isObject(beta)) {
    if (!Number.isSafeInteger(beta.operators) || beta.operators < 1) {
      errors.push('externalOperatorBeta.operators must be at least 1');
    }
    if (beta.releaseBlockers !== 0) errors.push('externalOperatorBeta.releaseBlockers must be 0');
  }

  const docs = document.gates.releaseDocsReview;
  if (isObject(docs)) {
    const files = Array.isArray(docs.files) ? docs.files : [];
    for (const required of REQUIRED_DOCS) {
      if (!files.includes(required)) errors.push(`releaseDocsReview.files must include ${required}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  REQUIRED_DOCS,
  REQUIRED_GATES,
  classifyTag,
  expectedArtifactNames,
  parseChecksums,
  validateReleaseEvidence
};
