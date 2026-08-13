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
    const dragVisibleRow=(source,target,after=false)=>{
      const transfer={effectAllowed:'',dropEffect:'',setData(){},getData(){return '';}};
      const event=(type,clientY=0)=>{
        const value=new Event(type,{bubbles:true,cancelable:true});
        Object.defineProperty(value,'dataTransfer',{value:transfer});
        Object.defineProperty(value,'clientY',{value:clientY});
        return value;
      };
      source.dispatchEvent(event('dragstart'));
      const grabbed=source.classList.contains('dragging')&&source.getAttribute('aria-grabbed')==='true';
      const rect=target.getBoundingClientRect();
      const y=after?rect.bottom-1:rect.top+1;
      target.dispatchEvent(event('dragover',y));
      const marked=target.classList.contains(after?'drop-after':'drop-before');
      target.dispatchEvent(event('drop',y));
      source.dispatchEvent(event('dragend',y));
      return grabbed&&marked;
    };
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
    S.activeSceneId=timer.sceneId; selectedContentItemId=timer.id; liveContentItemId=timer.id; programState=outputSnapshot(S); selectedCue=-1; S.studioDirect=true; renderCues();
    document.querySelector('#cueList .cue').click();
    const rundownRowPreviewSafe=selectedCue===0 && S.activeSceneId===holding.sceneId && selectedContentItemId===holding.id && programState.activeSceneId===timer.sceneId && liveContentItemId===timer.id;
    S.studioDirect=false;
    document.getElementById('btnGo').click();
    const cueGoWorked=currentCue===0 && programState.activeSceneId===holding.sceneId && liveContentItemId===holding.id;
    S.running=false; S.endAt=0; currentCue=-1; selectedCue=-1; cues=[]; S.activeSceneId=timer.sceneId; selectedContentItemId=timer.id; liveContentItemId=timer.id; programState=outputSnapshot(S); setCueEditorOpen(false); renderCues();
    cues=migrateCues([
      {id:'sort-a',name:'First',durationMs:60000,contentItemId:timer.id},
      {id:'sort-b',name:'Second',durationMs:60000,contentItemId:holding.id},
      {id:'sort-c',name:'Third',durationMs:60000,contentItemId:deck.id}
    ]);
    currentCue=1; selectedCue=2; renderCues();
    const programBeforeCueReorder=programState.activeSceneId;
    const cueRows=[...document.querySelectorAll('#cueList .cue')];
    const cueDragged=dragVisibleRow(cueRows[2],cueRows[0],false);
    const cueReordered=cueDragged && cues.map(cue=>cue.id).join(',')==='sort-c,sort-a,sort-b' && cues[currentCue].id==='sort-b' && cues[selectedCue].id==='sort-c' && programState.activeSceneId===programBeforeCueReorder && [...document.querySelectorAll('#cueList .cue')].every(row=>row.draggable);
    selectedCue=currentCue; renderCues();
    const backPrepared=preparePreviousCue() && selectedCue===1 && S.activeSceneId===timer.sceneId && programState.activeSceneId===programBeforeCueReorder;
    cues=[]; currentCue=-1; selectedCue=-1; S.activeSceneId=timer.sceneId; selectedContentItemId=timer.id; renderCues();
    const rundownSceneFlow=newEditorVisible && previewButtonSafe && cueCreated && rundownRowPreviewSafe && cueGoWorked && cueReordered && backPrepared;
    const slidesTab=document.getElementById('btnSidebarSlides');
    const slidesTabVisible=!!slidesTab && slidesTab.getClientRects().length>0;
    if(slidesTabVisible) slidesTab.click();
    renderContentItems();
    const sceneRows=[...document.querySelectorAll('#slidesList .slide-row')];
    const sceneUi={
      tab:slidesTab.querySelector('[data-i18n]')?.textContent.trim(),
      rows:sceneRows.length,
      thumbnails:sceneRows.filter(row=>row.querySelector('.slide-thumb .scene-thumb-layer')).length,
      numbered:sceneRows.every((row,index)=>row.querySelector('.slide-index')?.textContent===String(index+1).padStart(2,'0')),
      metadata:sceneRows.every(row=>/source|layer/i.test(row.querySelector('.slide-meta')?.textContent||'')&&/1920×1080/.test(row.querySelector('.slide-meta')?.textContent||'')),
      newScene:!!document.getElementById('btnSceneLibraryNew')?.getClientRects().length,
      duplicate:!!document.getElementById('btnSceneLibraryDuplicate')?.getClientRects().length,
      rename:!!document.getElementById('btnSceneLibraryRename')?.getClientRects().length,
      oneTake:document.querySelectorAll('#btnTake').length===1&&!document.getElementById('btnSlideTake'),
      cutRemoved:!document.getElementById('btnSlideClear') && !document.getElementById('btnCut'),
      switcher:['btnTake','btnGo','btnBack','btnFadeBlack'].every(id=>document.getElementById(id)?.closest('.sidebar-live-controls .studio-switcher')),
      middleColumnRemoved:!document.querySelector('#studio > .studio-switcher'),
      monitorHeadersRemoved:document.querySelectorAll('.studio-monitor .monitor-head').length===0,
      screensFillMonitors:[...document.querySelectorAll('.studio-monitor')].every(monitor=>{
        const screen=monitor.querySelector('.monitor-screen');
        if(!screen)return false;
        const mr=monitor.getBoundingClientRect(),sr=screen.getBoundingClientRect();
        return Math.abs(mr.top-sr.top)<=2&&Math.abs(mr.bottom-sr.bottom)<=2;
      }),
      sortable:sceneRows.every(row=>row.draggable),
      rundownCount:document.getElementById('rundownTabCount')?.textContent,
      sceneCount:document.getElementById('scenesTabCount')?.textContent
    };
    const programBeforeSceneReorder=programState.activeSceneId;
    const deckRow=document.querySelector('#slidesList .slide-row[data-content-id="'+deck.id+'"]');
    const timerRow=document.querySelector('#slidesList .slide-row[data-content-id="'+timer.id+'"]');
    const sceneDragged=dragVisibleRow(deckRow,timerRow,false);
    const sceneReordered=sceneDragged && contentItems.map(item=>item.id).join(',')===[deck.id,timer.id,holding.id].join(',') && S.scenes[0].id===deck.sceneId && programState.activeSceneId===programBeforeSceneReorder;
    reorderContentItemById(deck.id,holding.id,true);
    const normalUi=slidesTabVisible && document.getElementById('sidebarSlidesPane').classList.contains('active') && sceneUi.tab==='SCENES' && sceneUi.rows===3 && sceneUi.thumbnails===3 && sceneUi.numbered && sceneUi.metadata && sceneUi.newScene && sceneUi.duplicate && sceneUi.rename && sceneUi.oneTake && sceneUi.cutRemoved && sceneUi.switcher && sceneUi.middleColumnRemoved && sceneUi.monitorHeadersRemoved && sceneUi.screensFillMonitors && sceneUi.sortable && sceneReordered && sceneUi.rundownCount==='0' && sceneUi.sceneCount==='3';
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
    renderContentItems();
    await new Promise(resolve=>setTimeout(resolve,280));
    document.querySelector('#slidesList .slide-row[data-content-id="'+holding.id+'"]').click();
    const sceneCardPreviewSafe=programState.activeSceneId===timer.sceneId && liveContentItemId===timer.id && S.activeSceneId===holding.sceneId && selectedContentItemId===holding.id;
    S.studioDirect=false; selectContentItem(deck.id);
    cues=migrateCues([{id:'content-cue',name:'Sponsor segment',durationMs:60000,contentItemId:deck.id,autoTakeContentOnGo:true}]);
    currentCue=-1; selectedCue=0; saveCues(); renderCues();
    goLiveWithCue(0,{autostart:false});
    const goWorked=currentCue===0 && programState.activeSceneId===deck.sceneId && liveContentItemId===deck.id;
    clearLiveContent();
    renderStage('pg',programState,Date.now());
    const clearWorked=liveContentItemId==='' && programState.activeSceneId==='scene-content-clear' && document.getElementById('pgScene').textContent.trim()==='';
    const saved=await flushShowAutosave({reason:'screen-content-test',force:true});
    return JSON.stringify({normalUi,sceneUi,sceneReordered,rundownSceneFlow,cueReordered,backPrepared,selectedSafe,previewRendered,timerSafe,takeWorked,directWorked,sceneCardPreviewSafe,pageWorked,goWorked,clearWorked,saved,ids:{timer:timer.id,holding:holding.id,deck:deck.id}});
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
  check('SCREEN_CONTENT_DIRECT_PROGRAM_SCENE_SELECT_OK', state.directWorked && state.sceneCardPreviewSafe, JSON.stringify(state));
  check('SCREEN_CONTENT_TAKE_AND_CLEAR_OK', state.takeWorked && state.clearWorked, JSON.stringify(state));
  check('SCREEN_CONTENT_PDF_DECK_NAV_OK', state.pageWorked, JSON.stringify(state));
  check('SCREEN_CONTENT_CUE_AUTO_TAKE_ON_GO_OK', state.goWorked, JSON.stringify(state));
  check('SCREEN_CONTENT_AUTOSAVE_OK', state.saved && state.saved.ok, JSON.stringify(state.saved));

  await new Promise(resolve => setTimeout(resolve, 160));
  fs.mkdirSync(artifactDirectory, { recursive: true });
  fs.writeFileSync(path.join(artifactDirectory, 'scenes-1280x800.png'), (await win.webContents.capturePage()).toPNG());
  const disk = await repository.loadCurrent();
  check('SCREEN_CONTENT_FILE_ROUNDTRIP_OK', disk.ok && disk.document.show.screenContent.items.length === 3 && disk.document.show.rundown[0].autoTakeContentOnGo === true && disk.document.show.rundown[0].contentItemId === state.ids.deck);
  await win.webContents.executeJavaScript(`(()=>{
    for(let index=4;index<=16;index++){
      S.scenes.push({id:'overflow-scene-'+index,name:'Event scene '+index,layers:[{id:'overflow-layer-'+index,type:'text',name:'Scene '+index,text:'SCENE '+index,color:'#ffffff',bg:'transparent',fontSize:9,visible:true,fit:'contain',x:5,y:5,w:90,h:90,opacity:1}]});
    }
    ensureScenes(); normalizeContentWorkflow();
    cues=migrateCues(Array.from({length:18},(_,index)=>({id:'overflow-cue-'+index,name:'Rundown item '+(index+1),durationMs:60000,note:'Scene '+((index%16)+1),contentItemId:contentItems[index%contentItems.length]?.id||'',autoTakeContentOnGo:false})));
    currentCue=-1; selectedCue=-1; renderCues(); renderContentItems();
  })()`);
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
    const sceneList=document.getElementById('slidesList');
    const sceneOverflow=getComputedStyle(sceneList).overflowY==='auto'&&sceneList.scrollHeight>sceneList.clientHeight+1;
    sceneList.scrollTop=sceneList.scrollHeight;
    const sceneScrolled=sceneList.scrollTop>0;
    document.getElementById('btnSidebarRundown').click();
    await new Promise(resolve=>setTimeout(resolve,50));
    const cueList=document.getElementById('cueList');
    const cueOverflow=getComputedStyle(cueList).overflowY==='auto'&&cueList.scrollHeight>cueList.clientHeight+1;
    cueList.scrollTop=cueList.scrollHeight;
    const cueScrolled=cueList.scrollTop>0;
    const cueRects=[...cueList.querySelectorAll('.cue')].map(row=>row.getBoundingClientRect());
    const cuesDoNotOverlap=cueRects.every((rect,index)=>index===0||cueRects[index-1].bottom<=rect.top+.5);
    document.getElementById('btnSidebarSlides').click();
    const probeX=Math.max(1,Math.min(innerWidth-1,panel.left+Math.min(20,panel.width/2)));
    const probeY=Math.max(1,Math.min(innerHeight-1,panel.top+Math.min(80,panel.height/2)));
    const hit=document.elementFromPoint(probeX,probeY);
    const exposed=!!hit&&sidebar.contains(hit);
    const scrimStyle=getComputedStyle(document.getElementById('drawerScrim'));
    const scrimVisible=scrimStyle.display!=='none'&&scrimStyle.visibility!=='hidden';
    const sidebarDocked=initialSidebar.left>=0&&initialSidebar.right<=innerWidth+1&&initialStyle.pointerEvents!=='none';
    return JSON.stringify({navAvailable,navClicked,initial,afterNavClass,slidesAvailable,afterSlidesClass,active:document.getElementById('sidebarSlidesPane').classList.contains('active'),exposed,scrimVisible,sidebarDocked,sceneOverflow,sceneScrolled,cueOverflow,cueScrolled,cuesDoNotOverlap,hit:hit?.id||hit?.className||hit?.tagName||'',bodyClass:document.body.className,sidebarTransform:getComputedStyle(sidebar).transform,vw:innerWidth,vh:innerHeight,panel:{x:panel.x,y:panel.y,right:panel.right,bottom:panel.bottom},foot:{top:foot.top,bottom:foot.bottom},tabs:{top:tabs.top,bottom:tabs.bottom}});
  })()`));
  check('SCREEN_CONTENT_900X600_REACHABLE_OK', layout.navAvailable && layout.slidesAvailable && layout.active && layout.exposed && (layout.sidebarDocked || layout.scrimVisible) && layout.sceneOverflow && layout.sceneScrolled && layout.cueOverflow && layout.cueScrolled && layout.cuesDoNotOverlap && layout.panel.x >= 0 && layout.panel.right <= layout.vw + 1 && layout.tabs.top >= 0 && layout.foot.bottom <= layout.vh + 1, JSON.stringify(layout));
  await new Promise(resolve => setTimeout(resolve, 220));
  fs.writeFileSync(path.join(artifactDirectory, 'scenes-900x600.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`(()=>{ document.getElementById('btnSidebarRundown').click(); document.getElementById('cueList').scrollTop=0; })()`);
  await new Promise(resolve => setTimeout(resolve, 160));
  fs.writeFileSync(path.join(artifactDirectory, 'rundown-900x600.png'), (await win.webContents.capturePage()).toPNG());

  console.log('SCREEN_CONTENT_RENDERER_TESTS_OK ' + checks + '/12');
  win.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  app.quit();
}).catch(error => {
  console.error(error && error.stack || error);
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
