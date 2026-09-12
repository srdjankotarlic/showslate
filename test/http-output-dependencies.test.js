'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const start = main.indexOf('function startServer(');
const end = main.indexOf('// media://', start);
assert.ok(start >= 0 && end > start, 'Production HTTP handler is available');

let requestHandler;
const context = {
  __dirname: root, fs, path, console, URLSearchParams,
  statusSectionForPath: () => null,
  pushNetworkInfo() {},
  http: { createServer(handler) {
    requestHandler = handler;
    return { on() {}, listen(port, host, ready) { ready(); } };
  } }
};
vm.runInNewContext(main.slice(start, end), context, { filename: 'main.js:http-output' });
context.startServer(7878);

function request(url) {
  const result = { status: 0, headers: {}, body: '' };
  requestHandler({ url, method: 'GET', headers: {} }, {
    writeHead(status, headers = {}) { result.status = status; result.headers = headers; },
    end(body = '') { result.body = String(body); }
  });
  return result;
}

let checked = 0;
for (const route of ['/', '/output.html', '/remote', '/backstage', '/signal']) {
  const page = request(route);
  assert.strictEqual(page.status, 200, `Browser page must load: ${route}`);
  const scripts = [...page.body.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1]);
  assert.ok(scripts.length, `Browser page declares its dependencies: ${route}`);
  for (const script of scripts) {
    const url = new URL(script, 'http://showslate.test' + route);
    assert.strictEqual(url.origin, 'http://showslate.test');
    const asset = request(url.pathname + url.search);
    assert.strictEqual(asset.status, 200, `${route} requires ${url.pathname}`);
    assert.match(asset.headers['Content-Type'], /javascript/, `Dependency must be served as JavaScript: ${script}`);
    assert.strictEqual(asset.body, fs.readFileSync(path.join(root, url.pathname.slice(1)), 'utf8'));
    checked++;
  }
}
assert.strictEqual(request('/src/show-storage/repository.js').status, 404, 'The public asset whitelist stays explicit');
console.log(`HTTP_OUTPUT_DEPENDENCIES_OK count=${checked}`);
