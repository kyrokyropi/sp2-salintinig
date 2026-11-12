// shortcut: SDK 54 lacks Device Hub support; remove this backport after upgrading Expo.
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const cli = dirname(require.resolve('@expo/cli/package.json', {
  paths: [dirname(require.resolve('expo/package.json'))],
}));
assert.match(require(join(cli, 'package.json')).version, /^54\./,
  'Review/remove the Device Hub backport when upgrading Expo.');
const root = join(cli, 'build/src/start');
const marker = '// salintinig: Device Hub backport';
const patches = [
  ['doctor/apple/SimulatorAppPrerequisite.js',
    'async function getSimulatorAppIdAsync() {',
    `async function getSimulatorAppIdAsync() {
    const hub = require('../../platforms/ios/deviceHub').getDeviceHubPath();
    if (hub) {
        const { stdout } = await (0, _spawnasync().default)('defaults', [
            'read', hub + '/Contents/Info.plist', 'CFBundleIdentifier'
        ]);
        return stdout.trim();
    }`,
    "result !== 'com.apple.iphonesimulator'",
    "result !== 'com.apple.dt.Devices' && result !== 'com.apple.iphonesimulator'"],
  ['platforms/ios/ensureSimulatorAppRunning.js',
    'async function ensureSimulatorAppRunningAsync(device, { maxWaitTime } = {}) {',
    `async function ensureSimulatorAppRunningAsync(device, { maxWaitTime } = {}) {
    if (await require('./deviceHub').openDeviceHub(device)) return;`],
  ['platforms/ios/AppleDeviceManager.js',
    'async activateWindowAsync() {',
    `async activateWindowAsync() {
        if (await require('./deviceHub').openDeviceHub(this.device)) return;`],
];

// Validate every replacement before writing any dependency files.
const updates = patches.map(([file, ...replacements]) => {
  const path = join(root, file);
  let source = readFileSync(path, 'utf8');
  if (source.includes(marker)) return [path, source];
  for (let i = 0; i < replacements.length; i += 2) {
    const [before, after] = replacements.slice(i, i + 2);
    assert.equal(source.split(before).length, 2, `Expo CLI changed: review ${file}`);
    source = source.replace(before, after);
  }
  return [path, `${marker}\n${source}`];
});
writeFileSync(join(root, 'platforms/ios/deviceHub.js'),
  readFileSync(join(__dirname, 'expo-device-hub.cjs')));
for (const [path, source] of updates) writeFileSync(path, source);
console.log('Applied Expo SDK 54 Device Hub compatibility fix.');
