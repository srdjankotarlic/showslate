const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ShowRepository } = require('../src/show-storage/repository.js');
const smokeDisplay = require('../tools/smoke-display.js');

const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'showslate-recovery-renderer-'));
const artifactDirectory = path.join(root, 'artifacts', 'generated', 'show-recovery');
app.setPath('userData', profile);
let repository;
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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
};

function baselineDocument() {
  return {
    schemaVersion: 1,
    show: {
      id: 'recovery-show', name: 'Last saved show', details: {},
      rundown: [{ id: 'baseline-cue', name: 'Baseline', durationMs: 300000, speakerName: 'Baseline Speaker' }],
      selectedCue: 0, liveCue: -1,
      timer: { mode: 'countdown', durationMs: 300000, remainingMs: 300000, elapsedMs: 0, wasRunning: false, capturedAt: Date.now() },
      actualTimes: [], message: { text: '', flash: false }, lowerThird: {}, screenContent: {}, branding: {}, outputs: {}, preferences: { lang: 'en' }
    }
  };
}

ipcMain.on('state', () => {});
ipcMain.on('close-output', () => {});
ipcMain.on('set-output-configs', () => {});
ipcMain.handle('displays', () => screen.getAllDisplays().map((display) => ({ id: display.id, label: display.label, width: display.bounds.width, height: display.bounds.height })));
ipcMain.handle('output-open', () => false);
ipcMain.handle('output-configs', () => []);
ipcMain.handle('network-info', () => ({ running: false }));
ipcMain.handle('build-info', () => ({ version: 'test', commit: 'show-recovery-test', isPackaged: false }));
ipcMain.handle('show-storage-status', () => ({ ...repository.getStatus(), autosaveEnabled: true }));
ipcMain.handle('show-storage-save', (event, payload) => repository.save(payload.document, { reason: payload.reason }));
ipcMain.handle('show-storage-load-current', () => repository.loadCurrent());
ipcMain.handle('show-storage-recover', (event, choice) => repository.resolveRecovery(choice));
ipcMain.handle('identify-displays', () => 0);
ipcMain.handle('qr', () => '');
ipcMain.handle('share-info', () => ({}));

app.whenReady().then(async () => {
  const clean = new ShowRepository({ userDataDir: profile, appMetadata: { commit: 'baseline' } });
  await clean.initializeSession({ track: true });
  await clean.save(baselineDocument(), { reason: 'manual-save' });
  await clean.markClean();

  repository = new ShowRepository({ userDataDir: profile, appMetadata: { commit: 'crashed-session' } });
  await repository.initializeSession({ track: true });
  const target = smokeDisplay.resolveTargetDisplay(screen, { root }).display;
  check('SHOW_RECOVERY_TARGET_DISPLAY_OK', !!target, target ? target.label : 'missing');
  const bounds = smokeDisplay.clampToWorkArea({ width: 1280, height: 800 }, target.workArea);
  const win = new BrowserWindow({ ...bounds, show: false, webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  await win.loadFile(path.join(root, 'controller.html'));
  if (!await waitFor(() => win.webContents.executeJavaScript('showAutosaveReady===true'))) throw new Error('autosave did not become ready');
  const saved = JSON.parse(await win.webContents.executeJavaScript(`(async function(){
    initLtLibrary();
    const tpl=PTLT.makeTemplate({id:'recovery-template',name:'Recovery Template',kind:'custom',layers:[PTLT.makeDynamicTextLayer({id:'recovery-name',field:'speakerName'})]});
    ltLibrary.templates=(ltLibrary.templates||[]).filter(t=>t.id!==tpl.id); ltLibrary.templates.push(tpl); ltLibrary.activeTemplateId=tpl.id; saveLtLibrary();
    cues=migrateCues([{id:'recover-a',name:'Recovery keynote',durationMs:600000,speakerName:'Recovery Speaker',speakerTitle:'Director'},{id:'recover-b',name:'Next panel',durationMs:900000,speakerName:'Panel'}]);
    currentCue=0; selectedCue=1; S.mode='countdown'; S.durationMs=600000; S.remMs=420000; S.running=true; S.endAt=Date.now()+420000;
    S.message={text:'WRAP UP',flash:true}; S.lowerThirdAutoCue=true; showLowerThirdFromCue(0); outputConfigs=[{id:'out-a',name:'Stage',displayId:1,mode:'fullscreen',enabled:true}];
    saveCues(); send(true);
    const result=await flushShowAutosave({reason:'recovery-test-fixture',force:true});
    return JSON.stringify({result});
  })()`));
  const disk = await repository.readCurrent();
  check('SHOW_AUTOSAVE_RENDERER_TO_DISK_OK', saved.result.ok && disk.ok && disk.document.show.rundown[0].speakerName === 'Recovery Speaker' && disk.document.show.timer.wasRunning);

  repository = new ShowRepository({ userDataDir: profile, appMetadata: { commit: 'restarted-session' } });
  const restartStatus = await repository.initializeSession({ track: true });
  check('SHOW_CRASH_RECOVERY_DETECTED_OK', restartStatus.recoveryAvailable && restartStatus.hasLastSaved);
  await win.reload();
  const dialogOpen = await waitFor(() => win.webContents.executeJavaScript("document.getElementById('showRecoveryOverlay').classList.contains('open')"));
  check('SHOW_RECOVERY_DIALOG_VISIBLE_OK', dialogOpen && await win.webContents.executeJavaScript("!document.getElementById('btnRecoveryLastSaved').disabled"));
  fs.mkdirSync(artifactDirectory, { recursive: true });
  fs.writeFileSync(path.join(artifactDirectory, 'recovery-dialog.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.getElementById('btnRecoveryRecover').click()");
  if (!await waitFor(() => win.webContents.executeJavaScript("!document.getElementById('showRecoveryOverlay').classList.contains('open') && showAutosaveReady"))) throw new Error('recovery did not complete');
  const state = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify({
    cue:cues[0]&&cues[0].speakerName,currentCue,selectedCue,running:S.running,remMs:S.remMs,
    message:S.message&&S.message.text,ltVisible:S.lowerThird&&S.lowerThird.visible,runtime:!!(S.lowerThird&&S.lowerThird.runtime),
    outputOpen,activeTemplate:ltLibrary&&ltLibrary.activeTemplateId,outputs:outputConfigs.length
  })`));
  fs.writeFileSync(path.join(artifactDirectory, 'recovered-paused.png'), (await win.webContents.capturePage()).toPNG());
  check('SHOW_RECOVERY_DATA_RESTORED_OK', state.cue === 'Recovery Speaker' && state.currentCue === 0 && state.selectedCue === 1 && state.activeTemplate === 'recovery-template' && state.outputs === 1, JSON.stringify(state));
  check('SHOW_RECOVERY_OFF_AIR_PAUSED_OK', state.running === false && state.remMs > 400000 && state.message === '' && state.ltVisible === false && state.runtime === false && state.outputOpen === false, JSON.stringify(state));
  await repository.markClean();
  const cleanRestart = new ShowRepository({ userDataDir: profile });
  const cleanStatus = await cleanRestart.initializeSession({ track: false });
  check('SHOW_RECOVERY_CLEAN_EXIT_OK', !cleanStatus.recoveryAvailable);
  console.log('SHOW_RECOVERY_RENDERER_TESTS_OK ' + checks + '/7');
  win.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  app.quit();
}).catch((error) => {
  console.error(error && error.stack || error);
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
