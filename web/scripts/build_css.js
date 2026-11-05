const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const env = {
  ...process.env,
  PATH: `C:\\Program Files\\nodejs;${process.env.PATH}`,
};

const webDir = 'C:\\AI-Hedge-Cockpit\\web';

console.log('Running tailwind build directly via node CLI...');
try {
  const result = execSync('npx tailwindcss -i ./app/globals.css -o ./test_tailwind.css', {
    cwd: webDir,
    env,
    encoding: 'utf8',
  });
  console.log('Result:', result);
  const size = fs.statSync(path.join(webDir, 'test_tailwind.css')).size;
  console.log('test_tailwind.css generated! Size:', size, 'bytes');

  const content = fs.readFileSync(path.join(webDir, 'test_tailwind.css'), 'utf8');
  console.log('Has .flex:', content.includes('.flex'));
  console.log('Has .grid:', content.includes('.grid'));
  console.log('Has bg-background:', content.includes('bg-background'));
  console.log('Has text-accent-amber:', content.includes('text-accent-amber'));
} catch (err) {
  console.error('Error running tailwind:', err.message);
  if (err.stdout) console.log('STDOUT:', err.stdout);
  if (err.stderr) console.error('STDERR:', err.stderr);
}
