/**
 * EMPIRICAL ADVERSARIAL STRESS HARNESS #2: LIVE DAEMON ROUTE RESILIENCE
 * 
 * Verifies live endpoint resilience on http://127.0.0.1:3000/api/convergence/daemon:
 * 1. Invalid payload handling (empty, malformed, missing fields, unrecognized actions)
 * 2. Route resilience under stress
 * 3. Verification of active LIVE_ON_EXCHANGE mode and dryRun: false while actively ticking
 * 4. Text and notation hygiene
 * 
 * Strict Constraints:
 * - Zero mentions of legacy bot engines.
 * - All spreads and price gaps formatted in % (zero forbidden notation).
 */

const BASE_URL = 'http://127.0.0.1:3000/api/convergence/daemon';

interface TestResult {
  testName: string;
  passed: boolean;
  httpStatus: number;
  expectedStatus: number | number[];
  details: string;
}

async function runAdversarialRouteTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  console.log('========================================================================');
  console.log('RUNNING EMPIRICAL ADVERSARIAL STRESS HARNESS #2: LIVE DAEMON RESILIENCE');
  console.log(`Target Endpoint: ${BASE_URL}`);
  console.log('========================================================================\n');

  // 1. GET Status Check: Confirm daemon is running live
  try {
    const res = await fetch(BASE_URL, { method: 'GET', headers: { 'Cache-Control': 'no-cache' } });
    const data = await res.json();
    const passed =
      res.status === 200 &&
      data.success === true &&
      data.isRunning === true &&
      data.mode === 'LIVE_ON_EXCHANGE' &&
      data.dryRun === false &&
      data.fsmState === 'RUNNING';

    results.push({
      testName: '1. GET Status: Verify LIVE_ON_EXCHANGE and dryRun: false',
      passed,
      httpStatus: res.status,
      expectedStatus: 200,
      details: `mode: ${data.mode}, dryRun: ${data.dryRun}, isRunning: ${data.isRunning}, fsmState: ${data.fsmState}, uptime: ${data.uptimeSeconds}s`,
    });
  } catch (err) {
    results.push({
      testName: '1. GET Status: Verify LIVE_ON_EXCHANGE and dryRun: false',
      passed: false,
      httpStatus: 0,
      expectedStatus: 200,
      details: `Exception: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 2. POST with Unrecognized Action
  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'MALICIOUS_UNKNOWN_ACTION_999' }),
    });
    const data = await res.json();
    const passed =
      res.status === 400 &&
      data.success === false &&
      typeof data.error === 'string' &&
      data.error.includes('Unrecognized action');

    results.push({
      testName: '2. POST Error Handling: Unrecognized action returns HTTP 400',
      passed,
      httpStatus: res.status,
      expectedStatus: 400,
      details: `Response error: "${data.error}"`,
    });
  } catch (err) {
    results.push({
      testName: '2. POST Error Handling: Unrecognized action returns HTTP 400',
      passed: false,
      httpStatus: 0,
      expectedStatus: 400,
      details: `Exception: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 3. POST with Empty JSON Object ({})
  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    const passed = res.status === 400 && data.success === false;

    results.push({
      testName: '3. POST Error Handling: Empty payload {} returns HTTP 400',
      passed,
      httpStatus: res.status,
      expectedStatus: 400,
      details: `Response error: "${data.error}"`,
    });
  } catch (err) {
    results.push({
      testName: '3. POST Error Handling: Empty payload {} returns HTTP 400',
      passed: false,
      httpStatus: 0,
      expectedStatus: 400,
      details: `Exception: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 4. POST with Malformed JSON Syntax (broken syntax)
  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"action": "test", broken_json: ...',
    });
    const data = await res.json();
    // Route catches json parse failure and falls back to empty body, resulting in 400 Unrecognized action
    const passed = res.status === 400 && data.success === false;

    results.push({
      testName: '4. POST Error Handling: Broken JSON syntax handled without crashing',
      passed,
      httpStatus: res.status,
      expectedStatus: 400,
      details: `Handled cleanly: status ${res.status}, error: "${data.error}"`,
    });
  } catch (err) {
    results.push({
      testName: '4. POST Error Handling: Broken JSON syntax handled without crashing',
      passed: false,
      httpStatus: 0,
      expectedStatus: 400,
      details: `Exception: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 5. POST close_position without positionId
  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'close_position' }),
    });
    const data = await res.json();
    const passed = res.status === 400 && data.success === false && data.error.includes('positionId is required');

    results.push({
      testName: '5. POST Validation: close_position missing positionId returns HTTP 400',
      passed,
      httpStatus: res.status,
      expectedStatus: 400,
      details: `Response error: "${data.error}"`,
    });
  } catch (err) {
    results.push({
      testName: '5. POST Validation: close_position missing positionId returns HTTP 400',
      passed: false,
      httpStatus: 0,
      expectedStatus: 400,
      details: `Exception: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 6. POST close_position with non-existent positionId
  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'close_position', positionId: 'pos_ghost_999999' }),
    });
    const data = await res.json();
    const passed = res.status === 404 && data.success === false && data.error.includes('not found');

    results.push({
      testName: '6. POST Validation: close_position with non-existent positionId returns HTTP 404',
      passed,
      httpStatus: res.status,
      expectedStatus: 404,
      details: `Response error: "${data.error}"`,
    });
  } catch (err) {
    results.push({
      testName: '6. POST Validation: close_position with non-existent positionId returns HTTP 404',
      passed: false,
      httpStatus: 0,
      expectedStatus: 404,
      details: `Exception: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 7. POST action: "status" explicitly
  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status' }),
    });
    const data = await res.json();
    const passed =
      res.status === 200 &&
      data.success === true &&
      data.mode === 'LIVE_ON_EXCHANGE' &&
      data.dryRun === false &&
      data.isRunning === true;

    results.push({
      testName: '7. POST Action: status reports LIVE_ON_EXCHANGE and dryRun: false',
      passed,
      httpStatus: res.status,
      expectedStatus: 200,
      details: `mode: ${data.mode}, dryRun: ${data.dryRun}, fsmState: ${data.fsmState}`,
    });
  } catch (err) {
    results.push({
      testName: '7. POST Action: status reports LIVE_ON_EXCHANGE and dryRun: false',
      passed: false,
      httpStatus: 0,
      expectedStatus: 200,
      details: `Exception: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 8. POST action: "cron_tick" with dryRun: false actively ticking
  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cron_tick', dryRun: false }),
    });
    const data = await res.json();
    const passed =
      res.status === 200 &&
      data.success === true &&
      data.mode === 'LIVE_ON_EXCHANGE' &&
      data.dryRun === false &&
      data.isRunning === true &&
      data.scanResult !== undefined &&
      data.manageResult !== undefined;

    results.push({
      testName: '8. POST Action: cron_tick executes sweep in LIVE_ON_EXCHANGE mode (dryRun: false)',
      passed,
      httpStatus: res.status,
      expectedStatus: 200,
      details: `mode: ${data.mode}, dryRun: ${data.dryRun}, qualifyingSignals: ${data.scanResult?.qualifyingSignalsCount}, evaluated: ${data.manageResult?.evaluatedCount}`,
    });
  } catch (err) {
    results.push({
      testName: '8. POST Action: cron_tick executes sweep in LIVE_ON_EXCHANGE mode (dryRun: false)',
      passed: false,
      httpStatus: 0,
      expectedStatus: 200,
      details: `Exception: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 9. Verify GET query parameter handling ?dryRun=false
  try {
    const res = await fetch(`${BASE_URL}?dryRun=false`, {
      method: 'GET',
      headers: { 'Cache-Control': 'no-cache' },
    });
    const data = await res.json();
    const passed =
      res.status === 200 &&
      data.mode === 'LIVE_ON_EXCHANGE' &&
      data.dryRun === false;

    results.push({
      testName: '9. GET Query: ?dryRun=false guarantees LIVE_ON_EXCHANGE mode',
      passed,
      httpStatus: res.status,
      expectedStatus: 200,
      details: `mode: ${data.mode}, dryRun: ${data.dryRun}`,
    });
  } catch (err) {
    results.push({
      testName: '9. GET Query: ?dryRun=false guarantees LIVE_ON_EXCHANGE mode',
      passed: false,
      httpStatus: 0,
      expectedStatus: 200,
      details: `Exception: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 10. Verify Text Hygiene in Daemon Responses
  try {
    const res = await fetch(BASE_URL, { method: 'GET' });
    const text = await res.text();
    // Verify zero forbidden legacy phrases
    const hasForbiddenBasis = /basis[\s_-]?bot/i.test(text);
    const hasForbiddenBps = /"bps"/i.test(text);
    const passed = !hasForbiddenBasis && !hasForbiddenBps;

    results.push({
      testName: '10. Text & Notation Hygiene: Zero legacy bot mentions & zero "bps" strings in response payload',
      passed,
      httpStatus: res.status,
      expectedStatus: 200,
      details: `hasForbiddenBasis: ${hasForbiddenBasis}, hasForbiddenBps: ${hasForbiddenBps}`,
    });
  } catch (err) {
    results.push({
      testName: '10. Text & Notation Hygiene: Zero legacy bot mentions & zero "bps" strings in response payload',
      passed: false,
      httpStatus: 0,
      expectedStatus: 200,
      details: `Exception: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  console.log('------------------------------------------------------------------------');
  console.log('HARNESS RESULTS SUMMARY:');
  console.log('------------------------------------------------------------------------');
  let allPassed = true;
  for (const r of results) {
    const icon = r.passed ? '✓ PASS' : '✗ FAIL';
    if (!r.passed) allPassed = false;
    console.log(`${icon} | ${r.testName}`);
    console.log(`       Status: ${r.httpStatus} (Expected: ${r.expectedStatus}) | Details: ${r.details}`);
  }
  console.log('------------------------------------------------------------------------');
  console.log(`Final Outcome: ${allPassed ? 'ALL TESTS PASSED (10/10)' : 'SOME TESTS FAILED'}`);
  console.log('========================================================================\n');

  if (!allPassed) {
    process.exit(1);
  }
  return results;
}

runAdversarialRouteTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
