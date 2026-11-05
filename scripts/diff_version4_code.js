const { execSync } = require('child_process');
const gitExe = 'C:\\Program Files\\Git\\cmd\\git.exe';
const newDir = 'C:\\AI-Hedge-Cockpit-Incoming\\version4_unpack';
const currentDir = 'C:\\AI-Hedge-Cockpit';

const files = [
  'web/lib/authHelper.ts',
  'web/lib/exchangeFundingMeta.ts',
  'web/lib/spreadCalculation.ts',
  'web/lib/userStore.ts',
  'web/app/api/auth/route.ts',
];

for (const f of files) {
  console.log(`\n=================== DIFF FOR ${f} ===================`);
  try {
    const diff = execSync(`"${gitExe}" diff --no-index "${currentDir}/${f}" "${newDir}/${f}"`, { encoding: 'utf8' });
    console.log(diff || 'No diff');
  } catch (err) {
    if (err.stdout) {
      console.log(err.stdout.slice(0, 4000));
      if (err.stdout.length > 4000) console.log(`... [truncated ${err.stdout.length - 4000} chars]`);
    } else {
      console.log('Error:', err.message);
    }
  }
}
