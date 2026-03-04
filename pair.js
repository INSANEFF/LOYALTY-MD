/*
  LOYALTY MD - Local Session ID Generator
  Run: node pair.js
  
  Generates a session ID for your bot.
  Set the output as SESSION_ID env var in Pterodactyl/your hosting.
*/

const {
  default: makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const readline = require('readline');
const path = require('path');
const fs = require('fs');
const os = require('os');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(r => rl.question(q, a => r(a.trim()))); }

async function generateSession() {
  console.log('\n====================================');
  console.log('  👑 LOYALTY MD Session Generator');
  console.log('====================================\n');

  const phone = await ask('Enter your WhatsApp number (with country code, no + or spaces):\n> ');
  const cleanNumber = phone.replace(/[^0-9]/g, '');
  if (cleanNumber.length < 7) {
    console.log('❌ Invalid phone number.');
    process.exit(1);
  }

  const tempDir = path.join(os.tmpdir(), `loyalty-pair-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  console.log('\n⏳ Connecting to WhatsApp...\n');

  const { state, saveCreds } = await useMultiFileAuthState(tempDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }).child({ level: 'silent' }))
    },
    browser: ["Ubuntu", "Chrome", "20.0.00"]
  });

  sock.ev.on('creds.update', saveCreds);

  // Request pairing code
  if (!sock.authState.creds.registered) {
    const pairingCode = await sock.requestPairingCode(cleanNumber);
    console.log('====================================');
    console.log(`  📱 PAIRING CODE: ${pairingCode}`);
    console.log('====================================');
    console.log('\nOpen WhatsApp on your phone:');
    console.log('  Settings → Linked Devices → Link a Device');
    console.log('  Enter the code above when prompted.\n');
    console.log('⏳ Waiting for you to pair...\n');
  }

  // Wait for connection
  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      console.log('✅ Connected successfully!\n');

      // Read creds and encode
      const credsPath = path.join(tempDir, 'creds.json');
      const credsData = fs.readFileSync(credsPath, 'utf8');
      const sessionId = `LOYALTY-MD~${Buffer.from(credsData).toString('base64')}`;

      console.log('====================================');
      console.log('  🔑 YOUR SESSION ID');
      console.log('====================================\n');
      console.log(sessionId);
      console.log('\n====================================\n');
      console.log('📋 Copy the SESSION ID above and set it as:');
      console.log('   SESSION_ID environment variable in your hosting panel.\n');
      console.log('   On Pterodactyl: Startup → Environment Variables → SESSION_ID\n');

      // Save to file too
      const outFile = path.join(process.cwd(), 'session_id.txt');
      fs.writeFileSync(outFile, sessionId);
      console.log(`💾 Also saved to: ${outFile}\n`);

      // Cleanup
      setTimeout(() => {
        try { sock.end(); } catch (_) {}
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
        rl.close();
        process.exit(0);
      }, 2000);

    } else if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === 401 || code === 403) {
        console.log('❌ Pairing rejected or expired. Please try again.');
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
        rl.close();
        process.exit(1);
      }
    }
  });

  // Timeout after 2 minutes
  setTimeout(() => {
    console.log('❌ Timed out waiting for pairing (2 minutes). Try again.');
    try { sock.end(); } catch (_) {}
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    rl.close();
    process.exit(1);
  }, 120000);
}

generateSession().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
