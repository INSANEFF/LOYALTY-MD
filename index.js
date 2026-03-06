/*
📝 | LOYALTY MD Bot v4.0
🖥️ | Powered by @whiskeysockets/baileys + gifted-btns
*/

const http = require('http');
const fs = require('fs');
const pino = require('pino');
const readline = require('readline');
const path = require('path');
const chalk = require('chalk');
const { exec } = require('child_process');
const NodeCache = require('node-cache');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  downloadContentFromMessage,
  jidDecode,
  Browsers,
  DisconnectReason,
  delay
} = require('@whiskeysockets/baileys');

// Message retry counter cache — prevents retry storms (MEGA-MD pattern)
const msgRetryCounterCache = new NodeCache();

const { sendButtons } = require('gifted-btns');

const handleCommand = require('./case');
const config = require('./config');
const { connectDB, getAllSessions, saveSession, deleteSession: dbDeleteSession } = require('./database/mongodb');

// 🛡️ Prevent crashes
process.on('uncaughtException', (err) => {
  const msg = String(err);
  const ignore = ['conflict', 'not-authorized', 'Socket connection timeout', 'rate-overlimit',
    'Connection Closed', 'Timed Out', 'Value not found', 'Stream Errored', 'restart required',
    'Bad MAC', 'Failed to decrypt', 'decryption-error'];
  if (!ignore.some(x => msg.includes(x))) console.error('[UNCAUGHT]', err.message);
});
process.on('unhandledRejection', (err) => {
  const msg = String(err?.message || err);
  const ignore = ['Bad MAC', 'Failed to decrypt', 'decryption-error'];
  if (!ignore.some(x => msg.includes(x))) console.error('[UNHANDLED]', msg);
});

// Suppress noisy baileys/signal internal logs
const _origConsoleError = console.error;
console.error = function (...args) {
  const first = String(args[0] || '');
  if (first.includes('Bad MAC') || first.includes('Failed to decrypt') || first.includes('Session error') || first.includes('decryption-error')) return;
  _origConsoleError.apply(console, args);
};
// libsignal dumps huge SessionEntry objects via console.info — suppress them
const _origConsoleInfo = console.info;
console.info = function (...args) {
  const first = String(args[0] || '');
  if (first.includes('Closing session') || first.includes('Opening session') || first.includes('Removing old closed') || first.includes('Migrating session')) return;
  _origConsoleInfo.apply(console, args);
};
const _origConsoleWarn = console.warn;
console.warn = function (...args) {
  const first = String(args[0] || '');
  if (first.includes('Decrypted message with') || first.includes('Session already') || first.includes('Closing open session') || first.includes('Unhandled bucket') || first.includes('printQRInTerminal')) return;
  _origConsoleWarn.apply(console, args);
};

// Group metadata cache (5 min TTL) to avoid network calls on every message
const _groupMetaCache = new Map();
const GROUP_META_TTL = 5 * 60 * 1000;
function getCachedGroupMeta(sock, jid) {
  const cached = _groupMetaCache.get(jid);
  if (cached && Date.now() - cached.ts < GROUP_META_TTL) return Promise.resolve(cached.data);
  return sock.groupMetadata(jid).then(meta => {
    _groupMetaCache.set(jid, { data: meta, ts: Date.now() });
    return meta;
  }).catch(() => null);
}

// Known bot commands — skip handleCommand for non-matching messages (NO_PREFIX mode)
const KNOWN_COMMANDS = new Set([
  'ping','alive','menu','help','weather','checktime','time','gitclone','save',
  'fb','facebook','fbdl','ig','instagram','igdl','tiktok','tt','play','music',
  'video','toaudio','tovoicenote','toimage','private','self','public',
  'addsession','delsession','sessions','listsessions','addbot','delbot',
  'addowner','delowner','removeowner','listowners','owners',
  'sudo','addsudo','delsudo','removesudo','listsudo','playdoc',
  'antilink','antitag','antidemote','antipromote','antibadword',
  'add','hidetag','tagall','everyone','kick','remove','promote','demote','copilot',
  '>','<','=>'
]);

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
    keepAliveIntervalMs: 10000,
    retryRequestDelayMs: 1500,
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
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    msgRetryCounterCache,
    getMessage: async (key) => {
      return { conversation: '' };
    }
  });

  // Save creds on update
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
        log.info(`Using phone: ${chalk.green(cleanNumber)}`);
      }
      await delay(1500);
      console.clear();
      const pairCode = await sock.requestPairingCode(cleanNumber);
      log.info(`Pairing code: ${chalk.green(pairCode)}`);
      log.info("Enter this code on your phone → Linked Devices → Link a Device");
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

  // ---- Connection handling ----
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    try {
      if (connection === 'connecting') {
        log.info(`Session "${sessionId}" connecting...`);
      } else if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const reason = lastDisconnect?.error?.message || 'unknown';
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;
        log.error(`Session "${sessionId}" disconnected (code: ${statusCode}, reason: ${reason}).`);
        delete global.activeSessions[sessionId];
        if (shouldReconnect) {
          const attempts = (global.reconnectAttempts[sessionId] || 0) + 1;
          global.reconnectAttempts[sessionId] = attempts;
          const backoff = Math.min(3000 * Math.pow(2, attempts - 1), 30000);
          log.info(`Reconnecting session "${sessionId}" in ${backoff / 1000}s (attempt #${attempts})...`);
          setTimeout(() => startSession(sessionId, false), backoff);
        } else {
          log.error(`Session "${sessionId}" logged out (401). Not reconnecting.`);
          delete global.reconnectAttempts[sessionId];
        }
      } else if (connection === 'open') {
        global.reconnectAttempts[sessionId] = 0;
        const botNumber = sock.user?.id?.split("@")[0]?.split(":")[0] || 'unknown';
        log.success(`Session "${sessionId}" connected as ${chalk.green(botNumber)}`);
        global.activeSessions[sessionId] = sock;
        if (isInitial) { try { rl.close(); } catch (_) {} }

        sock.isPublic = true;

        // Send connection DM with interactive buttons
        setTimeout(async () => {
          try {
            const ownerJid = (sock.user?.id?.split(":")[0] || '') + "@s.whatsapp.net";
            await sendButtons(sock, ownerJid, {
              text: `✅ *${config.BOT_NAME} Connected!*\n\n👑 ${config.OWNER_NAME} v4.0\n📦 Session: ${sessionId}\n📱 Number: ${botNumber}\n\n✨ Tap a button below!`,
              footer: '🖥️ Powered by @whiskeysockets/baileys',
              buttons: [
                { id: 'menu', text: '📋 Menu' },
                { id: 'ping', text: '🏓 Ping' }
              ]
            });
          } catch (err) {
            log.error(`Failed to send DM for session ${sessionId}: ${err.message || err}`);
          }
        }, 3000);
      }
    } catch (err) {
      console.error(`connection.update error for session ${sessionId}:`, err);
    }
  });

  // ---- Group participant events (anti-promote / anti-demote) ----
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

  // ---- Messages handler ----
  sock.ev.on('messages.upsert', async (chatUpdate) => {
    const { messages, type: upsertType } = chatUpdate;
    // baileys v7 sends 'append' for real-time messages; v6 used 'notify'
    if (upsertType !== 'notify' && upsertType !== 'append') return;
    try {
      // Keep processing responsive under heavy backlog bursts.
      const recentBatch = messages.length > 40 ? messages.slice(-40) : messages;
      for (const msg of [...recentBatch].reverse()) {
        if (!msg.message) continue;

        // Process append + notify the same way so commands are never dropped.

        // Allow fromMe if it starts with a command prefix — owner can use bot from same phone
        // Bot responses never start with . ! / # + so no infinite loop risk
        if (msg.key.fromMe) {
          const _bodyPeek = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
          if (!/^[.!/#+><=]/.test(_bodyPeek)) continue;
        }
        // Skip internal Baileys protocol messages (BAE5)
        if (msg.key.id?.startsWith('BAE5') && msg.key.id.length === 16) continue;

        // Auto-view statuses
        if (config.STATUS_VIEW && msg.key.remoteJid === 'status@broadcast') {
          try { await sock.readMessages([msg.key]); } catch (_) {}
          continue;
        }

        if (msg.key.remoteJid === 'status@broadcast') continue;
        if (msg.key.remoteJid?.endsWith('@newsletter')) continue;

        const from = msg.key.remoteJid;
        if (!from.endsWith('@s.whatsapp.net') && !from.endsWith('@g.us') && !from.endsWith('@lid')) continue;

        // baileys v7 uses LID addressing; participantAlt has the real phone JID
        const sender = msg.key.participantAlt || msg.key.participant || msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const botNumber = (sock.user?.id?.split(":")[0] || '') + "@s.whatsapp.net";

        // Unwrap ephemeral / viewOnce / document wrappers
        let msgContent = msg.message;
        if (msgContent.ephemeralMessage) msgContent = msgContent.ephemeralMessage.message;
        if (msgContent.viewOnceMessage) msgContent = msgContent.viewOnceMessage.message;
        if (msgContent.viewOnceMessageV2) msgContent = msgContent.viewOnceMessageV2.message;
        if (msgContent.documentWithCaptionMessage) msgContent = msgContent.documentWithCaptionMessage.message;
        msg.message = msgContent;

        // Extract message body from all possible message types
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

        // Handle gifted-btns interactive button responses
        if (msgContent.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
          try {
            const params = JSON.parse(msgContent.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
            body = params.id || body;
          } catch (_) {}
        }

        body = (body || '').trim();
        if (!body) continue;

        const contextInfo = msgContent?.extendedTextMessage?.contextInfo
          || msgContent?.imageMessage?.contextInfo
          || msgContent?.videoMessage?.contextInfo
          || msgContent?.documentMessage?.contextInfo
          || {};

        const msgType = Object.keys(msgContent).find(k => k !== 'messageContextInfo');

        const m = {
          ...msg,
          chat: from,
          sender,
          isGroup,
          body,
          mentionedJid: contextInfo.mentionedJid || [],
          mtype: msgType,
          type: msgType,
          quoted: contextInfo.quotedMessage
            ? {
                key: {
                  remoteJid: contextInfo.remoteJid || from,
                  id: contextInfo.stanzaId,
                  participant: contextInfo.participant
                },
                message: contextInfo.quotedMessage,
                sender: contextInfo.participant || from,
                msg: contextInfo.quotedMessage[Object.keys(contextInfo.quotedMessage).find(k => k !== 'messageContextInfo')]
              }
            : null,
          reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
          pushName: msg.pushName || 'Unknown'
        };

        let command = body.split(/ +/)[0].toLowerCase();
        // Strip common prefixes (. ! / #) so ".ping" matches "ping"
        const stripped = command.replace(/^[.!/#+]+/, '');
        if (stripped) command = stripped;

        // Always forward text to handleCommand for reliability.
        // Non-command chatter exits quickly in case.js switch/default.

        // Use cached group metadata — no network call
        const groupMeta = isGroup ? await getCachedGroupMeta(sock, from) : null;
        const groupAdmins = groupMeta ? groupMeta.participants.filter(p => p.admin).map(p => p.id) : [];
        const isBotAdmin = isGroup ? groupAdmins.includes(botNumber) : false;
        const isAdmin = isGroup ? groupAdmins.includes(sender) : false;

        const _cmdStart = Date.now();
        m._receivedAt = _cmdStart;
        try {
          await handleCommand(sock, m, command, isGroup, isAdmin, groupAdmins, isBotAdmin, groupMeta, config);
          const ms = Date.now() - _cmdStart;
          if (ms > 50) log.info(`"${command}" ${ms}ms`);
        } catch (cmdErr) {
          log.error(`"${command}" failed ${Date.now() - _cmdStart}ms: ${cmdErr.message}`);
        }
      }
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
    engine: '@whiskeysockets/baileys',
    sessions: activeSessions.length,
    uptime: Math.floor(process.uptime()) + 's'
  }));
}).listen(PORT, '0.0.0.0', () => {
  log.info(`🌐 Health server listening on port ${PORT}`);
});

main();