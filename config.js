module.exports = {
  BOT_NAME: 'LOYALTY MD',
  OWNER_NAME: 'LOYALTY MD',
  OWNER_NUMBER: '2349112184365',

  // ============================================================
  // 📱 PHONE_NUMBER — The WhatsApp number to connect as the bot
  //    Set this to skip the pairing code prompt on startup.
  //    Format: country code + number, no + or spaces
  //    Example: '12025551234' or '255778104517'
  //    Leave empty '' to be prompted on first run.
  // ============================================================
  PHONE_NUMBER: process.env.PHONE_NUMBER || '',

  SESSION_DIR: './trash_baileys',
  NO_PREFIX: true,
  STATUS_VIEW: true,
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb+srv://goodlucknosakhare9_db_user:loyalty@cluster0.gei0orj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
  SESSION_ID: process.env.SESSION_ID || '',
};






/*
📝 | LOYALTY MD Bot
🖥️ | Powered by LOYALTY MD
*/