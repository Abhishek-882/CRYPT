const fs = require('fs');
const filePath = 'C:/AI-Hedge-Cockpit/web/lib/exchangeFundingMeta.ts';
let code = fs.readFileSync(filePath, 'utf8');

const regex = /\/\/ 1\. Resolve active interval mode[\s\S]*?\/\/ 2\. Compute timing/;
const replacement = `// 1. Resolve active interval mode (with legacy boolean fallback)
  let effectiveMode: FundingIntervalMode = "STRICT_SYNC_ONLY";
  if (options?.intervalMode) {
    effectiveMode = options.intervalMode;
  } else if (options?.allowAsymmetric === true) {
    effectiveMode = "ALL_ASYMMETRIC";
  } else if (options?.allowAsymmetric === false) {
    effectiveMode = "STRICT_SYNC_ONLY";
  } else {
    effectiveMode = "STRICT_SYNC_ONLY";
  }

  // 2. Compute timing`;

if (regex.test(code)) {
  code = code.replace(regex, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Successfully replaced effectiveMode block in exchangeFundingMeta.ts');
} else {
  console.error('Regex match failed');
}
