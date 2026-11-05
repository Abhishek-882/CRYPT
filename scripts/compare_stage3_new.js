const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const newDir = 'C:\\AI-Hedge-Cockpit-Incoming\\stage3_new_unpack';
const currentDir = 'C:\\AI-Hedge-Cockpit';

function getHash(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch (e) {
    return null;
  }
}

function walk(dir, base = '') {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const item of list) {
    if (item === 'node_modules' || item === '.next' || item === '.git') continue;
    const fullPath = path.join(dir, item);
    const relPath = path.join(base, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(walk(fullPath, relPath));
    } else {
      results.push(relPath);
    }
  }
  return results;
}

const newFiles = walk(newDir);
const currentFiles = walk(currentDir);

console.log(`New unpack files count: ${newFiles.length}`);
console.log(`Current files count: ${currentFiles.length}`);

const addedInNew = [];
const modifiedInNew = [];
const identical = [];

for (const rel of newFiles) {
  const newPath = path.join(newDir, rel);
  const curPath = path.join(currentDir, rel);
  
  if (!fs.existsSync(curPath)) {
    addedInNew.push(rel);
  } else {
    const hNew = getHash(newPath);
    const hCur = getHash(curPath);
    if (hNew === hCur) {
      identical.push(rel);
    } else {
      modifiedInNew.push(rel);
    }
  }
}

console.log(`\nIdentical files: ${identical.length}`);
console.log(`Added in new version: ${addedInNew.length}`);
if (addedInNew.length > 0) {
  console.log('Added:', addedInNew.slice(0, 30));
}
console.log(`\nModified in new version: ${modifiedInNew.length}`);
if (modifiedInNew.length > 0) {
  console.log('Modified:', modifiedInNew);
}
