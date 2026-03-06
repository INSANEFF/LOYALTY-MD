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

// Ensure git is available
const gitCheck = run('git --version', 'Git check');
if (gitCheck) {
  // Stash any local changes (like data files) to prevent pull conflicts
  run('git stash', 'Git stash');
  
  // Fetch and reset to remote to ensure clean sync
  const fetchResult = run('git fetch origin', 'Git fetch');
  
  // Get current branch name
  const branch = run('git rev-parse --abbrev-ref HEAD', 'Git branch') || 'master';
  
  // Pull latest changes
  const pullResult = run(`git pull origin ${branch} --rebase`, 'Git pull');

  if (pullResult !== null) {
    if (pullResult.includes('Already up to date') || pullResult.includes('Already up-to-date')) {
      console.log('✅ Already up to date.');
    } else {
      console.log('📥 Updates pulled:');
      console.log(pullResult);
    }
  } else {
    // If pull failed, try hard reset to remote
    console.log('⚠️ Pull failed, attempting hard reset to remote...');
    const resetResult = run(`git reset --hard origin/${branch}`, 'Git reset');
    if (resetResult) {
      console.log('✅ Reset to latest remote code.');
    }
  }
  
  // Re-apply stashed changes (won't fail if nothing was stashed)
  run('git stash pop', 'Git stash pop');
} else {
  console.log('⚠️ Git not available. Skipping code sync.');
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
