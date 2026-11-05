const fs = require('fs');
const path = require('path');

function searchFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let results = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      results = results.concat(searchFiles(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

console.log("Checking data directories:");
['data', 'web/data'].forEach(d => {
  const p = path.resolve(d);
  if (fs.existsSync(p)) {
    console.log(`\nDir: ${p}`);
    searchFiles(p).forEach(f => console.log('  ', f));
  } else {
    console.log(`\nDir ${p} does not exist`);
  }
});
