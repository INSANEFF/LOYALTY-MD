/*
  📦 LOYALTY MD — Auto-Sync Startup Script
  ==========================================
  This script runs before the bot starts:
    1. Pulls the latest code from your GitHub repo
    2. Installs any new dependencies
    3. Starts the bot

  Usage:  node start.js
  Or set:  "start": "node start.js"  in package.json
*/

const { execSync } = require('child_process');
const path = require('path');

const ROOT = __dirname;

function run(cmd, label) {
  try {
    const output = execSync(cmd, { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    return output.trim();
  } catch (err) {
    console.log(`⚠️  ${label} failed: ${err.message.split('\n')[0]}`);
    return null;
  }
}

// ============================================================
// 1️⃣  Git Pull — sync latest code from remote
// ============================================================
console.log('\n🔄 Syncing latest code from GitHub...');
const pullResult = run('git pull', 'Git pull');

if (pullResult !== null) {
  if (pullResult.includes('Already up to date') || pullResult.includes('Already up-to-date')) {
    console.log('✅ Already up to date.');
  } else {
    console.log('📥 Updates pulled:');
    console.log(pullResult);
  }
}

// ============================================================
// 2️⃣  npm install — install any new/changed dependencies
// ============================================================
console.log('\n📦 Checking dependencies...');
const installResult = run('npm install --production', 'npm install');
if (installResult !== null) {
  // Count new packages if any
  const added = installResult.match(/added (\d+) package/);
  if (added) {
    console.log(`✅ Installed ${added[1]} new package(s).`);
  } else {
    console.log('✅ Dependencies up to date.');
  }
}

// ============================================================
// 3️⃣  Start the bot
// ============================================================
console.log('\n🚀 Starting LOYALTY MD Bot...\n');
console.log('='.repeat(50));

require('./index.js');
