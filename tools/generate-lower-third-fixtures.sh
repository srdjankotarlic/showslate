#!/bin/bash
# ShowSlate — synthetic LT test fixtures (LT-1). Run manually during development;
# ffmpeg NIJE runtime zavisnost aplikacije. Rezultati se COMMITUJU (deterministički pattern).
# Pattern (320x180): leva trećina NEPROZIRNA lime, srednja 50% lime, desna POTPUNO transparentna,
# beli pokretni kvadrat preko (motion). Sample tačke: (30,90) a=255, (160,90) a≈128, (290,90) a=0.
set -e
cd "$(dirname "$0")/../test/fixtures/lower-third"
FF="ffmpeg -hide_banner -loglevel error -y"
# NAPOMENA: raniji drawbox pristup ne upisuje alfa preko transparentne osnove -> geq trake
ABANDS="if(lt(X\,107)\,255\,if(lt(X\,213)\,128\,0))"
BANDS="geq=r=0:g=255:b=0:a=$ABANDS"
VBANDS="geq=lum='lum(X\,Y)':cb='cb(X\,Y)':cr='cr(X\,Y)':a=$ABANDS"
ALPHASRC="color=lime:s=320x180:d=1.2,format=yuva420p,$VBANDS"
MOVE=";color=white:s=36x36:d=1.2,format=yuva420p[box];[bg][box]overlay=x='40+t*180':y=72:shortest=1,format=yuva420p"
# statične slike
$FF -f lavfi -i "color=lime:s=320x180,format=rgba,$BANDS" -frames:v 1 alpha-static.png
($FF -f lavfi -i "color=lime:s=320x180,format=rgba,$BANDS" -frames:v 1 -c:v libwebp -lossless 1 alpha-static.webp) || echo "SKIP alpha-static.webp (libwebp encoder nije u ovom ffmpeg buildu - dokumentovano u manifestu)"
$FF -f lavfi -i "testsrc2=s=320x180:d=1" -frames:v 1 -q:v 4 opaque-static.jpg
# alpha video (libvpx yuva420p; -auto-alt-ref 0 OBAVEZNO za VP8 alpha)
$FF -f lavfi -i "$ALPHASRC[bg]$MOVE" -filter_complex_threads 1 -c:v libvpx     -pix_fmt yuva420p -auto-alt-ref 0 -b:v 300k -an alpha-vp8.webm
$FF -f lavfi -i "$ALPHASRC[bg]$MOVE" -filter_complex_threads 1 -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 300k -an alpha-vp9.webm
# intro/hold/outro varijante (različite boje radi identifikacije)
$FF -f lavfi -i "color=cyan:s=320x180:d=1,format=yuva420p,$VBANDS" -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 200k -an intro-alpha.webm
$FF -f lavfi -i "color=magenta:s=320x180:d=1,format=yuva420p,$VBANDS" -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 200k -an hold-loop-alpha.webm
$FF -f lavfi -i "color=yellow:s=320x180:d=1,format=yuva420p,$VBANDS" -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 200k -an outro-alpha.webm
# opaque H.264
$FF -f lavfi -i "testsrc2=s=320x180:d=1" -c:v libx264 -pix_fmt yuv420p -profile:v baseline -an opaque-h264.mp4
# SVG (ručno, tri regiona)
cat > alpha-static.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect x="0" width="107" height="180" fill="lime"/><rect x="107" width="106" height="180" fill="lime" fill-opacity="0.5"/></svg>
SVG
# korumpiran video = prvih 300 bajtova validnog
head -c 300 alpha-vp8.webm > corrupt-video.webm
ls -la
