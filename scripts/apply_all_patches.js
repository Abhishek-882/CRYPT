const { execSync } = require('child_process');
const path = require('path');

const nodeExe = 'C:\\Program Files\\nodejs\\node.exe';
const rootDir = 'C:\\AI-Hedge-Cockpit';
const patches = [
  'scripts/patch_auth_helper.js',
  'scripts/update_auth_route.js',
  'scripts/patch_user_store.js',
  'scripts/patch_r1_funding_sync.js',
  'scripts/setup_active_bots.js'
];

for (const patch of patches) {
  const fullPath = path.join(rootDir, patch);
  console.log(`Running ${fullPath}...`);
  execSync(`"${nodeExe}" "${fullPath}"`, { cwd: rootDir, stdio: 'inherit' });
}

console.log('All safeguard patches successfully applied.');
