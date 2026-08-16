'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, screen } = require('electron');
const smokeDisplay = require('../tools/smoke-display.js');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts', 'generated', 'site');
const releaseVersion = require('../package.json').version;
let checks = 0;

function check(name, condition, detail = '') {
  console.log(`${name}=${!!condition}${detail ? ` ${detail}` : ''}`);
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
  checks++;
}

async function settled(window) {
  await window.webContents.executeJavaScript(`(async function(){
    document.documentElement.style.scrollBehavior='auto';
    document.querySelectorAll('img').forEach(image=>{ image.loading='eager'; });
    window.scrollTo(0,document.documentElement.scrollHeight);
    await new Promise(resolve=>setTimeout(resolve,250));
    window.scrollTo(0,0);
    await new Promise(resolve=>setTimeout(resolve,80));
  })()`);
  await new Promise(resolve => setTimeout(resolve, 120));
}

app.whenReady().then(async () => {
  const target = smokeDisplay.resolveTargetDisplay(screen, { root }).display;
  check('SITE_TARGET_DISPLAY_OK', !!target, target ? target.label : 'missing');
  fs.mkdirSync(artifacts, { recursive: true });
  const window = new BrowserWindow({
    ...smokeDisplay.clampToWorkArea({ width: 1280, height: 800 }, target.workArea),
    show: true,
    useContentSize: true,
    backgroundColor: '#0b0e12',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  await window.loadFile(path.join(root, 'site', 'index.html'));
  await settled(window);

  const desktop = JSON.parse(await window.webContents.executeJavaScript(`JSON.stringify((()=>{
    const hero=document.querySelector('.hero').getBoundingClientRect();
    const next=document.querySelector('.problem-band').getBoundingClientRect();
    const nextContent=document.querySelector('.problem-band .eyebrow').getBoundingClientRect();
    const title=document.querySelector('h1').getBoundingClientRect();
    const heroLinks=[...document.querySelectorAll('.hero-actions a')].map(link=>link.href);
    const installerLinks=[...document.querySelectorAll('a[href*="/releases/download/"]')].map(link=>link.href);
    return {width:innerWidth,height:innerHeight,scrollY,scrollWidth:document.documentElement.scrollWidth,heroTop:hero.top,heroBottom:hero.bottom,nextTop:next.top,nextContentTop:nextContent.top,title:{left:title.left,right:title.right,top:title.top,bottom:title.bottom},heroLinks,installerLinks,images:[...document.images].map(image=>({src:image.getAttribute('src'),ok:image.naturalWidth>0}))};
  })())`));
  check('SITE_DESKTOP_NO_HORIZONTAL_OVERFLOW_OK', desktop.scrollWidth <= desktop.width, JSON.stringify(desktop));
  check('SITE_DESKTOP_HERO_AND_NEXT_SECTION_OK', desktop.scrollY === 0 && desktop.heroTop >= 0 && desktop.title.left >= 0 && desktop.title.right <= desktop.width && desktop.title.top >= 0 && desktop.title.bottom <= desktop.height && desktop.nextTop > 0 && desktop.nextTop < desktop.height && desktop.nextContentTop > 0 && desktop.nextContentTop < desktop.height, JSON.stringify(desktop));
  check('SITE_DOWNLOADS_AND_REAL_IMAGES_OK', desktop.heroLinks[0].includes(`v${releaseVersion}`) && desktop.installerLinks.some(url=>url.endsWith('.dmg')) && desktop.installerLinks.some(url=>url.endsWith('.exe')) && desktop.installerLinks.every(url=>url.includes(`v${releaseVersion}`)) && desktop.images.every(image=>image.ok), JSON.stringify({heroLinks:desktop.heroLinks,installerLinks:desktop.installerLinks,images:desktop.images}));
  fs.writeFileSync(path.join(artifacts, 'desktop.png'), (await window.webContents.capturePage()).toPNG());

  window.setBounds(smokeDisplay.clampToWorkArea({ width: 1100, height: 700 }, target.workArea));
  await settled(window);
  const compactDesktop = JSON.parse(await window.webContents.executeJavaScript(`JSON.stringify((()=>{
    const hero=document.querySelector('.hero').getBoundingClientRect();
    const next=document.querySelector('.problem-band').getBoundingClientRect();
    const nextContent=document.querySelector('.problem-band .eyebrow').getBoundingClientRect();
    return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,heroBottom:hero.bottom,nextTop:next.top,nextContentTop:nextContent.top};
  })())`));
  check('SITE_COMPACT_DESKTOP_LEAVES_NEXT_SECTION_HINT_OK', compactDesktop.scrollWidth <= compactDesktop.width && compactDesktop.heroBottom <= compactDesktop.height && compactDesktop.nextTop > 0 && compactDesktop.nextTop < compactDesktop.height && compactDesktop.nextContentTop > 0 && compactDesktop.nextContentTop < compactDesktop.height, JSON.stringify(compactDesktop));

  window.setBounds(smokeDisplay.clampToWorkArea({ width: 390, height: 844 }, target.workArea));
  await settled(window);
  const mobile = JSON.parse(await window.webContents.executeJavaScript(`JSON.stringify((()=>{
    const title=document.querySelector('h1').getBoundingClientRect();
    const actions=document.querySelector('.hero-actions').getBoundingClientRect();
    const next=document.querySelector('.problem-band').getBoundingClientRect();
    return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,title:{left:title.left,right:title.right,bottom:title.bottom},actions:{left:actions.left,right:actions.right,bottom:actions.bottom},nextTop:next.top};
  })())`));
  check('SITE_MOBILE_NO_HORIZONTAL_OVERFLOW_OK', mobile.scrollWidth <= mobile.width, JSON.stringify(mobile));
  check('SITE_MOBILE_PRIMARY_CONTENT_FITS_OK', mobile.title.left >= 0 && mobile.title.right <= mobile.width && mobile.title.bottom > 0 && mobile.title.bottom <= mobile.height && mobile.actions.left >= 0 && mobile.actions.right <= mobile.width && mobile.actions.bottom > 0 && mobile.actions.bottom <= mobile.height, JSON.stringify(mobile));
  check('SITE_MOBILE_LEAVES_NEXT_SECTION_HINT_OK', mobile.nextTop > 0 && mobile.nextTop < mobile.height, JSON.stringify(mobile));
  fs.writeFileSync(path.join(artifacts, 'mobile.png'), (await window.webContents.capturePage()).toPNG());

  console.log(`SITE_RENDERER_TESTS_OK ${checks}/8`);
  window.destroy();
  app.quit();
}).catch(error => {
  console.error(error && error.stack || error);
  app.exit(1);
});
