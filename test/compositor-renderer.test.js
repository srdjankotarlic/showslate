'use strict';

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ShowRepository } = require('../src/show-storage/repository.js');
const smokeDisplay = require('../tools/smoke-display.js');

const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'showslate-compositor-ui-'));
const artifactDirectory = path.join(root, 'artifacts', 'generated', 'compositor');
app.setPath('userData', profile);

let repository;
let target;
let checks = 0;
let configuredInputs = [];
let deviceDiscoveryMode = 'ready';
let screenPermissionMode = 'granted';
let privacySettingsRequests = [];

function check(name, condition, detail = '') {
  console.log(`${name}=${!!condition}${detail ? ` ${detail}` : ''}`);
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
  checks++;
}

async function waitFor(fn, timeout = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { if (await fn()) return true; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return false;
}

function displayRows() {
  return [target].filter(Boolean).map(display => ({
    id: display.id, label: display.label, width: display.bounds.width, height: display.bounds.height,
    primary: display.id === screen.getPrimaryDisplay().id, hasControl: true, hasOutput: false
  }));
}

ipcMain.on('state', () => {});
ipcMain.on('control-status', () => {});
ipcMain.on('close-output', () => {});
ipcMain.on('set-output-configs', () => {});
ipcMain.on('ctl-on-top', () => {});
ipcMain.on('fit-window', () => {});
ipcMain.on('live-input-unsubscribe', () => {});
ipcMain.handle('displays', displayRows);
ipcMain.handle('output-open', () => false);
ipcMain.handle('output-configs', () => []);
ipcMain.handle('network-info', () => ({ running: true, ip: '127.0.0.1', port: 7878, oscPort: 7879, token: 'compositor-test' }));
ipcMain.handle('build-info', () => ({ version: 'test', commit: 'compositor-ui', isPackaged: false }));
ipcMain.handle('show-storage-status', () => ({ ...repository.getStatus(), autosaveEnabled: true }));
ipcMain.handle('show-storage-save', (event, payload) => repository.save(payload.document, { reason: payload.reason }));
ipcMain.handle('show-storage-load-current', () => repository.loadCurrent());
ipcMain.handle('show-storage-recover', (event, choice) => repository.resolveRecovery(choice));
ipcMain.handle('show-preflight-inspect', () => ({ overall: 'warning', checks: [], counts: { ok: 0, warning: 1, blocking: 0 } }));
ipcMain.handle('show-package-export', () => ({ ok: false, canceled: true }));
ipcMain.handle('show-package-import', () => ({ ok: false, canceled: true }));
ipcMain.handle('show-folder-import', () => ({ ok: false, canceled: true }));
ipcMain.handle('media-save', (event, payload) => ({ ok: true, src: String(payload.dataURL || '') }));
ipcMain.handle('lt-package-export', () => ({ ok: false, canceled: true }));
ipcMain.handle('lt-package-import', () => ({ ok: false, canceled: true }));
ipcMain.handle('identify-displays', () => 1);
ipcMain.handle('qr', () => '');
ipcMain.handle('share-info', () => ({}));
ipcMain.handle('live-input-desktop-sources', () => screenPermissionMode === 'denied' ? [] : [{
  id: 'window:compositor-test:1', name: 'Presentation Window', kind: 'window',
  thumbnail: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#1b2430"/><rect x="36" y="34" width="248" height="112" rx="6" fill="#6a8eb5"/></svg>')
}]);
ipcMain.handle('live-input-devices', () => {
  if (deviceDiscoveryMode === 'pending') return { devices: [], permissions: { camera: 'not-determined', microphone: 'not-determined', screen: 'granted' }, error: '' };
  if (deviceDiscoveryMode === 'blocked') return { devices: [], permissions: { camera: 'denied', microphone: 'denied', screen: 'granted' }, error: '' };
  return {
    devices: [
      { deviceId: 'video-card-1', groupId: 'capture-card', kind: 'videoinput', label: 'UVC Capture Card' },
      { deviceId: 'audio-card-1', groupId: 'capture-card', kind: 'audioinput', label: 'UVC Capture Audio' }
    ],
    permissions: { camera: 'granted', microphone: 'granted', screen: 'granted' }, error: ''
  };
});
ipcMain.handle('live-input-permissions', () => ({ camera: 'granted', microphone: 'granted', screen: screenPermissionMode }));
ipcMain.handle('open-privacy-settings', (event, section) => { privacySettingsRequests.push(String(section || '')); return { ok: true }; });
ipcMain.handle('live-input-configure', (event, definitions) => { configuredInputs = JSON.parse(JSON.stringify(definitions || [])); return { ok: true, count: configuredInputs.length }; });
ipcMain.handle('live-input-restart', () => ({ ok: true }));
ipcMain.handle('live-input-statuses', () => []);
ipcMain.handle('live-input-subscribe', () => ({ ok: false, error: 'renderer test has no media hub' }));
ipcMain.handle('live-input-signal-to-hub', () => ({ ok: false }));

app.whenReady().then(async () => {
  repository = new ShowRepository({ userDataDir: profile, appMetadata: { commit: 'compositor-ui' } });
  await repository.initializeSession({ track: false });
  target = smokeDisplay.resolveTargetDisplay(screen, { root }).display || screen.getPrimaryDisplay();
  check('COMPOSITOR_UI_TARGET_DISPLAY_OK', !!target, target ? target.label : 'missing');
  fs.mkdirSync(artifactDirectory, { recursive: true });

  const win = new BrowserWindow({
    ...smokeDisplay.clampToWorkArea({ width: 1280, height: 800 }, target.workArea),
    show: true, backgroundColor: '#0b0c0f',
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  await win.loadFile(path.join(root, 'controller.html'));
  if (!await waitFor(() => win.webContents.executeJavaScript('showAutosaveReady===true && lastDisplays.length>0'))) throw new Error('controller did not initialize');

  const opened = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    const button=document.getElementById('btnCompositor');
    const visible=button.getClientRects().length>0;
    const defaultOpen=document.body.classList.contains('compositor-open');
    if(!defaultOpen) button.click();
    return {visible,defaultOpen,open:document.body.classList.contains('compositor-open'),advanced:document.body.classList.contains('adv'),previewVisible:document.getElementById('preview').getClientRects().length>0,panelVisible:document.getElementById('panelSources').getClientRects().length>0,defaultTimerHidden:getComputedStyle(document.getElementById('pvStage')).display==='none',directProgram:document.getElementById('chkDirectProgram').checked,layerTakeVisible:document.getElementById('btnTakeLayer').getClientRects().length>0,layerHideVisible:document.getElementById('btnHideLayer').getClientRects().length>0,settingsText:document.getElementById('btnSettingsDrawer').textContent.trim(),settingsAria:document.getElementById('btnSettingsDrawer').getAttribute('aria-label')};
  })())`));
  check('COMPOSITOR_VISIBLE_FROM_NORMAL_UI_OK', opened.visible && opened.open && opened.advanced && opened.previewVisible && opened.panelVisible && opened.defaultTimerHidden, JSON.stringify(opened));
  check('COMPOSITOR_SAFE_PREVIEW_DEFAULT_AND_LAYER_CONTROLS_OK', opened.directProgram === false && opened.layerTakeVisible && opened.layerHideVisible && opened.settingsText === 'Settings' && opened.settingsAria === 'Settings', JSON.stringify(opened));
  const sceneControls = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{const ids=['canvasSceneSelect','btnCanvasSceneAdd','btnCanvasSceneDuplicate','btnCanvasSceneDelete'];return {visible:ids.every(id=>document.getElementById(id).getClientRects().length>0),options:document.getElementById('canvasSceneSelect').options.length,duplicateTitle:document.getElementById('btnCanvasSceneDuplicate').title};})())`));
  check('COMPOSITOR_SCENE_CONTROLS_VISIBLE_OK', sceneControls.visible && sceneControls.options >= 1 && sceneControls.duplicateTitle.length > 0, JSON.stringify(sceneControls));

  const picturePath = path.join(profile, 'picture.svg');
  fs.writeFileSync(picturePath, '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#d9dde2"/><circle cx="320" cy="180" r="90" fill="#3b6d94"/></svg>');
  win.webContents.debugger.attach('1.3');
  const documentNode = await win.webContents.debugger.sendCommand('DOM.getDocument');
  const mediaNode = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '#sceneMediaFile' });
  await win.webContents.executeJavaScript(`(()=>{window.__compositorFileEvents=0;window.__compositorFileErrors=[];document.getElementById('sceneMediaFile').addEventListener('change',()=>window.__compositorFileEvents++);window.addEventListener('unhandledrejection',event=>window.__compositorFileErrors.push(String(event.reason&&event.reason.message||event.reason)));})()`);
  await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', { files: [picturePath], nodeId: mediaNode.nodeId });
  if (!await waitFor(() => win.webContents.executeJavaScript(`currentScene().layers.some(layer=>layer.name==='picture.svg')`))) {
    const state = await win.webContents.executeJavaScript(`JSON.stringify({events:window.__compositorFileEvents,errors:window.__compositorFileErrors,files:document.getElementById('sceneMediaFile').files.length,layers:currentScene().layers.map(layer=>({type:layer.type,name:layer.name}))})`);
    throw new Error(`picture file input did not add a layer: ${state}`);
  }
  win.webContents.debugger.detach();

  const authored = JSON.parse(await win.webContents.executeJavaScript(`(async()=>{
    const change=(element)=>element.dispatchEvent(new Event('change',{bubbles:true}));
    document.getElementById('canvasWidth').value='1000'; change(document.getElementById('canvasWidth'));
    document.getElementById('canvasHeight').value='1000'; change(document.getElementById('canvasHeight'));
    document.getElementById('canvasFps').value='25'; change(document.getElementById('canvasFps'));

    document.getElementById('btnAddSource').click();
    document.querySelector('[data-source-kind="color"]').click();
    document.getElementById('sourceColorName').value='Slate background';
    document.getElementById('sourceColorValue').value='#24303d';
    document.getElementById('btnColorAdd').click();

    document.getElementById('btnAddSource').click();
    document.querySelector('[data-source-kind="text"]').click();
    const modalStarted=Date.now(); while(Date.now()-modalStarted<1000&&!document.getElementById('modalOverlay').classList.contains('open')) await new Promise(resolve=>setTimeout(resolve,20));
    document.getElementById('modalInput').value='Guest camera'; document.getElementById('modalOk').click();
    await new Promise(resolve=>setTimeout(resolve,40));

    document.getElementById('btnAddSource').click();
    document.querySelector('[data-source-kind="timer"]').click();
    await new Promise(resolve=>setTimeout(resolve,40));

    document.getElementById('btnAddSource').click();
    document.querySelector('[data-source-kind="device"]').click();
    const deviceStarted=Date.now(); while(Date.now()-deviceStarted<2000&&document.getElementById('sourceVideoDevice').options[0]?.value!=='video-card-1') await new Promise(resolve=>setTimeout(resolve,25));
    document.getElementById('sourceAudioDevice').value='audio-card-1';
    document.getElementById('sourceDeviceResolution').value='1280x720';
    document.getElementById('sourceDeviceFps').value='30';
    document.getElementById('btnDeviceAdd').click();
    await new Promise(resolve=>setTimeout(resolve,80));

    document.getElementById('btnAddSource').click();
    document.querySelector('[data-source-kind="window"]').click();
    const windowStarted=Date.now(); while(Date.now()-windowStarted<2000&&!document.querySelector('.desktop-source-card')) await new Promise(resolve=>setTimeout(resolve,25));
    document.querySelector('.desktop-source-card').click();
    await new Promise(resolve=>setTimeout(resolve,80));

    document.getElementById('inspName').value='Slides capture'; change(document.getElementById('inspName'));
    document.getElementById('inspX').value='54'; change(document.getElementById('inspX'));
    document.getElementById('inspY').value='8'; change(document.getElementById('inspY'));
    document.getElementById('inspW').value='42'; change(document.getElementById('inspW'));
    document.getElementById('inspH').value='40'; change(document.getElementById('inspH'));
    renderStage('pv',S,Date.now());
    const scene=currentScene(); const timer=scene.layers.find(layer=>layer.type==='timer'); const color=scene.layers.find(layer=>layer.type==='color'); const capture=scene.layers.find(layer=>layer.type==='window');
    const captureElement=document.querySelector('#pvScene [data-layer-id="'+capture.id+'"]');
    const previewRect=document.getElementById('preview').getBoundingClientRect();
    return JSON.stringify({canvas:S.canvas,previewRatio:previewRect.width/previewRect.height,types:scene.layers.map(layer=>layer.type),timerIndex:scene.layers.indexOf(timer),colorIndex:scene.layers.indexOf(color),capture:{x:capture.x,y:capture.y,w:capture.w,h:capture.h,name:capture.name},handles:captureElement?captureElement.querySelectorAll('.transform-handle').length:0,layerRows:document.querySelectorAll('#layerList .layer-row').length,liveInputs:S.liveInputs.length});
  })()`));
  check('COMPOSITOR_CUSTOM_CANVAS_AND_SOURCE_TYPES_OK', authored.canvas.width === 1000 && authored.canvas.height === 1000 && authored.canvas.fps === 25 && Math.abs(authored.previewRatio - 1) < 0.02 && ['color','image','text','window','capture','timer'].every(type => authored.types.includes(type)), JSON.stringify(authored));
  check('COMPOSITOR_LAYER_INSPECTOR_AND_HANDLES_OK', authored.capture.name === 'Slides capture' && authored.capture.x === 54 && authored.capture.y === 8 && authored.capture.w === 42 && authored.capture.h === 40 && authored.handles === 4 && authored.layerRows === authored.types.length, JSON.stringify(authored));
  check('COMPOSITOR_COLOR_DEFAULTS_BEHIND_TIMER_OK', authored.colorIndex === 0 && authored.timerIndex > authored.colorIndex, JSON.stringify({ colorIndex: authored.colorIndex, timerIndex: authored.timerIndex }));
  const layerSelection = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    selectedLayerId=null; renderInspector(); updateLayerProgramControls();
    const disabledOpacity=Number(getComputedStyle(document.getElementById('btnTakeLayer')).opacity);
    const selector=[...document.querySelectorAll('#layerList .layer-select')].find(button=>button.querySelector('.layer-name')?.textContent==='Slides capture');
    const targetId=selector?.closest('.layer-row')?.dataset.layerId||'';
    selector?.click();
    return {button:selector?.tagName||'',aria:selector?.getAttribute('aria-label')||'',current:document.querySelector('#layerList .layer-select[aria-current="true"]')?.closest('.layer-row')?.dataset.layerId||'',targetId,selectedId:selectedLayer()?.id||'',inspectorOpen:document.getElementById('inspector').classList.contains('open'),inspectorName:document.getElementById('inspName').value,takeEnabled:!document.getElementById('btnTakeLayer').disabled,disabledOpacity};
  })())`));
  check('COMPOSITOR_LAYER_SELECT_USER_CONTROL_OK', layerSelection.button === 'BUTTON' && layerSelection.aria.includes('Slides capture') && layerSelection.targetId === layerSelection.selectedId && layerSelection.current === layerSelection.targetId && layerSelection.inspectorOpen && layerSelection.inspectorName === 'Slides capture' && layerSelection.takeEnabled && layerSelection.disabledOpacity < 0.6, JSON.stringify(layerSelection));
  if (!await waitFor(() => configuredInputs.some(input => input.type === 'window' && input.active))) throw new Error('window input was not configured');
  check('COMPOSITOR_WINDOW_AND_CAPTURE_CARD_CONFIGURED_ONCE_OK', configuredInputs.filter(input => input.type === 'window').length === 1 && configuredInputs.filter(input => input.type === 'device' && input.videoDeviceId === 'video-card-1' && input.audioDeviceId === 'audio-card-1' && input.withAudio && input.width === 1280 && input.height === 720).length === 1, JSON.stringify(configuredInputs));

  deviceDiscoveryMode = 'pending';
  const permissionPending = JSON.parse(await win.webContents.executeJavaScript(`(async()=>{
    document.getElementById('btnAddSource').click();
    document.querySelector('[data-source-kind="device"]').click();
    const started=Date.now(); while(Date.now()-started<2000&&document.getElementById('sourceVideoDevice').options[0]?.textContent.includes('Scanning')) await new Promise(resolve=>setTimeout(resolve,25));
    const result={option:document.getElementById('sourceVideoDevice').options[0]?.textContent||'',status:document.getElementById('sourceDeviceStatusText').textContent,visible:!document.getElementById('sourceDeviceStatus').hidden,cameraAction:!document.getElementById('btnCameraPermission').hidden,microphoneAction:!document.getElementById('btnMicrophonePermission').hidden,addDisabled:document.getElementById('btnDeviceAdd').disabled};
    closeSourceDialog(); return JSON.stringify(result);
  })()`));
  deviceDiscoveryMode = 'blocked';
  const permissionFailure = JSON.parse(await win.webContents.executeJavaScript(`(async()=>{
    document.getElementById('btnAddSource').click();
    document.querySelector('[data-source-kind="device"]').click();
    const started=Date.now(); while(Date.now()-started<2000&&document.getElementById('sourceVideoDevice').options[0]?.textContent.includes('Scanning')) await new Promise(resolve=>setTimeout(resolve,25));
    const result={option:document.getElementById('sourceVideoDevice').options[0]?.textContent||'',status:document.getElementById('sourceDeviceStatus').textContent,visible:!document.getElementById('sourceDeviceStatus').hidden,cameraSettings:!document.getElementById('btnCameraSettings').hidden,microphoneSettings:!document.getElementById('btnMicrophoneSettings').hidden,addDisabled:document.getElementById('btnDeviceAdd').disabled};
    closeSourceDialog(); return JSON.stringify(result);
  })()`));
  deviceDiscoveryMode = 'ready';
  check('COMPOSITOR_PERMISSION_FAILURE_EXITS_SCANNING_OK', permissionPending.visible && permissionPending.cameraAction && permissionPending.microphoneAction && permissionPending.addDisabled && !permissionPending.option.includes('Scanning') && permissionFailure.visible && permissionFailure.cameraSettings && permissionFailure.microphoneSettings && permissionFailure.addDisabled && !permissionFailure.option.includes('Scanning') && permissionFailure.status.includes('Camera') && permissionFailure.status.includes('Microphone'), JSON.stringify({ permissionPending, permissionFailure }));

  screenPermissionMode = 'denied';
  privacySettingsRequests = [];
  const screenPermissionAction = JSON.parse(await win.webContents.executeJavaScript(`(async()=>{
    document.getElementById('btnAddSource').click();
    document.querySelector('[data-source-kind="window"]').click();
    const started=Date.now(); while(Date.now()-started<2000&&!document.querySelector('#desktopSourceGrid .permission-blocked')) await new Promise(resolve=>setTimeout(resolve,25));
    const empty=document.querySelector('#desktopSourceGrid .permission-blocked'); const action=empty&&empty.querySelector('button');
    if(action)action.click(); await new Promise(resolve=>setTimeout(resolve,80));
    const result={message:empty&&empty.textContent||'',actionVisible:!!(action&&action.getClientRects().length),actionText:action&&action.textContent||''};
    closeSourceDialog(); return JSON.stringify(result);
  })()`));
  screenPermissionMode = 'granted';
  check('COMPOSITOR_PRIVACY_SETTINGS_RECOVERY_VISIBLE_OK', screenPermissionAction.actionVisible && screenPermissionAction.message.includes('Screen Recording') && screenPermissionAction.actionText.includes('settings') && privacySettingsRequests.includes('screen'), JSON.stringify({ screenPermissionAction, privacySettingsRequests }));

  const hiddenSource = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    const layer=selectedLayer(); const inputId=layer.inputId;
    const findToggle=()=>[...document.querySelectorAll('#layerList .layer-row')].find(row=>row.querySelector('.layer-name')?.textContent===layer.name)?.querySelector('.vis');
    let toggle=findToggle(); toggle.checked=false; toggle.dispatchEvent(new Event('change',{bubbles:true}));
    const retainedWhileHidden=S.liveInputs.some(input=>input.id===inputId);
    toggle=findToggle(); toggle.checked=true; toggle.dispatchEvent(new Event('change',{bubbles:true}));
    return {retainedWhileHidden,retainedAfterShow:S.liveInputs.some(input=>input.id===inputId),visible:selectedLayer().visible,inputId};
  })())`));
  check('COMPOSITOR_HIDDEN_LIVE_LAYER_RETAINS_SOURCE_OK', hiddenSource.retainedWhileHidden && hiddenSource.retainedAfterShow && hiddenSource.visible, JSON.stringify(hiddenSource));

  const replaced = JSON.parse(await win.webContents.executeJavaScript(`(async()=>{
    const before=selectedLayer(); const transform={id:before.id,inputId:before.inputId,x:before.x,y:before.y,w:before.w,h:before.h,opacity:before.opacity,rotation:before.rotation};
    document.getElementById('inspLiveChange').click();
    const started=Date.now(); while(Date.now()-started<2000&&!document.querySelector('.desktop-source-card')) await new Promise(resolve=>setTimeout(resolve,25));
    const card=document.querySelector('.desktop-source-card'); const highlighted=card&&card.classList.contains('selected'); if(card) card.click();
    await new Promise(resolve=>setTimeout(resolve,80));
    const after=selectedLayer();
    return JSON.stringify({highlighted,closed:!document.getElementById('sourceOverlay').classList.contains('open'),sameLayer:after.id===transform.id,newInput:after.inputId!==transform.inputId,geometry:after.x===transform.x&&after.y===transform.y&&after.w===transform.w&&after.h===transform.h&&after.opacity===transform.opacity&&after.rotation===transform.rotation,liveInputs:S.liveInputs.length});
  })()`));
  check('COMPOSITOR_CHANGE_SOURCE_PRESERVES_TRANSFORM_OK', replaced.highlighted && replaced.closed && replaced.sameLayer && replaced.newInput && replaced.geometry && replaced.liveInputs === 2, JSON.stringify(replaced));

  const handle = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{const el=document.querySelector('#pvScene .transform-handle.handle-se');const r=el.getBoundingClientRect();const layer=selectedLayer();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),w:layer.w,h:layer.h};})())`));
  win.webContents.sendInputEvent({ type: 'mouseDown', x: handle.x, y: handle.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseMove', x: handle.x + 45, y: handle.y + 28, movementX: 45, movementY: 28 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: handle.x + 45, y: handle.y + 28, button: 'left', clickCount: 1 });
  await new Promise(resolve => setTimeout(resolve, 100));
  const resized = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{const layer=selectedLayer();return {w:layer.w,h:layer.h,inspectorW:Number(document.getElementById('inspW').value),inspectorH:Number(document.getElementById('inspH').value)};})())`));
  check('COMPOSITOR_POINTER_RESIZE_PERSISTS_OK', resized.w > handle.w && resized.h > handle.h && resized.inspectorW === resized.w && resized.inspectorH === resized.h, JSON.stringify({ before: handle, after: resized }));

  const isolation = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    const direct=document.getElementById('chkDirectProgram'); direct.checked=false; direct.dispatchEvent(new Event('change',{bubbles:true}));
    const before=JSON.stringify(programState.scenes);
    document.getElementById('inspX').value='48'; document.getElementById('inspX').dispatchEvent(new Event('change',{bubbles:true}));
    const previewOnly=before===JSON.stringify(programState.scenes);
    document.getElementById('btnTake').click();
    const taken=JSON.stringify(programState.scenes)===JSON.stringify(S.scenes);
    const layer=selectedLayer(), scene=currentScene(), index=scene.layers.findIndex(row=>row.id===layer.id), inputId=layer.inputId;
    scene.layers.splice(index,1); sceneDirty();
    const deleteStayedInPreview=!currentScene().layers.some(row=>row.id===layer.id)&&activeScene(programState).layers.some(row=>row.id===layer.id);
    const programDefinitionRetained=S.liveInputs.some(input=>input.id===inputId)&&programState.liveInputs.some(input=>input.id===inputId);
    currentScene().layers.splice(index,0,layer); selectedLayerId=layer.id; sceneDirty();
    return {previewOnly,taken,direct:S.studioDirect,deleteStayedInPreview,programDefinitionRetained,restored:currentScene().layers.some(row=>row.id===layer.id)};
  })())`));
  check('COMPOSITOR_PREVIEW_TAKE_ISOLATION_OK', isolation.previewOnly && isolation.taken && isolation.direct === false && isolation.deleteStayedInPreview && isolation.programDefinitionRetained && isolation.restored, JSON.stringify(isolation));

  const layerTake = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    const layer=selectedLayer(); const layerId=layer.id;
    const programScene=activeScene(programState);
    const beforeProgramLayer=findProgramLayer(layer);
    const beforeOther=JSON.stringify(programScene.layers.filter(row=>row.id!==beforeProgramLayer.id));
    document.getElementById('inspX').value='44'; document.getElementById('inspX').dispatchEvent(new Event('change',{bubbles:true}));
    const previewAfterEdit=selectedLayer();
    const previewIsolated=findProgramLayer(previewAfterEdit).x!==previewAfterEdit.x;
    const changedStatus=document.getElementById('layerProgramStatus').textContent;
    document.getElementById('btnTakeLayer').click();
    const taken=findProgramLayer(layer);
    const afterOther=JSON.stringify(activeScene(programState).layers.filter(row=>row.id!==taken.id));
    const liveStatus=document.getElementById('layerProgramStatus').textContent;
    document.getElementById('btnHideLayer').click();
    const hidden=findProgramLayer(layer);
    const hiddenStatus=document.getElementById('layerProgramStatus').textContent;
    document.getElementById('btnTakeLayer').click();
    const restored=findProgramLayer(layer);
    const previewAfterTake=(currentScene().layers||[]).find(row=>row.id===layerId);
    return {previewIsolated,changedStatus,takenX:taken.x,previewX:previewAfterTake.x,otherLayersUnchanged:beforeOther===afterOther,liveStatus,hidden: hidden.visible===false,previewVisible:previewAfterTake.visible!==false,hiddenStatus,restoredVisible:restored.visible!==false,finalStatus:document.getElementById('layerProgramStatus').textContent};
  })())`));
  check('COMPOSITOR_LAYER_TAKE_HIDE_WORKFLOW_OK', layerTake.previewIsolated && layerTake.changedStatus === 'CHANGED' && layerTake.takenX === layerTake.previewX && layerTake.otherLayersUnchanged && layerTake.liveStatus === 'LIVE' && layerTake.hidden && layerTake.previewVisible && layerTake.hiddenStatus === 'HIDDEN' && layerTake.restoredVisible && layerTake.finalStatus === 'LIVE', JSON.stringify(layerTake));

  const crossSceneLayer = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    const programSceneBefore=activeScene(programState);
    const programSceneId=programSceneBefore.id;
    const existingIds=programSceneBefore.layers.map(row=>row.id);
    const source=currentScene().layers.find(row=>row.type==='image') || currentScene().layers[0];
    const previewLayer={...cloneState(source),id:makeId('layer'),name:'Cross-scene overlay',x:12,y:14,w:38,h:28,visible:true};
    const previewScene={id:makeId('scene'),name:'Overlay preview',layers:[previewLayer]};
    S.scenes.push(previewScene); S.activeSceneId=previewScene.id; selectedLayerId=previewLayer.id;
    renderScenesUI(); send();
    const programUnchangedBeforeTake=activeScene(programState).id===programSceneId && existingIds.every(id=>activeScene(programState).layers.some(row=>row.id===id));
    document.getElementById('btnTakeLayer').click();
    const live=findProgramLayer(previewLayer), programSceneAfter=activeScene(programState);
    const preservedProgramScene=programSceneAfter.id===programSceneId && existingIds.every(id=>programSceneAfter.layers.some(row=>row.id===id));
    const insertedAsOverlay=!!live && live.programSourceLayerId===previewLayer.id && live.programSourceSceneId===previewScene.id && live.visible!==false;
    document.getElementById('btnHideLayer').click();
    const hidden=findProgramLayer(previewLayer);
    return {programUnchangedBeforeTake,preservedProgramScene,insertedAsOverlay,hidden:!!hidden&&hidden.visible===false,previewVisible:previewLayer.visible!==false,status:document.getElementById('layerProgramStatus').textContent};
  })())`));
  check('COMPOSITOR_CROSS_SCENE_LAYER_TAKE_PRESERVES_PROGRAM_OK', crossSceneLayer.programUnchangedBeforeTake && crossSceneLayer.preservedProgramScene && crossSceneLayer.insertedAsOverlay && crossSceneLayer.hidden && crossSceneLayer.previewVisible && crossSceneLayer.status === 'HIDDEN', JSON.stringify(crossSceneLayer));

  const audioGuard = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    outputConfigs=[normalizeOutputConfigUI({id:'audio-route',name:'Recorder',enabled:true,liveAudio:true,displayId:lastDisplays[0].id},0)];
    const primary=document.getElementById('chkPrimaryLiveAudio'); primary.checked=true; primary.dispatchEvent(new Event('change',{bubbles:true}));
    return {primary:S.primaryLiveAudio,checked:primary.checked,router:document.getElementById('outputRouterOverlay').classList.contains('open'),status:document.getElementById('outputRouterStatus').textContent};
  })())`));
  check('COMPOSITOR_SINGLE_LIVE_AUDIO_ROUTE_GUARD_OK', !audioGuard.primary && !audioGuard.checked && audioGuard.router && audioGuard.status.length > 10, JSON.stringify(audioGuard));
  await win.webContents.executeJavaScript(`document.getElementById('btnOutputRouterCloseX').click(); document.getElementById('panelSources').scrollIntoView({block:'start'});`);
  await new Promise(resolve => setTimeout(resolve, 160));
  fs.writeFileSync(path.join(artifactDirectory, 'compositor-1280x800.png'), (await win.webContents.capturePage()).toPNG());

  const saved = await win.webContents.executeJavaScript(`flushShowAutosave({reason:'compositor-renderer-test',force:true})`);
  const disk = await repository.loadCurrent();
  const roundtripDetail = disk.ok ? {
    saved: !!saved.ok,
    canvas: disk.document.show.screenContent.canvas,
    liveInputs: disk.document.show.screenContent.liveInputs.length,
    layerTypes: disk.document.show.screenContent.scenes[0].layers.map(layer => layer.type)
  } : { saved: !!saved.ok, disk };
  check('COMPOSITOR_FILE_ROUNDTRIP_OK', saved.ok && disk.ok && disk.document.show.screenContent.canvas.width === 1000 && disk.document.show.screenContent.liveInputs.length === 2 && disk.document.show.screenContent.scenes[0].layers.some(layer => layer.type === 'window') && disk.document.show.screenContent.scenes[0].layers.some(layer => layer.type === 'capture'), JSON.stringify(roundtripDetail));

  win.setBounds(smokeDisplay.clampToWorkArea({ width: 900, height: 600 }, target.workArea));
  if (!await waitFor(() => win.webContents.executeJavaScript('innerWidth===900 && innerHeight>=560'))) throw new Error('900x600 viewport did not settle');
  const compact = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    const root=document.getElementById('panelSources'); root.scrollTop=root.scrollHeight;
    const panel=root.getBoundingClientRect(); const add=document.getElementById('btnAddSource').getBoundingClientRect(); const action=document.getElementById('inspDelete').getBoundingClientRect();
    return {vw:innerWidth,vh:innerHeight,panel:{left:panel.left,right:panel.right,top:panel.top,bottom:panel.bottom},add:{left:add.left,right:add.right,top:add.top,bottom:add.bottom},action:{left:action.left,right:action.right,top:action.top,bottom:action.bottom},scrollTop:root.scrollTop,scrollable:root.scrollHeight>root.clientHeight};
  })())`));
  check('COMPOSITOR_900X600_CONTROLS_REACHABLE_OK', compact.panel.left >= 0 && compact.panel.right <= compact.vw + 1 && compact.add.left >= 0 && compact.add.right <= compact.vw + 1 && compact.scrollable && compact.scrollTop > 0 && compact.action.left >= 0 && compact.action.right <= compact.vw + 1 && compact.action.top >= compact.panel.top && compact.action.bottom <= compact.panel.bottom + 1, JSON.stringify(compact));
  await win.webContents.executeJavaScript(`document.getElementById('panelSources').scrollTop=0`);
  await new Promise(resolve => setTimeout(resolve, 120));
  fs.writeFileSync(path.join(artifactDirectory, 'compositor-900x600.png'), (await win.webContents.capturePage()).toPNG());

  const demoBaseline = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    const demo=document.getElementById('btnDemoShow');
    const visible=!!(demo&&demo.getClientRects().length); if(demo) demo.click();
    const statuses=[...document.querySelectorAll('#layerList .layer-program-chip')].map(chip=>chip.textContent);
    return {visible,direct:S.studioDirect,selectedStatus:document.getElementById('layerProgramStatus').textContent,statuses,preview:activeScene(S)?.name,program:activeScene(programState)?.name};
  })())`));
  check('COMPOSITOR_DEMO_STARTS_PREVIEW_PROGRAM_IN_SYNC_OK', demoBaseline.visible && demoBaseline.direct === false && demoBaseline.selectedStatus === 'LIVE' && demoBaseline.statuses.length > 0 && demoBaseline.statuses.every(status=>status === 'LIVE') && demoBaseline.preview === demoBaseline.program, JSON.stringify(demoBaseline));

  console.log(`COMPOSITOR_RENDERER_TESTS_OK ${checks}/21`);
  win.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  app.quit();
}).catch(error => {
  console.error(error && error.stack || error);
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
