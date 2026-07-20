'use strict';

// Persists bot routing state on the persistent /data volume.
// This is the SOURCE OF TRUTH for sessions because the bot service cannot
// enumerate remote Kilo sessions (kilo session list / debug scrap are local-DB only).

const fs = require('fs');
const path = require('path');

const MAX_SESSIONS_PER_CHAT = parseInt(process.env.KILO_MAX_SESSIONS || '50', 10);

function stateDir() {
  const home = process.env.KILO_TELEGRAM_HOME || '/data';
  return path.join(home, 'kilo-telegram');
}

function stateFile() {
  return path.join(stateDir(), 'state.json');
}

function ensureDir() {
  fs.mkdirSync(stateDir(), { recursive: true });
}

function load() {
  try {
    const raw = fs.readFileSync(stateFile(), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return { chats: {} };
  }
}

function save(state) {
  ensureDir();
  fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2));
}

function chatKey(chatId, threadId) {
  return threadId ? `${chatId}:${threadId}` : `${chatId}`;
}

function getChat(chatId, threadId) {
  const state = load();
  const key = chatKey(chatId, threadId);
  if (!state.chats[key]) {
    state.chats[key] = {
      activeWorkdir: process.env.KILO_DEFAULT_WORKDIR || '',
      activeSession: '',
      activeTaskKey: '',
      tasks: [],
    };
  }
  return state.chats[key];
}

function updateChat(chatId, threadId, patch) {
  const state = load();
  const key = chatKey(chatId, threadId);
  state.chats[key] = Object.assign(getChat(chatId, threadId), patch);
  save(state);
  return state.chats[key];
}

// Records a session and trims the list to MAX_SESSIONS_PER_CHAT.
function recordSession(chatId, threadId, session) {
  const chat = getChat(chatId, threadId);
  chat.tasks.push(session);
  if (session.active) {
    chat.activeSession = session.id;
  }
  // Trim oldest if over the cap.
  if (chat.tasks.length > MAX_SESSIONS_PER_CHAT) {
    chat.tasks = chat.tasks.slice(-MAX_SESSIONS_PER_CHAT);
  }
  updateChat(chatId, threadId, chat);
}

// Marks a session inactive and clears the active task handle if it matches.
function markSessionInactive(chatId, threadId, sessionKey) {
  const chat = getChat(chatId, threadId);
  const task = chat.tasks.find((t) => t.key === sessionKey);
  if (task) task.active = false;
  if (chat.activeTaskKey === sessionKey) chat.activeTaskKey = '';
  updateChat(chatId, threadId, chat);
}

function listSessions(chatId, threadId) {
  return getChat(chatId, threadId).tasks;
}

function getSession(chatId, threadId, sessionId) {
  return getChat(chatId, threadId).tasks.find((t) => t.id === sessionId);
}

module.exports = {
  getChat,
  updateChat,
  recordSession,
  markSessionInactive,
  listSessions,
  getSession,
};
