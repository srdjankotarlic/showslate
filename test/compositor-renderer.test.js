'use strict';

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
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
let showDocumentSaveRequests = [];
let showDocumentOpenRequests = 0;

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
ipcMain.handle('show-document-status', () => ({ ok: true, path: '', name: '' }));
ipcMain.handle('show-document-save', (event, payload) => {
  showDocumentSaveRequests.push(JSON.parse(JSON.stringify(payload || {})));
  const suffix = payload && payload.saveAs ? ' Copy' : '';
  return { ok: true, path: path.join(profile, `Conference Desk Demo${suffix}.showslate`), name: `Conference Desk Demo${suffix}.showslate` };
});
ipcMain.handle('show-document-open', () => { showDocumentOpenRequests++; return { ok: false, canceled: true }; });
ipcMain.on('show-document-clear-path', () => {});
ipcMain.handle('show-preflight-inspect', () => ({ overall: 'warning', checks: [], counts: { ok: 0, warning: 1, blocking: 0 } }));
ipcMain.handle('show-package-export', () => ({ ok: false, canceled: true }));
ipcMain.handle('show-package-import', () => ({ ok: false, canceled: true }));
ipcMain.handle('show-folder-import', () => ({ ok: false, canceled: true }));
ipcMain.handle('media-import-file', (event, payload) => {
  const data = fs.readFileSync(String(payload && payload.path || ''));
  return {
    ok: true,
    src: 'data:image/svg+xml;base64,' + data.toString('base64'),
    bytes: data.length,
    mime: 'image/svg+xml',
    storage: 'linked',
    portable: false,
    originalName: String(payload && payload.name || '')
  };
});
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
      { deviceId: 'audio-card-1', groupId: 'capture-card', kind: 'audioinput', label: 'UVC Capture Audio' },
      { deviceId: 'speaker-main', groupId: 'speaker', kind: 'audiooutput', label: 'Main Audio Output' }
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

  const showMenuInitial = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    window.alert=()=>{};window.confirm=()=>true;
    const button=document.getElementById('btnShowFileMenu');button.click();
    const menu=document.getElementById('showFileMenu');
    return {buttonVisible:button.getClientRects().length>0,menuVisible:menu.getClientRects().length>0,expanded:button.getAttribute('aria-expanded'),hidden:menu.getAttribute('aria-hidden'),items:menu.querySelectorAll('[role="menuitem"]').length,name:document.getElementById('showFileMenuName').textContent.trim(),path:document.getElementById('showFileMenuPath').textContent.trim()};
  })())`));
  await win.webContents.executeJavaScript(`document.getElementById('btnShowSave').click()`);
  if (!await waitFor(() => showDocumentSaveRequests.length === 1)) throw new Error('Save Show did not invoke show-document-save');
  const firstSavePath = await win.webContents.executeJavaScript(`document.getElementById('showFileMenuPath').textContent.trim()`);
  await win.webContents.executeJavaScript(`document.getElementById('btnShowFileMenu').click();document.getElementById('btnShowSaveAs').click()`);
  if (!await waitFor(() => showDocumentSaveRequests.length === 2)) throw new Error('Save Show As did not invoke show-document-save');
  const saveAsPath = await win.webContents.executeJavaScript(`document.getElementById('showFileMenuPath').textContent.trim()`);
  await win.webContents.executeJavaScript(`document.getElementById('btnShowFileMenu').click();document.getElementById('btnShowOpen').click()`);
  if (!await waitFor(() => showDocumentOpenRequests === 1)) throw new Error('Open Show did not invoke show-document-open');
  const showMenuFinal = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify({open:document.body.classList.contains('show-file-open'),expanded:document.getElementById('btnShowFileMenu').getAttribute('aria-expanded')})`));
  check('SHOW_FILE_MENU_SAVE_SAVE_AS_OPEN_VISIBLE_OK', showMenuInitial.buttonVisible && showMenuInitial.menuVisible && showMenuInitial.expanded === 'true' && showMenuInitial.hidden === 'false' && showMenuInitial.items === 3 && showMenuInitial.name.length > 0 && firstSavePath.endsWith('.showslate') && saveAsPath.endsWith(' Copy.showslate') && showDocumentSaveRequests[0].saveAs === false && showDocumentSaveRequests[1].saveAs === true && !showMenuFinal.open && showMenuFinal.expanded === 'false', JSON.stringify({showMenuInitial,firstSavePath,saveAsPath,showMenuFinal}));

  const compositionWorkflow = JSON.parse(await win.webContents.executeJavaScript(`(async()=>{
    const wait=async fn=>{const started=Date.now();while(Date.now()-started<1800){if(fn())return true;await new Promise(resolve=>setTimeout(resolve,25));}return false;};
    window.__compositionTestRestore={compositionId:S.activeCompositionId,outputs:cloneState(outputConfigs)};
    const button=document.getElementById('btnCompositionWorkspace');
    const topButtonVisible=button.getClientRects().length>0&&button.closest('.workspace-nav')!==null;
    const singleTopEntry=document.querySelectorAll('#btnCompositionWorkspace').length===1&&!document.getElementById('btnOpenCompositionFromComposer')&&!document.querySelector('.compositor-title-copy');
    button.click();
    const opened=await wait(()=>document.getElementById('compositionWorkspace').classList.contains('open'));
    const panes=['compositionList','compositionMapViewport','canvasPresetSel','projectorMappingList'].every(id=>document.getElementById(id).getClientRects().length>0);
    document.getElementById('btnCompositionNew').click();
    const modalOpened=await wait(()=>document.getElementById('modalOverlay').classList.contains('open'));
    document.getElementById('modalInput').value='LED Wall 5376';
    document.getElementById('modalOk').click();
    await wait(()=>activeComposition().name==='LED Wall 5376');
    const change=element=>element.dispatchEvent(new Event('change',{bubbles:true}));
    document.getElementById('canvasPresetSel').value='custom'; change(document.getElementById('canvasPresetSel'));
    document.getElementById('canvasWidth').value='5376';
    document.getElementById('canvasHeight').value='768';
    document.getElementById('canvasFps').value='50';
    change(document.getElementById('canvasWidth'));
    document.getElementById('canvasHeight').value='768';
    document.getElementById('canvasFps').value='50';
    change(document.getElementById('canvasHeight'));
    document.getElementById('canvasFps').value='50';
    change(document.getElementById('canvasFps'));
    outputConfigs=[
      normalizeOutputConfigUI({id:'projection-test',name:'Left projector',enabled:true,displayId:lastDisplays[0].id,mode:'fullscreen',outputCanvas:{width:1920,height:1080,fps:50,fit:'contain'}},0),
      normalizeOutputConfigUI({id:'projection-square',name:'Square LED relay',enabled:true,displayId:lastDisplays[0].id,mode:'window',outputCanvas:{width:1000,height:1000,fps:30,fit:'cover'}},1)
    ];
    renderOutputRows();
    document.getElementById('btnMappingAdd').click();
    const inspectorVisible=await wait(()=>!document.getElementById('mappingInspector').hidden);
    document.getElementById('mappingName').value='Left LED processor';
    document.getElementById('mappingOutput').value='projection-test';
    document.getElementById('mappingX').value='0';
    document.getElementById('mappingY').value='0';
    document.getElementById('mappingWidth').value='2688';
    document.getElementById('mappingHeight').value='768';
    document.getElementById('mappingBlendRight').value='96';
    document.getElementById('mappingWarpEnabled').checked=true;
    document.getElementById('mappingGridVisible').checked=true;
    document.getElementById('mappingGridColumns').value='10';
    document.getElementById('mappingGridRows').value='8';
    document.getElementById('mappingWarpTlX').value='4';
    document.getElementById('mappingWarpTlY').value='6';
    document.getElementById('mappingWarpTrX').value='97';
    document.getElementById('mappingWarpTrY').value='2';
    document.getElementById('mappingWarpBrX').value='93';
    document.getElementById('mappingWarpBrY').value='95';
    document.getElementById('mappingWarpBlX').value='8';
    document.getElementById('mappingWarpBlY').value='98';
    change(document.getElementById('mappingName'));
    document.getElementById('btnMappingOutputMode').click();
    document.getElementById('mappingX').value='0';
    document.getElementById('mappingY').value='0';
    document.getElementById('mappingWidth').value='50';
    document.getElementById('mappingHeight').value='100';
    change(document.getElementById('mappingWidth'));
    const firstMappingId=selectedProjectorMappingId;
    document.getElementById('btnMappingDuplicate').click();
    const secondMappingId=selectedProjectorMappingId;
    document.getElementById('btnMappingInputMode').click();
    document.getElementById('mappingName').value='Right curved screen';
    document.getElementById('mappingX').value='2688';
    document.getElementById('mappingY').value='0';
    document.getElementById('mappingWidth').value='2688';
    document.getElementById('mappingHeight').value='768';
    change(document.getElementById('mappingName'));
    document.getElementById('btnMappingOutputMode').click();
    document.getElementById('mappingX').value='50';
    document.getElementById('mappingY').value='0';
    document.getElementById('mappingWidth').value='50';
    document.getElementById('mappingHeight').value='100';
    document.getElementById('mappingWarpEnabled').checked=true;
    document.getElementById('mappingWarpMode').value='mesh';
    document.getElementById('mappingMeshColumns').value='2';
    document.getElementById('mappingMeshRows').value='2';
    document.getElementById('mappingGridVisible').checked=true;
    document.getElementById('mappingGridPattern').value='checker';
    document.getElementById('mappingGridLabels').checked=true;
    document.getElementById('mappingMaskEnabled').checked=true;
    change(document.getElementById('mappingMaskEnabled'));
    const advancedMapping=selectedProjectorMapping();
    advancedMapping.warp.mesh.points[4]={x:47,y:54};
    advancedMapping.mask.points=[{x:2,y:3},{x:98,y:1},{x:94,y:97},{x:5,y:100}];
    compositionDirty();
    const composition=cloneState(activeComposition());
    const mapping=cloneState(composition.mappings[0]);
    const projected=projectedOutputConfig(outputConfigs[0]);
    const advanced=cloneState(composition.mappings.find(row=>row.id===secondMappingId));
    const editor={
      inputModeVisible:document.getElementById('btnMappingInputMode').getClientRects().length>0,
      outputModeActive:document.getElementById('btnMappingOutputMode').classList.contains('active'),
      surfaceTabs:document.querySelectorAll('#projectorMappingList .projector-mapping-tab').length,
      visibleSurfaces:document.querySelectorAll('#projectorMappingSurfaces .mapping-surface').length,
      meshHandles:[...document.querySelectorAll('.mapping-surface.selected .mapping-mesh-handle')].filter(node=>getComputedStyle(node).display!=='none').length,
      meshLines:document.querySelectorAll('.mapping-surface.selected .mapping-mesh-overlay line').length,
      maskHandles:[...document.querySelectorAll('.mapping-surface.selected .mapping-mask-handle')].filter(node=>getComputedStyle(node).display!=='none').length,
      inspectorScroll:getComputedStyle(document.querySelector('.composition-settings-pane')).overflowY
    };
    document.getElementById('btnCompositionClose').click();
    button.click();
    const reopened=await wait(()=>document.getElementById('compositionWorkspace').classList.contains('open'));
    const persisted=activeComposition().id===composition.id&&activeComposition().canvas.width===5376&&activeComposition().mappings[0]?.outputId==='projection-test';
    document.getElementById('btnCompositionClose').click();
    document.getElementById('btnOpenOut').click();
    const routerVisible=await wait(()=>document.getElementById('outputRouterOverlay').classList.contains('open'));
    const routeCanvases=[...document.querySelectorAll('.output-route-editor')].map(row=>({
      id:row.dataset.routeId,
      width:Number(row.querySelector('.out-canvas-w').value),
      height:Number(row.querySelector('.out-canvas-h').value),
      fit:row.querySelector('.out-canvas-fit').value,
      mapping:row.querySelector('.output-mapping-state').textContent.trim(),
      mapVisible:row.querySelector('.out-map').getClientRects().length>0
    }));
    document.querySelector('.output-route-editor[data-route-id="projection-test"] .out-map').click();
    const mapEntryOpened=await wait(()=>document.getElementById('compositionWorkspace').classList.contains('open')&&selectedProjectorMappingId===mapping.id);
    const cornerHandles=[...document.querySelectorAll('.mapping-surface.selected .mapping-corner-handle')].filter(node=>getComputedStyle(node).display!=='none').length;
    return JSON.stringify({topButtonVisible,singleTopEntry,opened,panes,modalOpened,inspectorVisible,reopened,persisted,routerVisible,routeCanvases,mapEntryOpened,cornerHandles,compositionId:composition.id,compositionCount:S.compositions.length,sceneCount:scenesForComposition(composition.id).length,canvas:composition.canvas,mapping,advanced,editor,firstMappingId,secondMappingId,projected,overlayInside:document.querySelector('.composition-workspace-dialog').getBoundingClientRect().right<=innerWidth+1});
  })()`));
  check('COMPOSITION_WORKSPACE_VISIBLE_FROM_TOP_NAV_OK', compositionWorkflow.topButtonVisible && compositionWorkflow.singleTopEntry && compositionWorkflow.opened && compositionWorkflow.panes && compositionWorkflow.modalOpened && compositionWorkflow.inspectorVisible && compositionWorkflow.reopened && compositionWorkflow.overlayInside, JSON.stringify(compositionWorkflow));
  check('COMPOSITION_CUSTOM_LED_MULTI_PROJECTOR_MAPPING_OK', compositionWorkflow.persisted && compositionWorkflow.compositionCount >= 2 && compositionWorkflow.sceneCount >= 1 && compositionWorkflow.canvas.width === 5376 && compositionWorkflow.canvas.height === 768 && compositionWorkflow.canvas.fps === 50 && compositionWorkflow.mapping.width === 2688 && compositionWorkflow.mapping.height === 768 && compositionWorkflow.mapping.blend.right === 96 && compositionWorkflow.mapping.warp.enabled && compositionWorkflow.mapping.warp.grid.visible && compositionWorkflow.mapping.warp.grid.columns === 10 && compositionWorkflow.mapping.warp.corners.topLeft.x === 4 && compositionWorkflow.projected.compositionId === compositionWorkflow.compositionId && compositionWorkflow.projected.projection.width === 2688 && compositionWorkflow.projected.projection.warp.enabled && compositionWorkflow.cornerHandles === 4, JSON.stringify(compositionWorkflow));
  check('COMPOSITION_ADVANCED_OUTPUT_INPUT_OUTPUT_EDITOR_OK', compositionWorkflow.editor.inputModeVisible && compositionWorkflow.editor.outputModeActive && compositionWorkflow.editor.surfaceTabs === 2 && compositionWorkflow.editor.visibleSurfaces === 2 && compositionWorkflow.editor.meshHandles === 9 && compositionWorkflow.editor.meshLines === 12 && compositionWorkflow.editor.maskHandles === 4 && ['auto','scroll'].includes(compositionWorkflow.editor.inspectorScroll) && compositionWorkflow.advanced.input.x === 2688 && compositionWorkflow.advanced.output.x === 50 && compositionWorkflow.advanced.output.width === 50 && compositionWorkflow.advanced.warp.mode === 'mesh' && compositionWorkflow.advanced.mask.enabled, JSON.stringify(compositionWorkflow.editor));
  check('COMPOSITION_MULTI_SURFACE_ROUTE_PAYLOAD_OK', compositionWorkflow.projected.projection.surfaces.length === 2 && compositionWorkflow.projected.projection.surfaces[0].output.width === 50 && compositionWorkflow.projected.projection.surfaces[1].input.x === 2688 && compositionWorkflow.projected.projection.surfaces[1].output.x === 50 && compositionWorkflow.projected.projection.surfaces[1].warp.mode === 'mesh' && compositionWorkflow.projected.projection.surfaces[1].mask.enabled, JSON.stringify(compositionWorkflow.projected.projection.surfaces));
  check('OUTPUT_ROUTER_MULTI_CANVAS_AND_MAPPING_ENTRY_OK', compositionWorkflow.routerVisible && compositionWorkflow.mapEntryOpened && compositionWorkflow.routeCanvases.length === 2 && compositionWorkflow.routeCanvases[0].width === 1920 && compositionWorkflow.routeCanvases[0].height === 1080 && compositionWorkflow.routeCanvases[0].fit === 'contain' && compositionWorkflow.routeCanvases[0].mapping === 'Mapping active' && compositionWorkflow.routeCanvases[1].width === 1000 && compositionWorkflow.routeCanvases[1].height === 1000 && compositionWorkflow.routeCanvases[1].fit === 'cover' && compositionWorkflow.routeCanvases.every(route=>route.mapVisible), JSON.stringify(compositionWorkflow.routeCanvases));
  await win.webContents.executeJavaScript(`(()=>{selectedProjectorMappingId=${JSON.stringify(compositionWorkflow.secondMappingId)};setMappingWorkspaceMode('output');renderCompositionWorkspace();})()`);
  await new Promise(resolve => setTimeout(resolve, 180));
  fs.writeFileSync(path.join(artifactDirectory, 'composition-workspace-1280x800.png'), (await win.webContents.capturePage()).toPNG());
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  if (!await waitFor(() => win.webContents.executeJavaScript(`!document.getElementById('compositionWorkspace').classList.contains('open')`))) throw new Error('Composition workspace did not close with Escape');
  win.setContentSize(1159, 745);
  if (!await waitFor(() => win.webContents.executeJavaScript('innerWidth===1159&&innerHeight===745'))) throw new Error('Output Routing reference viewport did not settle');
  await win.webContents.executeJavaScript(`document.getElementById('btnOpenOut').click()`);
  if (!await waitFor(() => win.webContents.executeJavaScript(`document.getElementById('outputRouterOverlay').classList.contains('open')`))) throw new Error('Output Routing did not open for visual evidence');
  await new Promise(resolve => setTimeout(resolve, 120));
  fs.writeFileSync(path.join(artifactDirectory, 'output-routing-1159x745.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.getElementById('btnOutputRouterCloseX').click()`);
  win.setContentSize(1280, 800);
  if (!await waitFor(() => win.webContents.executeJavaScript('innerWidth===1280&&innerHeight===800'))) throw new Error('Controller viewport did not restore after Output Routing evidence');
  await win.webContents.executeJavaScript(`(()=>{const prior=window.__compositionTestRestore;outputConfigs=prior.outputs;selectComposition(prior.compositionId,{save:false});renderOutputRows();delete window.__compositionTestRestore;})()`);

  const outputRendererWin = new BrowserWindow({
    width: 1280, height: 720, show: false, backgroundColor: '#000000',
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  await outputRendererWin.loadFile(path.join(root, 'output.html'));
  if (!await waitFor(() => outputRendererWin.webContents.executeJavaScript(`typeof applyState==='function'&&!!document.getElementById('programContent')`))) throw new Error('output renderer did not initialize');
  const outputGeometry = JSON.parse(await outputRendererWin.webContents.executeJavaScript(`(async()=>{
    const state={
      activeCompositionId:'composition-main',activeSceneId:'scene-main',
      canvas:{width:5376,height:768,fps:50,background:'#000000',transparent:false},
      scenes:[{id:'scene-main',name:'Mapped Program',compositionId:'composition-main',layers:[
        {id:'background',type:'color',name:'Background',visible:true,color:'#16324d',x:0,y:0,w:100,h:100,opacity:1},
        {id:'title',type:'text',name:'Mapped Program',visible:true,text:'MAPPED PROGRAM',color:'#ffffff',bg:'transparent',x:8,y:36,w:84,h:28,opacity:1,fontSize:9},
        {id:'timer',type:'timer',name:'Timer',visible:true,x:68,y:5,w:27,h:18,opacity:1}
      ]}],
      mode:'countdown',running:false,durationMs:600000,remMs:600000,endAt:0,startAt:0,elapsedMs:0,overtime:true,
      bgColor:'#000000',fgColor:'#ffffff',message:{text:'',flash:false},blackout:false,showProgress:false,transparent:false,lang:'en',cues:[],currentCue:-1,
      _outputRoute:{id:'projection-test',role:'audience',liveAudio:false,outputCanvas:{width:1000,height:1000,fps:30,fit:'contain'},projection:{
        id:'mapping-left',compositionId:'composition-main',enabled:true,x:2688,y:0,width:2688,height:768,canvasWidth:5376,canvasHeight:768,
        blend:{left:64,right:0,top:0,bottom:0},warp:{enabled:true,corners:{topLeft:{x:4,y:6},topRight:{x:97,y:2},bottomRight:{x:93,y:95},bottomLeft:{x:8,y:98}},grid:{visible:true,columns:10,rows:8,opacity:.78}}
      }}
    };
    applyState(state);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const surface=document.getElementById('programSurface'),content=document.getElementById('programContent'),grid=document.getElementById('projectionCalibration');
    const style=getComputedStyle(surface),contentStyle=getComputedStyle(content),gridStyle=getComputedStyle(grid),rect=surface.getBoundingClientRect();
    const contentMatrix=new DOMMatrix(contentStyle.transform);
    return JSON.stringify({
      surface:{width:parseFloat(surface.style.width),height:parseFloat(surface.style.height),boundsWidth:rect.width,boundsHeight:rect.height,transform:style.transform,mask:style.webkitMaskImage||style.maskImage},
      content:{transform:contentStyle.transform,scaleX:contentMatrix.a,scaleY:contentMatrix.d,translateX:contentMatrix.e,translateY:contentMatrix.f,children:content.children.length,containsLowerThird:content.contains(document.getElementById('lowerThird'))},
      grid:{display:gridStyle.display,size:gridStyle.backgroundSize,opacity:gridStyle.opacity,parent:grid.parentElement.id},
      canvas:{width:surface.dataset.canvasWidth,height:surface.dataset.canvasHeight,fit:surface.dataset.canvasFit,warp:surface.dataset.warp}
    });
  })()`));
  check('OUTPUT_RENDERER_FULL_PROGRAM_WARP_AND_CALIBRATION_GRID_OK', outputGeometry.surface.width === outputGeometry.surface.height && outputGeometry.surface.width >= 600 && outputGeometry.surface.transform !== 'none' && outputGeometry.surface.mask !== 'none' && outputGeometry.content.scaleX === 2 && outputGeometry.content.scaleY === 1 && Math.abs(outputGeometry.content.translateX + outputGeometry.surface.width) < 0.5 && outputGeometry.content.translateY === 0 && outputGeometry.content.containsLowerThird && outputGeometry.grid.display === 'block' && outputGeometry.grid.size.includes('10%') && outputGeometry.grid.parent === 'programSurface' && outputGeometry.canvas.width === '1000' && outputGeometry.canvas.height === '1000' && outputGeometry.canvas.fit === 'contain' && outputGeometry.canvas.warp === 'on', JSON.stringify(outputGeometry));
  fs.writeFileSync(path.join(artifactDirectory, 'projector-mapped-output-1280x720.png'), (await outputRendererWin.webContents.capturePage()).toPNG());
  const advancedOutput = JSON.parse(await outputRendererWin.webContents.executeJavaScript(`(async()=>{
    const base={
      activeCompositionId:'composition-main',activeSceneId:'scene-main',canvas:{width:1920,height:1080,fps:30,background:'#000000',transparent:false},
      scenes:[{id:'scene-main',name:'Advanced Output',compositionId:'composition-main',layers:[
        {id:'background',type:'color',name:'Background',visible:true,color:'#121a24',x:0,y:0,w:100,h:100,opacity:1},
        {id:'left',type:'text',name:'Left',visible:true,text:'INPUT A',color:'#e8edf5',bg:'transparent',x:5,y:35,w:38,h:25,opacity:1,fontSize:10},
        {id:'right',type:'text',name:'Right',visible:true,text:'INPUT B',color:'#b8e4cb',bg:'transparent',x:57,y:35,w:38,h:25,opacity:1,fontSize:10}
      ]}],mode:'countdown',running:false,durationMs:600000,remMs:600000,endAt:0,startAt:0,elapsedMs:0,overtime:true,bgColor:'#000000',fgColor:'#ffffff',message:{text:'',flash:false},blackout:false,showProgress:false,transparent:false,lang:'en',cues:[],currentCue:-1
    };
    const surfaces=[
      {id:'surface-a',name:'Stage left',compositionId:'composition-main',enabled:true,canvasWidth:1920,canvasHeight:1080,input:{x:0,y:0,width:960,height:1080},output:{x:0,y:0,width:50,height:100},opacity:1,mask:{enabled:false},blend:{right:48,gamma:1,blackLevel:0},warp:{enabled:true,mode:'perspective',corners:{topLeft:{x:2,y:4},topRight:{x:98,y:1},bottomRight:{x:96,y:97},bottomLeft:{x:4,y:99}},grid:{visible:true,columns:8,rows:6,pattern:'grid',labels:true}}},
      {id:'surface-b',name:'Curved right',compositionId:'composition-main',enabled:true,canvasWidth:1920,canvasHeight:1080,input:{x:960,y:0,width:960,height:1080},output:{x:50,y:0,width:50,height:100},opacity:.94,mask:{enabled:true,points:[{x:2,y:4},{x:98,y:2},{x:94,y:96},{x:6,y:99}]},blend:{left:48,gamma:1.15,blackLevel:.03},warp:{enabled:true,mode:'mesh',mesh:{columns:2,rows:2,points:[{x:0,y:0},{x:50,y:2},{x:100,y:0},{x:2,y:50},{x:47,y:54},{x:98,y:49},{x:0,y:100},{x:52,y:98},{x:100,y:100}]},grid:{visible:true,columns:8,rows:6,pattern:'checker',labels:true}}}
    ];
    applyState({...base,_outputRoute:{id:'advanced-output',role:'audience',liveAudio:false,outputCanvas:{width:1920,height:1080,fps:30,fit:'contain'},projection:{...surfaces[0],surfaces}}});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const host=document.getElementById('mappingSurfaceHost'),source=document.getElementById('programSurface'),wrappers=[...host.querySelectorAll('.mapped-surface')],mesh=wrappers.find(node=>node.dataset.surfaceId==='surface-b');
    const before=host.textContent;
    applyState({...base,remMs:545000,_outputRoute:{id:'advanced-output',role:'audience',liveAudio:false,outputCanvas:{width:1920,height:1080,fps:30,fit:'contain'},projection:{...surfaces[0],surfaces}}});
    await new Promise(resolve=>setTimeout(resolve,70));
    const meshGrids=mesh?[...mesh.querySelectorAll('.mapped-surface-frame .mapped-runtime-grid')]:[];
    return JSON.stringify({active:host.classList.contains('active'),sourceHidden:getComputedStyle(source).opacity==='0',surfaceCount:wrappers.length,frameCount:host.querySelectorAll('.mapped-surface-frame').length,meshFrames:mesh?mesh.querySelectorAll('.mapped-surface-frame').length:0,meshGridFrames:meshGrids.length,meshGridOffsets:meshGrids.map(node=>[node.style.left,node.style.top]),checker:!!host.querySelector('.pattern-checker'),checkerCells:host.querySelectorAll('.pattern-checker rect').length,cloneCount:host.querySelectorAll('.mapped-program-clone').length,labels:[...host.querySelectorAll('.mapped-surface-label')].map(node=>node.textContent),mask:getComputedStyle(mesh.querySelector('.mapped-surface-content')).clipPath,labelUnclipped:getComputedStyle(mesh).clipPath==='none',bodyText:before,dynamicTimer:[...host.querySelectorAll('[data-mapped-source-id="timer"]')].map(node=>node.textContent)});
  })()`));
  check('OUTPUT_RENDERER_MULTI_SURFACE_MESH_MASK_OK', advancedOutput.active && advancedOutput.sourceHidden && advancedOutput.surfaceCount === 2 && advancedOutput.frameCount === 5 && advancedOutput.meshFrames === 4 && advancedOutput.meshGridFrames === 4 && new Set(advancedOutput.meshGridOffsets.map(pair=>pair.join('|'))).size === 4 && advancedOutput.checkerCells >= 48 && advancedOutput.cloneCount === 5 && advancedOutput.labels.length === 2 && advancedOutput.checker && advancedOutput.mask !== 'none' && advancedOutput.labelUnclipped && advancedOutput.bodyText.includes('INPUT A') && advancedOutput.bodyText.includes('INPUT B'), JSON.stringify(advancedOutput));
  fs.writeFileSync(path.join(artifactDirectory, 'advanced-output-multi-surface-1280x720.png'), (await outputRendererWin.webContents.capturePage()).toPNG());
  const transportFixtureUrl = pathToFileURL(path.join(root, 'test', 'fixtures', 'lower-third', 'opaque-h264.mp4')).href;
  const outputVideoAudio = JSON.parse(await outputRendererWin.webContents.executeJavaScript(`(async()=>{
    const base={
      activeCompositionId:'composition-main',activeSceneId:'video-output-scene',canvas:{width:1920,height:1080,fps:30,background:'#000000',transparent:false},
      scenes:[{id:'video-output-scene',name:'Video output',compositionId:'composition-main',layers:[{
        id:'video-output-layer',type:'video',name:'Video output test',src:${JSON.stringify(transportFixtureUrl)},visible:true,x:0,y:0,w:100,h:100,opacity:1,fit:'contain',
        playbackState:'paused',playbackPosition:.2,playbackUpdatedAt:Date.now(),playbackRate:1,inPoint:.1,outPoint:.8,endBehavior:'loop',restartOnTake:true,
        audioEnabled:true,audioMonitoring:'off',muted:false,volume:.7
      }]}],mode:'countdown',running:false,durationMs:600000,remMs:500000,endAt:0,startAt:0,elapsedMs:0,overtime:true,bgColor:'#000000',fgColor:'#ffffff',message:{text:'',flash:false},blackout:false,showProgress:false,transparent:false,lang:'en',cues:[],currentCue:-1,sceneFadeMs:0
    };
    const waitVideo=async()=>{const started=Date.now();while(Date.now()-started<2500){const video=document.querySelector('#sceneRoot video');if(video&&video.readyState>=1)return video;await new Promise(resolve=>setTimeout(resolve,25));}return document.querySelector('#sceneRoot video');};
    applyState({...base,_outputRoute:{id:'primary',role:'audience',liveAudio:true,audioOutputDeviceId:'',outputCanvas:{width:1920,height:1080,fps:30,fit:'contain'}}});
    let video=await waitVideo();
    const routed={exists:!!video,muted:video&&video.muted,volume:video&&video.volume,controls:video&&video.controls,state:video&&video.dataset.playbackState,currentTime:video&&video.currentTime};
    const publicPauseOverlayAbsent=!document.getElementById('paused')&&!/\\b(PAUSED|PAUZA)\\b/.test(document.body.innerText);
    applyState({...base,_outputRoute:{id:'primary',role:'audience',liveAudio:false,audioOutputDeviceId:'',outputCanvas:{width:1920,height:1080,fps:30,fit:'contain'}}});
    video=await waitVideo();
    const safe={muted:video&&video.muted,state:video&&video.dataset.playbackState};
    return JSON.stringify({routed,safe,publicPauseOverlayAbsent});
  })()`));
  check('OUTPUT_VIDEO_TRANSPORT_AND_SINGLE_ROUTE_AUDIO_OK', outputVideoAudio.routed.exists && outputVideoAudio.routed.muted === false && Math.abs(outputVideoAudio.routed.volume - .7) < .001 && outputVideoAudio.routed.controls === false && outputVideoAudio.routed.state === 'paused' && outputVideoAudio.routed.currentTime >= .1 && outputVideoAudio.routed.currentTime < .8 && outputVideoAudio.safe.muted === true, JSON.stringify(outputVideoAudio));
  check('OUTPUT_PUBLIC_PAUSE_OVERLAY_ABSENT_OK', outputVideoAudio.publicPauseOverlayAbsent, JSON.stringify(outputVideoAudio));
  outputRendererWin.destroy();

  const picturePath = path.join(profile, 'picture.svg');
  fs.writeFileSync(picturePath, '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#d9dde2"/><circle cx="320" cy="180" r="90" fill="#3b6d94"/></svg>');
  const replacementPath = path.join(profile, 'replacement.svg');
  fs.writeFileSync(replacementPath, '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#111820"/><rect x="180" y="70" width="280" height="220" rx="24" fill="#c6a25d"/></svg>');
  win.webContents.debugger.attach('1.3');
  const documentNode = await win.webContents.debugger.sendCommand('DOM.getDocument');
  const mediaNode = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '#sceneMediaFile' });
  await win.webContents.executeJavaScript(`(()=>{window.__compositorFileEvents=0;window.__compositorFileErrors=[];document.getElementById('sceneMediaFile').addEventListener('change',()=>window.__compositorFileEvents++);window.addEventListener('unhandledrejection',event=>window.__compositorFileErrors.push(String(event.reason&&event.reason.message||event.reason)));})()`);
  await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', { files: [picturePath], nodeId: mediaNode.nodeId });
  if (!await waitFor(() => win.webContents.executeJavaScript(`currentScene().layers.some(layer=>layer.name==='picture.svg')`))) {
    const state = await win.webContents.executeJavaScript(`JSON.stringify({events:window.__compositorFileEvents,errors:window.__compositorFileErrors,files:document.getElementById('sceneMediaFile').files.length,layers:currentScene().layers.map(layer=>({type:layer.type,name:layer.name}))})`);
    throw new Error(`picture file input did not add a layer: ${state}`);
  }
  const pictureLayerId = await win.webContents.executeJavaScript(`currentScene().layers.find(layer=>layer.name==='picture.svg').id`);
  await win.webContents.executeJavaScript(`selectLayer(${JSON.stringify(pictureLayerId)});document.getElementById('sceneMediaFile').addEventListener('click',event=>event.preventDefault(),{once:true});document.getElementById('inspMediaReplace').click()`);
  await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', { files: [replacementPath], nodeId: mediaNode.nodeId });
  if (!await waitFor(() => win.webContents.executeJavaScript(`currentScene().layers.some(layer=>layer.id===${JSON.stringify(pictureLayerId)}&&layer.name==='replacement.svg')`))) throw new Error('media replacement did not preserve the selected layer');
  const mediaReplacement = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{const layer=currentScene().layers.find(row=>row.id===${JSON.stringify(pictureLayerId)});return {id:layer.id,name:layer.name,type:layer.type,selected:selectedLayer().id,sourceBytes:layer.sourceBytes,sourceStorage:layer.sourceStorage,sourcePortable:layer.sourcePortable,sourceWidth:layer.sourceWidth,sourceHeight:layer.sourceHeight,summary:document.getElementById('inspMediaName').textContent};})())`));
  win.webContents.debugger.detach();
  check('COMPOSITOR_MEDIA_REPLACE_PRESERVES_LAYER_OK', mediaReplacement.id === pictureLayerId && mediaReplacement.selected === pictureLayerId && mediaReplacement.name === 'replacement.svg' && mediaReplacement.type === 'image' && mediaReplacement.sourceBytes > 0 && mediaReplacement.sourceStorage === 'linked' && mediaReplacement.sourcePortable === false && mediaReplacement.sourceWidth === 640 && mediaReplacement.sourceHeight === 360 && mediaReplacement.summary.includes('640×360'), JSON.stringify(mediaReplacement));
  const mediaRecovery = JSON.parse(await win.webContents.executeJavaScript(`(async()=>{
    monitorSceneKeys={pv:'cached-preview',pg:'cached-program'};
    const previousBase=ctlMediaBase;
    showNet({running:true,ip:'127.0.0.1',port:7979,clients:0,token:'media-test'});
    const startupInvalidated=monitorSceneKeys.pv===''&&monitorSceneKeys.pg===''&&ctlMediaBase==='http://127.0.0.1:7979';
    const scene=currentScene();const programScene=activeScene(programState);const priorSelected=selectedLayerId;
    const broken={id:makeId('layer'),type:'image',name:'Offline sponsor slate',src:'data:image/png;base64,broken',visible:true,fit:'contain',x:4,y:4,w:32,h:24,opacity:1};
    scene.layers.push(broken);programScene.layers.push(cloneState(broken));selectedLayerId=broken.id;monitorSceneKeys={pv:'',pg:''};renderMonitorScene('pv',S);renderMonitorScene('pg',programState);
    const started=Date.now();while(Date.now()-started<1200){const previewReady=document.querySelector('#pvScene [data-layer-id="'+broken.id+'"] .scene-media-error');const programReady=document.querySelector('#pgScene [data-layer-id="'+broken.id+'"]');if(previewReady&&programReady&&!programReady.querySelector('img,video,.scene-media-error'))break;await new Promise(resolve=>setTimeout(resolve,25));}
    const previewWarning=document.querySelector('#pvScene [data-layer-id="'+broken.id+'"] .scene-media-error');
    const programLayer=document.querySelector('#pgScene [data-layer-id="'+broken.id+'"]');
    const programMediaCount=programLayer?programLayer.querySelectorAll('img,video,.scene-media-error').length:-1;
    const programClean=!!programLayer&&programMediaCount===0;
    scene.layers=scene.layers.filter(layer=>layer.id!==broken.id);programScene.layers=programScene.layers.filter(layer=>layer.id!==broken.id);selectedLayerId=priorSelected;ctlMediaBase=previousBase;monitorSceneKeys={pv:'',pg:''};renderMonitorScene('pv',S);renderMonitorScene('pg',programState);
    return JSON.stringify({startupInvalidated,previewWarning:previewWarning&&previewWarning.textContent||'',programClean,programMediaCount,programHtml:programLayer&&programLayer.innerHTML||''});
  })()`));
  check('COMPOSITOR_MEDIA_STARTUP_AND_ERROR_RECOVERY_OK', mediaRecovery.startupInvalidated && mediaRecovery.previewWarning.includes('Offline sponsor slate') && mediaRecovery.programClean, JSON.stringify(mediaRecovery));

  const videoTransport = JSON.parse(await win.webContents.executeJavaScript(`(async()=>{
    window.__videoTransportRestore={state:cloneState(S),program:cloneState(programState),selected:selectedLayerId,target:videoTransportTarget,outputs:cloneState(outputConfigs)};
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const waitForVideo=async prefix=>{const started=Date.now();while(Date.now()-started<2500){const video=document.querySelector('#'+prefix+'Scene video');if(video&&video.readyState>=1)return video;await wait(25);}return document.querySelector('#'+prefix+'Scene video');};
    const change=element=>element.dispatchEvent(new Event('change',{bubbles:true}));
    const testScene=PTCOMP.normalizeScene({id:'video-transport-scene',name:'Video transport test',compositionId:S.activeCompositionId,layers:[{
      id:'video-transport-layer',type:'video',name:'Operator clip',src:${JSON.stringify(transportFixtureUrl)},visible:true,x:0,y:0,w:100,h:100,opacity:1,fit:'contain',
      playbackState:'paused',playbackPosition:.2,playbackUpdatedAt:Date.now(),playbackRate:1,inPoint:0,outPoint:0,endBehavior:'loop',restartOnTake:true,
      videoAudioConfigured:true,audioEnabled:false,audioMonitoring:'off',muted:true,volume:.8
    }]});
    S.scenes.push(testScene);S.activeSceneId=testScene.id;S.studioDirect=false;selectedLayerId='video-transport-layer';videoTransportTarget='preview';
    monitorSceneKeys={pv:'',pg:''};renderScenesUI();renderStage('pv',S,Date.now());renderStage('pg',programState,Date.now());
    let previewVideo=await waitForVideo('pv');
    const visible=['inspVideoWrap','inspVideoTargetPreview','inspVideoTargetProgram','inspVideoTargetBoth','inspVideoSeek','inspVideoRestart','inspVideoPlay','inspVideoPause','inspVideoStop','inspVideoIn','inspVideoOut','inspVideoEndBehavior','inspVideoPreviewAudio','inspVideoProgramAudio','inspVideoMuted','inspVideoVolume'].every(id=>document.getElementById(id).getClientRects().length>0);
    document.getElementById('inspVideoIn').value='00:00.100';change(document.getElementById('inspVideoIn'));
    document.getElementById('inspVideoOut').value='00:00.800';change(document.getElementById('inspVideoOut'));
    document.getElementById('inspVideoEndBehavior').value='loop';change(document.getElementById('inspVideoEndBehavior'));
    const previewAudio=document.getElementById('inspVideoPreviewAudio'),programAudio=document.getElementById('inspVideoProgramAudio');
    if(!previewAudio.checked)previewAudio.click();
    if(programAudio.checked)programAudio.click();
    await wait(60);
    const previewOnly={monitoring:selectedLayer().audioMonitoring,enabled:selectedLayer().audioEnabled,muted:(await waitForVideo('pv')).muted,monitorGain:audioMeterNodes.get(selectedLayer().id)?.monitorGain?.gain?.value};
    document.getElementById('inspVideoProgramAudio').click();
    document.getElementById('inspVideoPreviewAudio').click();
    await wait(60);
    const programOnly={monitoring:selectedLayer().audioMonitoring,enabled:selectedLayer().audioEnabled,muted:(await waitForVideo('pv')).muted,monitorGain:audioMeterNodes.get(selectedLayer().id)?.monitorGain?.gain?.value,route:activeProgramAudioRouteValue()};
    document.getElementById('inspVideoPreviewAudio').click();
    await wait(60);
    previewVideo=await waitForVideo('pv');
    const bothAudio={monitoring:selectedLayer().audioMonitoring,enabled:selectedLayer().audioEnabled,muted:previewVideo.muted,volume:previewVideo.volume,monitorGain:audioMeterNodes.get(selectedLayer().id)?.monitorGain?.gain?.value};
    document.getElementById('inspVideoRestart').click();await wait(80);
    const previewPlaying={state:selectedLayer().playbackState,currentTime:(await waitForVideo('pv')).currentTime};
    takeSelectedLayer();await wait(90);
    const liveAfterTake=findProgramLayer(selectedLayer()),programVideo=await waitForVideo('pg');
    syncProgramVideoAudio();await wait(50);
    const programAudioRecord=programAudioRecordForLayer(liveAfterTake);
    const taken={exists:!!liveAfterTake,state:liveAfterTake&&liveAfterTake.playbackState,position:liveAfterTake&&liveAfterTake.playbackPosition,inPoint:liveAfterTake&&liveAfterTake.inPoint,outPoint:liveAfterTake&&liveAfterTake.outPoint,programMonitorMuted:programVideo&&programVideo.muted,programGain:programAudioRecord&&programAudioRecord.programGain.gain.value,targetAfterTake:videoTransportTarget,transportDelta:Math.abs(Number((await waitForVideo('pv')).currentTime||0)-Number(programVideo.currentTime||0))};
    document.getElementById('inspVideoTargetProgram').click();document.getElementById('inspVideoPause').click();await wait(60);
    const independent={preview:selectedLayer().playbackState,program:findProgramLayer(selectedLayer())&&findProgramLayer(selectedLayer()).playbackState};
    document.getElementById('inspVideoTargetBoth').click();document.getElementById('inspVideoStop').click();await wait(60);
    document.getElementById('inspVideoPlay').click();await wait(60);
    const paired={status:layerProgramInfo(selectedLayer()).key,delta:Math.abs(Number((await waitForVideo('pv')).currentTime||0)-Number((await waitForVideo('pg')).currentTime||0))};
    document.getElementById('inspVideoStop').click();await wait(60);
    const stopped={preview:selectedLayer().playbackState,previewPosition:selectedLayer().playbackPosition,program:findProgramLayer(selectedLayer())&&findProgramLayer(selectedLayer()).playbackState,programPosition:findProgramLayer(selectedLayer())&&findProgramLayer(selectedLayer()).playbackPosition};
    return JSON.stringify({visible,previewOnly,programOnly,bothAudio,previewPlaying,taken,independent,paired,stopped,target:videoTransportTarget,clock:document.getElementById('inspVideoClock').textContent});
  })()`));
  check('COMPOSITOR_VIDEO_TRANSPORT_AND_AUDIO_ROUTING_OK', videoTransport.visible && videoTransport.previewOnly.monitoring === 'monitor-only' && videoTransport.previewOnly.enabled === false && videoTransport.previewOnly.muted === false && Math.abs(videoTransport.previewOnly.monitorGain - .8) < .001 && videoTransport.programOnly.monitoring === 'off' && videoTransport.programOnly.enabled === true && videoTransport.programOnly.muted === false && videoTransport.programOnly.monitorGain === 0 && videoTransport.programOnly.route === 'primary' && videoTransport.bothAudio.monitoring === 'monitor-and-output' && videoTransport.bothAudio.enabled === true && videoTransport.bothAudio.muted === false && videoTransport.bothAudio.volume === 1 && Math.abs(videoTransport.bothAudio.monitorGain - .8) < .001 && videoTransport.previewPlaying.state === 'playing' && videoTransport.previewPlaying.currentTime >= .1 && videoTransport.previewPlaying.currentTime < .8 && videoTransport.taken.exists && videoTransport.taken.state === 'playing' && Math.abs(videoTransport.taken.position - .1) < .001 && videoTransport.taken.inPoint === .1 && videoTransport.taken.outPoint === .8 && videoTransport.taken.programMonitorMuted === false && Math.abs(videoTransport.taken.programGain - .8) < .001 && videoTransport.taken.targetAfterTake === 'both' && videoTransport.taken.transportDelta < .08 && videoTransport.independent.preview === 'playing' && videoTransport.independent.program === 'paused' && videoTransport.paired.status === 'live' && videoTransport.paired.delta < .08 && videoTransport.stopped.preview === 'stopped' && videoTransport.stopped.program === 'stopped' && Math.abs(videoTransport.stopped.previewPosition - .1) < .001 && Math.abs(videoTransport.stopped.programPosition - .1) < .001 && videoTransport.target === 'both', JSON.stringify(videoTransport));
  fs.writeFileSync(path.join(artifactDirectory, 'video-transport-audio-1280x800.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`(()=>{const prior=window.__videoTransportRestore;S=prior.state;programState=prior.program;selectedLayerId=prior.selected;videoTransportTarget=prior.target;outputConfigs=prior.outputs;delete window.__videoTransportRestore;monitorSceneKeys={pv:'',pg:''};renderScenesUI();renderStage('pv',S,Date.now());renderStage('pg',programState,Date.now());})()`);

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
    const captureAudioDefault=document.getElementById('sourceAudioDevice').value;
    document.getElementById('sourceAudioDevice').value='audio-card-1';
    document.getElementById('sourceDeviceResolution').value='1920x1080';
    document.getElementById('sourceDeviceFps').value='60';
    document.getElementById('sourceQualityProfile').value='quality';
    document.getElementById('sourceDeviceCaptureMode').value='low-latency';
    document.getElementById('btnDeviceAdd').click();
    await new Promise(resolve=>setTimeout(resolve,80));

    document.getElementById('btnAddSource').click();
    document.querySelector('[data-source-kind="audio"]').click();
    const audioStarted=Date.now(); while(Date.now()-audioStarted<2000&&document.getElementById('sourceAudioInputDevice').options[0]?.value!=='audio-card-1') await new Promise(resolve=>setTimeout(resolve,25));
    document.getElementById('sourceAudioName').value='FOH mix';
    document.getElementById('btnAudioAdd').click();
    await new Promise(resolve=>setTimeout(resolve,80));
    const audioLayer=currentScene().layers.find(layer=>layer.type==='audio');
    let audioRow=document.querySelector('[data-audio-layer-id="'+audioLayer.id+'"]');
    const fader=audioRow.querySelector('.audio-fader');fader.value='62';fader.dispatchEvent(new Event('input',{bubbles:true}));const volumeAfterInput=currentScene().layers.find(layer=>layer.id===audioLayer.id)?.volume;fader.dispatchEvent(new Event('change',{bubbles:true}));const volumeAfterChange=currentScene().layers.find(layer=>layer.id===audioLayer.id)?.volume;
    audioRow=document.querySelector('[data-audio-layer-id="'+audioLayer.id+'"]');audioRow.querySelector('.audio-mixer-advanced').open=true;
    const monitor=audioRow.querySelector('.audio-monitoring');monitor.value='monitor-only';monitor.dispatchEvent(new Event('change',{bubbles:true}));const monitoringAfterChange=currentScene().layers.find(layer=>layer.id===audioLayer.id)?.audioMonitoring;
    const deviceReady=Date.now();while(Date.now()-deviceReady<1000&&![...document.getElementById('audioProgramDevice').options].some(option=>option.value==='speaker-main'))await new Promise(resolve=>setTimeout(resolve,20));
    const outputDevice=document.getElementById('audioProgramDevice');outputDevice.value='speaker-main';change(outputDevice);
    const audioRoute=document.getElementById('audioProgramRoute');audioRoute.value='primary';change(audioRoute);
    const audioState={layer:cloneState(currentScene().layers.find(layer=>layer.id===audioLayer.id)),input:cloneState(liveInputDefinition(audioLayer.inputId)),volumeAfterInput,volumeAfterChange,monitoringAfterChange,rows:document.querySelectorAll('#audioMixerRows .audio-channel').length,meters:document.querySelectorAll('#audioMixerRows .audio-meter').length,programRoute:activeProgramAudioRouteValue(),programDevice:S.programAudioDeviceId,programStateDevice:programState.programAudioDeviceId};
    document.getElementById('audioProgramRoute').value='off';change(document.getElementById('audioProgramRoute'));

    document.getElementById('btnAddSource').click();
    document.querySelector('[data-source-kind="window"]').click();
    const windowStarted=Date.now(); while(Date.now()-windowStarted<2000&&!document.querySelector('.desktop-source-card')) await new Promise(resolve=>setTimeout(resolve,25));
    const systemAudioDefault=document.getElementById('sourceDesktopAudio').checked;
    document.querySelector('.desktop-source-card').click();
    await new Promise(resolve=>setTimeout(resolve,80));

    document.getElementById('btnAddSource').click();
    document.querySelector('[data-source-kind="window"]').click();
    const duplicateStarted=Date.now();while(Date.now()-duplicateStarted<2000&&!document.querySelector('.desktop-source-card'))await new Promise(resolve=>setTimeout(resolve,25));
    const duplicateAudioDefault=document.getElementById('sourceDesktopAudio').checked;
    const duplicateNoticeVisible=!document.getElementById('sourceDesktopNotice').hidden;
    closeSourceDialog();

    document.getElementById('inspName').value='Slides capture'; change(document.getElementById('inspName'));
    document.getElementById('inspX').value='54'; change(document.getElementById('inspX'));
    document.getElementById('inspY').value='8'; change(document.getElementById('inspY'));
    document.getElementById('inspW').value='42'; change(document.getElementById('inspW'));
    document.getElementById('inspH').value='40'; change(document.getElementById('inspH'));
    renderStage('pv',S,Date.now());
    const scene=currentScene(); const timer=scene.layers.find(layer=>layer.type==='timer'); const color=scene.layers.find(layer=>layer.type==='color'); const text=scene.layers.find(layer=>layer.type==='text'); const capture=scene.layers.find(layer=>layer.type==='window'); const device=scene.layers.find(layer=>layer.type==='capture');
    const captureElement=document.querySelector('#pvScene .pv-scene-selection[data-layer-id="'+capture.id+'"]');
    const textElement=document.querySelector('#pvScene [data-layer-id="'+text.id+'"] .pv-scene-text');
    const imageElements=[...document.querySelectorAll('#pvScene [data-layer-id] img')];
    const previewRect=document.getElementById('preview').getBoundingClientRect();
    const windowInput=liveInputDefinition(capture.inputId);
    return JSON.stringify({canvas:S.canvas,previewRatio:previewRect.width/previewRect.height,types:scene.layers.map(layer=>layer.type),timerIndex:scene.layers.indexOf(timer),colorIndex:scene.layers.indexOf(color),text:{bg:text.bg,x:text.x,y:text.y,w:text.w,h:text.h,rendered:textElement&&textElement.textContent},pictures:{count:imageElements.length,allHaveSource:imageElements.length>0&&imageElements.every(image=>!!image.src)},deviceInput:cloneState(liveInputDefinition(device.inputId)),captureAudioDefault,systemAudioDefault,duplicateAudioDefault,duplicateNoticeVisible,capture:{x:capture.x,y:capture.y,w:capture.w,h:capture.h,fit:capture.fit,name:capture.name,audioEnabled:capture.audioEnabled,withAudio:windowInput&&windowInput.withAudio,desktopSourceId:windowInput&&windowInput.desktopSourceId},audioState,windowAudioRows:document.querySelectorAll('#audioMixerRows [data-audio-layer-id="'+capture.id+'"]').length,handles:captureElement?captureElement.querySelectorAll('.transform-handle').length:0,layerRows:document.querySelectorAll('#layerList .layer-row').length,liveInputs:S.liveInputs.length});
  })()`));
  fs.writeFileSync(path.join(artifactDirectory, 'capture-safe-defaults.png'), (await win.webContents.capturePage()).toPNG());
  check('COMPOSITOR_CUSTOM_CANVAS_AND_SOURCE_TYPES_OK', authored.canvas.width === 1000 && authored.canvas.height === 1000 && authored.canvas.fps === 25 && Math.abs(authored.previewRatio - 1) < 0.02 && ['color','image','text','window','capture','timer'].every(type => authored.types.includes(type)), JSON.stringify(authored));
  check('COMPOSITOR_LAYER_INSPECTOR_AND_HANDLES_OK', authored.capture.name === 'Slides capture' && authored.capture.x === 54 && authored.capture.y === 8 && authored.capture.w === 42 && authored.capture.h === 40 && authored.handles === 4 && authored.layerRows === authored.types.length, JSON.stringify(authored));
  check('COMPOSITOR_CAPTURE_AUDIO_REQUIRES_EXPLICIT_CHOICE_OK', authored.captureAudioDefault === '', JSON.stringify({ captureAudioDefault: authored.captureAudioDefault }));
  const layerListLayout = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{const rows=[...document.querySelectorAll('#layerList .layer-row')];const chips=[...document.querySelectorAll('#layerList .layer-program-chip')];const bar=document.getElementById('layerProgramBar').getBoundingClientRect();return {rows:rows.map(row=>row.getBoundingClientRect().height),chips:chips.map(chip=>chip.getBoundingClientRect().height),bar:bar.height};})())`));
  check('COMPOSITOR_LAYER_LIST_STAYS_COMPACT_OK', layerListLayout.rows.length > 0 && layerListLayout.rows.every(height=>height >= 72 && height <= 80) && layerListLayout.chips.every(height=>height <= 18) && layerListLayout.bar <= 64, JSON.stringify(layerListLayout));
  check('COMPOSITOR_COLOR_DEFAULTS_BEHIND_TIMER_OK', authored.colorIndex === 0 && authored.timerIndex > authored.colorIndex, JSON.stringify({ colorIndex: authored.colorIndex, timerIndex: authored.timerIndex }));
  check('COMPOSITOR_TEXT_DEFAULT_IS_NON_OBSCURING_OK', authored.text.bg === 'transparent' && authored.text.x > 0 && authored.text.y > 0 && authored.text.w < 100 && authored.text.h < 100, JSON.stringify(authored.text));
  check('COMPOSITOR_PICTURE_AND_TEXT_RENDER_OK', authored.pictures.count >= 1 && authored.pictures.allHaveSource && authored.text.rendered === 'Guest camera', JSON.stringify({ pictures: authored.pictures, text: authored.text }));
  check('COMPOSITOR_AUDIO_INPUT_AND_MIXER_OK', authored.types.includes('audio') && authored.audioState.layer.volume === 0.62 && authored.audioState.layer.audioMonitoring === 'monitor-only' && authored.audioState.input.type === 'audio' && authored.audioState.input.audioDeviceId === 'audio-card-1' && authored.audioState.rows >= 2 && authored.audioState.meters === authored.audioState.rows, JSON.stringify(authored.audioState));
  check('COMPOSITOR_WINDOW_SYSTEM_AUDIO_MIXER_OK', authored.systemAudioDefault && authored.capture.withAudio && authored.capture.audioEnabled && authored.windowAudioRows === 1, JSON.stringify({ systemAudioDefault: authored.systemAudioDefault, capture: authored.capture, windowAudioRows: authored.windowAudioRows }));
  check('COMPOSITOR_WINDOW_CAPTURE_SAFE_DEFAULTS_OK', authored.capture.fit === 'contain' && authored.capture.desktopSourceId === 'window:compositor-test:1' && authored.duplicateAudioDefault === false && authored.duplicateNoticeVisible, JSON.stringify({ capture: authored.capture, duplicateAudioDefault: authored.duplicateAudioDefault, duplicateNoticeVisible: authored.duplicateNoticeVisible }));
  check('COMPOSITOR_CAPTURE_CARD_1080P60_LOW_LATENCY_CONFIG_OK', authored.deviceInput.width === 1920 && authored.deviceInput.height === 1080 && authored.deviceInput.fps === 60 && authored.deviceInput.captureMode === 'low-latency' && authored.deviceInput.withAudio, JSON.stringify(authored.deviceInput));
  check('COMPOSITOR_AUDIO_OUTPUT_ROUTING_OK', authored.audioState.programRoute === 'primary' && authored.audioState.programDevice === 'speaker-main' && authored.audioState.programStateDevice === 'speaker-main', JSON.stringify(authored.audioState));
  const sourceCatalog = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{document.getElementById('btnAddSource').click();const kinds=[...document.querySelectorAll('#sourceKindGrid [data-source-kind]')].map(button=>button.dataset.sourceKind);const groups=[...document.querySelectorAll('#sourceKindGrid .source-kind-section-title strong')].map(node=>node.textContent);closeSourceDialog();return {kinds,groups};})())`));
  check('COMPOSITOR_ADVANCED_SOURCE_CATALOG_OK', ['image','video','pdf','color','text','window','screen','device','audio','timer'].every(kind=>sourceCatalog.kinds.includes(kind)) && sourceCatalog.groups.length === 3, JSON.stringify(sourceCatalog));
  const advancedInspector = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    const fire=(id,value,event='change')=>{const element=document.getElementById(id);if(element.type==='checkbox')element.checked=!!value;else element.value=String(value);element.dispatchEvent(new Event(event,{bubbles:true}));};
    fire('inspOrigin','top-left');fire('inspFlipX',true);fire('inspCropTop',8);fire('inspCropLeft',6);fire('inspObjectX',68,'input');fire('inspBlend','screen');fire('inspCornerRadius',12,'input');fire('inspBrightness',115,'input');fire('inspContrast',125,'input');fire('inspSaturation',135,'input');fire('inspHue',18,'input');
    renderStage('pv',S,Date.now());const layer=selectedLayer();const box=document.querySelector('#pvScene [data-layer-id="'+layer.id+'"]');const content=box&&box.querySelector('.pv-scene-layer-content');
    const result={layer:{origin:layer.transformOrigin,flipX:layer.flipX,crop:layer.crop,objectX:layer.objectPositionX,blend:layer.blendMode,radius:layer.cornerRadius,brightness:layer.brightness,contrast:layer.contrast,saturation:layer.saturation,hue:layer.hue},style:{transform:box&&box.style.transform,origin:box&&box.style.transformOrigin,blend:box&&box.style.mixBlendMode,clip:content&&content.style.clipPath,filter:content&&content.style.filter,radius:content&&content.style.borderRadius},sections:document.querySelectorAll('#inspector .inspector-section').length};
    Object.assign(layer,{transformOrigin:'center',flipX:false,crop:{top:0,right:0,bottom:0,left:0},objectPositionX:50,blendMode:'normal',cornerRadius:0,brightness:1,contrast:1,saturation:1,hue:0});sceneDirty();selectLayer(layer.id);return result;
  })())`));
  check('COMPOSITOR_ADVANCED_INSPECTOR_RENDER_OK', advancedInspector.layer.origin === 'top-left' && advancedInspector.layer.flipX && advancedInspector.layer.crop.top === 8 && advancedInspector.layer.crop.left === 6 && advancedInspector.layer.objectX === 68 && advancedInspector.layer.blend === 'screen' && advancedInspector.layer.radius === 12 && advancedInspector.style.transform.includes('scale(-1, 1)') && advancedInspector.style.origin === '0% 0%' && advancedInspector.style.blend === 'screen' && advancedInspector.style.clip.includes('8%') && advancedInspector.style.filter.includes('brightness(1.15)') && advancedInspector.style.radius === '12%' && advancedInspector.sections >= 4, JSON.stringify(advancedInspector));
  const layerSelection = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    document.activeElement?.blur(); selectLayer(null);
    const disabledOpacity=Number(getComputedStyle(document.getElementById('btnTakeLayer')).opacity);
    const selector=[...document.querySelectorAll('#layerList .layer-select')].find(button=>button.querySelector('.layer-name')?.textContent==='Slides capture');
    const targetId=selector?.closest('.layer-row')?.dataset.layerId||'';
    selector?.dispatchEvent(new FocusEvent('focus'));
    const selectedFromFocus=selectedLayer()?.id||'';
    selector?.click();
    const selectedRow=document.querySelector('#layerList .layer-row.sel');
    return {button:selector?.tagName||'',aria:selector?.getAttribute('aria-label')||'',current:document.querySelector('#layerList .layer-select[aria-current="true"]')?.closest('.layer-row')?.dataset.layerId||'',targetId,selectedFromFocus,selectedId:selectedLayer()?.id||'',inspectorOpen:document.getElementById('inspector').classList.contains('open'),inspectorName:document.getElementById('inspName').value,takeEnabled:!document.getElementById('btnTakeLayer').disabled,rowTakeVisible:!!selectedRow?.querySelector('.row-take')?.getClientRects().length,rowHideVisible:!!selectedRow?.querySelector('.row-hide')?.getClientRects().length,disabledOpacity};
  })())`));
  check('COMPOSITOR_LAYER_SELECT_USER_CONTROL_OK', layerSelection.button === 'BUTTON' && layerSelection.aria.includes('Slides capture') && layerSelection.targetId === layerSelection.selectedFromFocus && layerSelection.targetId === layerSelection.selectedId && layerSelection.current === layerSelection.targetId && layerSelection.inspectorOpen && layerSelection.inspectorName === 'Slides capture' && layerSelection.takeEnabled && layerSelection.rowTakeVisible && layerSelection.rowHideVisible && layerSelection.disabledOpacity < 0.6, JSON.stringify(layerSelection));

  const inspectorLayout = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    const panel=document.getElementById('panelSources'),inspector=document.getElementById('inspector'),layers=document.querySelector('.compositor-layers'),toggle=document.getElementById('btnInspectorToggle'),resizer=document.getElementById('compositorInspectorResizer');
    setSourceInspectorCollapsed(false,{persist:false});setSourceInspectorWidth(350,{persist:false});
    const initial={inspector:inspector.getBoundingClientRect().width,layers:layers.getBoundingClientRect().width,toggleVisible:toggle.getClientRects().length>0,resizerVisible:resizer.getClientRects().length>0,transformOpen:document.getElementById('inspTransformSection').open};
    toggle.click();
    const collapsed={inspector:inspector.getBoundingClientRect().width,layers:layers.getBoundingClientRect().width,inputVisible:document.getElementById('inspName').getClientRects().length>0,toggleVisible:toggle.getClientRects().length>0,ariaExpanded:toggle.getAttribute('aria-expanded')};
    toggle.click();
    const restored=inspector.getBoundingClientRect().width;
    resizer.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
    const resized=inspector.getBoundingClientRect().width,stored=Number(localStorage.getItem(SOURCE_INSPECTOR_WIDTH_KEY));
    setSourceInspectorWidth(350,{persist:false});
    return {initial,collapsed,restored,resized,stored,collapsedState:panel.classList.contains('inspector-collapsed'),resizerRole:resizer.getAttribute('role')};
  })())`));
  check('COMPOSITOR_SOURCE_INSPECTOR_COMPACT_RESIZABLE_OK', inspectorLayout.initial.inspector >= 340 && inspectorLayout.initial.inspector <= 360 && inspectorLayout.initial.toggleVisible && inspectorLayout.initial.resizerVisible && !inspectorLayout.initial.transformOpen && inspectorLayout.collapsed.inspector <= 46 && inspectorLayout.collapsed.layers > inspectorLayout.initial.layers + 140 && !inspectorLayout.collapsed.inputVisible && inspectorLayout.collapsed.toggleVisible && inspectorLayout.collapsed.ariaExpanded === 'false' && Math.abs(inspectorLayout.restored - inspectorLayout.initial.inspector) <= 2 && inspectorLayout.resized >= inspectorLayout.restored + 20 && inspectorLayout.stored >= 370 && !inspectorLayout.collapsedState && inspectorLayout.resizerRole === 'separator', JSON.stringify(inspectorLayout));

  const layerRowActions=JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    const scene=currentScene(), original=cloneState(scene.layers), selectedBefore=selectedLayerId, source=scene.layers[1]||scene.layers[0];
    const probe={...cloneState(source),id:'layer-action-probe',name:'Layer action probe'};
    scene.layers.splice(1,0,probe); selectedLayerId=probe.id; sceneDirty();
    const indexBefore=currentScene().layers.findIndex(layer=>layer.id===probe.id);
    let row=document.querySelector('#layerList .layer-row[data-layer-id="layer-action-probe"]');
    row.querySelector('.up').click();
    const indexForward=currentScene().layers.findIndex(layer=>layer.id===probe.id);
    row=document.querySelector('#layerList .layer-row[data-layer-id="layer-action-probe"]');
    row.querySelector('.dn').click();
    const indexBackward=currentScene().layers.findIndex(layer=>layer.id===probe.id);
    const activeLayers=currentScene().layers;
    const topId=activeLayers[activeLayers.length-1].id, bottomId=activeLayers[0].id;
    const topForwardDisabled=document.querySelector('#layerList .layer-row[data-layer-id="'+topId+'"] .up').disabled;
    const bottomBackwardDisabled=document.querySelector('#layerList .layer-row[data-layer-id="'+bottomId+'"] .dn').disabled;
    row=document.querySelector('#layerList .layer-row[data-layer-id="layer-action-probe"]');
    row.querySelector('.del').click();
    const deleted=!currentScene().layers.some(layer=>layer.id===probe.id);
    currentScene().layers=original; selectedLayerId=selectedBefore; sceneDirty();
    return {indexBefore,indexForward,indexBackward,topForwardDisabled,bottomBackwardDisabled,deleted};
  })())`));
  check('COMPOSITOR_LAYER_REORDER_DELETE_CONTROLS_OK', layerRowActions.indexForward === layerRowActions.indexBefore + 1 && layerRowActions.indexBackward === layerRowActions.indexBefore && layerRowActions.topForwardDisabled && layerRowActions.bottomBackwardDisabled && layerRowActions.deleted, JSON.stringify(layerRowActions));
  const layerDrag=JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    const scene=currentScene(),original=cloneState(scene.layers),selectedBefore=selectedLayerId,programBefore=JSON.stringify(programState&&programState.scenes||[]);
    const rows=[...document.querySelectorAll('#layerList .layer-row')];
    const source=rows[0],target=rows[rows.length-1],sourceId=source.dataset.layerId,targetId=target.dataset.layerId;
    const transfer=new DataTransfer(),targetRect=target.getBoundingClientRect();
    source.querySelector('.layer-drag-handle').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));
    target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,clientY:targetRect.bottom-1,dataTransfer:transfer}));
    target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,clientY:targetRect.bottom-1,dataTransfer:transfer}));
    source.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:transfer}));
    const visual=[...document.querySelectorAll('#layerList .layer-row')].map(row=>row.dataset.layerId);
    const result={sourceId,targetId,last:visual[visual.length-1],modelBottom:currentScene().layers[0]?.id,programUnchanged:programBefore===JSON.stringify(programState&&programState.scenes||[]),handles:document.querySelectorAll('#layerList .layer-drag-handle').length,pointerDriven:[...document.querySelectorAll('#layerList .layer-row')].every(row=>!row.draggable),summary:document.getElementById('layerStackSummary').textContent};
    scene.layers=original;selectedLayerId=selectedBefore;sceneDirty();return result;
  })())`));
  check('COMPOSITOR_LAYER_DRAG_REORDER_PREVIEW_ONLY_OK', layerDrag.sourceId !== layerDrag.targetId && layerDrag.last === layerDrag.sourceId && layerDrag.modelBottom === layerDrag.sourceId && layerDrag.programUnchanged && layerDrag.handles > 1 && layerDrag.pointerDriven && /top is in front/i.test(layerDrag.summary), JSON.stringify(layerDrag));
  const layerPointerSetup=JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    const scene=currentScene(),rows=[...document.querySelectorAll('#layerList .layer-row')],source=rows[1],target=rows[0],handle=source.querySelector('.layer-drag-handle');
    const sourceRect=handle.getBoundingClientRect(),targetRect=target.getBoundingClientRect();
    window.__layerPointerRestore={layers:cloneState(scene.layers),selected:selectedLayerId,program:JSON.stringify(programState&&programState.scenes||[])};
    return {sourceId:source.dataset.layerId,targetId:target.dataset.layerId,startX:Math.round(sourceRect.left+sourceRect.width/2),startY:Math.round(sourceRect.top+sourceRect.height/2),dropX:Math.round(targetRect.left+12),dropY:Math.round(targetRect.top+2)};
  })())`));
  win.webContents.sendInputEvent({type:'mouseDown',x:layerPointerSetup.startX,y:layerPointerSetup.startY,button:'left',clickCount:1});
  win.webContents.sendInputEvent({type:'mouseMove',x:layerPointerSetup.startX+3,y:layerPointerSetup.startY+12,movementX:3,movementY:12});
  win.webContents.sendInputEvent({type:'mouseMove',x:layerPointerSetup.dropX,y:layerPointerSetup.dropY,movementX:layerPointerSetup.dropX-layerPointerSetup.startX,movementY:layerPointerSetup.dropY-layerPointerSetup.startY});
  await new Promise(resolve=>setTimeout(resolve,40));
  const layerPointerActive=JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify({active:document.body.classList.contains('layer-pointer-dragging'),marked:!!document.querySelector('#layerList .layer-row.drop-before')})`));
  win.webContents.sendInputEvent({type:'mouseUp',x:layerPointerSetup.dropX,y:layerPointerSetup.dropY,button:'left',clickCount:1});
  await new Promise(resolve=>setTimeout(resolve,80));
  const layerPointerDrag=JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    const visual=[...document.querySelectorAll('#layerList .layer-row')].map(row=>row.dataset.layerId),prior=window.__layerPointerRestore;
    const result={sourceId:${JSON.stringify(layerPointerSetup.sourceId)},targetId:${JSON.stringify(layerPointerSetup.targetId)},first:visual[0],active:${JSON.stringify(layerPointerActive.active)},marked:${JSON.stringify(layerPointerActive.marked)},programUnchanged:prior.program===JSON.stringify(programState&&programState.scenes||[]),bodyClean:!document.body.classList.contains('layer-pointer-dragging')};
    currentScene().layers=prior.layers;selectedLayerId=prior.selected;delete window.__layerPointerRestore;sceneDirty();return result;
  })())`));
  check('COMPOSITOR_LAYER_POINTER_DRAG_REORDER_OK', layerPointerDrag.sourceId !== layerPointerDrag.targetId && layerPointerDrag.first === layerPointerDrag.sourceId && layerPointerDrag.active && layerPointerDrag.marked && layerPointerDrag.programUnchanged && layerPointerDrag.bodyClean, JSON.stringify(layerPointerDrag));
  if (!await waitFor(() => configuredInputs.some(input => input.type === 'window' && input.active))) throw new Error('window input was not configured');
  check('COMPOSITOR_WINDOW_AND_CAPTURE_CARD_CONFIGURED_ONCE_OK', configuredInputs.filter(input => input.type === 'window' && input.withAudio).length === 1 && configuredInputs.filter(input => input.type === 'device' && input.videoDeviceId === 'video-card-1' && input.audioDeviceId === 'audio-card-1' && input.withAudio && input.width === 1920 && input.height === 1080 && input.fps === 60 && input.captureMode === 'low-latency' && input.qualityProfile === 'quality').length === 1, JSON.stringify(configuredInputs));
  const captureFallback=JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{const previousId=selectedLayerId,layer=currentScene().layers.find(row=>row.type==='capture'),input=liveInputDefinition(layer.inputId);liveInputStatuses.set(input.id,{inputId:input.id,state:'live',width:1280,height:720,frameRate:29.97,requestedWidth:1920,requestedHeight:1080,requestedFrameRate:60,qualityTier:'HD',qualityProfile:'quality',hasVideo:true,hasAudio:true,audioSampleRate:48000,audioSampleSize:24,audioChannels:2,formatMatched:false,formatFallback:true});selectLayer(layer.id);renderInspector();const quality=document.getElementById('inspLiveQuality');const row=document.querySelector('#layerList .layer-row[data-layer-id="'+layer.id+'"]');const result={warning:quality.classList.contains('warning'),text:quality.textContent,meta:row&&row.querySelector('.layer-meta')?.textContent||''};liveInputStatuses.delete(input.id);selectLayer(previousId);renderInspector();return result;})())`));
  check('COMPOSITOR_CAPTURE_FORMAT_FALLBACK_VISIBLE_OK', captureFallback.warning && captureFallback.text.includes('Maximum quality') && captureFallback.text.includes('HD source') && captureFallback.text.includes('1920×1080 @ 60 fps') && captureFallback.text.includes('1280×720 @ 29.97 fps') && captureFallback.text.includes('48 kHz') && captureFallback.text.includes('2 ch') && captureFallback.text.includes('24-bit') && captureFallback.text.includes('Compatible fallback is active'), JSON.stringify(captureFallback));

  deviceDiscoveryMode = 'pending';
  const permissionPending = JSON.parse(await win.webContents.executeJavaScript(`(async()=>{
    document.getElementById('btnAddSource').click();
    document.querySelector('[data-source-kind="device"]').click();
    const started=Date.now(); while(Date.now()-started<2000&&document.getElementById('sourceVideoDevice').options[0]?.textContent.includes('Scanning')) await new Promise(resolve=>setTimeout(resolve,25));
    const add=document.getElementById('btnDeviceAdd');
    const result={option:document.getElementById('sourceVideoDevice').options[0]?.textContent||'',status:document.getElementById('sourceDeviceStatusText').textContent,visible:!document.getElementById('sourceDeviceStatus').hidden,cameraAction:!document.getElementById('btnCameraPermission').hidden,microphoneAction:!document.getElementById('btnMicrophonePermission').hidden,addDisabled:add.disabled,addOpacity:Number.parseFloat(getComputedStyle(add).opacity)};
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
  check('COMPOSITOR_PERMISSION_FAILURE_EXITS_SCANNING_OK', permissionPending.visible && permissionPending.cameraAction && permissionPending.microphoneAction && permissionPending.addDisabled && permissionPending.addOpacity <= .5 && !permissionPending.option.includes('Scanning') && permissionFailure.visible && permissionFailure.cameraSettings && permissionFailure.microphoneSettings && permissionFailure.addDisabled && !permissionFailure.option.includes('Scanning') && permissionFailure.status.includes('Camera') && permissionFailure.status.includes('Microphone'), JSON.stringify({ permissionPending, permissionFailure }));

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

  const hiddenSource = JSON.parse(await win.webContents.executeJavaScript(`(async()=>{
    const layer=selectedLayer(); const inputId=layer.inputId;
    if(layer.visible===false){layer.visible=true;sceneDirty();await new Promise(resolve=>setTimeout(resolve,30));}
    const findToggle=()=>document.querySelector('#layerList .layer-row[data-layer-id="'+layer.id+'"] .vis');
    const findPreviewLayer=()=>document.querySelector('#pvScene .pv-scene-layer[data-layer-id="'+layer.id+'"]');
    const programBefore=JSON.stringify(programState.scenes);
    let toggle=findToggle();
    const initialPressed=toggle?.getAttribute('aria-pressed')==='true';
    const previewBefore=!!findPreviewLayer();
    toggle?.click(); await new Promise(resolve=>setTimeout(resolve,40));
    toggle=findToggle();
    const retainedWhileHidden=S.liveInputs.some(input=>input.id===inputId);
    const previewHidden=!findPreviewLayer();
    const hidden=selectedLayer().visible===false;
    const hiddenPressed=toggle?.getAttribute('aria-pressed')==='false';
    toggle?.click(); await new Promise(resolve=>setTimeout(resolve,40));
    toggle=findToggle();
    const previewRestored=!!findPreviewLayer();
    const visiblePressed=toggle?.getAttribute('aria-pressed')==='true';
    return JSON.stringify({retainedWhileHidden,retainedAfterShow:S.liveInputs.some(input=>input.id===inputId),visible:selectedLayer().visible,inputId,initialPressed,previewBefore,previewHidden,hidden,hiddenPressed,previewRestored,visiblePressed,programUnchanged:programBefore===JSON.stringify(programState.scenes)});
  })()`));
  check('COMPOSITOR_HIDDEN_LIVE_LAYER_RETAINS_SOURCE_OK', hiddenSource.retainedWhileHidden && hiddenSource.retainedAfterShow && hiddenSource.visible, JSON.stringify(hiddenSource));
  check('COMPOSITOR_LAYER_VISIBILITY_BUTTON_PREVIEW_ONLY_OK', hiddenSource.initialPressed && hiddenSource.previewBefore && hiddenSource.previewHidden && hiddenSource.hidden && hiddenSource.hiddenPressed && hiddenSource.previewRestored && hiddenSource.visiblePressed && hiddenSource.programUnchanged, JSON.stringify(hiddenSource));

  const replaced = JSON.parse(await win.webContents.executeJavaScript(`(async()=>{
    const before=selectedLayer(); const transform={id:before.id,inputId:before.inputId,x:before.x,y:before.y,w:before.w,h:before.h,opacity:before.opacity,rotation:before.rotation};
    document.getElementById('inspLiveChange').click();
    const started=Date.now(); while(Date.now()-started<2000&&!document.querySelector('.desktop-source-card')) await new Promise(resolve=>setTimeout(resolve,25));
    const card=document.querySelector('.desktop-source-card'); const highlighted=card&&card.classList.contains('selected'); if(card) card.click();
    await new Promise(resolve=>setTimeout(resolve,80));
    const after=selectedLayer();
    return JSON.stringify({highlighted,closed:!document.getElementById('sourceOverlay').classList.contains('open'),sameLayer:after.id===transform.id,newInput:after.inputId!==transform.inputId,geometry:after.x===transform.x&&after.y===transform.y&&after.w===transform.w&&after.h===transform.h&&after.opacity===transform.opacity&&after.rotation===transform.rotation,liveInputs:S.liveInputs.length});
  })()`));
  check('COMPOSITOR_CHANGE_SOURCE_PRESERVES_TRANSFORM_OK', replaced.highlighted && replaced.closed && replaced.sameLayer && replaced.newInput && replaced.geometry && replaced.liveInputs === 3, JSON.stringify(replaced));

  const handle = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{const el=document.querySelector('#pvScene .transform-handle.handle-se');const r=el.getBoundingClientRect();const layer=selectedLayer();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),w:layer.w,h:layer.h,id:layer.id,type:layer.type,handleLayerId:el.closest('[data-layer-id]')?.dataset.layerId||''};})())`));
  win.webContents.sendInputEvent({ type: 'mouseDown', x: handle.x, y: handle.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseMove', x: handle.x + 45, y: handle.y + 28, movementX: 45, movementY: 28 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: handle.x + 45, y: handle.y + 28, button: 'left', clickCount: 1 });
  await new Promise(resolve => setTimeout(resolve, 100));
  const resized = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{const layer=selectedLayer();return {w:layer.w,h:layer.h,id:layer.id,type:layer.type,inspectorW:Number(document.getElementById('inspW').value),inspectorH:Number(document.getElementById('inspH').value)};})())`));
  check('COMPOSITOR_POINTER_RESIZE_PERSISTS_OK', resized.id === handle.id && handle.handleLayerId === handle.id && resized.w > handle.w && resized.h > handle.h && resized.inspectorW === resized.w && resized.inspectorH === resized.h, JSON.stringify({ before: handle, after: resized }));

  const isolation = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    const direct=document.getElementById('chkDirectProgram');
    direct.checked=true; direct.dispatchEvent(new Event('change',{bubbles:true}));
    direct.checked=false; direct.dispatchEvent(new Event('change',{bubbles:true}));
    const directReset=document.getElementById('layerProgramStatus').textContent!=='DIRECT' && [...document.querySelectorAll('#layerList .layer-program-chip')].every(chip=>chip.textContent!=='DIRECT');
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
    return {previewOnly,taken,direct:S.studioDirect,directReset,deleteStayedInPreview,programDefinitionRetained,restored:currentScene().layers.some(row=>row.id===layer.id),inputId,previewInputIds:(S.liveInputs||[]).map(row=>row.id),programInputIds:(programState.liveInputs||[]).map(row=>row.id)};
  })())`));
  check('COMPOSITOR_PREVIEW_TAKE_ISOLATION_OK', isolation.previewOnly && isolation.taken && isolation.direct === false && isolation.directReset && isolation.deleteStayedInPreview && isolation.programDefinitionRetained && isolation.restored, JSON.stringify(isolation));

  const layerTake = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    const layer=selectedLayer(); const layerId=layer.id;
    const programScene=activeScene(programState);
    const beforeProgramLayer=findProgramLayer(layer);
    const beforeOther=JSON.stringify(programScene.layers.filter(row=>row.id!==beforeProgramLayer.id));
    document.getElementById('inspX').value='44'; document.getElementById('inspX').dispatchEvent(new Event('change',{bubbles:true}));
    const previewAfterEdit=selectedLayer();
    const previewIsolated=findProgramLayer(previewAfterEdit).x!==previewAfterEdit.x;
    const changedStatus=document.getElementById('layerProgramStatus').textContent;
    document.querySelector('#layerList .layer-row.sel .row-take').click();
    const taken=findProgramLayer(layer);
    const afterOther=JSON.stringify(activeScene(programState).layers.filter(row=>row.id!==taken.id));
    const liveStatus=document.getElementById('layerProgramStatus').textContent;
    document.querySelector('#layerList .layer-row.sel .row-hide').click();
    const hidden=findProgramLayer(layer);
    const hiddenStatus=document.getElementById('layerProgramStatus').textContent;
    document.querySelector('#layerList .layer-row.sel .row-take').click();
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
    document.querySelector('#layerList .layer-row.sel .row-take').click();
    const live=findProgramLayer(previewLayer), programSceneAfter=activeScene(programState);
    const preservedProgramScene=programSceneAfter.id===programSceneId && existingIds.every(id=>programSceneAfter.layers.some(row=>row.id===id));
    const insertedAsOverlay=!!live && live.programSourceLayerId===previewLayer.id && live.programSourceSceneId===previewScene.id && live.visible!==false;
    document.querySelector('#layerList .layer-row.sel .row-hide').click();
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
  const unavailableOutputGuard = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    const previous=outputConfigs; const previousDirty=outputRoutingDirty;
    outputConfigs=[normalizeOutputConfigUI({id:'missing-route',name:'Missing LED',enabled:true,displayId:999999,displayLabel:'Disconnected LED',displayWidth:1920,displayHeight:1080},0)];
    outputRoutingDirty=true; renderOutputRows(); openOutputRouter();
    const blocked=document.getElementById('btnOutputRouterApply').disabled;
    const status=document.getElementById('outputRouterStatus').textContent;
    const state=document.querySelector('.output-route-state')?.textContent||'';
    outputConfigs=previous; outputRoutingDirty=previousDirty; renderOutputRows(); closeOutputRouter();
    return {blocked,status,state};
  })())`));
  check('COMPOSITOR_UNAVAILABLE_OUTPUT_BLOCKS_APPLY_OK', unavailableOutputGuard.blocked && unavailableOutputGuard.status.includes('available display') && unavailableOutputGuard.state === 'DISPLAY UNAVAILABLE', JSON.stringify(unavailableOutputGuard));
  await win.webContents.executeJavaScript(`document.getElementById('btnOutputRouterCloseX').click(); document.getElementById('panelSources').scrollIntoView({block:'start'});`);
  await new Promise(resolve => setTimeout(resolve, 160));
  fs.writeFileSync(path.join(artifactDirectory, 'compositor-1280x800.png'), (await win.webContents.capturePage()).toPNG());

  const stableLayouts = [];
  for (const viewport of [
    { width: 1600, height: 900 },
    { width: 1280, height: 800 },
    { width: 1024, height: 700 },
    { width: 900, height: 600 }
  ]) {
    win.setContentSize(viewport.width, viewport.height);
    if (!await waitFor(() => win.webContents.executeJavaScript(`innerWidth===${viewport.width}&&innerHeight===${viewport.height}`))) throw new Error(`${viewport.width}x${viewport.height} viewport did not settle`);
    await win.webContents.executeJavaScript(`(()=>{
      document.body.classList.remove('sidebar-collapsed','dr-run','dr-right');
      setSidebarView('slides');
      setSourceInspectorCollapsed(false,{persist:false});
      const panel=document.getElementById('panelSources');
      setSourceInspectorWidth(Number(panel.dataset.sourceInspectorPreferredWidth)||350,{persist:false,updatePreferred:false});
    })()`);
    await new Promise(resolve => setTimeout(resolve, 140));
    const layout = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
      const rect=value=>{const node=typeof value==='string'?document.querySelector(value):value;const box=node.getBoundingClientRect();return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,height:box.height};};
      const app=rect('#app-shell'),workspace=rect('.main.operator-workspace'),sidebar=rect('#primarySidebar'),main=rect('.operator-main'),studio=rect('#studio');
      const preview=rect('#preview'),program=rect('#program'),panel=rect('#panelSources'),docks=rect('.compositor-workspace');
      const layers=rect('.compositor-layers'),inspector=rect('#inspector'),audio=rect('.compositor-audio'),add=rect('#btnAddSource');
      const layerRow=document.querySelector('#layerList .layer-row'),layerRowRect=layerRow?rect(layerRow):null;
      const layerActionRects=layerRow?[...layerRow.querySelectorAll('.layer-row-actions button')].map(rect):[];
      const sceneCommands=[...document.querySelectorAll('.slides-tools button')];
      const sceneCommandMetrics=sceneCommands.map(button=>{const style=getComputedStyle(button);const context=document.createElement('canvas').getContext('2d');context.font=style.font;return {text:button.textContent.trim(),required:context.measureText(button.textContent.trim()).width+parseFloat(style.paddingLeft)+parseFloat(style.paddingRight),available:button.clientWidth};});
      const close=(a,b,tolerance=2)=>Math.abs(a-b)<=tolerance;
      return {
        viewport:{width:innerWidth,height:innerHeight},app,workspace,sidebar,main,studio,preview,program,panel,docks,layers,inspector,audio,add,
        bodyOverflow:document.documentElement.scrollWidth>innerWidth+1,
        dockOverflow:document.querySelector('.compositor-workspace').scrollWidth>document.querySelector('.compositor-workspace').clientWidth+1,
        sidebarDocked:sidebar.width>=178&&sidebar.left>=workspace.left-1&&sidebar.right<=main.left-4,
        monitorsStable:preview.width>100&&program.width>100&&close(preview.top,program.top)&&close(preview.bottom,program.bottom)&&close(preview.width,program.width,4)&&preview.right<program.left,
        panelBelow:panel.top>=Math.max(preview.bottom,program.bottom)+4&&panel.bottom<=main.bottom+1,
        docksStable:layers.width>=215&&inspector.width>=215&&audio.width>=215&&close(layers.top,inspector.top)&&close(inspector.top,audio.top)&&close(layers.bottom,inspector.bottom)&&close(inspector.bottom,audio.bottom)&&layers.right<inspector.left&&inspector.right<=audio.left+1,
        controlsVisible:add.width>0&&add.height>0&&add.left>=panel.left&&add.right<=panel.right+1,
        layerActionsVisible:!!layerRowRect&&layerActionRects.length===5&&layerActionRects.every(button=>button.width>0&&button.height>0&&button.left>=layerRowRect.left-1&&button.right<=layerRowRect.right+1&&button.top>=layerRowRect.top-1&&button.bottom<=layerRowRect.bottom+1),
        sceneCommandsFit:sceneCommands.length===3&&sceneCommands.every(button=>button.scrollWidth<=button.clientWidth),
        sceneCommandLabelsVisible:sceneCommandMetrics.length===3&&sceneCommandMetrics.every(metric=>metric.required<=metric.available+.5),
        sceneCommandMetrics,
        localScroll:[getComputedStyle(document.querySelector('.compositor-layers')).overflowY,getComputedStyle(document.querySelector('#inspector')).overflowY,getComputedStyle(document.querySelector('.compositor-audio')).overflowY]
      };
    })())`));
    stableLayouts.push(layout);
    fs.writeFileSync(path.join(artifactDirectory, `compositor-stable-${viewport.width}x${viewport.height}.png`), (await win.webContents.capturePage()).toPNG());
  }
  check('COMPOSITOR_OBS_DOCK_LAYOUT_STABLE_OK', stableLayouts.every(layout => !layout.bodyOverflow && !layout.dockOverflow && layout.sidebarDocked && layout.monitorsStable && layout.panelBelow && layout.docksStable && layout.controlsVisible && layout.layerActionsVisible && layout.sceneCommandsFit && layout.sceneCommandLabelsVisible && layout.localScroll.every(value => value === 'auto' || value === 'scroll')), JSON.stringify(stableLayouts));

  await win.webContents.executeJavaScript(`setSidebarView('rundown')`);
  win.setContentSize(1280, 800);
  if (!await waitFor(() => win.webContents.executeJavaScript('innerWidth===1280&&innerHeight===800'))) throw new Error('1280x800 viewport did not restore');

  const saved = await win.webContents.executeJavaScript(`flushShowAutosave({reason:'compositor-renderer-test',force:true})`);
  const disk = await repository.loadCurrent();
  const roundtripDetail = disk.ok ? {
    saved: !!saved.ok,
    canvas: disk.document.show.screenContent.canvas,
    liveInputs: disk.document.show.screenContent.liveInputs.length,
    layerTypes: disk.document.show.screenContent.scenes[0].layers.map(layer => layer.type)
  } : { saved: !!saved.ok, disk };
  check('COMPOSITOR_FILE_ROUNDTRIP_OK', saved.ok && disk.ok && disk.document.show.screenContent.canvas.width === 1000 && disk.document.show.screenContent.liveInputs.length === 3 && disk.document.show.screenContent.scenes[0].layers.some(layer => layer.type === 'window') && disk.document.show.screenContent.scenes[0].layers.some(layer => layer.type === 'capture') && disk.document.show.screenContent.scenes[0].layers.some(layer => layer.type === 'audio'), JSON.stringify(roundtripDetail));

  win.setBounds(smokeDisplay.clampToWorkArea({ width: 900, height: 600 }, target.workArea));
  if (!await waitFor(() => win.webContents.executeJavaScript('innerWidth===900 && innerHeight>=560'))) throw new Error('900x600 viewport did not settle');
  const compactComposition = JSON.parse(await win.webContents.executeJavaScript(`(async()=>{
    document.getElementById('btnCompositionWorkspace').click();
    const started=Date.now();while(Date.now()-started<1200&&!document.getElementById('compositionWorkspace').classList.contains('open'))await new Promise(resolve=>setTimeout(resolve,25));
    const grid=document.querySelector('.composition-workspace-grid'),dialog=document.querySelector('.composition-workspace-dialog'),settings=document.querySelector('.composition-settings-pane');
    grid.scrollTop=grid.scrollHeight;
    await new Promise(resolve=>setTimeout(resolve,80));
    const dr=dialog.getBoundingClientRect(),sr=settings.getBoundingClientRect(),empty=document.getElementById('mappingEmpty'),emptyRect=empty.getBoundingClientRect(),inspector=document.getElementById('mappingInspector'),inspectorRect=inspector.getBoundingClientRect(),selection=document.getElementById('mappingSelectionStatus'),selectionRect=selection.getBoundingClientRect(),surfaceCount=document.querySelectorAll('.projector-mapping-tab').length;
    const emptyVisible=!empty.hidden&&getComputedStyle(empty).display!=='none'&&emptyRect.height>0,inspectorVisible=!inspector.hidden&&getComputedStyle(inspector).display!=='none'&&inspectorRect.height>0;
    const mappingStateCoherent=surfaceCount>0?(inspectorVisible&&!emptyVisible):(!inspectorVisible&&emptyVisible);
    return JSON.stringify({open:document.getElementById('compositionWorkspace').classList.contains('open'),dialogInside:dr.left>=0&&dr.right<=innerWidth&&dr.top>=0&&dr.bottom<=innerHeight,horizontalFit:grid.scrollWidth<=grid.clientWidth+2,verticalScroll:grid.scrollHeight>grid.clientHeight,settingsReachable:sr.left>=dr.left&&sr.right<=dr.right+1&&sr.top<dr.bottom&&sr.bottom>dr.top,closeVisible:document.getElementById('btnCompositionClose').getClientRects().length>0,mappingStateCoherent,surfaceCount,empty:{hidden:empty.hidden,display:getComputedStyle(empty).display,top:emptyRect.top,bottom:emptyRect.bottom,height:emptyRect.height},inspector:{hidden:inspector.hidden,display:getComputedStyle(inspector).display,top:inspectorRect.top,bottom:inspectorRect.bottom,height:inspectorRect.height},selection:{text:selection.textContent,top:selectionRect.top,bottom:selectionRect.bottom,height:selectionRect.height},dialog:{left:dr.left,right:dr.right,top:dr.top,bottom:dr.bottom},settings:{left:sr.left,right:sr.right,top:sr.top,bottom:sr.bottom},scroll:{top:grid.scrollTop,height:grid.clientHeight,full:grid.scrollHeight}});
  })()`));
  check('COMPOSITION_900X600_WORKSPACE_REACHABLE_OK', compactComposition.open && compactComposition.dialogInside && compactComposition.horizontalFit && compactComposition.verticalScroll && compactComposition.settingsReachable && compactComposition.closeVisible && compactComposition.mappingStateCoherent, JSON.stringify(compactComposition));
  await new Promise(resolve => setTimeout(resolve, 120));
  fs.writeFileSync(path.join(artifactDirectory, 'composition-workspace-900x600.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.getElementById('btnCompositionClose').click()`);
  const compact = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    const root=document.getElementById('panelSources'); const inspector=document.getElementById('inspector'); const actionElement=document.getElementById('inspDelete'); actionElement.scrollIntoView({block:'center'});
    const panel=root.getBoundingClientRect(); const add=document.getElementById('btnAddSource').getBoundingClientRect(); const action=actionElement.getBoundingClientRect(); const preview=document.getElementById('preview').getBoundingClientRect(); const program=document.getElementById('program').getBoundingClientRect(); const inspectorRect=inspector.getBoundingClientRect();
    return {vw:innerWidth,vh:innerHeight,panel:{left:panel.left,right:panel.right,top:panel.top,bottom:panel.bottom},add:{left:add.left,right:add.right,top:add.top,bottom:add.bottom},action:{left:action.left,right:action.right,top:action.top,bottom:action.bottom},preview:{left:preview.left,right:preview.right,top:preview.top,bottom:preview.bottom},program:{left:program.left,right:program.right,top:program.top,bottom:program.bottom},inspector:{left:inspectorRect.left,right:inspectorRect.right,top:inspectorRect.top,bottom:inspectorRect.bottom,scrollTop:inspector.scrollTop,scrollable:inspector.scrollHeight>inspector.clientHeight}};
  })())`));
  check('COMPOSITOR_900X600_CONTROLS_REACHABLE_OK', compact.panel.left >= 0 && compact.panel.right <= compact.vw + 1 && compact.add.left >= 0 && compact.add.right <= compact.vw + 1 && compact.preview.right > compact.preview.left && compact.preview.bottom > compact.preview.top && compact.program.right > compact.program.left && compact.program.bottom > compact.program.top && compact.inspector.scrollable && compact.inspector.scrollTop > 0 && compact.action.left >= compact.inspector.left && compact.action.right <= compact.inspector.right + 1 && compact.action.top >= compact.inspector.top && compact.action.bottom <= compact.inspector.bottom + 1, JSON.stringify(compact));
  const compactUtility = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    document.body.classList.add('dr-right'); const utility=document.getElementById('utilitySidebar'); utility.scrollTop=0;
    const status=document.querySelector('.card-status').getBoundingClientRect(); const scenes=document.querySelector('.card-scenes').getBoundingClientRect(); const rows=[...document.querySelectorAll('.card-status .strow')].map(row=>row.getBoundingClientRect());
    const result={scrollable:utility.scrollHeight>utility.clientHeight,statusBottom:status.bottom,scenesTop:scenes.top,rowsInside:rows.every(row=>row.top>=status.top&&row.bottom<=status.bottom+1)};
    document.body.classList.remove('dr-right'); return result;
  })())`));
  check('COMPOSITOR_COMPACT_UTILITY_CARDS_DO_NOT_OVERLAP_OK', compactUtility.scrollable && compactUtility.rowsInside && compactUtility.statusBottom <= compactUtility.scenesTop + 1, JSON.stringify(compactUtility));
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

  win.setContentSize(1600, 900);
  if (!await waitFor(() => win.webContents.executeJavaScript('innerWidth===1600&&innerHeight===900'))) throw new Error('1600x900 demo viewport did not settle');
  await win.webContents.executeJavaScript(`setSidebarView('slides');`);
  await new Promise(resolve => setTimeout(resolve, 160));
  fs.writeFileSync(path.join(artifactDirectory, 'compositor-demo-1600x900.png'), (await win.webContents.capturePage()).toPNG());

  console.log(`COMPOSITOR_RENDERER_TESTS_OK count=${checks}`);
  win.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  app.quit();
}).catch(error => {
  console.error(error && error.stack || error);
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
