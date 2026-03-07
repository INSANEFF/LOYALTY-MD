/*
  LOYALTY MD startup launcher.
  Keep startup deterministic for hosts (Render/Railway/PM2):
  no git pulls, no npm installs, no destructive git commands.
*/

console.log('\nStarting LOYALTY MD Bot...\n');
require('./index.js');
