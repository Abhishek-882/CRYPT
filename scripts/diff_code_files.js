const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const gitExe = 'C:\\Program Files\\Git\\cmd\\git.exe';
const newDir = 'C:\\AI-Hedge-Cockpit-Incoming\\stage3_new_unpack';
const currentDir = 'C:\\AI-Hedge-Cockpit';

const codeFiles = [
  'web\\app\\api\\auth\\route.ts',
  'web\\components\\AutoBotPanel.tsx',
  'web\\lib\\authHelper.ts',
  'web\\lib\\botEngine.ts',
  'web\\lib\\exchangeFundingMeta.ts',
  'web\\lib\\protectiveStopManager.ts',
  'web\\lib\\reconciliationEngine.ts',
  'web\\lib\\spreadCalculation.ts',
  'web\\lib\\userStore.ts',
  'web\\tests\\soak\\continuousSoakRunner.ts',
  'web\\tests\\unit\\startupReconciliation.test.ts',
];

for (const f of codeFiles) {
  const pNew = path.join(newDir, f);
  const pCur = path.join(currentDir, f);
  console.log(`\n=================== DIFF FOR ${f} ===================`);
  try {
    const diff = execSync(`"${gitExe}" diff --no-index "${pCur}" "${pNew}"`, { encoding: 'utf8' });
    console.log(diff || 'No diff');
  } catch (err) {
    if (err.stdout) {
      console.log(err.stdout.slice(0, 3000));
      if (err.stdout.length > 3000) console.log(`... [truncated ${err.stdout.length - 3000} chars]`);
    } else {
      console.log('Error comparing:', err.message);
    }
  }
}
