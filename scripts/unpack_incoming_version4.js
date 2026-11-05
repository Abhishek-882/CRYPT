const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const zipFile = 'C:\\Users\\Administrator\\Desktop\\SafeCoiner_version4.zip';
const targetDir = 'C:\\AI-Hedge-Cockpit-Incoming\\version4_unpack';

console.log('Unpacking', zipFile, 'to', targetDir);
if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, force: true });
}
fs.mkdirSync(targetDir, { recursive: true });

try {
  execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipFile}' -DestinationPath '${targetDir}' -Force"`, { stdio: 'inherit' });
  console.log('Successfully expanded version4 archive.');
  
  const files = fs.readdirSync(targetDir);
  console.log('Top level files/dirs in version 4 unpack:', files);
} catch (err) {
  console.error('Failed to unpack:', err.message);
}
