const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ShowRepository } = require('../src/show-storage/repository.js');
const { evaluatePreflight } = require('../src/show-storage/preflight.js');
const smokeDisplay = require('../tools/smoke-display.js');

const root = path.resolve(__dirname, '..');
const hiddenVisual = process.env.SHOWSLATE_HIDDEN_VISUAL === '1';
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
  if (!target) return [];
  return [{
    id: target.id, label: target.label, width: target.bounds.width, height: target.bounds.height,
    primary: true, hasControl: true, hasOutput: false
  }];
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
ipcMain.handle('live-input-statuses', () => []);

app.whenReady().then(async () => {
  repository = new ShowRepository({ userDataDir: profile, appMetadata: { commit: 'show-setup-test' } });
  await repository.initializeSession({ track: false });
  target = hiddenVisual ? screen.getPrimaryDisplay() : smokeDisplay.resolveTargetDisplay(screen, { root }).display;
  check('SHOW_SETUP_TARGET_DISPLAY_OK', !!target, target ? target.label : 'missing');
  const bounds = smokeDisplay.clampToWorkArea({ width: 1280, height: 800 }, target.workArea);
  const win = new BrowserWindow({
    ...bounds, show: !hiddenVisual, backgroundColor: '#0b0c0f',
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  await win.loadFile(path.join(root, 'controller.html'));
  if (!await waitFor(() => win.webContents.executeJavaScript('showAutosaveReady===true && lastDisplays.length>0'))) throw new Error('controller did not initialize');

  const opened = JSON.parse(await win.webContents.executeJavaScript(`(async function(){
    const qaTemplate=ltDefaultTemplate('Manual QA Lower Third');
    ltLibrary={schemaVersion:1,activeTemplateId:qaTemplate.id,templates:[qaTemplate],updatedAt:new Date().toISOString()};
    document.getElementById('btnShowFileMenu').click();
    const visibleButton=!!document.querySelector('#showFileMenu #btnNewShow')&&document.getElementById('btnNewShow').getClientRects().length>0;
    const visibleImport=!!document.querySelector('#showFileMenu #btnImportShowFolder')&&document.getElementById('btnImportShowFolder').getClientRects().length>0;
    const visiblePreflight=!!document.querySelector('#showFileMenu #btnPreflight')&&document.getElementById('btnPreflight').getClientRects().length>0;
    document.getElementById('btnNewShow').click();
    await new Promise(r=>setTimeout(r,80));
    const selectedDisplay=lastDisplays.find(display=>String(display.id)===document.getElementById('wizardDisplay').value);
    return JSON.stringify({
      visibleButton,visibleImport,visiblePreflight,
      open:document.getElementById('newShowOverlay').classList.contains('open'),
      outputMode:document.getElementById('wizardOutputMode').value,
      outputWidth:Number(document.getElementById('wizardWidth').value),
      outputHeight:Number(document.getElementById('wizardHeight').value),
      displayWidth:Number(selectedDisplay?.width)||0,
      displayHeight:Number(selectedDisplay?.height)||0,
      templateName:document.getElementById('wizardLtTemplate').selectedOptions[0]?.textContent||''
    });
  })()`));
  check('SHOW_WIZARD_VISIBLE_FROM_NORMAL_UI_OK', opened.visibleButton && opened.visibleImport && opened.visiblePreflight && opened.open, JSON.stringify(opened));
  check('SHOW_WIZARD_CONTROL_DISPLAY_DEFAULTS_TO_WINDOW_OK', opened.outputMode === 'window' && opened.outputWidth <= Math.min(1280, Math.floor(opened.displayWidth * 0.8)) && opened.outputHeight <= Math.min(720, Math.floor(opened.displayHeight * 0.8)) && Math.abs(opened.outputWidth / opened.outputHeight - 16 / 9) < 0.01, JSON.stringify(opened));
  check('SHOW_WIZARD_STARTER_TEMPLATE_DEFAULT_OK', opened.templateName === 'Starter Template', JSON.stringify(opened));
  const rundownValidation = JSON.parse(await win.webContents.executeJavaScript(`(function(){
    document.getElementById('wizardShowName').value='Beta Conference';
    document.getElementById('wizardClient').value='Demo Client';
    document.getElementById('wizardVenue').value='Main Hall';
    setWizardStep(1);
    wizardStepValid(1);
    const before=document.getElementById('wizardError').textContent;
    document.getElementById('wizardRundownText').value='Opening,10:00,Host welcome\\nKeynote,30:00,Main stage';
    document.getElementById('wizardRundownText').dispatchEvent(new Event('input',{bubbles:true}));
    return JSON.stringify({before,after:document.getElementById('wizardError').textContent,preview:document.getElementById('wizardRundownPreview').textContent,placeholder:document.getElementById('wizardRundownText').placeholder});
  })()`));
  check('SHOW_WIZARD_RUNDOWN_VALIDATION_RECOVERS_OK', rundownValidation.before === 'Import at least one valid rundown row.' && rundownValidation.after === '' && rundownValidation.preview === '2 valid cues' && rundownValidation.placeholder.includes('Opening,10:00'), JSON.stringify(rundownValidation));
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
    const activeTemplate=(ltLibrary.templates||[]).find(template=>template.id===ltLibrary.activeTemplateId);
    return JSON.stringify({result,preflight:document.getElementById('preflightOverlay').classList.contains('open'),overall:document.getElementById('preflightResult').className,name:showMeta.name,cues:cues.length,currentCue,selectedCue,running:S.running,outputOpen,outputMode:outputConfigs[0]?.mode,outputWidth:outputConfigs[0]?.width,outputHeight:outputConfigs[0]?.height,templateName:activeTemplate?.name||''});
  })()`));
  check('SHOW_WIZARD_CREATES_SAFE_OFF_AIR_SHOW_OK', finished.result.ok && finished.name === 'Beta Conference' && finished.cues === 2 && finished.currentCue === -1 && finished.selectedCue === 0 && !finished.running && !finished.outputOpen && finished.outputMode === 'window' && finished.outputWidth === opened.outputWidth && finished.outputHeight === opened.outputHeight && finished.templateName === 'Starter Template', JSON.stringify(finished));
  check('SHOW_PREFLIGHT_VISIBLE_AFTER_WIZARD_OK', finished.preflight && /warning|ready/.test(finished.overall), JSON.stringify(finished));
  await new Promise(resolve => setTimeout(resolve, 140));
  const preflightTemplate = await win.webContents.executeJavaScript(`document.querySelector('[data-check-id="lowerThirdTemplate"] .preflight-detail')?.textContent.trim()||''`);
  check('SHOW_PREFLIGHT_FRIENDLY_TEMPLATE_NAME_OK', preflightTemplate === 'Starter Template', preflightTemplate);
  fs.writeFileSync(path.join(artifactDirectory, 'preflight-900x600.png'), (await win.webContents.capturePage()).toPNG());
  const disk = await repository.loadCurrent();
  check('SHOW_WIZARD_AUTOSAVE_PERSISTS_OK', disk.ok && disk.document.show.name === 'Beta Conference' && disk.document.show.rundown.length === 2);

  console.log('SHOW_SETUP_RENDERER_TESTS_OK ' + checks + '/10');
  win.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  app.quit();
}).catch(error => {
  console.error(error && error.stack || error);
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
