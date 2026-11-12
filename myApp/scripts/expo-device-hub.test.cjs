const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');

function load({ platform = 'darwin', simulator = false, hub = true, openError } = {}) {
  const calls = [];
  const module = { exports: {} };
  runInNewContext(readFileSync(join(__dirname, 'expo-device-hub.cjs'), 'utf8'), {
    module,
    process: { platform },
    require(name) {
      if (name === 'node:fs') return {
        existsSync: (path) => path.endsWith('/Simulator.app') ? simulator : hub,
      };
      if (name === 'node:child_process') return {
        execFileSync: () => '/Applications/Xcode.app/Contents/Developer\n',
        execFile(command, args, callback) {
          calls.push([command, ...args]);
          callback(openError, '', '');
        },
      };
      return require(name);
    },
  });
  return { ...module.exports, calls };
}

test('opens the requested device in Device Hub', async () => {
  const hub = load();
  assert.equal(await hub.openDeviceHub({ udid: 'device-123' }), true);
  assert.deepEqual(hub.calls, [[
    'open', '-a', '/Applications/Xcode.app/Contents/Applications/DeviceHub.app',
    'devices://device/open?id=device-123',
  ]]);
});

test('retains the existing launcher on older Xcode and other platforms', async () => {
  for (const options of [{ simulator: true }, { hub: false }, { platform: 'linux' }]) {
    const hub = load(options);
    assert.equal(await hub.openDeviceHub({}), false);
    assert.equal(hub.calls.length, 0);
  }
});

test('reports launch failures instead of claiming success', async () => {
  const hub = load({ openError: new Error('Launch failed') });
  await assert.rejects(hub.openDeviceHub({}), /Launch failed/);
});
