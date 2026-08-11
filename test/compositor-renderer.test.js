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
    const composition=cloneState(activeComposition());
    const mapping=cloneState(composition.mappings[0]);
    const projected=projectedOutputConfig(outputConfigs[0]);
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
    return JSON.stringify({topButtonVisible,singleTopEntry,opened,panes,modalOpened,inspectorVisible,reopened,persisted,routerVisible,routeCanvases,mapEntryOpened,cornerHandles,compositionId:composition.id,compositionCount:S.compositions.length,sceneCount:scenesForComposition(composition.id).length,canvas:composition.canvas,mapping,projected,overlayInside:document.querySelector('.composition-workspace-dialog').getBoundingClientRect().right<=innerWidth+1});
  })()`));
  check('COMPOSITION_WORKSPACE_VISIBLE_FROM_TOP_NAV_OK', compositionWorkflow.topButtonVisible && compositionWorkflow.singleTopEntry && compositionWorkflow.opened && compositionWorkflow.panes && compositionWorkflow.modalOpened && compositionWorkflow.inspectorVisible && compositionWorkflow.reopened && compositionWorkflow.overlayInside, JSON.stringify(compositionWorkflow));
  check('COMPOSITION_CUSTOM_LED_MULTI_PROJECTOR_MAPPING_OK', compositionWorkflow.persisted && compositionWorkflow.compositionCount >= 2 && compositionWorkflow.sceneCount >= 1 && compositionWorkflow.canvas.width === 5376 && compositionWorkflow.canvas.height === 768 && compositionWorkflow.canvas.fps === 50 && compositionWorkflow.mapping.width === 2688 && compositionWorkflow.mapping.height === 768 && compositionWorkflow.mapping.blend.right === 96 && compositionWorkflow.mapping.warp.enabled && compositionWorkflow.mapping.warp.grid.visible && compositionWorkflow.mapping.warp.grid.columns === 10 && compositionWorkflow.mapping.warp.corners.topLeft.x === 4 && compositionWorkflow.projected.compositionId === compositionWorkflow.compositionId && compositionWorkflow.projected.projection.width === 2688 && compositionWorkflow.projected.projection.warp.enabled && compositionWorkflow.cornerHandles === 4, JSON.stringify(compositionWorkflow));
  check('OUTPUT_ROUTER_MULTI_CANVAS_AND_MAPPING_ENTRY_OK', compositionWorkflow.routerVisible && compositionWorkflow.mapEntryOpened && compositionWorkflow.routeCanvases.length === 2 && compositionWorkflow.routeCanvases[0].width === 1920 && compositionWorkflow.routeCanvases[0].height === 1080 && compositionWorkflow.routeCanvases[0].fit === 'contain' && compositionWorkflow.routeCanvases[0].mapping === 'Mapping active' && compositionWorkflow.routeCanvases[1].width === 1000 && compositionWorkflow.routeCanvases[1].height === 1000 && compositionWorkflow.routeCanvases[1].fit === 'cover' && compositionWorkflow.routeCanvases.every(route=>route.mapVisible), JSON.stringify(compositionWorkflow.routeCanvases));
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
  const mediaReplacement = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{const layer=currentScene().layers.find(row=>row.id===${JSON.stringify(pictureLayerId)});return {id:layer.id,name:layer.name,type:layer.type,selected:selectedLayer().id};})())`));
  win.webContents.debugger.detach();
  check('COMPOSITOR_MEDIA_REPLACE_PRESERVES_LAYER_OK', mediaReplacement.id === pictureLayerId && mediaReplacement.selected === pictureLayerId && mediaReplacement.name === 'replacement.svg' && mediaReplacement.type === 'image', JSON.stringify(mediaReplacement));
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
    document.getElementById('sourceDeviceResolution').value='1280x720';
    document.getElementById('sourceDeviceFps').value='30';
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
    const scene=currentScene(); const timer=scene.layers.find(layer=>layer.type==='timer'); const color=scene.layers.find(layer=>layer.type==='color'); const text=scene.layers.find(layer=>layer.type==='text'); const capture=scene.layers.find(layer=>layer.type==='window');
    const captureElement=document.querySelector('#pvScene [data-layer-id="'+capture.id+'"]');
    const previewRect=document.getElementById('preview').getBoundingClientRect();
    const windowInput=liveInputDefinition(capture.inputId);
    return JSON.stringify({canvas:S.canvas,previewRatio:previewRect.width/previewRect.height,types:scene.layers.map(layer=>layer.type),timerIndex:scene.layers.indexOf(timer),colorIndex:scene.layers.indexOf(color),text:{bg:text.bg,x:text.x,y:text.y,w:text.w,h:text.h},captureAudioDefault,systemAudioDefault,duplicateAudioDefault,duplicateNoticeVisible,capture:{x:capture.x,y:capture.y,w:capture.w,h:capture.h,fit:capture.fit,name:capture.name,audioEnabled:capture.audioEnabled,withAudio:windowInput&&windowInput.withAudio},audioState,windowAudioRows:document.querySelectorAll('#audioMixerRows [data-audio-layer-id="'+capture.id+'"]').length,handles:captureElement?captureElement.querySelectorAll('.transform-handle').length:0,layerRows:document.querySelectorAll('#layerList .layer-row').length,liveInputs:S.liveInputs.length});
  })()`));
  fs.writeFileSync(path.join(artifactDirectory, 'capture-safe-defaults.png'), (await win.webContents.capturePage()).toPNG());
  check('COMPOSITOR_CUSTOM_CANVAS_AND_SOURCE_TYPES_OK', authored.canvas.width === 1000 && authored.canvas.height === 1000 && authored.canvas.fps === 25 && Math.abs(authored.previewRatio - 1) < 0.02 && ['color','image','text','window','capture','timer'].every(type => authored.types.includes(type)), JSON.stringify(authored));
  check('COMPOSITOR_LAYER_INSPECTOR_AND_HANDLES_OK', authored.capture.name === 'Slides capture' && authored.capture.x === 54 && authored.capture.y === 8 && authored.capture.w === 42 && authored.capture.h === 40 && authored.handles === 4 && authored.layerRows === authored.types.length, JSON.stringify(authored));
  check('COMPOSITOR_CAPTURE_AUDIO_REQUIRES_EXPLICIT_CHOICE_OK', authored.captureAudioDefault === '', JSON.stringify({ captureAudioDefault: authored.captureAudioDefault }));
  const layerListLayout = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{const rows=[...document.querySelectorAll('#layerList .layer-row')];const chips=[...document.querySelectorAll('#layerList .layer-program-chip')];const bar=document.getElementById('layerProgramBar').getBoundingClientRect();return {rows:rows.map(row=>row.getBoundingClientRect().height),chips:chips.map(chip=>chip.getBoundingClientRect().height),bar:bar.height};})())`));
  check('COMPOSITOR_LAYER_LIST_STAYS_COMPACT_OK', layerListLayout.rows.length > 0 && layerListLayout.rows.every(height=>height >= 72 && height <= 80) && layerListLayout.chips.every(height=>height <= 18) && layerListLayout.bar <= 64, JSON.stringify(layerListLayout));
  check('COMPOSITOR_COLOR_DEFAULTS_BEHIND_TIMER_OK', authored.colorIndex === 0 && authored.timerIndex > authored.colorIndex, JSON.stringify({ colorIndex: authored.colorIndex, timerIndex: authored.timerIndex }));
  check('COMPOSITOR_TEXT_DEFAULT_IS_NON_OBSCURING_OK', authored.text.bg === 'transparent' && authored.text.x > 0 && authored.text.y > 0 && authored.text.w < 100 && authored.text.h < 100, JSON.stringify(authored.text));
  check('COMPOSITOR_AUDIO_INPUT_AND_MIXER_OK', authored.types.includes('audio') && authored.audioState.layer.volume === 0.62 && authored.audioState.layer.audioMonitoring === 'monitor-only' && authored.audioState.input.type === 'audio' && authored.audioState.input.audioDeviceId === 'audio-card-1' && authored.audioState.rows >= 2 && authored.audioState.meters === authored.audioState.rows, JSON.stringify(authored.audioState));
  check('COMPOSITOR_WINDOW_SYSTEM_AUDIO_MIXER_OK', authored.systemAudioDefault && authored.capture.withAudio && authored.capture.audioEnabled && authored.windowAudioRows === 1, JSON.stringify({ systemAudioDefault: authored.systemAudioDefault, capture: authored.capture, windowAudioRows: authored.windowAudioRows }));
  check('COMPOSITOR_WINDOW_CAPTURE_SAFE_DEFAULTS_OK', authored.capture.fit === 'contain' && authored.duplicateAudioDefault === false && authored.duplicateNoticeVisible, JSON.stringify({ capture: authored.capture, duplicateAudioDefault: authored.duplicateAudioDefault, duplicateNoticeVisible: authored.duplicateNoticeVisible }));
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
    const scene=currentScene(), original=cloneState(scene.layers), source=scene.layers[1]||scene.layers[0];
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
    currentScene().layers=original; selectedLayerId=(original[original.length-1]||{}).id||null; sceneDirty();
    return {indexBefore,indexForward,indexBackward,topForwardDisabled,bottomBackwardDisabled,deleted};
  })())`));
  check('COMPOSITOR_LAYER_REORDER_DELETE_CONTROLS_OK', layerRowActions.indexForward === layerRowActions.indexBefore + 1 && layerRowActions.indexBackward === layerRowActions.indexBefore && layerRowActions.topForwardDisabled && layerRowActions.bottomBackwardDisabled && layerRowActions.deleted, JSON.stringify(layerRowActions));
  if (!await waitFor(() => configuredInputs.some(input => input.type === 'window' && input.active))) throw new Error('window input was not configured');
  check('COMPOSITOR_WINDOW_AND_CAPTURE_CARD_CONFIGURED_ONCE_OK', configuredInputs.filter(input => input.type === 'window' && input.withAudio).length === 1 && configuredInputs.filter(input => input.type === 'device' && input.videoDeviceId === 'video-card-1' && input.audioDeviceId === 'audio-card-1' && input.withAudio && input.width === 1280 && input.height === 720).length === 1, JSON.stringify(configuredInputs));

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
  check('COMPOSITOR_CHANGE_SOURCE_PRESERVES_TRANSFORM_OK', replaced.highlighted && replaced.closed && replaced.sameLayer && replaced.newInput && replaced.geometry && replaced.liveInputs === 3, JSON.stringify(replaced));

  const handle = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{const el=document.querySelector('#pvScene .transform-handle.handle-se');const r=el.getBoundingClientRect();const layer=selectedLayer();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),w:layer.w,h:layer.h,id:layer.id,type:layer.type,handleLayerId:el.closest('.pv-scene-layer')?.dataset.layerId||''};})())`));
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
    const dr=dialog.getBoundingClientRect(),sr=settings.getBoundingClientRect();
    return JSON.stringify({open:document.getElementById('compositionWorkspace').classList.contains('open'),dialogInside:dr.left>=0&&dr.right<=innerWidth&&dr.top>=0&&dr.bottom<=innerHeight,horizontalFit:grid.scrollWidth<=grid.clientWidth+2,verticalScroll:grid.scrollHeight>grid.clientHeight,settingsReachable:sr.left>=dr.left&&sr.right<=dr.right+1&&sr.top<dr.bottom&&sr.bottom>dr.top,closeVisible:document.getElementById('btnCompositionClose').getClientRects().length>0,dialog:{left:dr.left,right:dr.right,top:dr.top,bottom:dr.bottom},settings:{left:sr.left,right:sr.right,top:sr.top,bottom:sr.bottom},scroll:{top:grid.scrollTop,height:grid.clientHeight,full:grid.scrollHeight}});
  })()`));
  check('COMPOSITION_900X600_WORKSPACE_REACHABLE_OK', compactComposition.open && compactComposition.dialogInside && compactComposition.horizontalFit && compactComposition.verticalScroll && compactComposition.settingsReachable && compactComposition.closeVisible, JSON.stringify(compactComposition));
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

  console.log(`COMPOSITOR_RENDERER_TESTS_OK ${checks}/42`);
  win.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  app.quit();
}).catch(error => {
  console.error(error && error.stack || error);
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
