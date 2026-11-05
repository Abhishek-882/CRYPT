const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const inputHtml = 'C:\\AI-Hedge-Cockpit\\journey_summary.html';
const outputPdf = 'C:\\AI-Hedge-Cockpit\\autonomous_trading_bot_journey.pdf';

const args = [
  '--headless=new',
  '--disable-gpu',
  '--no-pdf-header-footer',
  `--print-to-pdf=${outputPdf}`,
  inputHtml
];

console.log('Running Chrome with args:', args);
const result = spawnSync(chromePath, args, { stdio: 'pipe' });

console.log('Exit code:', result.status);
if (result.stderr) console.log('Stderr:', result.stderr.toString());
if (result.stdout) console.log('Stdout:', result.stdout.toString());

if (fs.existsSync(outputPdf)) {
  const stat = fs.statSync(outputPdf);
  console.log(`Success! PDF generated at ${outputPdf} (${stat.size} bytes)`);
  
  // Copy to Downloads & Artifacts
  const downloadsPath = 'C:\\Users\\Administrator\\Downloads\\autonomous_trading_bot_journey.pdf';
  const artifactPath = 'C:\\Users\\Administrator\\.gemini\\antigravity\\brain\\42bc4ac4-b5d2-4b58-b8c4-2862df424716\\autonomous_trading_bot_journey.pdf';
  
  fs.copyFileSync(outputPdf, downloadsPath);
  fs.copyFileSync(outputPdf, artifactPath);
  console.log('Copied to:', downloadsPath);
  console.log('Copied to:', artifactPath);
} else {
  console.error('PDF file was not created!');
}
