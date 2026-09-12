'use strict';

const assert = require('node:assert/strict');
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(process.env.SHOWSLATE_TEST_APP_ROOT || path.join(__dirname, '..'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'showslate-output-lifecycle-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
ipcMain.handle('live-input-subscribe', () => ({ ok: true }));
ipcMain.on('live-input-unsubscribe', () => {});
ipcMain.on('output-rendered', () => {});
let win;
let checks = 0;
const failures = [];
function check(name, condition, detail) {
  checks++;
  if (!condition) failures.push(name + ': ' + JSON.stringify(detail));
  console.log(name + '=' + !!condition);
}
function finish(code, error) {
  if (error) console.error(error.stack || error);
  if (win && !win.isDestroyed()) win.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(code);
}
const deadline = setTimeout(() => finish(1, new Error('Hidden output lifecycle test timed out.')), 20000);

app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, width: 800, height: 600,
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  await win.loadFile(path.join(root, 'output.html'));
  await win.webContents.executeJavaScript(`
    window.__state = {
      activeSceneId:'scene', activeCompositionId:'composition-main', sceneFadeMs:0,
      canvas:{width:1920,height:1080,fps:30},
      scenes:[{id:'scene',layers:[{id:'sound',type:'audio',inputId:'sound',audioEnabled:true,muted:false,volume:.6}]}],
      mode:'countdown',running:false,durationMs:600000,remMs:600000,elapsedMs:0,
      bgColor:'#172030',fgColor:'#ffffff',cues:[],currentCue:-1,
      _outputRoute:{role:'audience',liveAudio:true,outputCanvas:{width:1920,height:1080,fit:'contain'},projection:{
        canvasWidth:1920,canvasHeight:1080,surfaces:[{
          id:'surface',canvasWidth:1920,canvasHeight:1080,
          input:{x:0,y:0,width:1920,height:1080},output:{x:0,y:0,width:100,height:100}
        }]
      }}
    };
    applyState(__state); renderScene(); renderMappedSurfaces();
  `);
  const audio = await win.webContents.executeJavaScript(`(() => {
    const canonical=document.getElementById('sceneRoot').querySelector('audio');
    const mapped=document.getElementById('mappingSurfaceHost').querySelector('audio');
    const initial={canonicalMuted:canonical.muted,mappedMuted:mapped.muted};
    __state.scenes[0].layers[0].volume=.2;
    applyState(__state);
    const fader={canonical:canonical.volume,mappedMuted:mapped.muted};
    __state._outputRoute.liveAudio=false;
    applyState(__state);
    return {initial,fader,canonicalMuted:canonical.muted,mappedMuted:mapped.muted};
  })()`);
  check('OUTPUT_MAPPING_AUDIO_UPDATES_CANONICAL_ONLY_OK', audio.initial.canonicalMuted === false && audio.initial.mappedMuted && audio.fader.canonical === .2 && audio.fader.mappedMuted, audio);
  check('OUTPUT_MAPPING_ROUTE_MUTE_APPLIES_IMMEDIATELY_OK', audio.canonicalMuted && audio.mappedMuted, audio);

  const geometry = await win.webContents.executeJavaScript(`(() => {
    const host=document.getElementById('mappingSurfaceHost');
    const before=host.firstElementChild.getBoundingClientRect().width;
    __state._outputRoute.outputCanvas={width:1000,height:1000,fit:'contain'};
    applyState(__state);renderScene();renderMappedSurfaces();
    const rect=host.firstElementChild.getBoundingClientRect();
    return {before,width:rect.width,height:rect.height,expected:Math.min(innerWidth,innerHeight)};
  })()`);
  check('OUTPUT_MAPPING_CANVAS_CHANGE_REBUILDS_GEOMETRY_OK', Math.abs(geometry.width-geometry.expected)<1 && Math.abs(geometry.height-geometry.expected)<1 && geometry.width!==geometry.before, geometry);

  const fading = await win.webContents.executeJavaScript(`(() => {
    __state._outputRoute.liveAudio=true;
    __state.sceneFadeMs=120;
    __state.scenes[0].layers[0].name='Changed visual';
    applyState(__state);renderScene();renderMappedSurfaces();
    const frames=[...document.getElementById('sceneRoot').children];
    window.__retiredFrame=frames[0];
    return {frames:frames.length,retiredMuted:frames[0].querySelector('audio').muted,currentMuted:frames.at(-1).querySelector('audio').muted};
  })()`);
  check('OUTPUT_SCENE_FADE_HAS_ONLY_CURRENT_AUDIO_OK', fading.frames===2 && fading.retiredMuted && !fading.currentMuted, fading);
  await new Promise(resolve => setTimeout(resolve, 320));
  const settled = await win.webContents.executeJavaScript(`(() => {
    renderMappedSurfaces();
    const canonical=document.getElementById('sceneRoot');
    const mapped=document.getElementById('mappingSurfaceHost');
    return {canonicalFrames:canonical.querySelectorAll('.scene-frame').length,mappedFrames:mapped.querySelectorAll('.scene-frame').length,
      canonicalOpacity:canonical.lastElementChild.style.opacity,mappedOpacity:mapped.querySelector('.scene-frame:last-child').style.opacity,
      retiredConnected:__retiredFrame.isConnected,retiredPaused:__retiredFrame.querySelector('audio').paused};
  })()`);
  check('OUTPUT_MAPPED_SCENE_FADE_REACHES_VISIBLE_FRAME_OK', settled.canonicalOpacity==='1' && settled.mappedOpacity==='1' && settled.canonicalFrames===1 && settled.mappedFrames===1 && !settled.retiredConnected && settled.retiredPaused, settled);

  const background = await win.webContents.executeJavaScript(`(() => {
    __state.transparent=true;
    applyState(__state);renderScene();renderMappedSurfaces();
    const clip=document.getElementById('mappingSurfaceHost').querySelector('.mapped-surface-clip');
    return {background:clip.style.background};
  })()`);
  check('OUTPUT_MAPPING_TRANSPARENCY_UPDATE_OK', background.background==='transparent', background);

  const placeholder = await win.webContents.executeJavaScript(`(() => {
    __state.sceneFadeMs=0;
    __state.scenes[0].layers=[{id:'camera',type:'capture',inputId:'camera',visible:true}];
    applyState(__state);renderScene();renderMappedSurfaces();
    const source=document.getElementById('programContent'),host=document.getElementById('mappingSurfaceHost');
    const before=host.querySelectorAll('.live-input-placeholder').length;
    source.querySelector('video').dispatchEvent(new Event('playing'));
    for(const clone of host.querySelectorAll('.mapped-program-clone'))syncMappedDynamic(source,clone);
    return {before,source:source.querySelectorAll('.live-input-placeholder').length,mapped:host.querySelectorAll('.live-input-placeholder').length};
  })()`);
  check('OUTPUT_MAPPED_LIVE_PLACEHOLDER_CLEARS_WITH_SOURCE_OK', placeholder.before===1 && placeholder.source===0 && placeholder.mapped===0, placeholder);

  const cleanup = await win.webContents.executeJavaScript(`(() => {
    __state.scenes[0].layers=[{id:'clip',type:'video',src:'data:video/mp4;base64,',playbackState:'paused',visible:true}];
    applyState(__state);renderScene();renderMappedSurfaces();
    const retired=document.getElementById('sceneRoot').querySelector('video');
    const attached=typeof retired.__showSlateTransportCleanup==='function';
    __state.scenes[0].layers=[];
    applyState(__state);renderScene();renderMappedSurfaces();
    return {attached,detached:!retired.isConnected,transportReleased:!retired.__showSlateTransportCleanup,src:retired.getAttribute('src')};
  })()`);
  check('OUTPUT_RETIRED_MEDIA_RELEASES_TRANSPORT_AND_SOURCE_OK', cleanup.attached && cleanup.detached && cleanup.transportReleased && cleanup.src===null, cleanup);

  await win.webContents.executeJavaScript(`(() => {
    __state.sceneFadeMs=500;
    __state.scenes[0].layers=[{id:'color',type:'color',color:'#f00'}];
    applyState(__state);renderScene();renderMappedSurfaces();
    window.__rapidRetired=document.getElementById('sceneRoot').lastElementChild;
    __state.scenes[0].layers=[{id:'color',type:'color',color:'#0f0'}];
    applyState(__state);renderScene();renderMappedSurfaces();
  })()`);
  await new Promise(resolve => setTimeout(resolve, 100));
  const rapid = await win.webContents.executeJavaScript(`({connected:__rapidRetired.isConnected,retiredOpacity:__rapidRetired.style.opacity,currentOpacity:document.getElementById('sceneRoot').lastElementChild.style.opacity})`);
  check('OUTPUT_RAPID_TAKE_CANNOT_REVIVE_RETIRED_FRAME_OK', rapid.connected && rapid.retiredOpacity==='0' && rapid.currentOpacity==='1', rapid);
  check('OUTPUT_LIFECYCLE_TEST_WINDOW_HIDDEN_OK', !win.isVisible());
  await win.webContents.executeJavaScript('liveInputConsumer.dispose()');
  assert.equal(failures.length, 0, failures.join('\n'));
  console.log('OUTPUT_LIFECYCLE_RENDERER_TESTS_OK count=' + checks);
  clearTimeout(deadline);
  finish(0);
}).catch(error => finish(1, error));
