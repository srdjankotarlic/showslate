'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    const detail = `${result.stdout || ''}${result.stderr || ''}`.trim();
    throw new Error(`${command} failed${detail ? `: ${detail}` : ''}`);
  }
  return `${result.stdout || ''}${result.stderr || ''}`;
}

module.exports = async function afterSignLocal(context) {
  if (process.env.SHOWSLATE_LOCAL_SIGNING !== '1' || context.electronPlatformName !== 'darwin') return;

  const appId = String(context.packager.config.appId || '').trim();
  const productName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${productName}.app`);
  if (!appId) throw new Error('Local macOS signing requires build.appId.');

  // Local beta builds have no Apple identity. A stable development requirement
  // prevents every rebuild from looking like a new app to macOS TCC. Release
  // builds skip this hook and must use Developer ID signing and notarization.
  const requirement = `=designated => identifier "${appId}"`;
  run('codesign', ['--force', '--sign', '-', '--requirements', requirement, appPath]);
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  const displayed = run('codesign', ['--display', '--requirements', '-', appPath]);
  if (!displayed.includes(`designated => identifier "${appId}"`)) {
    throw new Error('The local macOS build did not receive its stable designated requirement.');
  }
  console.log(`SHOWSLATE_LOCAL_SIGNING_OK ${appId}`);
};
