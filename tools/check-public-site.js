'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const siteDir = path.join(root, 'site');
const indexPath = path.join(siteDir, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const releaseNotes = fs.readFileSync(path.join(root, 'docs', 'RELEASE-NOTES-0.9.0-beta.3.md'), 'utf8');
const failures = [];

const macInstallerUrl = 'https://github.com/srdjankotarlic/showslate/releases/download/v0.9.0-beta.3/ShowSlate-0.9.0-beta.3-arm64.dmg';
const windowsInstallerUrl = 'https://github.com/srdjankotarlic/showslate/releases/download/v0.9.0-beta.3/ShowSlate-Setup-0.9.0-beta.3.exe';

const requiredSnippets = [
  '<meta name="google-site-verification"',
  '<link rel="canonical" href="https://srdjankotarlic.github.io/showslate/">',
  '<meta property="og:image"',
  '<meta name="twitter:card" content="summary_large_image">',
  '"@type": "SoftwareApplication"',
  '"@type": "FAQPage"',
  'https://github.com/srdjankotarlic/showslate/releases/tag/v0.9.0-beta.3',
  'https://github.com/srdjankotarlic/showslate/discussions',
  macInstallerUrl,
  windowsInstallerUrl,
  'https://srdjankotarlic.github.io/protimer/',
  "GitHub's automatic <code>Source code</code>",
];

for (const snippet of requiredSnippets) {
  if (!html.includes(snippet)) failures.push(`missing required site metadata: ${snippet}`);
}

for (const [name, content] of [
  ['site/index.html', html],
  ['release notes', releaseNotes],
]) {
  if (/ProTimer Studio|protimer-studio|ProTimer-Studio/.test(content)) {
    failures.push(`${name} still exposes the former public brand`);
  }
}
if (/github\.com\/srdjankotarlic\/protimer-studio|github\.io\/protimer-studio/.test(readme)) {
  failures.push('README.md still links to the former repository or product page');
}

for (const [name, content] of [
  ['README.md', readme],
  ['release notes', releaseNotes],
]) {
  if (!content.includes(macInstallerUrl)) failures.push(`${name} is missing the recommended macOS installer`);
  if (!content.includes(windowsInstallerUrl)) failures.push(`${name} is missing the recommended Windows installer`);
  if (!/Source code[\s\S]{0,180}(?:will not install|do not contain an installer)/i.test(content)) {
    failures.push(`${name} does not warn that GitHub source archives are not installers`);
  }
}

const description = html.match(/<meta name="description" content="([^"]+)">/i)?.[1] || '';
if (description.length < 80 || description.length > 170) {
  failures.push(`meta description must be 80-170 characters (found ${description.length})`);
}

const localReferences = new Set();
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const reference = match[1];
  if (/^(?:https?:|#|mailto:|tel:)/i.test(reference)) continue;
  const clean = reference.split('#')[0].split('?')[0];
  if (clean) localReferences.add(clean);
}

for (const reference of localReferences) {
  const resolved = path.resolve(siteDir, reference);
  if (!resolved.startsWith(`${siteDir}${path.sep}`) || !fs.existsSync(resolved)) {
    failures.push(`missing or unsafe local site reference: ${reference}`);
  }
}

const jsonLdBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
if (jsonLdBlocks.length !== 2) failures.push(`expected 2 JSON-LD blocks (found ${jsonLdBlocks.length})`);
for (const [index, match] of jsonLdBlocks.entries()) {
  try {
    JSON.parse(match[1]);
  } catch (error) {
    failures.push(`invalid JSON-LD block ${index + 1}: ${error.message}`);
  }
}

const robots = fs.readFileSync(path.join(siteDir, 'robots.txt'), 'utf8');
const sitemap = fs.readFileSync(path.join(siteDir, 'sitemap.xml'), 'utf8');
if (!robots.includes('Sitemap: https://srdjankotarlic.github.io/showslate/sitemap.xml')) {
  failures.push('robots.txt does not advertise the canonical sitemap');
}
if (!sitemap.includes('<loc>https://srdjankotarlic.github.io/showslate/</loc>')) {
  failures.push('sitemap.xml does not contain the canonical page URL');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`PUBLIC_SITE_CHECK_OK=true localReferences=${localReferences.size} jsonLd=${jsonLdBlocks.length}`);
