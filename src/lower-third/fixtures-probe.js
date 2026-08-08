// ShowSlate — LT-1 codec/decode probe (test-only, main process).
// Kopira fixtures u tmp, učitava ih u SKRIVENOM prozoru (show:false, focusable:false —
// nikada vidljiv, nikada na HP-u) i vraća stvarne decode rezultate. Bez alpha-compositing
// tvrdnji: LT-1 dokazuje samo DECODE (alpha compositing je LT-2).
const fs = require('fs');
const path = require('path');
const os = require('os');

async function runFixtureProbe(BrowserWindow, fixturesDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'fixture-manifest.json'), 'utf8'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pts-lt-fixtures-'));
  const found = {};
  manifest.fixtures.forEach((f) => {
    if (f.present === false) { found[f.filename] = false; return; }
    const src = path.join(fixturesDir, f.filename);
    found[f.filename] = fs.existsSync(src);
    if (found[f.filename]) fs.copyFileSync(src, path.join(tmp, f.filename));
  });
  // probe.html živi u ISTOM tmp folderu kao fixtures ⇒ relativni file:// src; webSecurity je
  // isključen SAMO na ovom skrivenom test prozoru (učitava isključivo naše tmp fajlove) da bi
  // canvas alpha sampling nad file:// slikama radio bez taint greške. Nikad se ne prikazuje.
  fs.writeFileSync(path.join(tmp, 'probe.html'), '<html><body></body></html>');
  const win = new BrowserWindow({ show: false, focusable: false,
    webPreferences: { contextIsolation: true, backgroundThrottling: false, webSecurity: false } });
  await win.loadFile(path.join(tmp, 'probe.html'));
  const results = [];
  for (const f of manifest.fixtures) {
    if (f.present === false) { results.push({ filename: f.filename, skipped: true, reason: f.reason || 'not present' }); continue; }
    if (!found[f.filename]) { results.push({ filename: f.filename, ok: false, error: 'fixture missing on disk' }); continue; }
    const url = f.filename;   // relativno na probe.html u istom tmp folderu
    const isVideo = /\.(webm|mp4|mov)$/i.test(f.filename);
    const code = isVideo ? `(async function(){
        const out={ filename:${JSON.stringify(f.filename)} };
        try {
          const v=document.createElement('video'); v.muted=true; v.src=${JSON.stringify(url)};
          out.canPlayType = f=>0; out.canPlayType = document.createElement('video').canPlayType(${JSON.stringify(f.codec==='h264'?'video/mp4; codecs="avc1.42E01E"':(f.codec==='vp8'?'video/webm; codecs="vp8"':'video/webm; codecs="vp9"'))});
          const done = new Promise((res)=>{ v.addEventListener('loadeddata',()=>res('loadeddata'),{once:true}); v.addEventListener('error',()=>res('error'),{once:true}); setTimeout(()=>res('timeout'),6000); });
          document.body.appendChild(v);
          out.loadResult = await done;
          out.videoWidth=v.videoWidth; out.videoHeight=v.videoHeight; out.duration=Number(v.duration)||0;
          if(out.loadResult==='loadeddata'){
            try { await v.play(); out.playOk=true; } catch(e){ out.playOk=false; out.playErr=String(e && e.message); }
            try { v.currentTime=Math.min(0.4,(out.duration||1)/2); await new Promise(r=>{v.addEventListener('seeked',r,{once:true}); setTimeout(r,1500);}); out.seekOk=Math.abs(v.currentTime-Math.min(0.4,(out.duration||1)/2))<0.35; } catch(e){ out.seekOk=false; }
            ${f.loopTest ? "v.loop=true; const ct0=v.currentTime; await new Promise(r=>setTimeout(r,1600)); out.loopOk=!v.ended;" :
              "v.loop=false; const waitEnd=new Promise(res=>{v.addEventListener('ended',()=>res(true),{once:true}); setTimeout(()=>res(false),4000);}); v.currentTime=0; try{await v.play();}catch(e){} out.endedOk=await waitEnd;"}
          }
          v.pause(); v.remove();
          out.ok = ${f.expectError ? "out.loadResult==='error'" : "out.loadResult==='loadeddata' && out.videoWidth===" + (f.width||0)};
        } catch(e){ out.ok=${f.expectError ? 'true' : 'false'}; out.error=String(e && e.message); }
        return JSON.stringify(out);
      })()` : `(async function(){
        const out={ filename:${JSON.stringify(f.filename)} };
        try {
          const img=new Image();
          const done=new Promise((res)=>{ img.onload=()=>res('load'); img.onerror=()=>res('error'); setTimeout(()=>res('timeout'),5000); });
          img.src=${JSON.stringify(url)};
          out.loadResult=await done;
          out.naturalWidth=img.naturalWidth; out.naturalHeight=img.naturalHeight;
          if(out.loadResult==='load' && ${JSON.stringify(!!f.alpha)}){
            const c=document.createElement('canvas'); c.width=img.naturalWidth; c.height=img.naturalHeight;
            const x=c.getContext('2d'); x.drawImage(img,0,0);
            const sp=${JSON.stringify(manifest.samplePoints)};
            const a=(p)=>x.getImageData(p.x,p.y,1,1).data[3];
            out.alphaOpaque=a(sp.opaque); out.alphaSemi=a(sp.semi); out.alphaTransparent=a(sp.transparent);
            out.alphaOk = out.alphaOpaque>=250 && out.alphaTransparent<=5 && Math.abs(out.alphaSemi-sp.semi.expectedAlpha)<=(sp.semi.tolerance||40);
          }
          out.ok = out.loadResult==='load' && out.naturalWidth===${f.width||0};
        } catch(e){ out.ok=false; out.error=String(e && e.message); }
        return JSON.stringify(out);
      })()`;
    try { results.push(JSON.parse(await win.webContents.executeJavaScript(code))); }
    catch (e) { results.push({ filename: f.filename, ok: !!f.expectError, error: 'probe exec: ' + e.message }); }
  }
  try { win.destroy(); } catch (e) {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  return { versions: { electron: process.versions.electron, chrome: process.versions.chrome }, results };
}

module.exports = { runFixtureProbe };
