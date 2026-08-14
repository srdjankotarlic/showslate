'use strict';

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const smokeDisplay = require('../tools/smoke-display.js');

const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'showslate-control-api-'));
app.setPath('userData', profile);
let target;
let latestStatus = null;
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

ipcMain.on('state', () => {});
ipcMain.on('control-status', (event, status) => { latestStatus = status; });
ipcMain.on('close-output', () => {});
ipcMain.on('set-output-configs', () => {});
ipcMain.on('ctl-on-top', () => {});
ipcMain.on('fit-window', () => {});
ipcMain.handle('displays', () => [target].filter(Boolean).map(display => ({
  id: display.id, label: display.label, width: display.bounds.width, height: display.bounds.height,
  primary: display.id === screen.getPrimaryDisplay().id, hasControl: true, hasOutput: false
})));
ipcMain.handle('output-open', () => false);
ipcMain.handle('output-configs', () => []);
ipcMain.handle('network-info', () => ({ running: true, ip: '127.0.0.1', port: 7878, oscPort: 7879, token: 'test-token' }));
ipcMain.handle('build-info', () => ({ version: 'test', commit: 'control-api-test', isPackaged: false }));
ipcMain.handle('show-storage-status', () => ({ ok: true, autosaveEnabled: false, recoveryAvailable: false, currentAvailable: false }));
ipcMain.handle('show-storage-save', () => ({ ok: true }));
ipcMain.handle('show-storage-load-current', () => ({ ok: false }));
ipcMain.handle('show-storage-recover', () => ({ ok: false }));
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
  target = smokeDisplay.resolveTargetDisplay(screen, { root }).display;
  check('CONTROL_API_TARGET_DISPLAY_OK', !!target, target ? target.label : 'missing');
  const win = new BrowserWindow({
    ...smokeDisplay.clampToWorkArea({ width: 1100, height: 700 }, target.workArea),
    show: true,
    backgroundColor: '#0b0c0f',
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  await win.loadFile(path.join(root, 'controller.html'));
  if (!await waitFor(() => win.webContents.executeJavaScript('document.readyState==="complete" && lastDisplays.length>0'))) throw new Error('controller did not initialize');

  const result = JSON.parse(await win.webContents.executeJavaScript(`(async function(){
    showMeta={id:'api-show',name:'API Demo',details:{}};
    S.goAutoStart=false;
    const cueSeed=[
      {id:'cue-a',name:'Opening',durationMs:60000,speakerName:'Alex Host',speakerTitle:'Host'},
      {id:'cue-b',name:'Keynote',durationMs:120000,speakerName:'Maya Chen',speakerTitle:'Keynote Speaker'},
      {id:'cue-c',name:'Closing',durationMs:60000,speakerName:'Sam Lee',speakerTitle:'Producer'},
      {id:'cue-d',name:'Strike',durationMs:30000,speakerName:'Taylor Ray',speakerTitle:'Stage Manager'}
    ];
    cues=migrateCues(JSON.parse(JSON.stringify(cueSeed)));
    currentCue=-1; selectedCue=3; renderCues();
    document.getElementById('btnGo').click();
    const primaryStartedFirst=currentCue===0;
    reorderCueById('cue-d','cue-b',false);
    selectedCue=cues.findIndex(cue=>cue.id==='cue-c'); renderCues(); document.getElementById('btnGo').click();
    const primaryIgnoredSelection=currentCue===1&&cues[currentCue].id==='cue-d';
    cues.find(cue=>cue.id==='cue-b').status='skipped'; selectedCue=cues.findIndex(cue=>cue.id==='cue-c'); renderCues(); document.getElementById('btnGo').click();
    const primarySkippedMarkedCue=cues[currentCue].id==='cue-c';
    cues=migrateCues(JSON.parse(JSON.stringify(cueSeed)));
    currentCue=-1; selectedCue=1; renderCues();
    const goSelected=executeRemoteCommand({type:'goSelected'});
    const selectedWentLive=goSelected&&currentCue===1&&selectedCue===-1;
    selectedCue=0; const beforeNext=currentCue; executeRemoteCommand({type:'goNext'});
    const nextIgnoredSelection=beforeNext===1&&currentCue===2;

    S.running=false; executeRemoteCommand({type:'startPause'}); const started=S.running;
    executeRemoteCommand({type:'startPause'}); const paused=!S.running;
    executeRemoteCommand({type:'adjust',value:15}); const adjusted=S.durationMs===75000;
    executeRemoteCommand({type:'messageSend',value:'WRAP UP'}); const messageSent=S.message.text==='WRAP UP'&&programState.message.text==='WRAP UP';
    executeRemoteCommand({type:'messageClear'}); const messageCleared=!S.message.text&&!programState.message.text;
    executeRemoteCommand({type:'blackout',value:true}); const blackoutOn=programState.blackout===true;
    executeRemoteCommand({type:'blackout',value:false}); const blackoutOff=programState.blackout===false;

    const template=ltDefaultTemplate('API Lower Third'); template.id='api-lt-template';
    const library=ltEnsureLibrary(); library.templates=[template]; library.activeTemplateId=template.id; saveLtLibrary();
    const selectedTemplate=executeRemoteCommand({type:'ltSelectTemplate',value:'API Lower Third'})&&library.activeTemplateId===template.id;
    const took=executeRemoteCommand({type:'ltTake'});
    const firstInstance=String(S.lowerThird.runtime&&S.lowerThird.runtime.instanceId||'');
    const usesLiveCue=took&&S.lowerThird.visible&&S.lowerThird.runtime&&S.lowerThird.runtime.templateId===template.id&&S.lowerThird.runtime.cueId==='cue-c';
    executeRemoteCommand({type:'ltHide'});
    const hideStarted=!S.lowerThird.visible||(S.lowerThird.runtime&&S.lowerThird.runtime.phase==='outro');
    hideLowerThird({force:true}); await new Promise(r=>setTimeout(r,12));
    const replayed=executeRemoteCommand({type:'ltReplay'});
    const secondInstance=String(S.lowerThird.runtime&&S.lowerThird.runtime.instanceId||'');
    executeRemoteCommand({type:'ltAuto',value:true}); const autoOn=S.lowerThirdAutoCue===true;
    executeRemoteCommand({type:'ltAuto',value:false}); const autoOff=S.lowerThirdAutoCue===false;

    S.scenes=[]; contentItems=[]; selectedContentItemId=''; liveContentItemId='';
    const timer=addContentScene('Timer','timer',[makeTimerLayer()]);
    const holding=addContentScene('Holding','text',[{id:makeId('layer'),type:'text',name:'Holding',text:'WELCOME',color:'#fff',bg:'transparent',fontSize:10,visible:true,fit:'contain',x:0,y:0,w:100,h:100,opacity:1}]);
    selectContentItem(timer.id); liveContentItemId=timer.id; programState=outputSnapshot(S); programState.activeSceneId=timer.sceneId;
    selectContentItem(holding.id); const previewOnly=programState.activeSceneId===timer.sceneId&&liveContentItemId===timer.id;
    const contentTaken=executeRemoteCommand({type:'contentTake',value:'cut'})&&programState.activeSceneId===holding.sceneId&&liveContentItemId===holding.id;
    executeRemoteCommand({type:'contentClear'});
    const contentCleared=liveContentItemId===''&&programState.activeSceneId==='scene-content-clear';
    return JSON.stringify({primaryStartedFirst,primaryIgnoredSelection,primarySkippedMarkedCue,selectedWentLive,nextIgnoredSelection,started,paused,adjusted,messageSent,messageCleared,blackoutOn,blackoutOff,selectedTemplate,usesLiveCue,hideStarted,replayed,newInstance:!!secondInstance&&secondInstance!==firstInstance,autoOn,autoOff,previewOnly,contentTaken,contentCleared});
  })()`));

  check('PRIMARY_GO_NEXT_FOLLOWS_RUNDOWN_ORDER_OK', result.primaryStartedFirst && result.primaryIgnoredSelection && result.primarySkippedMarkedCue, JSON.stringify(result));
  check('CONTROL_API_GO_NEXT_AND_SELECTED_OK', result.selectedWentLive && result.nextIgnoredSelection, JSON.stringify(result));
  check('CONTROL_API_TIMER_MESSAGE_BLACKOUT_OK', result.started && result.paused && result.adjusted && result.messageSent && result.messageCleared && result.blackoutOn && result.blackoutOff, JSON.stringify(result));
  check('CONTROL_API_LT_TAKE_HIDE_REPLAY_OK', result.selectedTemplate && result.usesLiveCue && result.hideStarted && result.replayed && result.newInstance, JSON.stringify(result));
  check('CONTROL_API_LT_AUTO_ON_OFF_OK', result.autoOn && result.autoOff, JSON.stringify(result));
  check('CONTROL_API_CONTENT_PREVIEW_TAKE_CLEAR_OK', result.previewOnly && result.contentTaken && result.contentCleared, JSON.stringify(result));
  if (!await waitFor(() => latestStatus && latestStatus.show && latestStatus.show.id === 'api-show' && latestStatus.cue && latestStatus.cue.live && latestStatus.cue.live.id === 'cue-c')) throw new Error('control status was not published');
  check('CONTROL_API_STATUS_SNAPSHOT_OK', latestStatus.ready === true && latestStatus.lowerThird.canReplay === true && latestStatus.content.live === null && latestStatus.output.blackout === false, JSON.stringify(latestStatus));
  check('CONTROL_API_STATUS_EXCLUDES_LIBRARY_OK', latestStatus.lowerThird.library === undefined && latestStatus.token === undefined && latestStatus.license === undefined);

  console.log('CONTROL_API_RENDERER_TESTS_OK ' + checks + '/9');
  win.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  app.quit();
}).catch(error => {
  console.error(error && error.stack || error);
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
