const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const gitExe = 'C:\\Program Files\\Git\\cmd\\git.exe';
const newDir = 'C:\\AI-Hedge-Cockpit-Incoming\\stage3_new_unpack';
const currentDir = 'C:\\AI-Hedge-Cockpit';

const files = [
  'web\\lib\\protectiveStopManager.ts',
  'web\\lib\\reconciliationEngine.ts',
  'web\\lib\\botEngine.ts',
  'web\\lib\\spreadCalculation.ts',
  'web\\lib\\exchangeFundingMeta.ts',
  'web\\lib\\userStore.ts',
  'web\\lib\\authHelper.ts',
];

for (const f of files) {
  const pNew = path.join(newDir, f);
  const pCur = path.join(currentDir, f);
  console.log(`\n=================== DIFF FOR ${f} ===================`);
  try {
    const diff = execSync(`"${gitExe}" diff --no-index "${pCur}" "${pNew}"`, { encoding: 'utf8' });
    console.log(diff || 'No diff');
  } catch (err) {
    if (err.stdout) {
      console.log(err.stdout);
    } else {
      console.log('Error:', err.message);
    }
  }
}
