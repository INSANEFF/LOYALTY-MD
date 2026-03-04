/*
📝 | LOYALTY MD Bot
🖥️ | Powered by LOYALTY MD
  MongoDB Session Database Layer
*/

const { MongoClient } = require('mongodb');

let client = null;
let db = null;

/**
 * Connect to MongoDB
 */
async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log('[DB] No MONGODB_URI set — using local file sessions only.');
    return null;
  }
  try {
    client = new MongoClient(uri);
    await client.connect();
    db = client.db('loyaltymd');
    console.log('[DB] Connected to MongoDB successfully.');
    return db;
  } catch (err) {
    console.error('[DB] MongoDB connection failed:', err.message);
    return null;
  }
}

/**
 * Get the database instance
 */
function getDB() {
  return db;
}

/**
 * Save a session to MongoDB
 * @param {string} sessionId - Unique session identifier
 * @param {object} authState - The Baileys auth credentials (creds + keys)
 */
async function saveSession(sessionId, authState) {
  if (!db) return;
  try {
    await db.collection('sessions').updateOne(
      { sessionId },
      {
        $set: {
          sessionId,
          authState: JSON.stringify(authState),
          active: true,
          updatedAt: new Date()
        },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );
  } catch (err) {
    console.error(`[DB] Error saving session ${sessionId}:`, err.message);
  }
}

/**
 * Load a session from MongoDB
 * @param {string} sessionId
 * @returns {object|null} parsed auth state
 */
async function loadSession(sessionId) {
  if (!db) return null;
  try {
    const doc = await db.collection('sessions').findOne({ sessionId, active: true });
    if (doc && doc.authState) {
      return JSON.parse(doc.authState);
    }
    return null;
  } catch (err) {
    console.error(`[DB] Error loading session ${sessionId}:`, err.message);
    return null;
  }
}

/**
 * Get all active sessions
 * @returns {Array} list of session documents
 */
async function getAllSessions() {
  if (!db) return [];
  try {
    return await db.collection('sessions').find({ active: true }).toArray();
  } catch (err) {
    console.error('[DB] Error fetching sessions:', err.message);
    return [];
  }
}

/**
 * Delete/deactivate a session
 * @param {string} sessionId
 */
async function deleteSession(sessionId) {
  if (!db) return false;
  try {
    const result = await db.collection('sessions').updateOne(
      { sessionId },
      { $set: { active: false, updatedAt: new Date() } }
    );
    return result.modifiedCount > 0;
  } catch (err) {
    console.error(`[DB] Error deleting session ${sessionId}:`, err.message);
    return false;
  }
}

/**
 * Store session creds (called on every creds.update for persistence)
 */
async function updateSessionCreds(sessionId, creds) {
  if (!db) return;
  try {
    await db.collection('sessions').updateOne(
      { sessionId },
      { $set: { 'creds': JSON.stringify(creds), updatedAt: new Date() } }
    );
  } catch (err) {
    console.error(`[DB] Error updating creds for ${sessionId}:`, err.message);
  }
}

module.exports = {
  connectDB,
  getDB,
  saveSession,
  loadSession,
  getAllSessions,
  deleteSession,
  updateSessionCreds
};
