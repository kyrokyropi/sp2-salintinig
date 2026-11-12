const { execFileSync, execFile } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { promisify } = require('node:util');

function getDeviceHubPath() {
  if (process.platform !== 'darwin') return null;
  const developerDir = execFileSync('xcode-select', ['-p'], { encoding: 'utf8' }).trim();
  if (existsSync(join(developerDir, 'Applications/Simulator.app'))) return null;
  const app = join(developerDir, '../Applications/DeviceHub.app');
  return existsSync(app) ? app : null;
}

async function openDeviceHub(device) {
  const app = getDeviceHubPath();
  if (!app) return false;
  const args = ['-a', app];
  if (device.udid) args.push(`devices://device/open?id=${encodeURIComponent(device.udid)}`);
  await promisify(execFile)('open', args);
  return true;
}

module.exports = { getDeviceHubPath, openDeviceHub };
