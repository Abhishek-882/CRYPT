const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const zipFile = 'C:\\Users\\Administrator\\Desktop\\SafeCoiner_Stage3_Production_Cockpit_new.zip';
const targetDir = 'C:\\AI-Hedge-Cockpit-Incoming\\stage3_new_unpack';

console.log('Unpacking', zipFile, 'to', targetDir);
if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, force: true });
}
fs.mkdirSync(targetDir, { recursive: true });

try {
  // PowerShell Expand-Archive
  execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipFile}' -DestinationPath '${targetDir}' -Force"`, { stdio: 'inherit' });
  console.log('Successfully expanded archive.');
  
  const files = fs.readdirSync(targetDir);
  console.log('Top level files/dirs in unpack:', files);
} catch (err) {
  console.error('Failed to unpack:', err.message);
}
