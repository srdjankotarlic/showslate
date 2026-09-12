'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const controlApi = require('../src/control-api/commands.js');

const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const start = main.indexOf('function parseOSC(');
const end = main.indexOf('function startOSC(', start);
assert.ok(start >= 0 && end > start, 'Production OSC parser exists');
const context = {};
vm.runInNewContext(main.slice(start, end), context, { filename: 'main.js:parseOSC' });

function oscString(value) {
  const bytes = Buffer.from(String(value) + '\0');
  return Buffer.concat([bytes, Buffer.alloc((4 - bytes.length % 4) % 4)]);
}
function packet(address, tags = '', payload = Buffer.alloc(0)) {
  return Buffer.concat([oscString(address), oscString(',' + tags), payload]);
}
function commandFor(bytes) {
  const message = context.parseOSC(bytes);
  assert.ok(message);
  return controlApi.normalizeCommand({
    type: message.address.replace(/^\/(showslate|protimer)\//, ''),
    value: message.args[0]
  });
}

let checked = 0;
for (const prefix of ['/showslate/', '/protimer/']) {
  for (const [tag, expected] of [['T', true], ['F', false]]) {
    for (const action of ['blackout', 'lt/auto', 'screen/text-only']) {
      const result = commandFor(packet(prefix + action, tag));
      assert.strictEqual(result.ok, true, `${action} accepts OSC ${tag}`);
      assert.strictEqual(result.command.value, expected, `${action} receives an explicit boolean, never a toggle`);
      checked++;
    }
  }
}

const number = Buffer.alloc(4);
number.writeInt32BE(42);
const mixed = context.parseOSC(packet('/showslate/blackout', 'TFi', number));
assert.deepStrictEqual(Array.from(mixed.args), [true, false, 42], 'Boolean tags consume no argument bytes');
checked++;

assert.strictEqual(commandFor(packet('/showslate/blackout', 's', oscString('off'))).command.value, false);
assert.strictEqual(commandFor(packet('/showslate/adjust', 'i', number)).command.value, 42);
assert.deepStrictEqual(commandFor(packet('/showslate/blackout')).command, { type: 'blackout' });
assert.deepStrictEqual(commandFor(oscString('/protimer/go')).command, { type: 'go' });
checked += 4;
console.log(`OSC_PARSER_TESTS_OK count=${checked}`);
