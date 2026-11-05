const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const srcDir = 'C:\\AI-Hedge-Cockpit';
const backupDir = 'C:\\AI-Hedge-Cockpit-Stage3-Old-Backup';
const zipTargetDir = 'C:\\AI-Hedge-Cockpit-Backups';
const zipTarget = path.join(zipTargetDir, 'ai-hedge-cockpit-stage3-old-backup.zip');
const downloadsZip = 'C:\\Users\\Administrator\\Downloads\\ai-hedge-cockpit-stage3-old-backup.zip';

console.log('--- Step 1: Mirror directory snapshot ---');
if (fs.existsSync(backupDir)) {
  fs.rmSync(backupDir, { recursive: true, force: true });
}
fs.mkdirSync(backupDir, { recursive: true });

try {
  // Robocopy returns exit code 0-7 for success
  execSync(`robocopy "${srcDir}" "${backupDir}" /E /XD node_modules .next /R:2 /W:2 /NFL /NDL /NP`, { stdio: 'inherit' });
} catch (e) {
  if (e.status && e.status <= 7) {
    console.log(`Robocopy succeeded with status ${e.status}`);
  } else {
    console.error('Robocopy error:', e.message);
  }
}

console.log('--- Step 2: Create standalone zip archive ---');
if (!fs.existsSync(zipTargetDir)) {
  fs.mkdirSync(zipTargetDir, { recursive: true });
}

try {
  // Use PowerShell Compress-Archive without variable stripping
  const psCmd = `powershell -NoProfile -Command "Compress-Archive -Path '${backupDir}\\*' -DestinationPath '${zipTarget}' -Force"`;
  console.log('Compressing to', zipTarget);
  execSync(psCmd, { stdio: 'inherit' });
  console.log('Created zip at', zipTarget);
  
  fs.copyFileSync(zipTarget, downloadsZip);
  console.log('Copied zip to', downloadsZip);

  const stats = fs.statSync(zipTarget);
  console.log(`Archive size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
} catch (err) {
  console.error('Zip creation error:', err.message);
}

console.log('Backup completed successfully.');
