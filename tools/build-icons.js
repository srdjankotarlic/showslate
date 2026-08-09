'use strict';

const { app, BrowserWindow, nativeImage } = require('electron');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const svgPath = path.join(root, 'build', 'icon.svg');
const iconsetPath = path.join(root, 'build', 'icon.iconset');
const renderPath = path.join(root, 'build', '.icon-render.html');

const iconset = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_64x64.png', 64],
  ['icon_64x64@2x.png', 128],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
];

async function renderMasterPng() {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true, backgroundThrottling: false }
  });
  try {
    await win.loadFile(renderPath);
    await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const image = document.querySelector('img');
      if (image.complete && image.naturalWidth) return resolve(true);
      image.addEventListener('load', () => resolve(true), { once: true });
      image.addEventListener('error', () => reject(new Error('SVG image failed to load')), { once: true });
    })`);
    return (await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })).toPNG();
  } finally {
    win.destroy();
  }
}

app.whenReady().then(async () => {
  fs.accessSync(svgPath, fs.constants.R_OK);
  fs.mkdirSync(iconsetPath, { recursive: true });
  fs.writeFileSync(renderPath, '<!doctype html><style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}img{display:block;width:100%;height:100%}</style><img src="icon.svg" alt="">');
  const cache = new Map();
  try {
    const master = await renderMasterPng();
    for (const [name, size] of iconset) {
      if (!cache.has(size)) {
        const png = size === 1024 ? master : nativeImage.createFromBuffer(master).resize({ width: size, height: size, quality: 'best' }).toPNG();
        cache.set(size, png);
      }
      fs.writeFileSync(path.join(iconsetPath, name), cache.get(size));
    }
  } finally {
    fs.rmSync(renderPath, { force: true });
  }
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), cache.get(1024));
  fs.writeFileSync(path.join(root, 'site', 'assets', 'icon.png'), cache.get(512));

  if (process.platform === 'darwin') {
    const result = spawnSync('iconutil', ['-c', 'icns', iconsetPath, '-o', path.join(root, 'build', 'icon.icns')], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'iconutil failed').trim());
  }
  console.log('ICON_ASSETS_OK sizes=' + [...cache.keys()].join(','));
  app.quit();
}).catch(error => {
  console.error(error && error.stack || error);
  app.exit(1);
});
