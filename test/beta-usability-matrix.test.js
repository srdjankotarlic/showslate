'use strict';

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { evaluatePreflight } = require('../src/show-storage/preflight.js');
const smokeDisplay = require('../tools/smoke-display.js');

const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'showslate-beta-usability-'));
const artifactDirectory = path.join(root, 'artifacts', 'generated', 'beta-usability');
const allSizes = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1024x700', width: 1024, height: 700 },
  { name: '900x600', width: 900, height: 600 }
];
const requestedSize = String(process.env.SHOWSLATE_BETA_SIZE || process.env.PROTIMER_BETA_SIZE || '').trim();
const sizes = requestedSize ? allSizes.filter(size => size.name === requestedSize) : allSizes;
if (!sizes.length) throw new Error('Unknown SHOWSLATE_BETA_SIZE: ' + requestedSize);
const hiddenVisual = (process.env.SHOWSLATE_HIDDEN_VISUAL || process.env.PROTIMER_HIDDEN_VISUAL) === '1';
app.setPath('userData', profile);
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
  return screen.getAllDisplays().map(display => ({
    id: display.id, label: display.label, width: display.bounds.width, height: display.bounds.height,
    primary: display.id === screen.getPrimaryDisplay().id, hasControl: display.id === target.id, hasOutput: false
  }));
}

ipcMain.on('state', () => {});
ipcMain.on('control-status', () => {});
ipcMain.on('close-output', () => {});
ipcMain.on('set-output-configs', () => {});
ipcMain.on('ctl-on-top', () => {});
ipcMain.on('fit-window', () => {});
ipcMain.handle('displays', displayRows);
ipcMain.handle('output-open', () => false);
ipcMain.handle('output-configs', () => []);
ipcMain.handle('network-info', () => ({ running: true, ip: '127.0.0.1', port: 7878, oscPort: 7879, token: 'test-token' }));
ipcMain.handle('build-info', () => ({ version: 'test', commit: 'beta-usability', isPackaged: false }));
ipcMain.handle('show-storage-status', () => ({ ok: true, autosaveEnabled: false, recoveryAvailable: false, currentAvailable: false }));
ipcMain.handle('show-storage-save', () => ({ ok: true }));
ipcMain.handle('show-storage-load-current', () => ({ ok: false }));
ipcMain.handle('show-storage-recover', () => ({ ok: false }));
ipcMain.handle('show-preflight-inspect', (event, payload) => evaluatePreflight(payload.document, {
  lastSaveOk: true, autosaveWritable: true, missingAssets: [], speakerScreenReady: true,
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

async function setSize(win, size) {
  win.setBounds(smokeDisplay.clampToWorkArea({ width: size.width, height: size.height }, target.workArea));
  if (!await waitFor(() => win.webContents.executeJavaScript(`innerWidth===${size.width} && innerHeight>=${size.height - 50}`))) {
    throw new Error('viewport did not settle at ' + size.name);
  }
  await new Promise(resolve => setTimeout(resolve, 120));
}

async function capture(win, name) {
  await new Promise(resolve => setTimeout(resolve, 300));
  fs.writeFileSync(path.join(artifactDirectory, name + '.png'), (await win.webContents.capturePage()).toPNG());
}

async function json(win, source) {
  return JSON.parse(await win.webContents.executeJavaScript(`Promise.resolve(${source}).then(value=>JSON.stringify(value))`));
}

app.whenReady().then(async () => {
  target = hiddenVisual ? screen.getPrimaryDisplay() : smokeDisplay.resolveTargetDisplay(screen, { root }).display;
  check('BETA_UI_TARGET_DISPLAY_OK', !!target, target ? `${target.label}${hiddenVisual ? ' (hidden visual)' : ''}` : 'missing');
  fs.mkdirSync(artifactDirectory, { recursive: true });
  const win = new BrowserWindow({
    ...smokeDisplay.clampToWorkArea({ width: 1440, height: 900 }, target.workArea),
    show: !hiddenVisual,
    backgroundColor: '#0b0c0f',
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  await win.loadFile(path.join(root, 'controller.html'));
  if (!await waitFor(() => win.webContents.executeJavaScript('document.readyState==="complete" && lastDisplays.length>0'))) throw new Error('controller did not initialize');

  await win.webContents.executeJavaScript(`(function(){
    const anchor=new Date(2026,6,10,9,0,0,0).getTime();
    showMeta={id:'beta-usability-show',name:'Beta Production',details:{client:'Demo Client',venue:'Main Hall',eventDate:'2026-07-10'}};
    S.showStart='09:00'; S.goAutoStart=false; S.studioDirect=true;
    cues=migrateCues([
      {id:'beta-cue-a',name:'Opening and welcome',durationMs:300000,actualStart:anchor,actualEnd:anchor+305000,actualDurationMs:305000,status:'completed',note:'Host opens the event',speakerName:'Alex Morgan',speakerTitle:'Event Host'},
      {id:'beta-cue-b',name:'Keynote: Building reliable live experiences',durationMs:1200000,actualStart:anchor+305000,actualEnd:null,actualDurationMs:null,status:'live',note:'Main stage keynote',speakerName:'Dr Maya Chen',speakerTitle:'Keynote Speaker',company:'Northstar Labs'},
      {id:'beta-cue-c',name:'Coffee Break',durationMs:600000,actualStart:null,actualEnd:null,actualDurationMs:null,status:'pending',note:'Lobby and sponsor loop'},
      {id:'beta-cue-d',name:'Panel discussion and audience questions',durationMs:1500000,actualStart:null,actualEnd:null,actualDurationMs:null,status:'pending',note:'Four guests plus moderator',speakerName:'Jordan Lee',speakerTitle:'Panel Moderator'},
      {id:'beta-cue-e',name:'Closing remarks',durationMs:300000,actualStart:null,actualEnd:null,actualDurationMs:null,status:'pending',note:'Thank sponsors and guests'}
    ]);
    currentCue=1; selectedCue=3;
    S.mode='countdown'; S.durationMs=cues[1].durationMs; S.remMs=720000; S.running=true; S.endAt=Date.now()+720000;
    S.message={text:'',flash:false};
    S.scenes=[]; contentItems=[]; selectedContentItemId=''; liveContentItemId='';
    const timer=addContentScene('Event Timer','timer',[makeTimerLayer()]);
    const holding=addContentScene('Welcome Holding','text',[{id:makeId('layer'),type:'text',name:'Welcome',text:'WELCOME TO BETA PRODUCTION',color:'#ffffff',bg:'transparent',fontSize:9,visible:true,fit:'contain',x:5,y:5,w:90,h:90,opacity:1}]);
    const blank=addContentScene('Intermission Blank','blank',[{id:makeId('layer'),type:'text',name:'Blank',text:'',color:'#ffffff',bg:'transparent',fontSize:8,visible:true,fit:'contain',x:0,y:0,w:100,h:100,opacity:1}]);
    selectedContentItemId=holding.id; liveContentItemId=timer.id; S.activeSceneId=holding.sceneId;
    programState=outputSnapshot(S); programState.activeSceneId=timer.sceneId;
    const template=ltDefaultTemplate('Starter Template');
    template.id='beta-starter-template';
    template.layers[0].id='beta-starter-plate';
    template.layers[1].id='beta-starter-name';
    template.layers[2].id='beta-starter-title';
    ltLibrary={schemaVersion:1,activeTemplateId:template.id,templates:[template],updatedAt:new Date().toISOString()};
    ltStudioState.selectedTemplateId=template.id; ltStudioState.selectedLayerId='beta-starter-name';
    showLog=[{cueId:'beta-cue-a',i:0,n:cues[0].name,p:cues[0].durationMs,note:cues[0].note,s:anchor,e:anchor+305000},{cueId:'beta-cue-b',i:1,n:cues[1].name,p:cues[1].durationMs,note:cues[1].note,s:anchor+305000,e:0}];
    outputOpen=true;
    outputConfigs=[
      normalizeOutputConfigUI({id:'beta-route-program',name:'Projector Program',enabled:true,displayId:${target.id},mode:'custom',width:1280,height:720,placement:'center'}),
      normalizeOutputConfigUI({id:'beta-route-confidence',name:'Confidence Window',enabled:false,displayId:${target.id},mode:'grid',gridSize:3,gridCell:8})
    ];
    outputRuntime={primaryOpen:false,routes:[{id:'beta-route-program',enabled:true,open:true,displayId:${target.id},mode:'custom',bounds:{x:0,y:0,width:1280,height:720},fullscreen:false}]};
    const targetDisplayOption=document.querySelector('#displaySel option[value="${target.id}"]');
    if(targetDisplayOption) document.getElementById('displaySel').value=targetDisplayOption.value;
    renderCues(); renderContentItems(); renderScenesUI(); renderOutputRows(); updateGoLabel(); updateLiveInfo(); updateButtons(); send(true);
    window.__betaState=()=>({running:S.running,endAt:S.endAt,currentCue,selectedCue,outputOpen,programScene:programState&&programState.activeSceneId,message:S.message.text});
    window.__visible=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0;};
    window.__inside=el=>{if(!window.__visible(el))return false;const r=el.getBoundingClientRect();return r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;};
    window.__insideX=el=>{if(!window.__visible(el))return false;const r=el.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1;};
    window.__rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
    window.__waitVisual=async(fn,timeout=1600)=>{const started=Date.now();while(Date.now()-started<timeout){try{if(fn())return true;}catch(_){}await new Promise(resolve=>setTimeout(resolve,25));}return false;};
    window.__fits=el=>{if(!window.__visible(el))return true;const style=getComputedStyle(el),fits=el.scrollWidth<=el.clientWidth+2&&el.scrollHeight<=el.clientHeight+2;const deliberateEllipsis=style.overflow==='hidden'&&style.textOverflow==='ellipsis'&&!!String(el.title||el.getAttribute('aria-label')||'').trim();return fits||deliberateEllipsis;};
    window.__baseProbe=selectors=>{const els=selectors.map(s=>document.querySelector(s));const footer=document.querySelector('.statusbar');return {vw:innerWidth,vh:innerHeight,inside:els.map(window.__inside),bodyX:document.documentElement.scrollWidth-innerWidth,footer:window.__inside(footer),footerTop:footer.getBoundingClientRect().top,uniqueStart:document.querySelectorAll('#btnStart').length,uniqueGo:document.querySelectorAll('#btnGo').length,textFits:[document.getElementById('btnStart'),document.getElementById('btnGo'),document.getElementById('btnGoNext')].map(window.__fits)};};
    window.__overlayProbe=id=>{const root=document.getElementById(id),dialog=root&&root.querySelector('.flow-dialog'),head=dialog&&dialog.querySelector('.flow-head'),foot=dialog&&dialog.querySelector('.flow-foot');return {open:!!root&&root.classList.contains('open'),display:root?getComputedStyle(root).display:'',dialog:window.__inside(dialog),head:window.__inside(head),foot:window.__inside(foot),bodyX:document.documentElement.scrollWidth-innerWidth,buttons:foot?[...foot.querySelectorAll('button')].filter(window.__visible).map(window.__fits):[]};};
  })()`);

  const initialState = await json(win, '__betaState()');

  const sidebarToggle = await json(win, `(async()=>{
    applyCompactMode(false); applyAdvancedMode(false); closeDrawers(); setSidebarCollapsed(false,false);
    const button=document.getElementById('btnRundownDrawer'), sidebar=document.getElementById('primarySidebar'), operator=document.querySelector('.operator-main');
    const sidebarStyle=()=>{const style=getComputedStyle(sidebar);return {display:style.display,visibility:style.visibility,opacity:style.opacity,transform:style.transform};};
    const waitSidebar=async collapsed=>{const started=Date.now();while(Date.now()-started<1600){const style=getComputedStyle(sidebar),rect=__rect(operator);if(collapsed?style.visibility==='hidden'&&Number(style.opacity)<=.01&&rect.w>1000:style.visibility==='visible'&&Number(style.opacity)>=.99&&rect.w<900)return true;await new Promise(resolve=>setTimeout(resolve,25));}return false;};
    const before={sidebar:__visible(sidebar),sidebarStyle:sidebarStyle(),operator:__rect(operator),state:__betaState(),expanded:button.getAttribute('aria-expanded'),viewport:innerWidth,drawerBreakpoint:matchMedia('(max-width:1100px)').matches};
    button.click(); const collapsedSettled=await waitSidebar(true);
    const collapsed={classOn:document.body.classList.contains('sidebar-collapsed'),sidebar:__visible(sidebar),sidebarStyle:sidebarStyle(),operator:__rect(operator),state:__betaState(),expanded:button.getAttribute('aria-expanded')};
    button.click(); const restoredSettled=await waitSidebar(false);
    const restored={classOff:!document.body.classList.contains('sidebar-collapsed'),sidebar:__visible(sidebar),sidebarStyle:sidebarStyle(),operator:__rect(operator),state:__betaState(),expanded:button.getAttribute('aria-expanded')};
    return {before,collapsed:{...collapsed,settled:collapsedSettled},restored:{...restored,settled:restoredSettled}};
  })()`);
  check('BETA_SIDEBAR_TOGGLE_WIDE_OK', sidebarToggle.before.sidebar && sidebarToggle.before.expanded==='true' && sidebarToggle.collapsed.settled && sidebarToggle.collapsed.classOn && !sidebarToggle.collapsed.sidebar && sidebarToggle.collapsed.expanded==='false' && sidebarToggle.collapsed.operator.w>sidebarToggle.before.operator.w+150 && sidebarToggle.restored.settled && sidebarToggle.restored.classOff && sidebarToggle.restored.sidebar && sidebarToggle.restored.expanded==='true' && JSON.stringify(sidebarToggle.before.state)===JSON.stringify(sidebarToggle.collapsed.state) && JSON.stringify(sidebarToggle.before.state)===JSON.stringify(sidebarToggle.restored.state), JSON.stringify(sidebarToggle));
  await capture(win, '1440x900-sidebar-restored');

  for (const size of sizes) {
    await setSize(win, size);

    const standard = await json(win, `(async()=>{
      closeDrawers(); closeLtStudio({returnFocus:false}); closeNewShowWizard(); closePreflight(); closePostShowReport(); closeRecoveryDialog();
      applyCompactMode(false); applyAdvancedMode(false); setSidebarView('rundown'); setCueEditorOpen(false);
      document.querySelector('#setupTabs button[data-pane="timer"]').click();
      const p=__baseProbe(['#program','#btnStart','#btnGo']);
      let rundownAccess=__inside(document.getElementById('cueList'));
      const rundownButton=__inside(document.getElementById('btnRundownDrawer'));
      let rundownProbe={button:rundownButton,display:getComputedStyle(document.getElementById('btnRundownDrawer')).display,buttonRect:__rect(document.getElementById('btnRundownDrawer'))};
      if(!rundownAccess&&rundownButton){document.getElementById('btnRundownDrawer').click();await new Promise(resolve=>setTimeout(resolve,420));rundownAccess=document.body.classList.contains('dr-run')&&__inside(document.getElementById('cueList'));rundownProbe={...rundownProbe,drawer:document.body.classList.contains('dr-run'),cueRect:__rect(document.getElementById('cueList')),sideRect:__rect(document.querySelector('.primary-sidebar')),transform:getComputedStyle(document.querySelector('.primary-sidebar')).transform};closeDrawers();}
      const operatorRect=__rect(document.querySelector('.operator-main'));
      const operatorUsesWidth=innerWidth>1100||operatorRect.w>=innerWidth-32;
      return {...p,rundownAccess,rundownProbe,operatorRect,operatorUsesWidth,mode:document.getElementById('app-shell').classList.contains('mode-standard'),ghosts:[...document.querySelectorAll('.flow-overlay.open,.recovery-overlay.open')].length,studioGhost:document.getElementById('ltStudio').classList.contains('open')};
    })()`);
    check('BETA_STANDARD_' + size.name + '_OK', standard.mode && standard.inside.every(Boolean) && standard.rundownAccess && standard.operatorUsesWidth && standard.bodyX <= 1 && standard.footer && standard.uniqueStart === 1 && standard.uniqueGo === 1 && standard.textFits.every(Boolean) && standard.ghosts === 0 && !standard.studioGhost, JSON.stringify(standard));
    await capture(win, size.name + '-standard');

    const compact = await json(win, `(async()=>{
      applyCompactMode(true); applyAdvancedMode(false); closeDrawers();
      await __waitVisual(()=>document.getElementById('app-shell').classList.contains('mode-compact')&&__rect(document.querySelector('.operator-main')).w<=642);
      const closed=__baseProbe(['#program','#btnStart','#btnGo','#compactMsg','#btnRundownDrawer']);
      document.getElementById('btnRundownDrawer').click();
      await __waitVisual(()=>document.body.classList.contains('dr-run')&&__inside(document.getElementById('cueList')));
      const drawer={open:document.body.classList.contains('dr-run'),cueList:__inside(document.getElementById('cueList'))};
      closeDrawers();
      await __waitVisual(()=>!document.body.classList.contains('dr-run')&&__rect(document.querySelector('.primary-sidebar')).right<=1);
      const operator=__rect(document.querySelector('.operator-main'));
      const sidebarStyle=getComputedStyle(document.querySelector('.primary-sidebar'));
      const utilityStyle=getComputedStyle(document.querySelector('.utility-column'));
      return {closed,drawer,mode:document.getElementById('app-shell').classList.contains('mode-compact'),operator,drawersFixed:sidebarStyle.position==='fixed'&&utilityStyle.position==='fixed',rects:{rundown:__rect(document.getElementById('btnRundownDrawer')),start:__rect(document.getElementById('btnStart')),go:__rect(document.getElementById('btnGo'))},styles:{rundown:getComputedStyle(document.getElementById('btnRundownDrawer')).display,startOverflow:getComputedStyle(document.getElementById('btnStart')).overflow,startText:document.getElementById('btnStart').textContent}};
    })()`);
    if (size.name === '1024x700') await capture(win, size.name + '-compact-diagnostic');
    check('BETA_COMPACT_' + size.name + '_OK', compact.mode && compact.closed.inside.every(Boolean) && compact.closed.bodyX <= 1 && compact.closed.footer && compact.drawer.open && compact.drawer.cueList && compact.drawersFixed && compact.operator.w <= 642 && compact.operator.w >= Math.min(600, size.width - 24), JSON.stringify(compact));
    if (size.name === '1280x800') await capture(win, size.name + '-compact');

    const advanced = await json(win, `(async()=>{
      applyCompactMode(false); applyAdvancedMode(true); closeDrawers();
      await __waitVisual(()=>document.getElementById('app-shell').classList.contains('mode-advanced')&&__inside(document.getElementById('program')));
      const monitors=[...document.querySelectorAll('.studio-monitor')].filter(__visible),rects=monitors.map(__rect);
      const overlap=rects.length===2&&!(rects[0].right<=rects[1].x||rects[1].right<=rects[0].x||rects[0].bottom<=rects[1].y||rects[1].bottom<=rects[0].y);
      const p=__baseProbe(['#program','#btnStart','#btnGo']);
      return {...p,mode:document.getElementById('app-shell').classList.contains('mode-advanced'),monitorCount:monitors.length,overlap};
    })()`);
    check('BETA_ADVANCED_' + size.name + '_OK', advanced.mode && advanced.inside.every(Boolean) && advanced.bodyX <= 1 && advanced.footer && advanced.monitorCount >= 1 && advanced.monitorCount <= 2 && !advanced.overlap, JSON.stringify(advanced));
    if (size.name === '1440x900') await capture(win, size.name + '-advanced');

    const panels = await json(win, `(async()=>{
      applyAdvancedMode(false); setSidebarView('rundown'); setCueEditorOpen(false); renderCues();
      await __waitVisual(()=>document.getElementById('app-shell').classList.contains('mode-standard')&&__inside(document.querySelector('.card-rundown')));
      closeDrawers(); if(innerWidth<=1100){document.getElementById('btnRundownDrawer').click();await new Promise(resolve=>setTimeout(resolve,420));}
      const rundown={visible:__visible(document.getElementById('cueList')),rows:document.querySelectorAll('#cueList .cue').length,scroll:getComputedStyle(document.getElementById('cueList')).overflowY,inside:__inside(document.querySelector('.card-rundown'))};
      setCueEditorOpen(true); const cueEditor=document.getElementById('cueEditor'); cueEditor.scrollTop=0;
      const inputBg=getComputedStyle(document.getElementById('cueName')).backgroundColor;
      const saveReachable=__inside(document.getElementById('btnCueSave')); cueEditor.scrollTop=cueEditor.scrollHeight;
      const editor={visible:__visible(cueEditor),inside:__inside(document.querySelector('.card-rundown')),save:saveReachable,last:__inside(document.getElementById('chkNowNext')),dark:!['rgb(255, 255, 255)','rgba(0, 0, 0, 0)'].includes(inputBg)};
      setCueEditorOpen(false); closeDrawers(); const setup=document.getElementById('setupWrap'); if(!__inside(setup)&&__inside(document.getElementById('btnSettingsDrawer'))){document.getElementById('btnSettingsDrawer').click();await new Promise(resolve=>setTimeout(resolve,420));} document.querySelector('#setupTabs button[data-pane="lt"]').click();
      const pane=document.getElementById('pane-lt'); pane.scrollTop=pane.scrollHeight; document.getElementById('btnLtDeletePreset').scrollIntoView({block:'nearest'});
      const lowerControls=[...pane.querySelectorAll('.lt-form-row input,.lt-form-row select,.lt-form-row button,.lt-form-row .chk')].filter(__visible);
      const lower={active:pane.classList.contains('active'),studioButton:__inside(document.getElementById('btnLtStudioOpen')),last:__inside(document.getElementById('btnLtDeletePreset')),controlsInsideX:lowerControls.map(__insideX),controlsFit:lowerControls.map(__fits),scroll:getComputedStyle(pane).overflowY};
      const result={rundown,editor,lower,bodyX:document.documentElement.scrollWidth-innerWidth}; closeDrawers(); return result;
    })()`);
    check('BETA_PANELS_' + size.name + '_OK', panels.rundown.visible && panels.rundown.rows === 5 && panels.rundown.inside && panels.editor.visible && panels.editor.inside && panels.editor.save && panels.editor.last && panels.editor.dark && panels.lower.active && panels.lower.studioButton && panels.lower.last && panels.lower.controlsInsideX.every(Boolean) && panels.lower.controlsFit.every(Boolean) && panels.bodyX <= 1, JSON.stringify(panels));
    if (size.name === '1280x800') {
      await capture(win, size.name + '-lower-third');
      await win.webContents.executeJavaScript(`setSidebarView('rundown');setCueEditorOpen(true);document.getElementById('cueEditor').scrollTop=0;`);
      await capture(win, size.name + '-cue-editor');
      await win.webContents.executeJavaScript(`setCueEditorOpen(false);`);
    }

    await win.webContents.executeJavaScript(`openOutputRouter()`);
    await new Promise(resolve => setTimeout(resolve, 80));
    const routing = await json(win, `(()=>{const root=document.getElementById('outputRouterOverlay'),dialog=root.querySelector('.output-router-dialog'),rows=[...document.querySelectorAll('#outputRouterList .output-route-editor')],first=rows[0];return {open:root.classList.contains('open'),dialog:__inside(dialog),head:__inside(root.querySelector('.output-router-head')),foot:__inside(root.querySelector('.output-router-foot')),rows:rows.length,first:!!first&&__inside(first),display:!!first&&__inside(first.querySelector('.out-display')),mode:!!first&&__inside(first.querySelector('.out-mode')),apply:__inside(document.getElementById('btnOutputRouterApply')),stop:__inside(document.getElementById('btnOutputStopAll')),bodyX:document.documentElement.scrollWidth-innerWidth};})()`);
    check('BETA_OUTPUT_ROUTING_' + size.name + '_OK', routing.open && routing.dialog && routing.head && routing.foot && routing.rows === 2 && routing.first && routing.display && routing.mode && routing.apply && routing.stop && routing.bodyX <= 1, JSON.stringify(routing));
    if (size.name === '1280x800') {
      const draftRefresh = await json(win, `(()=>{
        const originalDisplays=lastDisplays.slice();
        const originalConfig={...outputConfigs[1]};
        const synthetic={id:987654321,label:'QA Secondary Display',width:1366,height:768,hasControl:false,hasOutput:false};
        lastDisplays=[...originalDisplays,synthetic];
        renderOutputRouterRows();
        const row=document.querySelectorAll('#outputRouterList .output-route-editor')[1];
        const select=row.querySelector('.out-display');
        select.value=String(synthetic.id);
        select.dispatchEvent(new Event('change',{bubbles:true}));
        const state=row.querySelector('.output-route-state').textContent.trim();
        const summary=row.querySelector('.output-route-runtime').textContent.trim();
        const result={state,summary,displayLabel:outputConfigs[1].displayLabel,displayWidth:outputConfigs[1].displayWidth};
        lastDisplays=originalDisplays;
        outputConfigs[1]=originalConfig;
        renderOutputRouterRows();
        return result;
      })()`);
      check('BETA_OUTPUT_DRAFT_DISPLAY_REFRESH_OK', draftRefresh.state === 'PENDING APPLY' && draftRefresh.summary.includes('QA Secondary Display · 1366×768') && draftRefresh.displayLabel === 'QA Secondary Display' && draftRefresh.displayWidth === 1366, JSON.stringify(draftRefresh));
    }
    if (size.name === '1280x800' || size.name === '900x600') await capture(win, size.name + '-output-routing');
    await win.webContents.executeJavaScript(`closeOutputRouter()`);

    await win.webContents.executeJavaScript(`openLtStudio();ltSetStudioPane('canvas');`);
    await new Promise(resolve => setTimeout(resolve, 100));
    await win.webContents.executeJavaScript(`ltApplyCanvasZoom()`);
    const studio = await json(win, `(()=>{const root=document.getElementById('ltStudio'),toolbar=root.querySelector('.lt-studio-toolbar'),canvas=document.getElementById('ltStudioCanvas'),shell=document.getElementById('ltStudioCanvasShell'),activePane=document.querySelector('.lt-studio-center'),name=document.querySelector('[data-layer-id="beta-starter-name"]'),title=document.querySelector('[data-layer-id="beta-starter-title"]'),plate=document.querySelector('[data-layer-id="beta-starter-plate"]'),text=name&&name.querySelector('.lt-editor-text'),scale=canvas.clientWidth/1920,cs=text&&getComputedStyle(text),nr=name&&name.getBoundingClientRect(),tr=title&&title.getBoundingClientRect(),cr=canvas.getBoundingClientRect(),sr=shell.getBoundingClientRect(),runtime=ltStudioState.previewRuntime||{},runtimeName=(runtime.resolvedLayers||[]).find(layer=>layer.id==='beta-starter-name');return {open:root.classList.contains('open'),root:__inside(root),toolbar:__inside(toolbar),canvas:__visible(canvas)&&__inside(activePane),canvasRect:{w:cr.width,h:cr.height},shellRect:{w:sr.width,h:sr.height},runtimeCanvas:runtime.canvas,canvasInsideShell:cr.left>=sr.left-1&&cr.top>=sr.top-1&&cr.right<=sr.right+1&&cr.bottom<=sr.bottom+1,fitNoScroll:shell.scrollWidth<=shell.clientWidth+1&&shell.scrollHeight<=shell.clientHeight+1,templates:document.querySelectorAll('#ltStudioTemplates .lt-template-row').length,layers:document.querySelectorAll('#ltStudioLayers .lt-layer-row').length,buttons:[...toolbar.querySelectorAll('button')].filter(__visible).map(__fits),bodyX:document.documentElement.scrollWidth-innerWidth,scale,font:cs?parseFloat(cs.fontSize):0,preferredFont:Number(runtimeName&&runtimeName.fontSize)||0,autoFit:!!(text&&text.dataset.autoFit),radius:plate?parseFloat(getComputedStyle(plate).borderRadius):0,textFits:!!text&&text.scrollHeight<=text.clientHeight+1&&text.scrollWidth<=text.clientWidth+1,layersSeparated:!!nr&&!!tr&&nr.bottom<=tr.top+1};})()`);
    check('BETA_STUDIO_' + size.name + '_OK', studio.open && studio.root && studio.toolbar && studio.canvas && studio.templates > 0 && studio.layers > 0 && studio.buttons.every(Boolean) && studio.bodyX <= 1, JSON.stringify(studio));
    const fontRatio = studio.preferredFont > 0 && studio.scale > 0 ? studio.font / (studio.preferredFont * studio.scale) : 0;
    const canvasRatio = studio.canvasRect.h > 0 ? studio.canvasRect.w / studio.canvasRect.h : 0;
    const runtimeRatio = Number(studio.runtimeCanvas&&studio.runtimeCanvas.height) > 0 ? Number(studio.runtimeCanvas.width) / Number(studio.runtimeCanvas.height) : 0;
    check('BETA_STUDIO_VISUAL_FIDELITY_' + size.name + '_OK', studio.canvasInsideShell && studio.fitNoScroll && Math.abs(canvasRatio-runtimeRatio)<.01 && studio.textFits && studio.layersSeparated && fontRatio >= .9 && fontRatio <= 1.01 && Math.abs(studio.radius-34*studio.scale)<1, JSON.stringify({...studio,fontRatio,canvasRatio,runtimeRatio}));
    if (size.name === '1440x900' || size.name === '900x600') await capture(win, size.name + '-studio');
    await win.webContents.executeJavaScript(`closeLtStudio({returnFocus:false});`);

    await win.webContents.executeJavaScript(`openNewShowWizard()`);
    await new Promise(resolve => setTimeout(resolve, 80));
    const wizard = await json(win, `(async()=>{const steps=[];for(let i=0;i<7;i++){setWizardStep(i);await new Promise(r=>setTimeout(r,10));const pane=document.querySelector('.wizard-pane.active');steps.push(__visible(pane)&&__inside(document.querySelector('#newShowOverlay .flow-dialog')));}return {...__overlayProbe('newShowOverlay'),steps};})()`);
    check('BETA_WIZARD_' + size.name + '_OK', wizard.open && wizard.dialog && wizard.head && wizard.foot && wizard.bodyX <= 1 && wizard.buttons.every(Boolean) && wizard.steps.every(Boolean), JSON.stringify(wizard));
    if (size.name === '1024x700') await capture(win, size.name + '-wizard');
    await win.webContents.executeJavaScript(`closeNewShowWizard()`);

    await win.webContents.executeJavaScript(`openPreflight()`);
    if (!await waitFor(() => win.webContents.executeJavaScript(`document.querySelectorAll('#preflightList .preflight-row').length>=10`))) throw new Error('preflight did not render');
    const preflight = await json(win, `(()=>({...__overlayProbe('preflightOverlay'),rows:document.querySelectorAll('#preflightList .preflight-row').length,result:document.getElementById('preflightResult').textContent.trim()}))()`);
    check('BETA_PREFLIGHT_' + size.name + '_OK', preflight.open && preflight.dialog && preflight.head && preflight.foot && preflight.rows >= 10 && preflight.result && preflight.buttons.every(Boolean), JSON.stringify(preflight));
    if (size.name === '1024x700') await capture(win, size.name + '-preflight');
    await win.webContents.executeJavaScript(`closePreflight()`);

    const slides = await json(win, `(async()=>{closeDrawers();if(innerWidth<=1100){document.getElementById('btnRundownDrawer').click();await new Promise(resolve=>setTimeout(resolve,420));}setSidebarView('slides');renderContentItems();const panel=document.getElementById('sidebarSlidesPane'),foot=panel.querySelector('.slides-foot'),list=document.getElementById('slidesList');const result={panel:__inside(panel),foot:__inside(foot),items:list.querySelectorAll('.slide-row').length,scroll:getComputedStyle(list).overflowY,bodyX:document.documentElement.scrollWidth-innerWidth};closeDrawers();return result;})()`);
    check('BETA_SLIDES_' + size.name + '_OK', slides.panel && slides.foot && slides.items === 3 && slides.bodyX <= 1, JSON.stringify(slides));
    if (size.name === '1024x700') await capture(win, size.name + '-slides');

    await win.webContents.executeJavaScript(`showRecoveryDialog({recoveryAvailable:true,crashedSessionStartedAt:new Date().toISOString(),hasLastSaved:true})`);
    await new Promise(resolve => setTimeout(resolve, 50));
    const recovery = await json(win, `(()=>{const root=document.getElementById('showRecoveryOverlay'),box=root.querySelector('.recovery-box'),actions=root.querySelector('.recovery-actions');return {open:root.classList.contains('open'),box:__inside(box),actions:__inside(actions),buttons:[...actions.querySelectorAll('button')].map(__fits),bodyX:document.documentElement.scrollWidth-innerWidth};})()`);
    check('BETA_RECOVERY_' + size.name + '_OK', recovery.open && recovery.box && recovery.actions && recovery.buttons.every(Boolean) && recovery.bodyX <= 1, JSON.stringify(recovery));
    if (size.name === '900x600') await capture(win, size.name + '-recovery');
    await win.webContents.executeJavaScript(`closeRecoveryDialog()`);

    await win.webContents.executeJavaScript(`openPostShowReport()`);
    await new Promise(resolve => setTimeout(resolve, 50));
    const report = await json(win, `(()=>({...__overlayProbe('reportOverlay'),metrics:document.querySelectorAll('#reportSummary .report-metric').length,rows:document.querySelectorAll('#reportRows tr').length,tableScroll:getComputedStyle(document.querySelector('.report-table-wrap')).overflow}))()`);
    check('BETA_REPORT_' + size.name + '_OK', report.open && report.dialog && report.head && report.foot && report.metrics === 7 && report.rows === 5 && report.buttons.every(Boolean) && report.bodyX <= 1, JSON.stringify(report));
    if (size.name === '900x600') await capture(win, size.name + '-report');
    await win.webContents.executeJavaScript(`closePostShowReport();setSidebarView('rundown');document.querySelector('#setupTabs button[data-pane="timer"]').click();`);

    const state = await json(win, '__betaState()');
    check('BETA_STATE_' + size.name + '_OK', state.running && state.endAt === initialState.endAt && state.currentCue === initialState.currentCue && state.selectedCue === initialState.selectedCue && state.outputOpen === initialState.outputOpen && state.programScene === initialState.programScene && state.message === initialState.message, JSON.stringify({ initialState, state }));
  }

  const expectedChecks = 2 + sizes.length * 13 + (sizes.some(size => size.name === '1280x800') ? 1 : 0);
  console.log('BETA_USABILITY_MATRIX_OK ' + checks + '/' + expectedChecks + ' artifacts=' + artifactDirectory);
  win.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  app.quit();
}).catch(error => {
  console.error(error && error.stack || error);
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
