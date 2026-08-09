'use strict';

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const smokeDisplay = require('../tools/smoke-display.js');

const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'showslate-report-ui-'));
const artifactDirectory = path.join(root, 'artifacts', 'generated', 'report');
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

ipcMain.on('state', () => {});
ipcMain.on('control-status', () => {});
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
ipcMain.handle('build-info', () => ({ version: 'test', commit: 'report-test', isPackaged: false }));
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
  check('REPORT_UI_TARGET_DISPLAY_OK', !!target, target ? target.label : 'missing');
  const win = new BrowserWindow({
    ...smokeDisplay.clampToWorkArea({ width: 1280, height: 800 }, target.workArea),
    show: true,
    backgroundColor: '#0b0c0f',
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  await win.loadFile(path.join(root, 'controller.html'));
  if (!await waitFor(() => win.webContents.executeJavaScript('document.readyState==="complete" && lastDisplays.length>0'))) throw new Error('controller did not initialize');

  const state = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    const anchor=new Date(2026,6,10,9,0,0,0).getTime();
    showMeta={id:'report-show',name:'Beta Conference',details:{client:'Demo Client',venue:'Main Hall',eventDate:'2026-07-10'}};
    S.showStart='09:00';
    cues=migrateCues([
      {id:'report-a',name:'Opening, welcome',durationMs:60000,actualStart:anchor,actualEnd:anchor+70000,actualDurationMs:70000,status:'completed',note:'Host said "hello"'},
      {id:'report-b',name:'Coffee Break',durationMs:30000,actualStart:anchor+70000,actualEnd:anchor+90000,actualDurationMs:20000,status:'completed',note:'Lobby'},
      {id:'report-c',name:'Closing Ž',durationMs:30000,actualStart:null,actualEnd:null,actualDurationMs:null,status:'skipped',note:'Client note, final'}
    ]);
    currentCue=-1; selectedCue=1; S.running=true; S.endAt=Date.now()+42000; programState=outputSnapshot(S); showLog=[];
    const before={running:S.running,endAt:S.endAt,currentCue,selectedCue,program:JSON.stringify(programState)};
    document.getElementById('btnReport').click();
    const after={running:S.running,endAt:S.endAt,currentCue,selectedCue,program:JSON.stringify(programState)};
    const metrics=[...document.querySelectorAll('#reportSummary .report-metric')].map(el=>el.textContent.trim());
    const rows=[...document.querySelectorAll('#reportRows tr')].map(el=>el.textContent.trim());
    const csv=PTReport.toCsv(currentPostShowReport);
    let downloadName='',downloadHref=''; const originalClick=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){downloadName=this.download||'';downloadHref=this.href||'';};
    document.getElementById('btnReportExport').click(); HTMLAnchorElement.prototype.click=originalClick;
    return {open:document.getElementById('reportOverlay').classList.contains('open'),metrics,rows,csvOk:csv.startsWith('\\ufeffcue_number')&&csv.includes('"Opening, welcome"')&&csv.includes('Client note, final'),downloadOk:downloadName==='Beta-Conference-report.csv'&&downloadHref.startsWith('blob:'),safe:JSON.stringify(before)===JSON.stringify(after),summary:currentPostShowReport.summary};
  })())`));
  check('REPORT_UI_VISIBLE_FROM_NORMAL_BUTTON_OK', state.open && state.metrics.length === 7 && state.rows.length === 3, JSON.stringify(state));
  check('REPORT_UI_CANONICAL_FIELDS_OK', state.rows[0].includes('Opening, welcome') && state.rows[0].includes('1:10') && state.rows[2].includes('Closing Ž') && state.rows[2].includes('Skipped'), JSON.stringify(state.rows));
  check('REPORT_UI_SUMMARY_COMPLETE_OK', state.summary.totalPlannedMs === 120000 && state.summary.totalActualMs === 90000 && state.summary.finalDelayMs === -30000 && state.summary.overtimeSegments === 1 && state.summary.longestOvertimeMs === 10000 && state.summary.breaks === 1 && state.summary.skippedCues === 1, JSON.stringify(state.summary));
  check('REPORT_UI_DOES_NOT_CHANGE_LIVE_STATE_OK', state.safe);
  check('REPORT_UI_CSV_EXPORT_MODEL_OK', state.csvOk && state.downloadOk);

  fs.mkdirSync(artifactDirectory, { recursive: true });
  if (!await waitFor(() => win.webContents.executeJavaScript(`(()=>{const o=document.getElementById('reportOverlay'),r=document.querySelector('.report-dialog').getBoundingClientRect();return o.classList.contains('open')&&getComputedStyle(o).display==='flex'&&r.width>800&&document.querySelectorAll('#reportRows tr').length===3})()`))) throw new Error('report compositor did not become ready');
  await new Promise(resolve => setTimeout(resolve, 180));
  fs.writeFileSync(path.join(artifactDirectory, 'report-1280x800.png'), (await win.webContents.capturePage()).toPNG());
  win.setBounds(smokeDisplay.clampToWorkArea({ width: 900, height: 600 }, target.workArea));
  if (!await waitFor(() => win.webContents.executeJavaScript(`(()=>{const o=document.getElementById('reportOverlay'),r=document.querySelector('.report-dialog').getBoundingClientRect();return o.classList.contains('open')&&getComputedStyle(o).display==='flex'&&r.width>850&&r.right<=innerWidth})()`))) throw new Error('resized report compositor did not become ready');
  await new Promise(resolve => setTimeout(resolve, 180));
  const layout = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((()=>{
    const dialog=document.querySelector('.report-dialog').getBoundingClientRect();
    const foot=document.querySelector('#reportOverlay .flow-foot').getBoundingClientRect();
    const table=document.querySelector('.report-table-wrap');
    const summary=document.getElementById('reportSummary').getBoundingClientRect();
    return {vw:innerWidth,vh:innerHeight,dialog:{x:dialog.x,y:dialog.y,right:dialog.right,bottom:dialog.bottom},foot:{top:foot.top,bottom:foot.bottom},summary:{top:summary.top,bottom:summary.bottom},table:{clientWidth:table.clientWidth,scrollWidth:table.scrollWidth,clientHeight:table.clientHeight,scrollHeight:table.scrollHeight},bodyOverflow:document.documentElement.scrollWidth-innerWidth};
  })())`));
  check('REPORT_UI_900X600_REACHABLE_OK', layout.dialog.x >= 0 && layout.dialog.y >= 0 && layout.dialog.right <= layout.vw + 1 && layout.dialog.bottom <= layout.vh + 1 && layout.foot.bottom <= layout.vh + 1 && layout.table.clientHeight > 120 && layout.table.scrollWidth > layout.table.clientWidth && layout.bodyOverflow <= 1, JSON.stringify(layout));
  fs.writeFileSync(path.join(artifactDirectory, 'report-900x600.png'), (await win.webContents.capturePage()).toPNG());

  console.log('REPORT_RENDERER_TESTS_OK ' + checks + '/7');
  win.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  app.quit();
}).catch(error => {
  console.error(error && error.stack || error);
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
