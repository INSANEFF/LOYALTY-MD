module.exports = {
  // ============================================================
  // 🎨 CUSTOMIZATION — Set these via env vars on your panel
  //    or edit the defaults below for local testing
  // ============================================================
  BOT_NAME: process.env.BOT_NAME || 'LOYALTY MD',
  OWNER_NAME: process.env.OWNER_NAME || 'LOYALTY',
  OWNER_NUMBER: process.env.OWNER_NUMBER || '',

  // 📱 PHONE_NUMBER — The WhatsApp number to connect as the bot
  //    Format: country code + number, no + or spaces
  //    Leave empty '' to be prompted on first run.
  PHONE_NUMBER: process.env.PHONE_NUMBER || '',

  // ⚙️ BOT SETTINGS
  PREFIX: process.env.PREFIX || '',
  NO_PREFIX: (process.env.NO_PREFIX || 'false').toLowerCase() === 'true',
  STATUS_VIEW: (process.env.STATUS_VIEW || 'true').toLowerCase() === 'true',

  // 🗄️ DATABASE & SESSION
  SESSION_DIR: './trash_baileys',
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb+srv://goodlucknosakhare9_db_user:loyalty@cluster0.gei0orj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
  SESSION_ID: process.env.SESSION_ID || '',
};






/*
📝 | LOYALTY MD Bot
🖥️ | Powered by LOYALTY MD
*/