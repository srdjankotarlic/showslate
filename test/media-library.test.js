'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MediaLibrary } = require('../src/media-library/library.js');
const { parseByteRange } = require('../src/media-library/range.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'showslate-media-library-'));
const mediaDirectory = path.join(root, 'profile-media');
const sources = path.join(root, 'sources');
fs.mkdirSync(sources, { recursive: true });

let passed = 0;
function check(name, condition, detail = '') {
  assert.ok(condition, detail || name);
  passed++;
  console.log(`${name}=true${detail ? ` ${detail}` : ''}`);
}

(async () => {
  const library = new MediaLibrary({
    mediaDirectory,
    managedCopyMaxBytes: 1024,
    reserveBytes: 0
  });

  const smallPath = path.join(sources, 'full-quality.png');
  const smallBytes = Buffer.from('original-image-bytes-are-not-recompressed');
  fs.writeFileSync(smallPath, smallBytes);
  const managed = await library.importFile(smallPath);
  const managedInfo = library.inspect(managed.src);
  check('MEDIA_LIBRARY_MANAGED_IMPORT_OK', managed.ok && managed.storage === 'managed' && managed.portable === true);
  check('MEDIA_LIBRARY_PRESERVES_ORIGINAL_BYTES_OK', managedInfo.ok && fs.readFileSync(managedInfo.path).equals(smallBytes));

  const unsafeManagedPath = path.join(mediaDirectory, 'operator logo final.png');
  fs.writeFileSync(unsafeManagedPath, Buffer.from('unsafe-name-source'));
  const normalizedManaged = await library.importFile(unsafeManagedPath);
  check('MEDIA_LIBRARY_NORMALIZES_EXISTING_UNSAFE_NAME_OK', normalizedManaged.ok && /^media:\/\/[a-f0-9]{24}\.png$/.test(normalizedManaged.src));

  const largePath = path.join(sources, 'five-gigabyte-program.mp4');
  const fiveGiB = 5 * 1024 * 1024 * 1024;
  const markerOffset = 4 * 1024 * 1024 * 1024 + 12345;
  const marker = Buffer.from('SHOWSLATE-RANGE-ABOVE-4GB');
  const descriptor = fs.openSync(largePath, 'w');
  fs.ftruncateSync(descriptor, fiveGiB + 65536);
  fs.writeSync(descriptor, marker, 0, marker.length, markerOffset);
  fs.closeSync(descriptor);

  const linked = await library.importFile(largePath);
  check('MEDIA_LIBRARY_MULTI_GIGABYTE_LINK_OK', linked.ok && linked.bytes > 5_000_000_000 && linked.storage === 'linked' && linked.portable === false, String(linked.bytes));
  check('MEDIA_LIBRARY_DOES_NOT_COPY_MULTI_GIGABYTE_FILE_OK', !fs.existsSync(path.join(mediaDirectory, linked.src.slice(8))));

  const reopened = new MediaLibrary({ mediaDirectory, managedCopyMaxBytes: 1024, reserveBytes: 0 });
  const reopenedInfo = reopened.inspect(linked.src);
  check('MEDIA_LIBRARY_LINK_SURVIVES_RESTART_OK', reopenedInfo.ok && reopenedInfo.path === fs.realpathSync(largePath));

  const explicitRange = parseByteRange(`bytes=${markerOffset}-${markerOffset + marker.length - 1}`, reopenedInfo.bytes);
  const readBack = Buffer.alloc(marker.length);
  const readDescriptor = fs.openSync(reopenedInfo.path, 'r');
  fs.readSync(readDescriptor, readBack, 0, readBack.length, explicitRange.start);
  fs.closeSync(readDescriptor);
  check('MEDIA_RANGE_ABOVE_4GB_READS_EXACT_BYTES_OK', !explicitRange.invalid && readBack.equals(marker));

  const suffix = parseByteRange('bytes=-4096', reopenedInfo.bytes);
  const openEnded = parseByteRange(`bytes=${markerOffset}-`, reopenedInfo.bytes);
  const invalid = parseByteRange(`bytes=${reopenedInfo.bytes}-`, reopenedInfo.bytes);
  check('MEDIA_RANGE_SUFFIX_AND_OPEN_ENDED_OK', suffix.length === 4096 && openEnded.start === markerOffset && openEnded.end === reopenedInfo.bytes - 1);
  check('MEDIA_RANGE_INVALID_REQUEST_FAILS_CLOSED_OK', invalid.invalid === true);

  const unsupportedPath = path.join(sources, 'archive.zip');
  fs.writeFileSync(unsupportedPath, 'not media');
  const unsupported = await library.importFile(unsupportedPath);
  check('MEDIA_LIBRARY_UNSUPPORTED_FORMAT_FAILS_CLOSED_OK', unsupported.ok === false && unsupported.code === 'MEDIA_UNSUPPORTED');

  fs.renameSync(largePath, largePath + '.offline');
  const offline = reopened.inspect(linked.src);
  check('MEDIA_LIBRARY_OFFLINE_LINK_IS_REPORTED_OK', offline.ok === false && offline.code === 'MEDIA_LINK_OFFLINE');

  console.log(`MEDIA_LIBRARY_TESTS_OK count=${passed}`);
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => {
  console.error(error && error.stack || error);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(1);
});
