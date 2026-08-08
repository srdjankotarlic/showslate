const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ShowRepository } = require('../src/show-storage/repository.js');
const { evaluatePreflight } = require('../src/show-storage/preflight.js');
const smokeDisplay = require('../tools/smoke-display.js');

const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'showslate-show-setup-'));
const artifactDirectory = path.join(root, 'artifacts', 'generated', 'show-setup');
app.setPath('userData', profile);
let repository;
let target;
let checks = 0;

function check(name, condition, detail = '') {
  console.log(name + '=' + !!condition + (detail ? ' ' + detail : ''));
  if (!condition) throw new Error(name + (detail ? ': ' + detail : ''));
  checks++;
}

const waitFor = async (fn, timeout = 6000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { if (await fn()) return true; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return false;
};

function displayRows() {
  return screen.getAllDisplays().map(display => ({
    id: display.id, label: display.label, width: display.bounds.width, height: display.bounds.height,
    primary: display.id === screen.getPrimaryDisplay().id, hasControl: display.id === target.id, hasOutput: false
  }));
}

ipcMain.on('state', () => {});
ipcMain.on('close-output', () => {});
ipcMain.on('set-output-configs', () => {});
ipcMain.on('ctl-on-top', () => {});
ipcMain.on('fit-window', () => {});
ipcMain.handle('displays', displayRows);
ipcMain.handle('output-open', () => false);
ipcMain.handle('output-configs', () => []);
ipcMain.handle('network-info', () => ({ running: true, ip: '127.0.0.1', port: 7878, oscPort: 7879, token: 'test-token' }));
ipcMain.handle('build-info', () => ({ version: 'test', commit: 'show-setup-test', isPackaged: false }));
ipcMain.handle('show-storage-status', () => ({ ...repository.getStatus(), autosaveEnabled: true }));
ipcMain.handle('show-storage-save', (event, payload) => repository.save(payload.document, { reason: payload.reason }));
ipcMain.handle('show-storage-load-current', () => repository.loadCurrent());
ipcMain.handle('show-storage-recover', (event, choice) => repository.resolveRecovery(choice));
ipcMain.handle('show-preflight-inspect', (event, payload) => evaluatePreflight(payload.document, {
  lastSaveOk: !!payload.lastSaveOk, autosaveWritable: true, missingAssets: [], speakerScreenReady: false,
  programBrowserReady: true, backstageReady: true, remoteReady: true, apiReady: true,
  displays: displayRows(), selectedDisplayId: payload.selectedDisplayId, recoveryAvailable: false
}));
ipcMain.handle('show-package-export', () => ({ ok: false, canceled: true }));
ipcMain.handle('show-package-import', () => ({ ok: false, canceled: true }));
ipcMain.handle('media-save', () => ({ ok: false, error: 'not-used' }));
ipcMain.handle('lt-package-export', () => ({ ok: false, canceled: true }));
ipcMain.handle('lt-package-import', () => ({ ok: false, canceled: true }));
ipcMain.handle('identify-displays', () => 1);
ipcMain.handle('qr', () => '');
ipcMain.handle('share-info', () => ({}));

app.whenReady().then(async () => {
  repository = new ShowRepository({ userDataDir: profile, appMetadata: { commit: 'show-setup-test' } });
  await repository.initializeSession({ track: false });
  target = smokeDisplay.resolveTargetDisplay(screen, { root }).display;
  check('SHOW_SETUP_TARGET_DISPLAY_OK', !!target, target ? target.label : 'missing');
  const bounds = smokeDisplay.clampToWorkArea({ width: 1280, height: 800 }, target.workArea);
  const win = new BrowserWindow({
    ...bounds, show: true, backgroundColor: '#0b0c0f',
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  await win.loadFile(path.join(root, 'controller.html'));
  if (!await waitFor(() => win.webContents.executeJavaScript('showAutosaveReady===true && lastDisplays.length>0'))) throw new Error('controller did not initialize');

  const opened = JSON.parse(await win.webContents.executeJavaScript(`(async function(){
    document.getElementById('btnTb').click();
    const visibleButton=!!document.querySelector('#tbMenu #btnNewShow');
    document.getElementById('btnNewShow').click();
    await new Promise(r=>setTimeout(r,80));
    return JSON.stringify({visibleButton,open:document.getElementById('newShowOverlay').classList.contains('open')});
  })()`));
  check('SHOW_WIZARD_VISIBLE_FROM_NORMAL_UI_OK', opened.visibleButton && opened.open, JSON.stringify(opened));
  await win.webContents.executeJavaScript(`
    document.getElementById('wizardShowName').value='Beta Conference';
    document.getElementById('wizardClient').value='Demo Client';
    document.getElementById('wizardVenue').value='Main Hall';
    setWizardStep(1);
    document.getElementById('wizardRundownText').value='Opening,10:00,Host welcome\\nKeynote,30:00,Main stage';
    document.getElementById('wizardRundownText').dispatchEvent(new Event('input',{bubbles:true}));
  `);
  await new Promise(resolve => setTimeout(resolve, 140));
  fs.mkdirSync(artifactDirectory, { recursive: true });
  fs.writeFileSync(path.join(artifactDirectory, 'wizard-1280x800.png'), (await win.webContents.capturePage()).toPNG());

  const smallBounds = smokeDisplay.clampToWorkArea({ width: 900, height: 600 }, target.workArea);
  win.setBounds(smallBounds);
  await new Promise(resolve => setTimeout(resolve, 180));
  await win.webContents.executeJavaScript('setWizardStep(3)');
  const layout = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    const dialog=document.querySelector('#newShowOverlay .flow-dialog').getBoundingClientRect();
    const foot=document.querySelector('#newShowOverlay .flow-foot').getBoundingClientRect();
    return {vw:innerWidth,vh:innerHeight,dialog:{x:dialog.x,y:dialog.y,right:dialog.right,bottom:dialog.bottom},foot:{top:foot.top,bottom:foot.bottom},scroll:document.querySelector('#newShowOverlay .flow-content').scrollHeight};
  })())`));
  check('SHOW_WIZARD_900X600_REACHABLE_OK', layout.dialog.x >= 0 && layout.dialog.y >= 0 && layout.dialog.right <= layout.vw + 1 && layout.dialog.bottom <= layout.vh + 1 && layout.foot.bottom <= layout.vh + 1, JSON.stringify(layout));
  fs.writeFileSync(path.join(artifactDirectory, 'wizard-900x600.png'), (await win.webContents.capturePage()).toPNG());

  const finished = JSON.parse(await win.webContents.executeJavaScript(`(async function(){
    document.getElementById('wizardOpeningTimer').value='10:00';
    document.getElementById('wizardInitialView').value='timer';
    const result=await finishNewShowWizard();
    return JSON.stringify({result,preflight:document.getElementById('preflightOverlay').classList.contains('open'),overall:document.getElementById('preflightResult').className,name:showMeta.name,cues:cues.length,currentCue,selectedCue,running:S.running,outputOpen});
  })()`));
  check('SHOW_WIZARD_CREATES_SAFE_OFF_AIR_SHOW_OK', finished.result.ok && finished.name === 'Beta Conference' && finished.cues === 2 && finished.currentCue === -1 && finished.selectedCue === 0 && !finished.running && !finished.outputOpen, JSON.stringify(finished));
  check('SHOW_PREFLIGHT_VISIBLE_AFTER_WIZARD_OK', finished.preflight && /warning|ready/.test(finished.overall), JSON.stringify(finished));
  await new Promise(resolve => setTimeout(resolve, 140));
  fs.writeFileSync(path.join(artifactDirectory, 'preflight-900x600.png'), (await win.webContents.capturePage()).toPNG());
  const disk = await repository.loadCurrent();
  check('SHOW_WIZARD_AUTOSAVE_PERSISTS_OK', disk.ok && disk.document.show.name === 'Beta Conference' && disk.document.show.rundown.length === 2);

  console.log('SHOW_SETUP_RENDERER_TESTS_OK ' + checks + '/6');
  win.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  app.quit();
}).catch(error => {
  console.error(error && error.stack || error);
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
