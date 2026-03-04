/*
📝 | LOYALTY MD Bot - Persistent Store
🖥️ | Manages owners, sudo users, etc.
*/

const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'store.json');

function ensureDir() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadStore() {
  ensureDir();
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    }
  } catch (_) {}
  return { owners: [], sudo: [] };
}

function saveStore(data) {
  ensureDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

function getOwners() {
  return loadStore().owners || [];
}

function addOwner(number) {
  const store = loadStore();
  store.owners = store.owners || [];
  const clean = number.replace(/[^0-9]/g, '');
  if (!store.owners.includes(clean)) {
    store.owners.push(clean);
    saveStore(store);
    return true;
  }
  return false;
}

function removeOwner(number) {
  const store = loadStore();
  store.owners = store.owners || [];
  const clean = number.replace(/[^0-9]/g, '');
  const idx = store.owners.indexOf(clean);
  if (idx !== -1) {
    store.owners.splice(idx, 1);
    saveStore(store);
    return true;
  }
  return false;
}

function getSudo() {
  return loadStore().sudo || [];
}

function addSudo(number) {
  const store = loadStore();
  store.sudo = store.sudo || [];
  const clean = number.replace(/[^0-9]/g, '');
  if (!store.sudo.includes(clean)) {
    store.sudo.push(clean);
    saveStore(store);
    return true;
  }
  return false;
}

function removeSudo(number) {
  const store = loadStore();
  store.sudo = store.sudo || [];
  const clean = number.replace(/[^0-9]/g, '');
  const idx = store.sudo.indexOf(clean);
  if (idx !== -1) {
    store.sudo.splice(idx, 1);
    saveStore(store);
    return true;
  }
  return false;
}

module.exports = { loadStore, saveStore, getOwners, addOwner, removeOwner, getSudo, addSudo, removeSudo };
