'use strict';

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ShowRepository } = require('../src/show-storage/repository.js');
const { evaluatePreflight } = require('../src/show-storage/preflight.js');
const smokeDisplay = require('../tools/smoke-display.js');

const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'showslate-conference-ui-'));
const artifactDirectory = path.join(root, 'artifacts', 'generated', 'conference-desk');
app.setPath('userData', profile);

let repository;
let target;
let controller;
let output;
let revision = 0;
let lastAck = null;
let routeRole = 'confidence';
const stateEvents = [];
let checks = 0;
const demoOpeningImage = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#101419"/><rect x="90" y="90" width="14" height="720" rx="7" fill="#67a27c"/><text x="150" y="400" fill="#f5f7f8" font-family="Arial, sans-serif" font-size="118" font-weight="700">Demo Conference</text><text x="154" y="510" fill="#9ba6b2" font-family="Arial, sans-serif" font-size="52">Opening session</text></svg>');

function check(name, condition, detail = '') {
  console.log(`${name}=${!!condition}${detail ? ` ${detail}` : ''}`);
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
  checks++;
}

const waitFor = async (fn, timeout = 7000) => {
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
    primary: display.id === screen.getPrimaryDisplay().id, hasControl: display.id === target.id, hasOutput: display.id === target.id
  }));
}

function runtime() {
  return {
    primaryOpen: false,
    revision,
    routes: [{
      id: 'conference-test-output', role: routeRole, enabled: true, open: !!output,
      status: lastAck && lastAck.revision >= revision ? 'live' : 'syncing',
      lastDispatchRevision: revision, ackRevision: lastAck ? lastAck.revision : 0,
      acknowledged: !!(lastAck && lastAck.revision >= revision), actualDisplayId: target && target.id,
      displayAvailable: true, bounds: output ? output.getBounds() : null
    }]
  };
}

ipcMain.on('state', (event, state) => {
  revision++;
  stateEvents.push({ revision, state: JSON.parse(JSON.stringify(state)) });
  if (output && !output.isDestroyed()) {
    output.webContents.send('state', {
      ...state,
      _mediaBase: '',
      _outputRoute: { id: 'conference-test-output', role: routeRole },
      _dispatch: { revision, routeId: 'conference-test-output', role: routeRole, sentAt: Date.now() }
    });
  }
  if (controller && !controller.isDestroyed()) controller.webContents.send('output-config-state', runtime());
});
ipcMain.on('output-rendered', (event, payload) => {
  if (output && event.sender.id === output.webContents.id) lastAck = payload;
  if (controller && !controller.isDestroyed()) controller.webContents.send('output-config-state', runtime());
});
ipcMain.on('control-status', () => {});
ipcMain.on('close-output', () => {});
ipcMain.on('set-output-configs', () => {});
ipcMain.on('ctl-on-top', () => {});
ipcMain.on('fit-window', () => {});
ipcMain.handle('displays', displayRows);
ipcMain.handle('output-open', () => !!output);
ipcMain.handle('output-configs', () => []);
ipcMain.handle('network-info', () => ({ running: true, ip: '127.0.0.1', port: 7878, oscPort: 7879, token: 'conference-test' }));
ipcMain.handle('build-info', () => ({ version: 'test', commit: 'conference-desk-ui', isPackaged: false }));
ipcMain.handle('show-storage-status', () => ({ ...repository.getStatus(), autosaveEnabled: true }));
ipcMain.handle('show-storage-save', (event, payload) => repository.save(payload.document, { reason: payload.reason }));
ipcMain.handle('show-storage-load-current', () => repository.loadCurrent());
ipcMain.handle('show-storage-recover', (event, choice) => repository.resolveRecovery(choice));
ipcMain.handle('show-folder-import', () => ({
  ok: true,
  rootName: 'Demo Conference',
  schedule: {
    name: 'rundown.csv',
    text: 'session,duration,speaker,speaker title,company,media\nOpening,10:00,Ana Markovic,Host,Example Events,opening.png\nKeynote,30:00,Dr Maya Chen,Keynote Speaker,Northstar,keynote.pdf\n'
  },
  assets: [
    { id: 'asset-opening', name: 'opening.png', relativePath: 'media/opening.png', kind: 'image', src: demoOpeningImage },
    { id: 'asset-keynote', name: 'keynote.pdf', relativePath: 'media/keynote.pdf', kind: 'pdf', src: 'media://keynote.pdf' }
  ],
  warnings: []
}));
ipcMain.handle('show-preflight-inspect', (event, payload) => evaluatePreflight(payload.document, {
  lastSaveOk: !!payload.lastSaveOk, autosaveWritable: true, missingAssets: [], speakerScreenReady: !!output,
  programBrowserReady: true, backstageReady: true, remoteReady: true, apiReady: true,
  displays: displayRows(), selectedDisplayId: payload.selectedDisplayId, recoveryAvailable: false, outputRuntime: runtime()
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
  repository = new ShowRepository({ userDataDir: profile, appMetadata: { commit: 'conference-desk-ui' } });
  await repository.initializeSession({ track: false });
  target = smokeDisplay.resolveTargetDisplay(screen, { root }).display;
  check('CONFERENCE_UI_TARGET_DISPLAY_OK', !!target, target ? target.label : 'missing');
  fs.mkdirSync(artifactDirectory, { recursive: true });

  output = new BrowserWindow({
    ...smokeDisplay.clampToWorkArea({ width: 960, height: 540 }, target.workArea),
    show: false, backgroundColor: '#080a0d',
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  await output.loadFile(path.join(root, 'output.html'), { query: { routeId: 'conference-test-output', outputRole: 'confidence' } });

  controller = new BrowserWindow({
    ...smokeDisplay.clampToWorkArea({ width: 1280, height: 800 }, target.workArea),
    show: true, backgroundColor: '#0b0d11',
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  await controller.loadFile(path.join(root, 'controller.html'));
  if (!await waitFor(() => controller.webContents.executeJavaScript('showAutosaveReady===true && lastDisplays.length>0'))) throw new Error('controller did not initialize');

  const entry = JSON.parse(await controller.webContents.executeJavaScript(`(async function(){
    document.getElementById('btnTb').click();
    const menuButton=document.getElementById('btnImportShowFolder');
    const visible=!!menuButton && getComputedStyle(menuButton).display!=='none';
    menuButton.click();
    await new Promise(resolve=>setTimeout(resolve,120));
    return JSON.stringify({visible,open:document.getElementById('newShowOverlay').classList.contains('open'),step:wizardStep,folder:wizardFolderImport.rootName,cues:wizardRundown().length,matches:wizardAssetMatch().matches.length});
  })()`));
  check('CONFERENCE_IMPORT_VISIBLE_FROM_NORMAL_UI_OK', entry.visible && entry.open && entry.step === 1, JSON.stringify(entry));
  check('CONFERENCE_SHOW_FOLDER_MATCHES_MEDIA_OK', entry.folder === 'Demo Conference' && entry.cues === 2 && entry.matches === 2, JSON.stringify(entry));

  await controller.webContents.executeJavaScript(`(async function(){
    document.getElementById('wizardDisplay').value=${JSON.stringify(String(target.id))};
    document.getElementById('wizardDisplay').dispatchEvent(new Event('change',{bubbles:true}));
    while(wizardStep<6){ document.getElementById('btnWizardNext').click(); await new Promise(resolve=>setTimeout(resolve,30)); }
    document.getElementById('btnWizardFinish').click();
  })()`);
  if (!await waitFor(() => controller.webContents.executeJavaScript(`(()=>{const badge=document.getElementById('preflightResult');return document.getElementById('preflightOverlay').classList.contains('open') && showMeta.name==='Demo Conference' && document.querySelectorAll('#preflightList .preflight-row').length>=15 && ['ready','warning','blocking'].some(value=>badge.classList.contains(value));})()`))) throw new Error('wizard preflight did not finish');
  const built = JSON.parse(await controller.webContents.executeJavaScript(`JSON.stringify({mode:showMeta.details.productMode,cues:cues.length,linked:cues.filter(cue=>cue.contentItemId&&cue.autoTakeContentOnGo).length,assets:contentItems.filter(item=>item.type==='image'||item.type==='pdf').length,role:outputConfigs[0]&&outputConfigs[0].role,safe:currentCue===-1&&!S.running&&!outputOpen})`));
  check('CONFERENCE_WIZARD_BUILDS_LINKED_OFF_AIR_SHOW_OK', built.mode === 'conference-desk' && built.cues === 2 && built.linked === 2 && built.assets === 2 && built.role === 'audience' && built.safe, JSON.stringify(built));
  await new Promise(resolve => setTimeout(resolve, 100));
  fs.writeFileSync(path.join(artifactDirectory, 'setup-preflight.png'), (await controller.webContents.capturePage()).toPNG());

  await controller.webContents.executeJavaScript(`document.getElementById('btnPreflightContinue').click(); document.getElementById('btnOpenOut').click();`);
  const roleControl = JSON.parse(await controller.webContents.executeJavaScript(`JSON.stringify((()=>{const select=document.querySelector('#outputRouterList .out-role');const rect=select&&select.getBoundingClientRect();return {open:document.getElementById('outputRouterOverlay').classList.contains('open'),exists:!!select,options:select?[...select.options].map(option=>option.value):[],visible:!!rect&&rect.width>0&&rect.height>0};})())`));
  check('CONFERENCE_OUTPUT_ROLE_SELECTOR_VISIBLE_OK', roleControl.open && roleControl.exists && roleControl.visible && roleControl.options.join(',') === 'audience,confidence,timer,stream,door', JSON.stringify(roleControl));
  await controller.webContents.executeJavaScript(`document.getElementById('btnOutputRouterCloseX').click()`);

  const statesBefore = stateEvents.length;
  await controller.webContents.executeJavaScript(`document.getElementById('btnGo').click()`);
  if (!await waitFor(() => lastAck && lastAck.cueId && lastAck.transactionId)) throw new Error('confidence output did not acknowledge GO');
  const transactionStates = stateEvents.slice(statesBefore).filter(event => event.state.goTransaction && event.state.goTransaction.id === lastAck.transactionId);
  const outputState = JSON.parse(await output.webContents.executeJavaScript(`JSON.stringify({role:document.body.dataset.outputRole,current:document.getElementById('roleCurrent').textContent,timer:document.getElementById('timer').textContent,roleVisible:getComputedStyle(document.getElementById('roleView')).display!=='none'})`));
  check('CONFERENCE_GO_EMITS_ONE_ATOMIC_PROGRAM_REVISION_OK', transactionStates.length === 1 && transactionStates[0].state.running === true, `states=${transactionStates.length}`);
  check('CONFERENCE_CONFIDENCE_OUTPUT_RENDER_ACK_OK', outputState.role === 'confidence' && outputState.current === 'Opening' && outputState.timer !== '--:--' && outputState.roleVisible && lastAck.revision === revision, JSON.stringify({ outputState, lastAck }));
  output.show();
  await new Promise(resolve => setTimeout(resolve, 180));
  fs.writeFileSync(path.join(artifactDirectory, 'confidence-output.png'), (await output.webContents.capturePage()).toPNG());

  const liveProgramState = JSON.parse(JSON.stringify(transactionStates[0].state));
  async function verifyRole(role, predicate, checkName) {
    routeRole = role;
    revision++;
    lastAck = null;
    output.webContents.send('state', {
      ...liveProgramState,
      _mediaBase: '',
      _outputRoute: { id: 'conference-test-output', role },
      _dispatch: { revision, routeId: 'conference-test-output', role, sentAt: Date.now() }
    });
    if (!await waitFor(() => lastAck && lastAck.revision === revision && lastAck.role === role)) throw new Error(`${role} output did not acknowledge render`);
    const dom = JSON.parse(await output.webContents.executeJavaScript(`JSON.stringify({
      role:document.body.dataset.outputRole,
      roleView:getComputedStyle(document.getElementById('roleView')).display,
      stage:getComputedStyle(document.getElementById('stage')).display,
      scene:getComputedStyle(document.getElementById('sceneRoot')).display,
      lowerLegacy:getComputedStyle(document.getElementById('lowerThird')).display,
      lowerRuntime:getComputedStyle(document.getElementById('ltCanvas')).display,
      current:document.getElementById('roleCurrent').textContent,
      next:document.getElementById('roleNext').textContent,
      timer:document.getElementById('timer').textContent,
      background:getComputedStyle(document.body).backgroundColor
    })`));
    check(checkName, predicate(dom), JSON.stringify(dom));
  }
  await verifyRole('audience', dom => dom.role === 'audience' && dom.roleView === 'none' && dom.scene !== 'none', 'CONFERENCE_AUDIENCE_ROLE_RENDER_OK');
  await verifyRole('timer', dom => dom.role === 'timer' && dom.roleView === 'none' && dom.stage !== 'none' && dom.timer !== '--:--', 'CONFERENCE_TIMER_ROLE_RENDER_OK');
  await verifyRole('stream', dom => dom.role === 'stream' && dom.stage === 'none' && dom.scene === 'none' && dom.background === 'rgba(0, 0, 0, 0)' && (dom.lowerLegacy !== 'none' || dom.lowerRuntime !== 'none'), 'CONFERENCE_STREAM_ROLE_RENDER_OK');
  await verifyRole('door', dom => dom.role === 'door' && dom.roleView !== 'none' && dom.current === 'Opening' && dom.next === 'Keynote', 'CONFERENCE_DOOR_ROLE_RENDER_OK');
  routeRole = 'confidence';
  fs.writeFileSync(path.join(artifactDirectory, 'workspace.png'), (await controller.webContents.capturePage()).toPNG());

  const liveMode = JSON.parse(await controller.webContents.executeJavaScript(`(function(){document.getElementById('btnConferenceLive').click();return JSON.stringify({active:document.body.classList.contains('conference-live-mode'),importDisabled:document.getElementById('btnCueImport').disabled,newDisabled:document.getElementById('btnNewShow').disabled,goDisabled:document.getElementById('btnGo').disabled,pressed:document.getElementById('btnConferenceLive').getAttribute('aria-pressed')});})()`));
  check('CONFERENCE_LIVE_MODE_VISIBLE_AND_SAFE_OK', liveMode.active && liveMode.importDisabled && liveMode.newDisabled && !liveMode.goDisabled && liveMode.pressed === 'true', JSON.stringify(liveMode));

  controller.setBounds(smokeDisplay.clampToWorkArea({ width: 900, height: 600 }, target.workArea));
  await new Promise(resolve => setTimeout(resolve, 220));
  const compact = JSON.parse(await controller.webContents.executeJavaScript(`JSON.stringify((()=>{const button=document.getElementById('btnConferenceLive').getBoundingClientRect();return {vw:innerWidth,vh:innerHeight,button:{left:button.left,right:button.right,top:button.top,bottom:button.bottom},go:document.getElementById('btnGo').getBoundingClientRect().bottom};})())`));
  check('CONFERENCE_LIVE_CONTROLS_REMAIN_REACHABLE_900X600_OK', compact.button.left >= 0 && compact.button.right <= compact.vw && compact.button.top >= 0 && compact.button.bottom <= compact.vh && compact.go <= compact.vh, JSON.stringify(compact));
  fs.writeFileSync(path.join(artifactDirectory, 'live-mode-900x600.png'), (await controller.webContents.capturePage()).toPNG());

  await controller.webContents.executeJavaScript(`(async function(){
    if(showAutosaveTimer){ clearTimeout(showAutosaveTimer); showAutosaveTimer=null; }
    await flushShowAutosave({reason:'conference-ui-test-finish',force:true});
    showAutosaveReady=false;
  })()`);
  console.log(`CONFERENCE_DESK_RENDERER_TESTS_OK ${checks}/13`);
  controller.destroy();
  output.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  app.quit();
}).catch(error => {
  console.error(error && error.stack || error);
  try { if (controller && !controller.isDestroyed()) controller.destroy(); } catch (_) {}
  try { if (output && !output.isDestroyed()) output.destroy(); } catch (_) {}
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
