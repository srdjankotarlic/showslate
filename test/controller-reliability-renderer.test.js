'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = process.env.SHOWSLATE_TEST_APP_ROOT || path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'showslate-controller-reliability-'));
app.setPath('userData', profile);
let win;
let saveFailure = false;
let openedDocument;
let lastSaved;
const states = [];
const failures = [];
let checks = 0;
function check(name, condition, detail) {
  checks++;
  console.log(`${name}=${!!condition}${detail ? ' ' + JSON.stringify(detail) : ''}`);
  if (!condition) failures.push(name);
}
const evaluate = script => win.webContents.executeJavaScript(`(async()=>{${script}})()`);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
for (const channel of ['control-status', 'close-output', 'set-output-configs', 'ctl-on-top', 'fit-window', 'show-document-clear-path', 'live-input-unsubscribe']) ipcMain.on(channel, () => {});
ipcMain.on('state', (event, state) => states.push(state));
const handlers = {
  'displays': () => [],
  'output-open': () => false,
  'output-configs': () => [],
  'network-info': () => ({ running: false }),
  'build-info': () => ({ version: 'test', commit: 'controller-reliability', isPackaged: false }),
  'show-document-status': () => ({ ok: true, path: '' }),
  'recording-settings': () => ({ directory: '', includeAudio: false }),
  'show-storage-status': () => ({ ok: true, autosaveEnabled: true, recoveryAvailable: false, currentAvailable: false }),
  'show-storage-save': (event, payload) => {
    if (saveFailure) return { ok: false, error: 'simulated disk full' };
    lastSaved = payload.document;
    return { ok: true };
  },
  'show-storage-load-current': () => ({ ok: false }),
  'show-storage-recover': () => ({ ok: false }),
  'show-document-open': () => ({ ok: true, path: path.join(profile, 'Fixture.showslate'), document: openedDocument }),
  'show-document-clear-path': () => ({ ok: true }),
  'show-package-import': () => ({ ok: true, document: openedDocument, warnings: [] }),
  'show-preflight-inspect': () => ({ overall: 'warning', checks: [], counts: { ok: 0, warning: 1, blocking: 0 } }),
  'identify-displays': () => 0,
  'qr': () => '',
  'share-info': () => ({}),
  'live-input-statuses': () => [],
  'live-input-configure': () => ({ ok: true }),
  'live-input-subscribe': () => ({ ok: true }),
  'live-input-devices': () => ({ cameras: [], microphones: [] }),
  'live-input-permissions': () => ({ camera: 'not-determined', microphone: 'not-determined', screen: 'not-determined' })
};
for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);

app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: {
    preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
  } });
  win.webContents.setAudioMuted(true);
  await win.loadFile(path.join(root, 'controller.html'));
  for (let tries = 0; tries < 100 && !await evaluate('return showAutosaveReady===true;'); tries++) await pause(50);
  check('CONTROLLER_RELIABILITY_INITIALIZED_OK', await evaluate('return showAutosaveReady===true;'));
  await evaluate(`
    window.alerts=[];window.alert=message=>alerts.push(message);
    S.goAutoStart=false;S.studioDirect=false;
    const template=PTLT.makeTemplate({id:'delayed-template',name:'Delayed LT',layers:[PTLT.makeDynamicTextLayer({id:'speaker',field:'speakerName'})]});
    ltLibrary={schemaVersion:1,activeTemplateId:template.id,templates:[template]};saveLtLibrary();
    window.makeReliabilityCues=()=>migrateCues([
      {id:'cue-live',name:'Live cue',speakerName:'Live Speaker',durationMs:60000,lowerThirdAuto:true,lowerThirdDelayMs:120,lowerThirdDurationMs:0,lowerThirdTemplateId:template.id},
      {id:'cue-next',name:'Next cue',speakerName:'Next Speaker',durationMs:60000}
    ]);
    cues=makeReliabilityCues();currentCue=-1;goLiveWithCue(0);reorderCueById('cue-next','cue-live');
  `);
  await pause(300);
  const delayed = await evaluate(`return {cue:cues[currentCue].id,visible:S.lowerThird.visible,speaker:S.lowerThird.runtime?.resolvedData?.speakerName||S.lowerThird.name};`);
  check('CONTROLLER_DELAYED_LT_SURVIVES_CUE_REORDER_OK', delayed.cue === 'cue-live' && delayed.visible, delayed);
  await evaluate(`hideLowerThird({force:true});cues=makeReliabilityCues();currentCue=-1;goLiveWithCue(0);goLiveWithCue(1);`);
  await pause(250);
  check('CONTROLLER_NEXT_GO_CANCELS_OLD_DELAYED_LT_OK', await evaluate(`return cues[currentCue].id==='cue-next'&&!S.lowerThird.visible;`));

  const beforeGo = states.length;
  const quotaGo = await evaluate(`
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key==='pt_cues')throw new DOMException('quota','QuotaExceededError');return original.call(this,key,value);};
    let error='';try{cues=makeReliabilityCues();currentCue=-1;goLiveWithCue(1);}catch(e){error=e.message;}finally{Storage.prototype.setItem=original;}
    const save=await flushShowAutosave({reason:'quota-go-test',force:true});return {error,save,cue:cues[currentCue].id};
  `);
  await pause(30);
  check('CONTROLLER_GO_SURVIVES_LEGACY_CACHE_QUOTA_OK', !quotaGo.error && states.slice(beforeGo).some(state => state.goTransaction?.cueId === 'cue-next') && quotaGo.save.ok && lastSaved?.show.rundown[1].status === 'live', quotaGo);

  const restored = await evaluate(`
    const doc=collectShowDocument();doc.show.name='Disk document';doc.show.rundown[0].name='Authoritative disk cue';doc.show.branding.bgColor='#234567';
    doc.show.lowerThird.library={schemaVersion:1,activeTemplateId:null,templates:[]};
    const original=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw new DOMException('quota','QuotaExceededError');};
    let applied=false,error='';try{applied=applyShowDocument(doc,{source:'show-document',announce:false});}catch(e){error=e.message;}finally{Storage.prototype.setItem=original;}
    return {applied,error,name:cues[0].name,color:S.bgColor,running:S.running,outputOpen,templates:ltLibrary.templates.length};
  `);
  check('CONTROLLER_DISK_DOCUMENT_SURVIVES_FULL_LEGACY_CACHE_OK', restored.applied && !restored.error && restored.name === 'Authoritative disk cue' && restored.color === '#234567' && !restored.running && !restored.outputOpen, restored);
  check('CONTROLLER_DISK_DOCUMENT_MIGRATES_LT_LIBRARY_WITHOUT_CACHE_OK', restored.templates >= 4, restored);

  openedDocument = await evaluate('return collectShowDocument();');
  saveFailure = true;
  const openFailure = await evaluate(`await openShowDocument({confirmed:true,silent:true});return {kind:$('showSaveStatus').dataset.kind,name:showMeta.name};`);
  check('CONTROLLER_OPEN_AUTOSAVE_ERROR_REMAINS_VISIBLE_OK', openFailure.kind === 'error', openFailure);
  const importFailure = await evaluate(`alerts.length=0;await importPortableShow({confirmed:true});return {kind:$('showSaveStatus').dataset.kind,alerts:alerts.slice()};`);
  check('CONTROLLER_IMPORT_AUTOSAVE_FAILURE_REPORTED_OK', importFailure.kind === 'error' && importFailure.alerts.some(message => message.includes('simulated disk full')), importFailure);
  saveFailure = false;
  const recovered = await evaluate(`const result=await flushShowAutosave({reason:'retry',force:true});return {ok:result.ok,kind:$('showSaveStatus').dataset.kind};`);
  check('CONTROLLER_AUTOSAVE_CAN_RETRY_AFTER_DISK_FAILURE_OK', recovered.ok && recovered.kind === 'saved', recovered);
  const transitions = await evaluate(`
    S.studioDirect=false;S.sceneFadeMs=700;
    takePreview('cut');const cut=programState.sceneFadeMs;
    takePreview('transition');return {cut,fade:programState.sceneFadeMs,preference:S.sceneFadeMs};
  `);
  check('CONTROLLER_CUT_DOES_NOT_USE_FADE_PREFERENCE_OK', transitions.cut===0 && transitions.fade===700 && transitions.preference===700, transitions);
  const identity = await evaluate(`
    S.scenes=[{id:'origin',name:'Origin',layers:[{id:'shared',type:'text',text:'Original'}]},
      {id:'incoming',name:'Incoming',layers:[{id:'shared',type:'text',text:'Incoming'}]}];
    S.activeSceneId='origin';ensureScenes();programState=outputSnapshot(S);
    S.activeSceneId='incoming';selectedLayerId='shared';takeSelectedLayer();
    const first=cloneState(activeScene(programState).layers);
    selectedLayer().text='Updated incoming';takeSelectedLayer();
    return {first,second:cloneState(activeScene(programState).layers),found:findProgramLayer(selectedLayer())?.text};
  `);
  check('CONTROLLER_STUDIO_LAYER_TAKE_IS_SOURCE_SCOPED_OK', identity.first.length===2 && identity.second.length===2 && new Set(identity.second.map(row=>row.id)).size===2 && identity.second.some(row=>row.text==='Original') && identity.found==='Updated incoming', identity);
  const lifecycle = await evaluate(`
    const scene=currentScene();scene.layers=[{id:'decoder',type:'video',src:'data:video/mp4;base64,',playbackState:'paused',muted:true}];
    renderMonitorScene('pv',S);const first=$('pvScene').querySelector('video');
    scene.layers[0].x=12;monitorSceneKeys.pv='';renderMonitorScene('pv',S);
    const same=first===$('pvScene').querySelector('video');
    const retired=$('pvScene').querySelector('video');scene.layers=[];renderMonitorScene('pv',S);
    return {same,paused:retired.paused,released:!retired.__showSlateTransportCleanup,src:retired.getAttribute('src')};
  `);
  check('CONTROLLER_TRANSFORM_PRESERVES_VIDEO_DECODER_OK', lifecycle.same, lifecycle);
  check('CONTROLLER_REMOVED_VIDEO_RELEASES_RESOURCES_OK', lifecycle.paused && lifecycle.released && lifecycle.src===null, lifecycle);
  const pin = await evaluate(`
    S.scenes=[{id:'camera-scene',name:'Camera',layers:[{id:'pin-camera',type:'capture',inputId:'retained-input',livePersistent:true}]},
      {id:'next-scene',name:'Next',layers:[{id:'next-text',type:'text',text:'Next'}]}];
    S.activeSceneId='camera-scene';S.liveInputs=[{id:'retained-input',type:'device',videoDeviceId:'fixture-device',name:'Pinned camera'}];
    ensureScenes();programState=outputSnapshot(S);S.liveInputs=[];
    takeLiveModeScene('next-scene');
    const retained=activeScene(programState).layers.some(row=>row.inputId==='retained-input');
    const definition=programState.liveInputs.find(row=>row.id==='retained-input');
    liveModePreferences.transition='cut';selectLiveModeClip('next-scene','next-text',{previewOnly:true});takeLiveModeClip();
    const cut=programState.sceneFadeMs;
    liveModePreferences.transition='fade';takeLiveModeClip();
    return {retained,definition,cut,fade:programState.sceneFadeMs};
  `);
  check('CONTROLLER_PIN_RETAINS_CAPTURE_DEFINITION_OK', pin.retained && pin.definition?.videoDeviceId==='fixture-device', pin);
  check('CONTROLLER_CLIP_TAKE_RESPECTS_TRANSITION_OK', pin.cut===0 && pin.fade>0, pin);
  check('CONTROLLER_RELIABILITY_WINDOW_HIDDEN_OK', !win.isVisible());
  await evaluate('showAutosaveReady=false;clearTimeout(showAutosaveTimer);clearScheduledLowerThirdAuto();');
  if (failures.length) throw new Error(failures.join(', '));
  console.log(`CONTROLLER_RELIABILITY_RENDERER_TESTS_OK count=${checks}`);
  win.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  app.quit();
}).catch(error => {
  console.error(error && error.stack || error);
  if (win && !win.isDestroyed()) win.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
