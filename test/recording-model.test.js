'use strict';

const assert = require('assert');
const recording = require('../src/recording/model.js');

let checks = 0;
function check(name, condition) {
  console.log(`${name}=${!!condition}`);
  assert.ok(condition, name);
  checks++;
}

const normalized = recording.normalizeSettings({
  directory: '/tmp/recordings', filePrefix: '  Demo: Show / Night  ', resolution: 'custom',
  width: 99999, height: 1, fps: 58, format: 'webm-vp9', quality: 'custom',
  videoBitrateMbps: 400, includeAudio: false, audioBitrateKbps: 20
});
check('RECORDING_SETTINGS_NORMALIZE_OK', normalized.filePrefix === 'Demo Show Night' && normalized.width === 7680 && normalized.height === 180 && normalized.fps === 60 && normalized.videoBitrateMbps === 160 && normalized.audioBitrateKbps === 64 && normalized.includeAudio === false);

const program = recording.resolveDimensions({ resolution: 'program' }, { width: 3840, height: 2160 });
const custom = recording.resolveDimensions({ resolution: 'custom', width: 1000, height: 1000 }, {});
check('RECORDING_DIMENSIONS_PROGRAM_AND_CUSTOM_OK', program.width === 3840 && program.height === 2160 && custom.width === 1000 && custom.height === 1000);

const bitrate1080 = recording.computedVideoBitrate({ resolution: '1080p', fps: 30, quality: 'high' }, { width: 1920, height: 1080 });
const bitrate4k60 = recording.computedVideoBitrate({ resolution: '4k', fps: 60, quality: 'master' }, { width: 3840, height: 2160 });
check('RECORDING_BITRATE_SCALES_AND_CAPS_OK', bitrate1080 > 8000000 && bitrate1080 < 12000000 && bitrate4k60 === 119439360);

const vp9 = recording.mimeCandidates('webm-vp9', true);
const mp4 = recording.mimeCandidates('mp4-h264', false);
const automatic = recording.mimeCandidates('auto', true);
check('RECORDING_MIME_CANDIDATES_OK', vp9[0] === 'video/webm;codecs=vp9,opus' && mp4[0] === 'video/mp4;codecs=avc1.42E01E' && automatic[0].startsWith('video/mp4') && automatic.some(candidate => candidate.startsWith('video/webm')));

const filename = recording.recordingFilename({ filePrefix: 'Keynote' }, 'video/webm;codecs=vp9,opus', new Date(2026, 7, 16, 17, 50, 38));
check('RECORDING_FILENAME_STABLE_OK', filename === 'Keynote_2026-08-16_17-50-38.webm');

console.log(`RECORDING_MODEL_TESTS_OK count=${checks}`);
