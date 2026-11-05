const https = require('https');

const GITHUB_REPO = "Abhishek-882/Fund_rate";
const COLLABORATOR_EMAIL_OR_USER = process.argv[2] || "manthanrauthan1@gmail.com";
const TOKEN = process.env.GITHUB_TOKEN || process.argv[3];

if (!TOKEN) {
  console.log("Please provide a GitHub Personal Access Token (PAT) with 'repo' scope.");
  console.log("Usage: node scripts/invite_collaborator.js <username_or_email> <GITHUB_PAT>");
  process.exit(1);
}

// First resolve user by email if needed, or invite directly
console.log(`Sending invitation for ${COLLABORATOR_EMAIL_OR_USER} to ${GITHUB_REPO}...`);

const data = JSON.stringify({ permission: "push" });
const options = {
  hostname: 'api.github.com',
  port: 443,
  path: `/repos/${GITHUB_REPO}/collaborators/${encodeURIComponent(COLLABORATOR_EMAIL_OR_USER)}`,
  method: 'PUT',
  headers: {
    'User-Agent': 'Node-GitHub-Pusher',
    'Authorization': `token ${TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log(`GitHub API Response [${res.statusCode}]:`, body);
  });
});

req.on('error', (e) => console.error('Error:', e.message));
req.write(data);
req.end();
