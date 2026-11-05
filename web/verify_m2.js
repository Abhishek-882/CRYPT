#!/usr/bin/env node
/**
 * Milestone 2 Master Verification Runner:
 * Track A-03: Exclusive OS-Level Kernel File Lock (bot_daemon.lock)
 * Track A-06: Universal RFC 4122 v4 UUID Client Order ID Idempotency
 */

const { spawnSync } = require("child_process");
const path = require("path");

console.log("===============================================================================");
console.log("  MILESTONE 2 COMPREHENSIVE VERIFICATION RUNNER");
console.log("===============================================================================\n");

const tests = [
  {
    name: "Milestone 2 Adversarial Challenge Suite (A-03 & A-06)",
    command: "npx",
    args: ["tsx", path.join(__dirname, "tests", "adversarial_m2_challenge.ts")],
  },
  {
    name: "Milestone 1 Regression: Vault Security Challenge",
    command: "npx",
    args: ["tsx", path.join(__dirname, "tests", "adversarial_m1_challenge.ts")],
  },
  {
    name: "Milestone 1 Regression: Route Authentication & Injection Challenge",
    command: "npx",
    args: ["tsx", path.join(__dirname, "tests", "adversarial_routes_challenge.ts")],
  },
];

let totalPassed = 0;
let totalFailed = 0;

for (const test of tests) {
  console.log(`\n>>> Running: ${test.name}...`);
  const result = spawnSync(test.command, test.args, {
    cwd: __dirname,
    stdio: "inherit",
    shell: true,
  });

  if (result.status === 0) {
    console.log(`>>> [PASS] ${test.name}`);
    totalPassed++;
  } else {
    console.error(`>>> [FAIL] ${test.name} (Exit code: ${result.status})`);
    totalFailed++;
  }
}

console.log("\n===============================================================================");
console.log(`  ALL SUITES COMPLETE: ${totalPassed} SUITES PASSED, ${totalFailed} SUITES FAILED`);
console.log("===============================================================================\n");

if (totalFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
