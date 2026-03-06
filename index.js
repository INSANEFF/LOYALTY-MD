/*
📝 | LOYALTY MD Bot
🖥️ | Powered by LOYALTY MD
  Multi-Session WhatsApp Bot
*/

const http = require('http');
const fs = require('fs');
const pino = require('pino');
const readline = require('readline');
const path = require('path');
const chalk = require('chalk');
const { exec } = require('child_process');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  downloadContentFromMessage,
  jidDecode,
  Browsers,
  DisconnectReason
} = require('@whiskeysockets/baileys');

// Safety check — some forks export broken makeInMemoryStore
const HAS_STORE = typeof makeInMemoryStore === 'function';
const handleCommand = require('./case');
const config = require('./config');
const { connectDB, getAllSessions, saveSession, deleteSession: dbDeleteSession } = require('./database/mongodb');

// 🛡️ Prevent crashes from unhandled errors
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT]', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[UNHANDLED]', err?.message || err);
});

// 🌈 Console helpers
const log = {
  info: (msg) => console.log(chalk.cyanBright(`[INFO] ${msg}`)),
  success: (msg) => console.log(chalk.greenBright(`[SUCCESS] ${msg}`)),
  error: (msg) => console.log(chalk.redBright(`[ERROR] ${msg}`)),
  warn: (msg) => console.log(chalk.yellowBright(`[WARN] ${msg}`))
};

// Track all active bot instances: { sessionId: socket }
global.activeSessions = {};
// Track reconnect attempts per session for exponential backoff
global.reconnectAttempts = {};

// 🧠 Readline setup (only for initial pairing)
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function question(query) {
  return new Promise(resolve => rl.question(query, ans => resolve(ans.trim())));
}

/**
 * Start a single bot session
 * @param {string} sessionId - unique session folder name
 * @param {boolean} isInitial - true if this is the first/main session (uses pairing code prompt)
 */
async function startSession(sessionId, isInitial = false) {
  const sessionDir = path.join(__dirname, 'sessions', sessionId);
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

  let store = null;
  if (HAS_STORE) {
    try {
      store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });
    } catch (err) {
      log.warn(`Store init failed for "${sessionId}": ${err.message}`);
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  let version;
  try {
    const fetched = await fetchLatestBaileysVersion();
    version = fetched.version;
  } catch (err) {
    log.warn(`Could not fetch latest Baileys version: ${err.message}. Using fallback.`);
    version = [2, 3000, 1015901307];
  }

  const sock = makeWASocket({
    version,
    keepAliveIntervalMs: 30000,
    retryRequestDelayMs: 2000,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    emitOwnEvents: true,
    fireInitQueries: true,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }).child({ level: 'silent' }))
    },
    browser: Browsers.macOS('Chrome'),
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    getMessage: async (key) => {
      // Required for message retries — return empty if not found
      return { conversation: '' };
    }
  });

  // Bind the in-memory store to the socket for message retry (if available)
  if (store) {
    try { store.bind(sock.ev); } catch (err) {
      log.warn(`Store bind failed for "${sessionId}": ${err.message}`);
    }
  }

  // Save creds to disk + MongoDB on every update
  sock.ev.on('creds.update', async () => {
    await saveCreds();
    // Also persist to MongoDB for crash recovery
    try {
      const credsData = JSON.parse(fs.readFileSync(path.join(sessionDir, 'creds.json'), 'utf8'));
      await saveSession(sessionId, credsData);
    } catch (_) {}
  });

  // Pairing code (only for initial session if not yet registered)
  if (!sock.authState.creds.registered) {
    if (isInitial) {
      // Use PHONE_NUMBER from config.js if set, otherwise prompt
      let cleanNumber = (config.PHONE_NUMBER || '').replace(/[^0-9]/g, '');
      if (!cleanNumber) {
        const phoneNumber = await question(chalk.yellowBright("[ = ] Enter the WhatsApp number you want to use as a bot (with country code):\n"));
        cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
      } else {
        log.info(`Using phone number from config: ${chalk.green(cleanNumber)}`);
      }
      console.clear();
      const pairCode = await sock.requestPairingCode(cleanNumber);
      log.info(`Enter this code on your phone to pair: ${chalk.green(pairCode)}`);
      log.info("⏳ Wait a few seconds and approve the pairing on your phone...");
    } else {
      log.warn(`Session "${sessionId}" has no credentials. Use the session generator to create one.`);
      return null;
    }
  }

  // Media download helper
  sock.downloadMediaMessage = async (message) => {
    let mime = (message.msg || message).mimetype || '';
    let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
    const stream = await downloadContentFromMessage(message, messageType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }
    return buffer;
  };

  // Connection handling with auto-reconnect + exponential backoff
  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    try {
      if (connection === 'connecting') {
        log.info(`Session "${sessionId}" connecting...`);
      } else if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const reason = lastDisconnect?.error?.message || 'unknown';
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;
        log.error(`Session "${sessionId}" disconnected (code: ${statusCode}, reason: ${reason}).`);
        // Remove from active sessions on disconnect
        delete global.activeSessions[sessionId];
        if (shouldReconnect) {
          // Exponential backoff: 3s, 6s, 12s, 24s, max 30s
          const attempts = (global.reconnectAttempts[sessionId] || 0) + 1;
          global.reconnectAttempts[sessionId] = attempts;
          const delay = Math.min(3000 * Math.pow(2, attempts - 1), 30000);
          log.info(`Reconnecting session "${sessionId}" in ${delay / 1000}s (attempt #${attempts})...`);
          setTimeout(() => startSession(sessionId, false), delay);
        } else {
          log.error(`Session "${sessionId}" logged out (401). Not reconnecting.`);
          delete global.reconnectAttempts[sessionId];
        }
      } else if (connection === 'open') {
        // Reset reconnect counter on successful connection
        global.reconnectAttempts[sessionId] = 0;
        const botNumber = sock.user?.id?.split("@")[0]?.split(":")[0] || 'unknown';
        log.success(`Session "${sessionId}" connected as ${chalk.green(botNumber)}`);

        // Store in global active sessions
        global.activeSessions[sessionId] = sock;

        // Close readline if still open (initial session)
        if (isInitial) {
          try { rl.close(); } catch (_) {}
        }

        // Send connection DM
        setTimeout(async () => {
          try {
            const ownerJid = (sock.user?.id?.split(":")[0] || '') + "@s.whatsapp.net";
            const message = `
✅ *Bot Connected Successfully!*

👑 *Creator:* LOYALTY MD
⚙️ *Version:* 3.0.0
📦 *Session:* ${sessionId}
📱 *Number:* ${botNumber}

✨ Type *menu* to see commands!
`;
            await sock.sendMessage(ownerJid, { text: message });
          } catch (err) {
            log.error(`Failed to send DM for session ${sessionId}: ${err.message || err}`);
          }
        }, 3000);

        sock.isPublic = true;
      }
    } catch (err) {
      console.error(`connection.update error for session ${sessionId}:`, err);
    }
  });

  // Group participant events (anti-promote / anti-demote)
  sock.ev.on('group-participants.update', async (update) => {
    try {
      const { id, participants, action } = update;
      const chatId = id;
      const botNumber = (sock.user?.id?.split(":")[0] || '') + "@s.whatsapp.net";

      if (action === 'promote' && global.antipromote?.[chatId]?.enabled) {
        const settings = global.antipromote[chatId];
        for (const user of participants) {
          if (user !== botNumber) {
            await sock.sendMessage(chatId, {
              text: `🚫 *Promotion Blocked!*\nUser: @${user.split('@')[0]}\nMode: ${settings.mode.toUpperCase()}`,
              mentions: [user]
            });
            if (settings.mode === "revert") await sock.groupParticipantsUpdate(chatId, [user], "demote");
            else if (settings.mode === "kick") await sock.groupParticipantsUpdate(chatId, [user], "remove");
          }
        }
      }

      if (action === 'demote' && global.antidemote?.[chatId]?.enabled) {
        const settings = global.antidemote[chatId];
        for (const user of participants) {
          if (user !== botNumber) {
            await sock.sendMessage(chatId, {
              text: `🚫 *Demotion Blocked!*\nUser: @${user.split('@')[0]}\nMode: ${settings.mode.toUpperCase()}`,
              mentions: [user]
            });
            if (settings.mode === "revert") await sock.groupParticipantsUpdate(chatId, [user], "promote");
            else if (settings.mode === "kick") await sock.groupParticipantsUpdate(chatId, [user], "remove");
          }
        }
      }
    } catch (err) {
      console.error("AntiPromote/AntiDemote error:", err);
    }
  });

  // Auto-view statuses + Message handler (SINGLE listener to prevent spam)
  sock.ev.on('messages.upsert', async ({ messages, type: upsertType }) => {
    try {
      const msg = messages[0];
      if (!msg.message) return;

      // Skip messages from the bot itself (prevent loops)
      if (msg.key.fromMe) return;

      // Auto-view statuses
      if (config.STATUS_VIEW && msg.key && msg.key.remoteJid === 'status@broadcast') {
        try { await sock.readMessages([msg.key]); } catch (_) {}
        return;
      }

      // Skip status broadcasts for command handling
      if (msg.key.remoteJid === 'status@broadcast') return;

      const from = msg.key.remoteJid;
      const sender = msg.key.participant || msg.key.remoteJid;
      const isGroup = from.endsWith('@g.us');
      const botNumber = (sock.user?.id?.split(":")[0] || '') + "@s.whatsapp.net";

      // Extract message body from all possible message types
      const msgContent = msg.message;
      let body =
        msgContent.conversation ||
        msgContent.extendedTextMessage?.text ||
        msgContent.imageMessage?.caption ||
        msgContent.videoMessage?.caption ||
        msgContent.documentMessage?.caption ||
        msgContent.buttonsResponseMessage?.selectedButtonId ||
        msgContent.listResponseMessage?.singleSelectReply?.selectedRowId ||
        msgContent.templateButtonReplyMessage?.selectedId ||
        '';
      body = (body || '').trim();
      if (!body) return;

      // Extract contextInfo and mentionedJid from any message type that has them
      const contextInfo = msgContent?.extendedTextMessage?.contextInfo
        || msgContent?.imageMessage?.contextInfo
        || msgContent?.videoMessage?.contextInfo
        || msgContent?.documentMessage?.contextInfo
        || {};

      const m = {
        ...msg,
        chat: from,
        sender,
        isGroup,
        body,
        mentionedJid: contextInfo.mentionedJid || [],
        mtype: Object.keys(msgContent).filter(k => k !== 'messageContextInfo')[0],
        type: Object.keys(msgContent).filter(k => k !== 'messageContextInfo')[0],
        quoted: contextInfo.quotedMessage
          ? {
              key: {
                remoteJid: contextInfo.remoteJid || from,
                id: contextInfo.stanzaId,
                participant: contextInfo.participant
              },
              message: contextInfo.quotedMessage,
              sender: contextInfo.participant || from,
              msg: contextInfo.quotedMessage[Object.keys(contextInfo.quotedMessage).filter(k => k !== 'messageContextInfo')[0]]
            }
          : null,
        reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
        pushName: msg.pushName || 'Unknown'
      };

      const args = body.split(/ +/);
      const command = args.shift().toLowerCase();

      const groupMeta = isGroup ? await sock.groupMetadata(from).catch(() => null) : null;
      const groupAdmins = groupMeta ? groupMeta.participants.filter(p => p.admin).map(p => p.id) : [];
      const isBotAdmin = isGroup ? groupAdmins.includes(botNumber) : false;
      const isAdmin = isGroup ? groupAdmins.includes(sender) : false;

      await handleCommand(sock, m, command, isGroup, isAdmin, groupAdmins, isBotAdmin, groupMeta, config);
    } catch (err) {
      console.error('Message handler error:', err);
    }
  });

  // Decode JID helper
  sock.decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
      const decode = jidDecode(jid) || {};
      return decode.user && decode.server ? `${decode.user}@${decode.server}` : jid;
    }
    return jid;
  };

  return sock;
}

// ============================================================
// 🚀 MAIN ENTRY - Load all sessions and start
// ============================================================
async function main() {
  log.info('🚀 LOYALTY MD Bot starting...');

  // Connect to MongoDB (optional — works without it too)
  await connectDB();

  // Check for existing local sessions
  const sessionsDir = path.join(__dirname, 'sessions');
  if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

  // ============================================================
  // 🔑 SESSION_ID ENV VAR — Bootstrap creds from env if provided
  // ============================================================
  const envSessionId = config.SESSION_ID || process.env.SESSION_ID || '';
  if (envSessionId) {
    log.info('Found SESSION_ID in environment. Bootstrapping session...');
    try {
      // Strip the LOYALTY-MD~ prefix if present
      let credsB64 = envSessionId;
      if (credsB64.startsWith('LOYALTY-MD~')) {
        credsB64 = credsB64.replace('LOYALTY-MD~', '');
      }
      // Also handle LOYALTY-MD_ or LOYALTY_MD_ prefixes
      credsB64 = credsB64.replace(/^LOYALTY[-_]MD[~_]/i, '');

      const credsJson = Buffer.from(credsB64, 'base64').toString('utf8');
      // Validate it's valid JSON
      JSON.parse(credsJson);

      const mainSessionDir = path.join(sessionsDir, 'main');
      if (!fs.existsSync(mainSessionDir)) fs.mkdirSync(mainSessionDir, { recursive: true });

      const credsPath = path.join(mainSessionDir, 'creds.json');
      // Only write if creds.json doesn't exist yet (don't overwrite active session)
      if (!fs.existsSync(credsPath)) {
        fs.writeFileSync(credsPath, credsJson);
        log.success('Session credentials written from SESSION_ID env var.');
      } else {
        log.info('creds.json already exists for main session, skipping env bootstrap.');
      }
    } catch (err) {
      log.error(`Failed to parse SESSION_ID: ${err.message}`);
      log.error('Make sure SESSION_ID is a valid LOYALTY-MD~<base64> value.');
    }
  }

  const localSessions = fs.readdirSync(sessionsDir).filter(f => {
    return fs.statSync(path.join(sessionsDir, f)).isDirectory();
  });

  // Also load sessions from MongoDB that might not exist locally
  const dbSessions = await getAllSessions();
  for (const dbSess of dbSessions) {
    const sessDir = path.join(sessionsDir, dbSess.sessionId);
    if (!fs.existsSync(sessDir)) {
      fs.mkdirSync(sessDir, { recursive: true });
      // Restore creds from DB
      if (dbSess.authState) {
        try {
          fs.writeFileSync(path.join(sessDir, 'creds.json'), dbSess.authState);
          log.info(`Restored session "${dbSess.sessionId}" from database.`);
        } catch (_) {}
      }
      if (!localSessions.includes(dbSess.sessionId)) {
        localSessions.push(dbSess.sessionId);
      }
    }
  }

  if (localSessions.length === 0) {
    // No sessions exist — start first session with pairing code prompt
    log.info('No existing sessions found. Starting initial session setup...');
    await startSession('main', true);
  } else {
    // Start all existing sessions
    log.info(`Found ${localSessions.length} session(s). Starting them all...`);
    for (const sessionId of localSessions) {
      log.info(`Starting session: ${sessionId}`);
      await startSession(sessionId, false);
    }
  }

  // ============================================================
  // 💓 Keep-alive interval — prevents idle disconnections
  // ============================================================
  setInterval(() => {
    const activeCount = Object.keys(global.activeSessions).length;
    if (activeCount > 0) {
      log.info(`💓 Keep-alive: ${activeCount} active session(s)`);
    }
  }, 5 * 60 * 1000); // every 5 minutes

  // Hot reload for case.js and config.js
  const watchFiles = ['./case.js', './config.js'];
  watchFiles.forEach(file => {
    const absPath = path.resolve(file);
    fs.watchFile(absPath, () => {
      log.warn(`${file} updated! Reloading...`);
      delete require.cache[require.resolve(absPath)];
      try {
        require(absPath);
        log.success(`${file} reloaded successfully.`);
      } catch (err) {
        log.error(`Failed to reload ${file}: ${err}`);
      }
    });
  });
}

// Make startSession globally available for case.js (avoids circular require)
global.startSession = startSession;

module.exports = { startSession };

// ============================================================
// 🌐 HTTP health-check server (required by Railway / Render)
// ============================================================
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
  const activeSessions = Object.keys(global.activeSessions || {});
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    bot: 'LOYALTY MD',
    sessions: activeSessions.length,
    uptime: Math.floor(process.uptime()) + 's'
  }));
}).listen(PORT, '0.0.0.0', () => {
  log.info(`🌐 Health server listening on port ${PORT}`);
});

main();