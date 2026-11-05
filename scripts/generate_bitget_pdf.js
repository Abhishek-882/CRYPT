const { spawnSync } = require('child_process');
const fs = require('fs');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const inputHtml = 'C:\\AI-Hedge-Cockpit\\bitget_latency_summary.html';
const outputPdf = 'C:\\AI-Hedge-Cockpit\\bitget_websocket_and_rest_latency.pdf';

const args = [
  '--headless=new',
  '--disable-gpu',
  '--no-pdf-header-footer',
  `--print-to-pdf=${outputPdf}`,
  inputHtml
];

console.log('Rendering Bitget Latency PDF with Chrome...');
const result = spawnSync(chromePath, args, { stdio: 'pipe' });

if (fs.existsSync(outputPdf)) {
  const stat = fs.statSync(outputPdf);
  console.log(`Success! PDF generated at ${outputPdf} (${stat.size} bytes)`);
  
  const downloadsPath = 'C:\\Users\\Administrator\\Downloads\\bitget_websocket_and_rest_latency.pdf';
  const artifactPath = 'C:\\Users\\Administrator\\.gemini\\antigravity\\brain\\42bc4ac4-b5d2-4b58-b8c4-2862df424716\\bitget_websocket_and_rest_latency.pdf';
  
  fs.copyFileSync(outputPdf, downloadsPath);
  fs.copyFileSync(outputPdf, artifactPath);
  console.log('Copied to:', downloadsPath);
  console.log('Copied to:', artifactPath);
} else {
  console.error('Failed to create PDF!');
  if (result.stderr) console.error('Stderr:', result.stderr.toString());
}
