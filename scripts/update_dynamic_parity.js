const fs = require('fs');

const filePath = 'C:/AI-Hedge-Cockpit/web/lib/botEngine.ts';
let code = fs.readFileSync(filePath, 'utf8');

// 1. Interface
code = code.replace(
  'maxPriceDivergencePct: number;',
  'maxPriceDivergencePct: number;\r\n  maxDivergenceSpreadRatioPct?: number;\r\n  maxPriceDivergenceCapPct?: number;'
);

// 2. DEFAULT_CONFIG
code = code.replace(
  'maxPriceDivergencePct: 0.03,\r\n  optimalPriceDivergencePct: 0.01,',
  'maxPriceDivergencePct: 0.05,\r\n  maxDivergenceSpreadRatioPct: 50,\r\n  maxPriceDivergenceCapPct: 0.50,\r\n  optimalPriceDivergencePct: 0.01,'
);

// 3. serializeConfigToSetText
code = code.replace(
  '`MaxPriceDivergencePct=${config.maxPriceDivergencePct}`,',
  '`MaxPriceDivergencePct=${config.maxPriceDivergencePct}`,\r\n    `MaxDivergenceSpreadRatioPct=${config.maxDivergenceSpreadRatioPct ?? 50}`,\r\n    `MaxPriceDivergenceCapPct=${config.maxPriceDivergenceCapPct ?? 0.50}`,'
);

// 4. parseSetTextToConfig
code = code.replace(
  'case "maxpricedivergencepct":\r\n        cfg.maxPriceDivergencePct = parseFloat(val) || cfg.maxPriceDivergencePct;\r\n        break;',
  'case "maxpricedivergencepct":\r\n        cfg.maxPriceDivergencePct = parseFloat(val) || cfg.maxPriceDivergencePct;\r\n        break;\r\n      case "maxdivergencespreadratiopct":\r\n        cfg.maxDivergenceSpreadRatioPct = parseFloat(val) || 50;\r\n        break;\r\n      case "maxpricedivergencecappct":\r\n        cfg.maxPriceDivergenceCapPct = parseFloat(val) || 0.50;\r\n        break;'
);

// 5. calculateRequiredPriceDivergencePct
const oldFuncHeader = [
  'export function calculateRequiredPriceDivergencePct(',
  '  config: BotConfig,',
  '  secondsToFunding: number',
  '): {',
  '  requiredDivergencePct: number;',
  '  stage: "EARLY_BREATHING_ROOM" | "MID_BREATHING_ROOM" | "FINAL_COUNTDOWN" | "PRE_SETTLEMENT_FREEZE" | "CONTINUOUS";',
  '  optimalTargetPct: number;',
  '  hardCeilingPct: number;',
  '  shouldFreeze: boolean;',
  '} {',
  '  const hardCeilingPct = config.maxPriceDivergencePct || 0.05;',
  '  // Strict tolerance enforcement: honor user\'s configured ceiling directly across all countdown stages',
  '  // without artificial internal clamps (e.g. 0.010%), unless the user explicitly set optimalPriceDivergencePct.',
  '  const optimalTargetPct = config.optimalPriceDivergencePct && config.optimalPriceDivergencePct > 0',
  '    ? config.optimalPriceDivergencePct',
  '    : hardCeilingPct;'
].join('\r\n');

const newFuncHeader = [
  'export function calculateRequiredPriceDivergencePct(',
  '  config: BotConfig,',
  '  secondsToFunding: number,',
  '  spreadBps?: number',
  '): {',
  '  requiredDivergencePct: number;',
  '  stage: "EARLY_BREATHING_ROOM" | "MID_BREATHING_ROOM" | "FINAL_COUNTDOWN" | "PRE_SETTLEMENT_FREEZE" | "CONTINUOUS";',
  '  optimalTargetPct: number;',
  '  hardCeilingPct: number;',
  '  shouldFreeze: boolean;',
  '} {',
  '  const baseCeilingPct = config.maxPriceDivergencePct || 0.05;',
  '  let dynamicCeilingPct = baseCeilingPct;',
  '',
  '  if (spreadBps && spreadBps > 0) {',
  '    const spreadPct = spreadBps / 100;',
  '    const ratio = (config.maxDivergenceSpreadRatioPct ?? 50) / 100;',
  '    const proportionalTolerance = parseFloat((spreadPct * ratio).toFixed(4));',
  '    dynamicCeilingPct = Math.max(baseCeilingPct, proportionalTolerance);',
  '  }',
  '',
  '  const hardCap = config.maxPriceDivergenceCapPct ?? 0.50;',
  '  const hardCeilingPct = Math.min(dynamicCeilingPct, hardCap);',
  '',
  '  // Strict tolerance enforcement: honor dynamic ceiling directly across countdown stages',
  '  const optimalTargetPct = config.optimalPriceDivergencePct && config.optimalPriceDivergencePct > 0',
  '    ? config.optimalPriceDivergencePct',
  '    : hardCeilingPct;'
].join('\r\n');

if (!code.includes(oldFuncHeader)) {
  console.error('ERROR: oldFuncHeader not matched in botEngine.ts');
  process.exit(1);
}
code = code.replace(oldFuncHeader, newFuncHeader);

// 6. Pre-exec call
code = code.replace(
  'const preExecReq = calculateRequiredPriceDivergencePct(config, coin.secondsToFunding || 0);',
  'const preExecReq = calculateRequiredPriceDivergencePct(config, coin.secondsToFunding || 0, coin.spreadBps);'
);

// 7. runTenantBotCycle calls
code = code.replace(
  'const timingEval = calculateRequiredPriceDivergencePct(config, secondsToFunding);',
  'const timingEval = calculateRequiredPriceDivergencePct(config, secondsToFunding, corridorSpreadBps);'
);

code = code.replace(
  'const freshReq = calculateRequiredPriceDivergencePct(config, topCandidate.secondsToFunding || 0);',
  'const freshReq = calculateRequiredPriceDivergencePct(config, topCandidate.secondsToFunding || 0, topCandidate.spreadBps);'
);

fs.writeFileSync(filePath, code, 'utf8');
console.log('Successfully updated botEngine.ts with Dynamic Funding-Proportional Parity Scaling!');
