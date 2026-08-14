const fs = require('fs');
const path = require('path');
const { atomicWrite, MAX_SHOW_BYTES, validateShowDocument } = require('./repository.js');

const SHOW_DOCUMENT_EXTENSION = '.showslate';

function normalizeShowDocumentPath(file) {
  const raw = String(file || '').trim();
  if (!raw) throw new Error('Show file path is required.');
  const resolved = path.resolve(raw);
  if (!resolved || resolved === path.parse(resolved).root) throw new Error('Show file path is required.');
  return resolved.toLowerCase().endsWith(SHOW_DOCUMENT_EXTENSION) ? resolved : resolved + SHOW_DOCUMENT_EXTENSION;
}

async function writeShowDocumentFile({ file, document: input, appMetadata = {}, now = Date.now } = {}) {
  const validation = validateShowDocument(input);
  if (!validation.ok) return { ok: false, error: validation.errors.join('; '), errors: validation.errors };
  const destination = normalizeShowDocumentPath(file);
  const savedAt = new Date(now()).toISOString();
  const document = {
    ...validation.value,
    savedAt,
    app: { ...validation.value.app, ...appMetadata }
  };
  const serialized = JSON.stringify(document, null, 2) + '\n';
  const bytes = Buffer.byteLength(serialized);
  if (bytes > MAX_SHOW_BYTES) return { ok: false, error: 'show document exceeds 25 MB' };
  await atomicWrite(destination, serialized);
  return { ok: true, path: destination, name: path.basename(destination), savedAt, bytes };
}

async function readShowDocumentFile(file) {
  const raw = String(file || '').trim();
  if (!raw) return { ok: false, error: 'Show file path is required.' };
  const source = path.resolve(raw);
  try {
    const stat = await fs.promises.stat(source);
    if (!stat.isFile()) return { ok: false, error: 'Show project is not a file.' };
    if (stat.size > MAX_SHOW_BYTES) return { ok: false, error: 'Show project exceeds 25 MB.' };
    const parsed = JSON.parse(await fs.promises.readFile(source, 'utf8'));
    const validation = validateShowDocument(parsed);
    if (!validation.ok) return { ok: false, error: validation.errors.join('; '), errors: validation.errors };
    return { ok: true, path: source, name: path.basename(source), bytes: stat.size, document: validation.value };
  } catch (error) {
    return { ok: false, error: String(error && error.message || error) };
  }
}

module.exports = {
  SHOW_DOCUMENT_EXTENSION,
  normalizeShowDocumentPath,
  writeShowDocumentFile,
  readShowDocumentFile
};
