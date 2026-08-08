// ShowSlate display inventory tool. `npm run displays:list`
// Prints every connected monitor and writes artifacts/test-display/display-inventory.txt.
// Read-only: opens NO app windows, changes nothing.
const { app, screen } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

app.whenReady().then(() => {
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  const lines = [];
  const push = (s) => { lines.push(s); };
  push('DISPLAY INVENTORY  (' + displays.length + ' monitors)');
  push('generated: ' + new Date().toISOString());
  push('');
  displays.forEach((d, i) => {
    push('Display ' + (i + 1));
    push('  ID:          ' + d.id);
    push('  Label:       ' + (d.label || '(none)'));
    push('  Bounds:      ' + JSON.stringify(d.bounds));
    push('  WorkArea:    ' + JSON.stringify(d.workArea));
    push('  WorkAreaSize:' + JSON.stringify(d.workAreaSize));
    push('  ScaleFactor: ' + d.scaleFactor);
    push('  Rotation:    ' + d.rotation);
    push('  Internal:    ' + !!d.internal);
    push('  Primary:     ' + (d.id === primaryId));
    push('');
  });
  const out = lines.join('\n');
  console.log(out);
  try {
    const dir = path.join(__dirname, '..', 'artifacts', 'test-display');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'display-inventory.txt'), out + '\n');
    console.log('WROTE artifacts/test-display/display-inventory.txt');
  } catch (e) { console.error('write failed:', e.message); }
  app.exit(0);
});
