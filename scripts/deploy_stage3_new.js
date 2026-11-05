const fs = require('fs');
const path = require('path');

const srcDir = 'C:\\AI-Hedge-Cockpit-Incoming\\stage3_new_unpack';
const dstDir = 'C:\\AI-Hedge-Cockpit';

const skipFiles = new Set([
  '.git',
  'node_modules',
  'web/.next',
  'web/node_modules',
  'web/.env.local',
  '.env.local',
  'web/.vault_master_key',
  '.vault_master_key',
  'web/bot_daemon.lock',
  'bot_daemon.lock'
]);

function copyRecursive(src, dst, relBase = '') {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const rel = relBase ? path.join(relBase, entry.name) : entry.name;
    const relNorm = rel.replace(/\\/g, '/');
    if (skipFiles.has(relNorm) || relNorm.startsWith('.git/') || relNorm.includes('/node_modules/') || relNorm.includes('/.next/')) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);

    if (entry.isDirectory()) {
      if (!fs.existsSync(dstPath)) {
        fs.mkdirSync(dstPath, { recursive: true });
      }
      copyRecursive(srcPath, dstPath, rel);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

console.log('Synchronizing new files from stage3_new_unpack into C:\\AI-Hedge-Cockpit...');
copyRecursive(srcDir, dstDir);
console.log('Synchronization complete.');
