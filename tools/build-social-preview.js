'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '..');

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1600,
    height: 900,
    show: false,
    useContentSize: true,
    backgroundColor: '#0c0f12',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  await window.loadFile(path.join(root, 'build', 'banner.html'));
  await new Promise(resolve => setTimeout(resolve, 120));
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: 1600, height: 900 });
  const output = path.join(root, 'site', 'assets', 'social-preview.png');
  fs.writeFileSync(output, image.toPNG());
  console.log(`SOCIAL_PREVIEW_BUILT=${output}`);
  window.destroy();
  app.quit();
}).catch(error => {
  console.error(error && error.stack || error);
  app.exit(1);
});
