#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');

const groups = {
  modules: [
    'test:brand-migration',
    'test:lt-package',
    'test:show-storage',
    'test:show-package',
    'test:show-preflight',
    'test:conference-desk',
    'test:live-mode',
    'test:show-folder-import',
    'test:media-library',
    'test:screen-content',
    'test:compositor',
    'test:control-api',
    'test:report',
    'test:output-routing',
    'test:recording',
    'test:release-signing',
    'test:release-evidence',
    'test:localization',
    'test:build-info'
  ],
  renderers: [
    'test:show-recovery',
    'test:show-setup-ui',
    'test:conference-desk-ui',
    'test:site-ui',
    'test:screen-content-ui',
    'test:compositor-ui',
    'test:control-api-ui',
    'test:report-ui'
  ]
};

const requested = process.argv[2] || 'modules';
const scripts = requested === 'all'
  ? [...groups.modules, ...groups.renderers]
  : groups[requested];

if (!scripts) {
  console.error(`Unknown suite "${requested}". Use modules, renderers, or all.`);
  process.exit(2);
}

const isWindows = process.platform === 'win32';
const runner = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npm';
const startedAt = Date.now();

for (const script of scripts) {
  console.log(`\n=== ${script} ===`);
  const args = isWindows
    ? ['/d', '/s', '/c', `npm run ${script}`]
    : ['run', script];
  const result = spawnSync(runner, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit'
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`\nTEST_SUITE_OK group=${requested} scripts=${scripts.length} durationMs=${Date.now() - startedAt}`);
