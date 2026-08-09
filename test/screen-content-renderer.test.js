const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ShowRepository } = require('../src/show-storage/repository.js');
const smokeDisplay = require('../tools/smoke-display.js');

const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'showslate-screen-content-'));
const artifactDirectory = path.join(root, 'artifacts', 'generated', 'screen-content');
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

function displays() {
  return [target].filter(Boolean).map(display => ({
    id: display.id, label: display.label, width: display.bounds.width, height: display.bounds.height,
    primary: display.id === screen.getPrimaryDisplay().id, hasControl: display.id === target.id, hasOutput: false
  }));
}

ipcMain.on('state', () => {});
ipcMain.on('close-output', () => {});
ipcMain.on('set-output-configs', () => {});
ipcMain.on('ctl-on-top', () => {});
ipcMain.on('fit-window', () => {});
ipcMain.handle('displays', displays);
ipcMain.handle('output-open', () => false);
ipcMain.handle('output-configs', () => []);
ipcMain.handle('network-info', () => ({ running: true, ip: '127.0.0.1', port: 7878, oscPort: 7879, token: 'test-token' }));
ipcMain.handle('build-info', () => ({ version: 'test', commit: 'screen-content-test', isPackaged: false }));
ipcMain.handle('show-storage-status', () => ({ ...repository.getStatus(), autosaveEnabled: true }));
ipcMain.handle('show-storage-save', (event, payload) => repository.save(payload.document, { reason: payload.reason }));
ipcMain.handle('show-storage-load-current', () => repository.loadCurrent());
ipcMain.handle('show-storage-recover', (event, choice) => repository.resolveRecovery(choice));
ipcMain.handle('show-preflight-inspect', () => ({ overall: 'warning', checks: [], counts: { ok: 0, warning: 1, blocking: 0 } }));
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
  repository = new ShowRepository({ userDataDir: profile, appMetadata: { commit: 'screen-content-test' } });
  await repository.initializeSession({ track: false });
  target = smokeDisplay.resolveTargetDisplay(screen, { root }).display;
  check('SCREEN_CONTENT_TARGET_DISPLAY_OK', !!target, target ? target.label : 'missing');
  const win = new BrowserWindow({
    ...smokeDisplay.clampToWorkArea({ width: 1280, height: 800 }, target.workArea), show: true, backgroundColor: '#0b0c0f',
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  await win.loadFile(path.join(root, 'controller.html'));
  if (!await waitFor(() => win.webContents.executeJavaScript('showAutosaveReady===true && lastDisplays.length>0'))) throw new Error('controller did not initialize');

  const state = JSON.parse(await win.webContents.executeJavaScript(`(async function(){
    S.scenes=[]; contentItems=[]; selectedContentItemId=''; liveContentItemId=''; programState=null;
    const timer=addContentScene('Event Timer','timer',[makeTimerLayer()]);
    const holding=addContentScene('Welcome','text',[{id:makeId('layer'),type:'text',name:'Welcome',text:'WELCOME',color:'#ffffff',bg:'transparent',fontSize:10,visible:true,fit:'contain',x:4,y:4,w:92,h:92,opacity:1}]);
    const deck=addContentScene('Sponsor Deck','pdf',[{id:makeId('layer'),type:'pdf',name:'Sponsor Deck',src:'media://test-deck.pdf',page:1,visible:true,fit:'contain',x:0,y:0,w:100,h:100,opacity:1}],{assetId:'media://test-deck.pdf',page:1});
    selectContentItem(timer.id); liveContentItemId=timer.id; programState=outputSnapshot(S);
    cues=[]; currentCue=-1; selectedCue=-1; renderCues();
    document.getElementById('btnCueNew').click();
    const newEditorVisible=document.querySelector('.card-rundown').classList.contains('edit-open') && cueEditorMode==='new' && !document.getElementById('btnCueAdd').hidden;
    document.getElementById('cueName').value='Welcome cue';
    document.getElementById('cueDur').value='1:00';
    document.getElementById('cueContentItem').value=holding.id;
    document.getElementById('cueContentItem').dispatchEvent(new Event('change',{bubbles:true}));
    S.studioDirect=true;
    document.getElementById('btnCuePreviewScene').click();
    const previewButtonSafe=programState.activeSceneId===timer.sceneId && S.activeSceneId===holding.sceneId && liveContentItemId===timer.id;
    S.studioDirect=false;
    document.getElementById('btnCueAdd').click();
    const cueRow=document.querySelector('#cueList .cue');
    const cueCreated=cues.length===1 && selectedCue===0 && cues[0].name==='Welcome cue' && cues[0].contentItemId===holding.id && cues[0].autoTakeContentOnGo===true && cueEditorMode==='edit' && document.getElementById('btnCueAdd').hidden && !document.getElementById('btnCueSave').hidden && cueRow?.querySelector('.cue-scene-link')?.textContent.includes('Welcome');
    document.getElementById('btnGo').click();
    const cueGoWorked=currentCue===0 && programState.activeSceneId===holding.sceneId && liveContentItemId===holding.id;
    S.running=false; S.endAt=0; currentCue=-1; selectedCue=-1; cues=[]; S.activeSceneId=timer.sceneId; selectedContentItemId=timer.id; liveContentItemId=timer.id; programState=outputSnapshot(S); setCueEditorOpen(false); renderCues();
    const rundownSceneFlow=newEditorVisible && previewButtonSafe && cueCreated && cueGoWorked;
    const slidesTab=document.getElementById('btnSidebarSlides');
    const slidesTabVisible=!!slidesTab && slidesTab.getClientRects().length>0;
    if(slidesTabVisible) slidesTab.click();
    renderContentItems();
    const sceneRows=[...document.querySelectorAll('#slidesList .slide-row')];
    const sceneUi={
      tab:slidesTab.textContent.trim(),
      rows:sceneRows.length,
      thumbnails:sceneRows.filter(row=>row.querySelector('.slide-thumb .scene-thumb-layer')).length,
      newScene:!!document.getElementById('btnSceneLibraryNew')?.getClientRects().length,
      duplicate:!!document.getElementById('btnSceneLibraryDuplicate')?.getClientRects().length,
      rename:!!document.getElementById('btnSceneLibraryRename')?.getClientRects().length,
      take:document.getElementById('btnSlideTake')?.textContent.trim(),
      cut:document.getElementById('btnSlideClear')?.textContent.trim()
    };
    const normalUi=slidesTabVisible && document.getElementById('sidebarSlidesPane').classList.contains('active') && sceneUi.tab==='SCENES' && sceneUi.rows===3 && sceneUi.thumbnails===3 && sceneUi.newScene && sceneUi.duplicate && sceneUi.rename && sceneUi.take==='TAKE' && sceneUi.cut==='CUT';
    selectContentItem(holding.id);
    const selectedSafe=programState.activeSceneId===timer.sceneId && S.activeSceneId===holding.sceneId && liveContentItemId===timer.id;
    await new Promise(resolve=>setTimeout(resolve,120));
    const previewText=document.querySelector('#pvScene .pv-scene-text');
    const previewRendered=!!previewText && previewText.textContent==='WELCOME' && getComputedStyle(previewText).display!=='none' && getComputedStyle(document.getElementById('pvStage')).display==='none';
    startPause(); startPause();
    const timerSafe=programState.activeSceneId===timer.sceneId && liveContentItemId===timer.id;
    takeSelectedContent('cut');
    const takeWorked=programState.activeSceneId===holding.sceneId && liveContentItemId===holding.id;
    selectContentItem(deck.id); changeSelectedPdfPage(1); renderStage('pv',S,Date.now());
    const canonicalDeck=contentItemById(deck.id);
    const deckLayer=sceneForContent(canonicalDeck).layers.find(layer=>layer.type==='pdf');
    const deckFrame=document.querySelector('#pvScene iframe');
    const pageWorked=canonicalDeck.page===2 && deckLayer.page===2 && !!deckFrame && deckFrame.src.endsWith('#page=2');
    S.studioDirect=true; selectContentItem(timer.id);
    const directWorked=programState.activeSceneId===timer.sceneId && liveContentItemId===timer.id;
    S.studioDirect=false; selectContentItem(deck.id);
    cues=migrateCues([{id:'content-cue',name:'Sponsor segment',durationMs:60000,contentItemId:deck.id,autoTakeContentOnGo:true}]);
    currentCue=-1; selectedCue=0; saveCues(); renderCues();
    goLiveWithCue(0,{autostart:false});
    const goWorked=currentCue===0 && programState.activeSceneId===deck.sceneId && liveContentItemId===deck.id;
    clearLiveContent();
    renderStage('pg',programState,Date.now());
    const clearWorked=liveContentItemId==='' && programState.activeSceneId==='scene-content-clear' && document.getElementById('pgScene').textContent.trim()==='';
    const saved=await flushShowAutosave({reason:'screen-content-test',force:true});
    return JSON.stringify({normalUi,sceneUi,rundownSceneFlow,selectedSafe,previewRendered,timerSafe,takeWorked,directWorked,pageWorked,goWorked,clearWorked,saved,ids:{timer:timer.id,holding:holding.id,deck:deck.id}});
  })()`));
  win.webContents.reload();
  const reloadReady = await waitFor(() => win.webContents.executeJavaScript('showAutosaveReady===true && lastDisplays.length>0'));
  const reloadState = reloadReady ? JSON.parse(await win.webContents.executeJavaScript(`(async()=>{
    const item=contentItemById(${JSON.stringify(state.ids.holding)});
    if(!item) return JSON.stringify({item:false,previewRendered:false});
    selectContentItem(item.id);
    await new Promise(resolve=>setTimeout(resolve,120));
    const previewText=document.querySelector('#pvScene .pv-scene-text');
    return JSON.stringify({
      item:true,
      previewRendered:!!previewText && previewText.textContent==='WELCOME' && getComputedStyle(previewText).display!=='none' && getComputedStyle(document.getElementById('pvStage')).display==='none'
    });
  })()`)) : {item:false,previewRendered:false};
  check('SCREEN_CONTENT_VISIBLE_IN_STANDARD_UI_OK', state.normalUi, JSON.stringify(state));
  check('RUNDOWN_SCENE_ON_GO_USER_FLOW_OK', state.rundownSceneFlow, JSON.stringify(state));
  check('SCREEN_CONTENT_SELECT_PREVIEW_ONLY_OK', state.selectedSafe && state.timerSafe, JSON.stringify(state));
  check('SCREEN_CONTENT_SCENE_CARD_RENDERS_PREVIEW_OK', state.previewRendered && reloadReady && reloadState.previewRendered, JSON.stringify({state,reloadReady,reloadState}));
  check('SCREEN_CONTENT_DIRECT_PROGRAM_SCENE_SELECT_OK', state.directWorked, JSON.stringify(state));
  check('SCREEN_CONTENT_TAKE_AND_CLEAR_OK', state.takeWorked && state.clearWorked, JSON.stringify(state));
  check('SCREEN_CONTENT_PDF_DECK_NAV_OK', state.pageWorked, JSON.stringify(state));
  check('SCREEN_CONTENT_CUE_AUTO_TAKE_ON_GO_OK', state.goWorked, JSON.stringify(state));
  check('SCREEN_CONTENT_AUTOSAVE_OK', state.saved && state.saved.ok, JSON.stringify(state.saved));

  await new Promise(resolve => setTimeout(resolve, 160));
  fs.mkdirSync(artifactDirectory, { recursive: true });
  fs.writeFileSync(path.join(artifactDirectory, 'scenes-1280x800.png'), (await win.webContents.capturePage()).toPNG());
  win.setBounds(smokeDisplay.clampToWorkArea({ width: 900, height: 600 }, target.workArea));
  if (!await waitFor(() => win.webContents.executeJavaScript('innerWidth===900 && innerHeight>=560'))) {
    throw new Error('900x600 viewport did not settle');
  }
  const layout = JSON.parse(await win.webContents.executeJavaScript(`(async()=>{
    const visible=element=>!!element&&element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden';
    const nav=document.getElementById('btnRundownDrawer');
    const slides=document.getElementById('btnSidebarSlides');
    const navAvailable=visible(nav);
    const sidebar=document.getElementById('primarySidebar');
    const initialSidebar=sidebar.getBoundingClientRect();
    const initialStyle=getComputedStyle(sidebar);
    const initial={left:initialSidebar.left,right:initialSidebar.right,opacity:initialStyle.opacity,pointerEvents:initialStyle.pointerEvents,transform:initialStyle.transform};
    let navClicked=false;
    if(navAvailable && (initialSidebar.left<0 || initialSidebar.right>innerWidth || initialStyle.pointerEvents==='none')){ nav.click(); navClicked=true; }
    const afterNavClass=document.body.className;
    const started=Date.now();
    while(Date.now()-started<1600 && !visible(slides)) await new Promise(resolve=>setTimeout(resolve,25));
    const slidesAvailable=visible(slides);
    if(slidesAvailable) slides.click();
    const afterSlidesClass=document.body.className;
    const panelElement=document.getElementById('sidebarSlidesPane');
    const settledStarted=Date.now();
    while(Date.now()-settledStarted<1600){
      const rect=panelElement.getBoundingClientRect();
      if(rect.x>=0 && rect.right<=innerWidth+1) break;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    const panel=panelElement.getBoundingClientRect();
    const foot=document.querySelector('.slides-foot').getBoundingClientRect();
    const tabs=document.querySelector('.sidebar-view-tabs').getBoundingClientRect();
    const probeX=Math.max(1,Math.min(innerWidth-1,panel.left+Math.min(20,panel.width/2)));
    const probeY=Math.max(1,Math.min(innerHeight-1,panel.top+Math.min(80,panel.height/2)));
    const hit=document.elementFromPoint(probeX,probeY);
    const exposed=!!hit&&sidebar.contains(hit);
    const scrimStyle=getComputedStyle(document.getElementById('drawerScrim'));
    const scrimVisible=scrimStyle.display!=='none'&&scrimStyle.visibility!=='hidden';
    return JSON.stringify({navAvailable,navClicked,initial,afterNavClass,slidesAvailable,afterSlidesClass,active:document.getElementById('sidebarSlidesPane').classList.contains('active'),exposed,scrimVisible,hit:hit?.id||hit?.className||hit?.tagName||'',bodyClass:document.body.className,sidebarTransform:getComputedStyle(sidebar).transform,vw:innerWidth,vh:innerHeight,panel:{x:panel.x,y:panel.y,right:panel.right,bottom:panel.bottom},foot:{top:foot.top,bottom:foot.bottom},tabs:{top:tabs.top,bottom:tabs.bottom}});
  })()`));
  check('SCREEN_CONTENT_900X600_REACHABLE_OK', layout.navAvailable && layout.slidesAvailable && layout.active && layout.exposed && layout.scrimVisible && layout.panel.x >= 0 && layout.panel.right <= layout.vw + 1 && layout.tabs.top >= 0 && layout.foot.bottom <= layout.vh + 1, JSON.stringify(layout));
  await new Promise(resolve => setTimeout(resolve, 220));
  fs.writeFileSync(path.join(artifactDirectory, 'scenes-900x600.png'), (await win.webContents.capturePage()).toPNG());

  const disk = await repository.loadCurrent();
  check('SCREEN_CONTENT_FILE_ROUNDTRIP_OK', disk.ok && disk.document.show.screenContent.items.length === 3 && disk.document.show.rundown[0].autoTakeContentOnGo === true && disk.document.show.rundown[0].contentItemId === state.ids.deck);
  console.log('SCREEN_CONTENT_RENDERER_TESTS_OK ' + checks + '/12');
  win.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  app.quit();
}).catch(error => {
  console.error(error && error.stack || error);
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
