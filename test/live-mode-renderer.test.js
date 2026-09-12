'use strict';

// Deliberately hidden-only: this suite must never open a projector, acquire a
// camera, record, or read the operator's show/profile.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

if (process.env.SHOWSLATE_HIDDEN_VISUAL !== '1') {
  console.error('LIVE_MODE_REQUIRES_SHOWSLATE_HIDDEN_VISUAL=1');
  app.exit(1);
} else {
  run();
}

function run() {
  const root = process.env.SHOWSLATE_TEST_APP_ROOT || path.resolve(__dirname, '..');
  const fixtures = path.join(__dirname, 'fixtures', 'lower-third');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'showslate-live-mode-ui-'));
  const artifacts = path.join(path.resolve(__dirname, '..'), 'artifacts', 'generated', 'live-mode');
  const phase = process.argv.includes('--capture-before') ? 'before' : 'after';
  app.setPath('userData', profile);
  const failures = [];
  const states = [];
  let checks = 0;
  let captureRequests = 0;
  let win;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const evaluate = script => win.webContents.executeJavaScript(`(async()=>{${script}})()`);
  function check(name, condition, detail) {
    checks++;
    console.log(`${name}=${!!condition}${detail ? ' ' + JSON.stringify(detail) : ''}`);
    if (!condition) failures.push(name);
  }
  async function waitFor(script, timeout = 8000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(`return !!(${script});`)) return true;
      await pause(40);
    }
    return false;
  }
  for (const channel of ['control-status', 'close-output', 'set-output-configs', 'ctl-on-top', 'fit-window', 'show-document-clear-path', 'live-input-unsubscribe']) ipcMain.on(channel, () => {});
  ipcMain.on('state', (event, state) => states.push(state));
  const handlers = {
    'displays': () => [],
    'output-open': () => false,
    'output-configs': () => [],
    'network-info': () => ({ running: false }),
    'build-info': () => ({ version: 'test', commit: 'live-mode-ui', isPackaged: false }),
    'show-document-status': () => ({ ok: true, path: '' }),
    'recording-settings': () => ({ directory: '', includeAudio: false }),
    'show-storage-status': () => ({ ok: true, autosaveEnabled: true, recoveryAvailable: false, currentAvailable: false }),
    'show-storage-save': () => ({ ok: true }),
    'show-storage-load-current': () => ({ ok: false }),
    'show-storage-recover': () => ({ ok: false }),
    'show-preflight-inspect': () => ({ overall: 'warning', checks: [], counts: { ok: 0, warning: 1, blocking: 0 } }),
    'identify-displays': () => 0,
    'qr': () => '',
    'share-info': () => ({}),
    'live-input-statuses': () => [],
    'live-input-configure': () => ({ ok: true }),
    'live-input-devices': () => ({ devices: [], permissions: { camera: 'denied', microphone: 'denied', screen: 'denied' } }),
    'live-input-permissions': () => ({ camera: 'denied', microphone: 'denied', screen: 'denied' }),
    'live-input-subscribe': () => { captureRequests++; return { ok: false, error: 'No test capture hub' }; },
    'live-input-signal-to-hub': () => ({ ok: false })
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  const media = Object.fromEntries(['alpha-static.png', 'opaque-static.jpg', 'opaque-h264.mp4', 'alpha-vp8.webm'].map(name => [name, pathToFileURL(path.join(fixtures, name)).href]));

  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => callback(false));
    win = new BrowserWindow({ width: 1440, height: 900, useContentSize: true, show: false, webPreferences: {
      preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
    } });
    win.webContents.setAudioMuted(true);
    win.webContents.on('console-message', (event, details) => {
      if (details && details.level === 'error') console.error(`LIVE_MODE_RENDERER_CONSOLE ${details.message}`);
    });
    await win.loadFile(path.join(root, 'controller.html'));
    const initialized = await waitFor('showAutosaveReady===true');
    check('LIVE_MODE_INITIALIZED_OK', initialized);
    if (!initialized) throw new Error('Live Mode controller did not initialize');
    await evaluate(`
      window.alert=()=>{}; window.confirm=()=>true;
      window.liveFixtureMedia=${JSON.stringify(media)};
      window.installLiveFixture=()=>{
        setConferenceLiveMode(false);
        S.studioDirect=false; S.goAutoStart=false; S.running=false; S.durationMs=600000; S.remMs=563000; S.endAt=0; S.startAt=0;
        S.lowerThird={...S.lowerThird,visible:false,until:0,runtimeVersion:null,runtime:null};
        S.canvas={schemaVersion:1,width:1920,height:1080,fps:30,background:'#000000',transparent:false};
        S.compositions=[{schemaVersion:1,id:'composition-main',name:'Main Composition',canvas:cloneState(S.canvas),mappings:[]}];
        S.activeCompositionId='composition-main'; S.liveInputs=[];
        const layer=(id,type,name,extra={})=>({id,type,name,x:0,y:0,w:100,h:100,visible:true,opacity:1,...extra});
        S.scenes=[
          {id:'live-opening',name:'Opening',compositionId:'composition-main',layers:[
            layer('live-photo','image','Image fixture',{src:liveFixtureMedia['opaque-static.jpg']}),
            layer('live-title','text','Opening title',{text:'SHOWSLATE LIVE',y:76,h:18,color:'#ffffff',bg:'#101216',fontSize:4,liveSlot:'title',livePersistent:true})]},
          {id:'live-film',name:'Film',compositionId:'composition-main',layers:[
            layer('live-video','video','H.264 video fixture',{src:liveFixtureMedia['opaque-h264.mp4'],muted:true,playbackState:'paused',playbackPosition:0,inPoint:0.05}),
            layer('live-video-alpha','video','VP8 video fixture',{src:liveFixtureMedia['alpha-vp8.webm'],muted:true,playbackState:'paused',playbackPosition:0,inPoint:0.05})]},
          {id:'live-countdown',name:'Countdown',compositionId:'composition-main',layers:[layer('live-timer','timer','Timer')]},
          {id:'live-sources',name:'Sources',compositionId:'composition-main',layers:[
            layer('live-logo','image','Logo fixture',{src:liveFixtureMedia['alpha-static.png']}),
            layer('live-camera','capture','Camera unavailable',{inputId:''})]},
          {id:'live-holding',name:'Holding',compositionId:'composition-main',layers:[
            layer('live-black','color','Black',{color:'#000000'}),
            layer('live-missing','image','Missing image',{src:'file:///showslate-test-missing/image.png'})]}
        ];
        S.activeSceneId='live-opening'; selectedLayerId='live-title';
        cues=migrateCues([{id:'live-cue',name:'Opening cue',durationMs:600000,status:'live'},{id:'next-cue',name:'Next cue',durationMs:600000,status:'pending'}]);
        currentCue=0; selectedCue=1; S.currentCue=0; S.cues=cloneState(cues);
        ensureScenes(); programState=cloneState(S); normalizeContentWorkflow({items:[]});
        liveModePreferences=PTLIVE.normalizePreferences({triggerMode:'preview',transition:'cut'});
        monitorSceneKeys={pv:'',pg:''}; stageKeys={pv:'',pg:''}; lastKey='';
        renderCues(); renderScenesUI(); renderStage('pv',S,Date.now()); renderStage('pg',programState,Date.now());
        setConferenceLiveMode(true);
      };
      window.timerCueSnapshot=()=>JSON.stringify({running:S.running,remMs:S.remMs,endAt:S.endAt,startAt:S.startAt,currentCue,selectedCue,cues});
      installLiveFixture();
    `);
    await waitFor(`['live-photo','live-logo','live-video','live-video-alpha'].every(id=>{const image=document.querySelector('.live-mode-clip[data-layer-id="'+id+'"] .live-mode-clip-thumb img');return image?.complete&&image.naturalWidth>0;})`);
    check('LIVE_MODE_HIDDEN_MUTED_NO_CAPTURE_OK', !win.isVisible() && win.webContents.isAudioMuted() && captureRequests === 0, { visible: win.isVisible(), muted: win.webContents.isAudioMuted(), captureRequests });
    fs.mkdirSync(artifacts, { recursive: true });

    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 700 }, { width: 900, height: 600 }]) {
      win.setContentSize(viewport.width, viewport.height);
      await waitFor(`innerWidth===${viewport.width}&&innerHeight===${viewport.height}`);
      await pause(180);
      fs.writeFileSync(path.join(artifacts, `${phase}-${viewport.width}x${viewport.height}.png`), (await win.webContents.capturePage()).toPNG());
      const layout = await evaluate(`
        const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
        const thumbs=[...document.querySelectorAll('.live-mode-clip-thumb')].map(node=>({id:node.closest('.live-mode-clip').dataset.layerId,...rect(node),gridRow:getComputedStyle(node).gridRow,text:node.textContent}));
        const buttons=['liveModeTakeClip','liveModeHideClip','liveModeTakeScene','liveModeBlack','liveModeCueGo'].map(id=>({id,...rect(document.getElementById(id))}));
        const workspace=rect(document.getElementById('liveModeWorkspace'));
        return {width:innerWidth,height:innerHeight,thumbs,buttons,workspace,overflow:document.documentElement.scrollWidth>innerWidth+1};
      `);
      check(`LIVE_MODE_THUMBNAILS_${viewport.width}_OK`, layout.thumbs.length === 9 && layout.thumbs.every(thumb => thumb.height > 35 && thumb.width > 60 && thumb.gridRow.startsWith('1')), layout.thumbs);
      check(`LIVE_MODE_CONTROLS_${viewport.width}_OK`, !layout.overflow && layout.buttons.every(button => button.width > 20 && button.height >= 24 && button.left >= 0 && button.right <= layout.width + 1 && button.top >= 0 && button.bottom <= layout.height + 1), layout);
    }

    const decode = await evaluate(`
      const result={};
      for(const id of ['live-photo','live-logo','live-video','live-video-alpha']){
        const image=document.querySelector('.live-mode-clip[data-layer-id="'+id+'"] .live-mode-clip-thumb img');
        result[id]={complete:!!image?.complete,width:image?.naturalWidth||0,height:image?.naturalHeight||0,source:image?.currentSrc?.slice(0,30)||''};
      }
      return result;
    `);
    check('LIVE_MODE_REAL_IMAGE_VIDEO_DECODE_OK', Object.values(decode).every(row => row.complete && row.width > 0 && row.height > 0), decode);
    const missing = await evaluate(`
      const thumb=document.querySelector('.live-mode-clip[data-layer-id="live-missing"] .live-mode-clip-thumb');
      const fallback=thumb.querySelector('.live-mode-thumb-fallback');
      return {text:fallback?.textContent.trim()||thumb.textContent.trim(),state:thumb.dataset.thumbnailState,fallbackVisible:!!fallback&&!fallback.hidden&&getComputedStyle(fallback).display!=='none',imageHidden:!!thumb.querySelector('img')?.hidden};
    `);
    check('LIVE_MODE_MISSING_IMAGE_READABLE_FALLBACK_OK', missing.state === 'error' && missing.text.length > 3 && missing.fallbackVisible && missing.imageHidden, missing);
    const thumbnailTypes = await evaluate(`
      const text=document.querySelector('.live-mode-clip[data-layer-id="live-title"] .live-mode-clip-thumb');
      const timer=document.querySelector('.live-mode-clip[data-layer-id="live-timer"] .live-mode-clip-thumb');
      const capture=document.querySelector('.live-mode-clip[data-layer-id="live-camera"] .live-mode-clip-thumb');
      const blank=document.querySelector('.live-mode-clip[data-layer-id="live-black"] .live-mode-clip-thumb');
      return {text:text.textContent.trim(),timer:timer.textContent.trim(),capture:capture.textContent.trim(),captureState:capture.dataset.thumbnailState,blankBackground:getComputedStyle(blank).backgroundColor};
    `);
    check('LIVE_MODE_TEXT_TIMER_LIVE_BLANK_THUMBNAILS_OK', thumbnailTypes.text.includes('SHOWSLATE LIVE') && thumbnailTypes.timer.includes('9:23') && thumbnailTypes.capture.includes('Camera unavailable') && ['unavailable','fallback'].includes(thumbnailTypes.captureState) && thumbnailTypes.blankBackground === 'rgb(0, 0, 0)', thumbnailTypes);
    const selection = await evaluate(`
      const program=JSON.stringify(programState),timer=timerCueSnapshot();
      document.querySelector('.live-mode-clip[data-layer-id="live-video"]').click();
      return {programUnchanged:program===JSON.stringify(programState),timerUnchanged:timer===timerCueSnapshot(),scene:S.activeSceneId,layer:selectedLayerId};
    `);
    check('LIVE_MODE_PREVIEW_SELECTION_ISOLATED_OK', selection.programUnchanged && selection.timerUnchanged && selection.scene === 'live-film' && selection.layer === 'live-video', selection);
    const takeClip = await evaluate(`
      const before=activeScene(programState),timer=timerCueSnapshot();
      const untouched=cloneState(before.layers.find(row=>row.id==='live-title'));
      document.getElementById('liveModeTakeClip').click();
      const after=activeScene(programState),clip=liveModeProgramLayer(selectedLayer(),S.activeSceneId);
      const retained=after.layers.find(row=>row.id==='live-title');
      return {timerUnchanged:timer===timerCueSnapshot(),scenePreserved:after.id==='live-opening',clipLive:!!clip,source:clip?.programSourceLayerId,row:clip?.programLiveRow,replacedBack:!after.layers.some(row=>row.id==='live-photo'),othersUnchanged:!!retained&&Object.keys(untouched).every(key=>JSON.stringify(untouched[key])===JSON.stringify(retained[key])),count:after.layers.length};
    `);
    check('LIVE_MODE_TAKE_CLIP_REPLACES_ONLY_ITS_ROW_OK', takeClip.timerUnchanged && takeClip.scenePreserved && takeClip.clipLive && takeClip.source === 'live-video' && takeClip.row === 1 && takeClip.replacedBack && takeClip.othersUnchanged && takeClip.count === 2, takeClip);
    const columnTake = await evaluate(`
      const timer=timerCueSnapshot();
      document.querySelector('.live-mode-scene-take[data-scene-id="live-countdown"]').click();
      const scene=activeScene(programState);
      return {timerUnchanged:timer===timerCueSnapshot(),scene:scene.id,layers:scene.layers.map(row=>({id:row.id,persistent:row.livePersistent,source:row.programSourceSceneId})),countdown:scene.layers.some(row=>row.id==='live-timer'),persistent:scene.layers.some(row=>row.id==='live-title'&&row.livePersistent)};
    `);
    check('LIVE_MODE_COLUMN_TAKE_RESPECTS_PINNED_ROW_OK', columnTake.timerUnchanged && columnTake.scene === 'live-countdown' && !columnTake.countdown && columnTake.persistent, columnTake);

    const explicitReplace = await evaluate(`
      document.querySelector('.live-mode-clip[data-layer-id="live-timer"]').click();
      document.getElementById('liveModeTakeClip').click();
      document.getElementById('liveModeTakeClip').click();
      const scene=activeScene(programState);
      return {layers:scene.layers.map(row=>row.id),count:scene.layers.length,timer:!!liveModeProgramLayer(selectedLayer(),S.activeSceneId),pinRemoved:!scene.layers.some(row=>row.id==='live-title')};
    `);
    check('LIVE_MODE_EXPLICIT_TAKE_REPLACES_PIN_WITHOUT_DUPLICATE_OK', explicitReplace.count === 1 && explicitReplace.timer && explicitReplace.pinRemoved, explicitReplace);

    const hideClip = await evaluate(`
      installLiveFixture();
      document.querySelector('.live-mode-clip[data-layer-id="live-video"]').click();
      document.getElementById('liveModeTakeClip').click();
      const preview=JSON.stringify(S),timer=timerCueSnapshot();
      document.getElementById('liveModeHideClip').click();
      const scene=activeScene(programState);
      return {previewUnchanged:preview===JSON.stringify(S),timerUnchanged:timer===timerCueSnapshot(),selectedNotLive:!liveModeProgramLayer(selectedLayer(),S.activeSceneId),otherVisible:scene.layers.some(row=>row.id==='live-title'&&row.visible!==false),disabled:document.getElementById('liveModeHideClip').disabled};
    `);
    check('LIVE_MODE_HIDE_CLIP_PRESERVES_PREVIEW_AND_OTHER_ROW_OK', hideClip.previewUnchanged && hideClip.timerUnchanged && hideClip.selectedNotLive && hideClip.otherVisible && hideClip.disabled, hideClip);

    const crossColumnPin = await evaluate(`
      installLiveFixture();
      const scene=S.activeSceneId,layer=selectedLayerId,program=JSON.stringify(programState),timer=timerCueSnapshot();
      const checkbox=document.querySelector('.live-mode-persistent input[data-layer-id="live-logo"]');
      checkbox.checked=true; checkbox.dispatchEvent(new Event('change',{bubbles:true}));
      return {selectionUnchanged:scene===S.activeSceneId&&layer===selectedLayerId,programUnchanged:program===JSON.stringify(programState),timerUnchanged:timer===timerCueSnapshot(),pinned:S.scenes.find(row=>row.id==='live-sources').layers.find(row=>row.id==='live-logo').livePersistent};
    `);
    check('LIVE_MODE_CROSS_COLUMN_PIN_PRESERVES_SELECTION_OK', crossColumnPin.selectionUnchanged && crossColumnPin.programUnchanged && crossColumnPin.timerUnchanged && crossColumnPin.pinned, crossColumnPin);

    const direct = await evaluate(`
      installLiveFixture(); document.getElementById('liveModeDirect').click();
      const program=JSON.stringify(programState),timer=timerCueSnapshot();
      document.querySelector('.live-mode-clip[data-layer-id="live-video-alpha"] strong').click();
      const footerSafe=program===JSON.stringify(programState),selected=selectedLayerId==='live-video-alpha';
      document.querySelector('.live-mode-clip[data-layer-id="live-video-alpha"] .live-mode-clip-thumb').click();
      const scene=activeScene(programState);
      return {footerSafe,selected,triggered:!!liveModeProgramLayer(selectedLayer(),S.activeSceneId),replacedPin:!scene.layers.some(row=>row.id==='live-title'),backPreserved:scene.layers.some(row=>row.id==='live-photo'),timerUnchanged:timer===timerCueSnapshot(),warning:document.getElementById('liveModeSafety').classList.contains('direct')};
    `);
    check('LIVE_MODE_DIRECT_FOOTER_SELECTS_THUMBNAIL_TRIGGERS_OK', direct.footerSafe && direct.selected && direct.triggered && direct.replacedPin && direct.backPreserved && direct.timerUnchanged && direct.warning, direct);

    await evaluate(`installLiveFixture();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));document.querySelector('.live-mode-clip[data-layer-id="live-video"]').focus();window.liveKeyboardBefore=timerCueSnapshot();`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await pause(100);
    const keyboard = await evaluate(`return {timerUnchanged:liveKeyboardBefore===timerCueSnapshot(),running:S.running,scene:S.activeSceneId,layer:selectedLayerId,focus:document.activeElement?.className,focusLayer:document.activeElement?.dataset.layerId};`);
    check('LIVE_MODE_SPACE_SELECTS_WITHOUT_TIMER_START_OK', keyboard.timerUnchanged && !keyboard.running && keyboard.scene === 'live-film' && keyboard.layer === 'live-video', keyboard);
    check('LIVE_MODE_DECK_FOCUS_SURVIVES_SELECTION_OK', keyboard.focusLayer === 'live-video', keyboard);
    await evaluate(`window.liveArrowBefore={timer:timerCueSnapshot(),program:JSON.stringify(programState),scene:S.activeSceneId,layer:selectedLayerId};`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
    await pause(80);
    const arrow = await evaluate(`return {timerUnchanged:liveArrowBefore.timer===timerCueSnapshot(),programUnchanged:liveArrowBefore.program===JSON.stringify(programState),selectionUnchanged:liveArrowBefore.scene===S.activeSceneId&&liveArrowBefore.layer===selectedLayerId,focusMoved:document.activeElement?.dataset.layerId!=='live-video',focus:document.activeElement?.dataset.layerId};`);
    check('LIVE_MODE_ARROWS_MOVE_FOCUS_ONLY_OK', arrow.timerUnchanged && arrow.programUnchanged && arrow.selectionUnchanged && arrow.focusMoved && Boolean(arrow.focus), arrow);

    const duplicateTake = await evaluate(`
      installLiveFixture();
      const video=(id,name,src)=>({id,type:'video',name,src,muted:true,audioEnabled:false,visible:true,x:0,y:0,w:100,h:100,opacity:1,playbackState:'paused',playbackPosition:0});
      S.scenes=[
        {id:'duplicate-a',name:'Video A',compositionId:'composition-main',layers:[video('shared-video','Original back video',liveFixtureMedia['opaque-h264.mp4']),video('front-a','Original front video',liveFixtureMedia['alpha-vp8.webm'])]},
        {id:'duplicate-b',name:'Video B',compositionId:'composition-main',layers:[video('back-b','Alternative back video',liveFixtureMedia['opaque-h264.mp4']),video('shared-video','New front video',liveFixtureMedia['alpha-vp8.webm'])]},
        {id:'duplicate-c',name:'Video C',compositionId:'composition-main',layers:[video('shared-video','Untriggered video',liveFixtureMedia['opaque-h264.mp4'])]}
      ];
      S.activeSceneId='duplicate-a';selectedLayerId='front-a';ensureScenes();programState=cloneState(S);normalizeContentWorkflow({items:[]});renderScenesUI();renderLiveModeWorkspace();
      selectLiveModeClip('duplicate-b','shared-video');
      const timer=timerCueSnapshot();takeLiveModeClip();
      const rows=activeScene(programState).layers;
      const selected=findProgramLayer(selectedLayer());
      return {timerUnchanged:timer===timerCueSnapshot(),count:rows.length,uniqueIds:new Set(rows.map(row=>row.id)).size===rows.length,original:rows.some(row=>row.programSourceSceneId==='duplicate-a'&&row.programSourceLayerId==='shared-video'&&row.programLiveRow===1),selectedScene:selected?.programSourceSceneId,selectedId:selected?.id,selectedRow:selected?.programLiveRow,ids:rows.map(row=>row.id)};
    `);
    check('LIVE_MODE_DUPLICATE_SOURCE_IDS_HAVE_UNIQUE_RUNTIME_IDS_OK', duplicateTake.timerUnchanged && duplicateTake.count === 2 && duplicateTake.uniqueIds && duplicateTake.original && duplicateTake.selectedScene === 'duplicate-b' && duplicateTake.selectedRow === 0 && duplicateTake.selectedId !== 'shared-video', duplicateTake);

    const transport = await evaluate(`
      const rows=activeScene(programState).layers;
      rows.forEach(row=>{row.playbackState='playing';row.playbackPosition=.1;row.playbackUpdatedAt=Date.now();});
      const other=rows.find(row=>row.programSourceSceneId==='duplicate-a'),beforeOther=JSON.stringify(other),beforePreview=JSON.stringify(selectedLayer()),timer=timerCueSnapshot();
      document.getElementById('liveModeTargetProgram').click();
      const target=videoTargetRows().map(row=>({kind:row.kind,source:row.layer.programSourceSceneId}));
      document.getElementById('liveModePause').click();
      const selected=findProgramLayer(selectedLayer());
      return {target,paused:selected?.playbackState==='paused',otherUnchanged:beforeOther===JSON.stringify(other),previewUnchanged:beforePreview===JSON.stringify(selectedLayer()),timerUnchanged:timer===timerCueSnapshot(),otherState:other.playbackState};
    `);
    check('LIVE_MODE_PROGRAM_TRANSPORT_IS_SOURCE_SCOPED_OK', transport.target.length === 1 && transport.target[0].kind === 'program' && transport.target[0].source === 'duplicate-b' && transport.paused && transport.otherUnchanged && transport.previewUnchanged && transport.timerUnchanged && transport.otherState === 'playing', transport);

    const duplicatePreview = await evaluate(`
      const before=JSON.stringify(programState);selectLiveModeClip('duplicate-c','shared-video');
      return {programUnchanged:before===JSON.stringify(programState),notLive:!findProgramLayer(selectedLayer()),targetDisabled:document.getElementById('liveModeTargetProgram').disabled,hideDisabled:document.getElementById('liveModeHideClip').disabled,previewTarget:videoTransportTarget==='preview'};
    `);
    check('LIVE_MODE_DUPLICATE_ID_IN_UNTRIGGERED_SCENE_NOT_LIVE_OK', duplicatePreview.programUnchanged && duplicatePreview.notLive && duplicatePreview.targetDisabled && duplicatePreview.hideDisabled && duplicatePreview.previewTarget, duplicatePreview);

    const lowerThirdTake = await evaluate(`
      installLiveFixture();
      S.scenes.forEach(scene=>scene.layers.forEach(layer=>layer.livePersistent=false));
      programState.scenes.forEach(scene=>scene.layers.forEach(layer=>layer.livePersistent=false));
      const template=PTLT.makeTemplate({id:'live-deck-lt-template',name:'Live deck lower third',layers:[PTLT.makeDynamicTextLayer({id:'live-speaker-text',field:'speakerName'})]});
      ltLibrary={schemaVersion:1,activeTemplateId:template.id,templates:[template]};
      S.scenes.push({id:'live-lower-third-scene',name:'Speaker graphic',compositionId:'composition-main',layers:[
        {id:'live-lt-background',type:'color',name:'Background',color:'#101216',visible:true,x:0,y:0,w:100,h:100},
        {id:'live-lt-source',type:'lowerThird',name:'Speaker graphic',templateId:template.id,dataMode:'manual',speakerName:'Live speaker',speakerTitle:'Host',speakerMeta:'ShowSlate',durationSec:0,livePersistent:true,visible:true,x:0,y:0,w:100,h:100}
      ]});
      ensureScenes();normalizeContentWorkflow({items:[]});renderScenesUI();renderLiveModeWorkspace();
      const timer=timerCueSnapshot();takeLiveModeScene('live-lower-third-scene');
      window.liveLowerThirdBefore=JSON.stringify(programState.lowerThird);
      return {timerUnchanged:timer===timerCueSnapshot(),visible:programState.lowerThird.visible,version:programState.lowerThird.runtimeVersion,speaker:programState.lowerThird.runtime?.resolvedLayers?.find(row=>row.sourceField==='speakerName')?.resolvedText,template:programState.lowerThird.runtime?.templateId,source:activeScene(programState).layers.find(row=>row.id==='live-lt-source')?.livePersistent,isLiveRuntime:programState.lowerThird.runtime?.preview===false};
    `);
    check('LIVE_MODE_SCENE_TAKE_INITIALIZES_CANONICAL_LOWER_THIRD_OK', lowerThirdTake.timerUnchanged && lowerThirdTake.visible && lowerThirdTake.version === 1 && lowerThirdTake.speaker === 'Live speaker' && lowerThirdTake.template === 'live-deck-lt-template' && lowerThirdTake.source && lowerThirdTake.isLiveRuntime, lowerThirdTake);

    const pinnedLowerThird = await evaluate(`
      const timer=timerCueSnapshot();takeLiveModeScene('live-countdown');
      const pinned=activeScene(programState).layers.find(row=>row.programSourceSceneId==='live-lower-third-scene'&&row.programSourceLayerId==='live-lt-source');
      return {timerUnchanged:timer===timerCueSnapshot(),canonicalUnchanged:liveLowerThirdBefore===JSON.stringify(programState.lowerThird),visible:programState.lowerThird.visible,pinned:!!pinned&&pinned.livePersistent,sourceId:pinned?.id};
    `);
    check('LIVE_MODE_PINNED_LOWER_THIRD_CONTINUES_WITHOUT_RESTART_OK', pinnedLowerThird.timerUnchanged && pinnedLowerThird.canonicalUnchanged && pinnedLowerThird.visible && pinnedLowerThird.pinned, pinnedLowerThird);

    const replacedLowerThird = await evaluate(`
      selectLiveModeClip('live-countdown','live-timer');takeLiveModeClip();
      return {hidden:!programState.lowerThird.visible,noRuntime:!programState.lowerThird.runtime,noLowerThird:!activeScene(programState).layers.some(row=>row.type==='lowerThird'),timerLive:!!liveModeProgramLayer(selectedLayer(),S.activeSceneId)};
    `);
    check('LIVE_MODE_REPLACING_PINNED_LOWER_THIRD_CLEARS_RUNTIME_OK', replacedLowerThird.hidden && replacedLowerThird.noRuntime && replacedLowerThird.noLowerThird && replacedLowerThird.timerLive, replacedLowerThird);
    await evaluate(`installLiveFixture();`);
    check('LIVE_MODE_NO_CAPTURE_ACQUISITION_OK', captureRequests === 0, { captureRequests, publishedStates: states.length });
    console.log(`LIVE_MODE_RENDERER_TESTS_${failures.length ? 'FAILED' : 'OK'} count=${checks} failures=${JSON.stringify(failures)}`);
    win.destroy();
    fs.rmSync(profile, { recursive: true, force: true });
    app.exit(failures.length ? 1 : 0);
  }).catch(error => {
    console.error(error && error.stack || error);
    if (win && !win.isDestroyed()) win.destroy();
    fs.rmSync(profile, { recursive: true, force: true });
    app.exit(1);
  });
}
