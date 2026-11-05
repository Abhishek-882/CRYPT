/**
 * Empirical DAG Re-Verification for Challenger 2 Gen 2
 * Parses the actual Mermaid DAG from plans/PHASED_TEAM_EXECUTION_PLAN.md
 * and validates topological integrity, dependency decoupling, and serialization.
 */
const fs = require('fs');
const path = require('path');

const planPath = path.resolve('plans/PHASED_TEAM_EXECUTION_PLAN.md');
const planContent = fs.readFileSync(planPath, 'utf8');

// Extract Mermaid DAG block
const mermaidMatch = planContent.match(/```mermaid([\s\S]*?)```/);
if (!mermaidMatch) {
  console.error('FAIL: No mermaid block found in plan');
  process.exit(1);
}

const mermaidCode = mermaidMatch[1];
console.log('--- Extracted Mermaid DAG ---');
console.log(mermaidCode.trim());
console.log('-----------------------------');

// Clean node descriptions out first: M1_1["..."] -> M1_1
const cleanedCode = mermaidCode.replace(/\[".*?"\]/g, '');

// Parse edges: e.g. M1_1 --> M1_2 or M4_2 & M3_3 --> M4_3
const edgeRegex = /([A-Za-z0-9_]+(?:\s*&\s*[A-Za-z0-9_]+)*)\s*-->\s*([A-Za-z0-9_]+)/g;
let match;
const graph = {};
const allNodes = new Set();
const edges = [];

while ((match = edgeRegex.exec(cleanedCode)) !== null) {
  const sources = match[1].split('&').map(s => s.trim());
  const target = match[2].trim();
  allNodes.add(target);
  if (!graph[target]) graph[target] = [];
  
  for (const src of sources) {
    allNodes.add(src);
    graph[target].push(src);
    edges.push({ from: src, to: target });
  }
}

console.log(`Parsed ${allNodes.size} nodes and ${edges.length} directed edges:`);
edges.forEach(e => console.log(`  ${e.from} --> ${e.to}`));

// Verification 1: Check M2_1 --> M2_2 serialization
const m22Deps = graph['M2_2'] || [];
const isM2Serialized = m22Deps.includes('M2_1');
console.log(`\n[CHECK 1] M2.1 -> M2.2 Serialization: ${isM2Serialized ? 'PASS' : 'FAIL'} (Deps of M2_2: ${m22Deps.join(', ')})`);

// Verification 2: Check M4_1 decoupling from M3_3
const m41Deps = graph['M4_1'] || [];
const isM41DecoupledFromM33 = !m41Deps.includes('M3_3');
const doesM41DependOnM32 = m41Deps.includes('M3_2');
console.log(`[CHECK 2] M4.1 Decoupling from M3.3: ${isM41DecoupledFromM33 && doesM41DependOnM32 ? 'PASS' : 'FAIL'} (Deps of M4_1: ${m41Deps.join(', ')})`);

// Verification 3: Check M3_3 feeds into M4_3
const m43Deps = graph['M4_3'] || [];
const doesM43IncludeM33 = m43Deps.includes('M3_3');
console.log(`[CHECK 3] M3.3 routes to M4.3: ${doesM43IncludeM33 ? 'PASS' : 'FAIL'} (Deps of M4_3: ${m43Deps.join(', ')})`);

// Verification 4: Topological cycle check
const inDegree = {};
const adj = {};
for (const node of allNodes) {
  inDegree[node] = 0;
  adj[node] = [];
}
for (const edge of edges) {
  adj[edge.from].push(edge.to);
  inDegree[edge.to]++;
}

const queue = Array.from(allNodes).filter(n => inDegree[n] === 0);
const order = [];
while (queue.length > 0) {
  const curr = queue.shift();
  order.push(curr);
  for (const nxt of adj[curr]) {
    inDegree[nxt]--;
    if (inDegree[nxt] === 0) queue.push(nxt);
  }
}

const hasCycle = order.length !== allNodes.size;
console.log(`\n[CHECK 4] DAG Cycle Check: ${!hasCycle ? 'PASS (0 Cycles, Valid DAG)' : 'FAIL (Cycle Detected)'}`);
console.log(`Topological Order (${order.length} nodes): ${order.join(' -> ')}`);

if (isM2Serialized && isM41DecoupledFromM33 && doesM41DependOnM32 && doesM43IncludeM33 && !hasCycle && allNodes.size === 12) {
  console.log('\n>>> ALL REMEDIATED DAG CHECKS PASSED (12 NODES, 0 CYCLES) <<<');
  process.exit(0);
} else {
  console.log('\n>>> REMEDIATED DAG CHECKS FAILED <<<');
  process.exit(1);
}
