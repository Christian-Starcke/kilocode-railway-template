'use strict';

// Kilo Telegram bot — Phase 2 hardened.
// Long-poll mode (no public domain required).

const { Bot } = require('grammy');
const store = require('./state-store');
const kilo = require('./kilo-runner');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED = (process.env.TELEGRAM_ALLOWED_USER_ID || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!TOKEN) {
  console.error('[bot] TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

const bot = new Bot(TOKEN);

// Guard: only allow listed user IDs.
bot.use((ctx, next) => {
  const uid = String(ctx.from?.id ?? '');
  if (ALLOWED.length && !ALLOWED.includes(uid)) {
    return ctx.reply('Unauthorized.');
  }
  return next();
});

function parseWorkspaces() {
  try {
    return JSON.parse(process.env.KILO_WORKSPACES_JSON || '{}');
  } catch (_) {
    return {};
  }
}

function resolveWorkdir(input, aliases) {
  if (!input) return '';
  if (aliases[input]) return aliases[input];
  return input; // assume raw path
}

// In-flight task handles keyed by chat/thread so /cancel can kill them.
const activeTasks = new Map();

function taskKey(chatId, threadId) {
  return threadId ? `${chatId}:${threadId}` : `${chatId}`;
}

bot.command('start', (ctx) => {
  const aliases = parseWorkspaces();
  const chat = store.getChat(ctx.chat.id, ctx.message?.message_thread_id);
  let msg = 'Kilo Telegram bot ready.\n\nCommands:\n';
  msg += '/status — Kilo health + active context\n';
  msg += '/projects — list configured workdirs\n';
  msg += '/project <name|path> — set active workdir\n';
  msg += '/kilo <prompt> — run a new Kilo prompt\n';
  msg += '/sessions — list bot-known sessions\n';
  msg += '/session <id> — resume a session\n';
  msg += '/cancel — cancel active task\n';
  msg += `\nActive workdir: ${chat.activeWorkdir || '(none)'}\n`;
  const names = Object.keys(aliases);
  if (names.length) msg += `Available aliases: ${names.join(', ')}\n`;
  return ctx.reply(msg);
});

bot.command('status', async (ctx) => {
  const chat = store.getChat(ctx.chat.id, ctx.message?.message_thread_id);
  const h = await kilo.health();
  let msg = `Kilo server: ${h.ok ? `healthy v${h.version}` : 'UNREACHABLE'}\n`;
  if (!h.ok && h.error) msg += `Error: ${h.error}\n`;
  msg += `Workdir: ${chat.activeWorkdir || '(none)'}\n`;
  msg += `Active session: ${chat.activeSession || '(none)'}\n`;
  msg += `Active task: ${chat.activeTaskKey || '(none)'}\n`;
  return ctx.reply(msg);
});

bot.command('projects', (ctx) => {
  const aliases = parseWorkspaces();
  const names = Object.keys(aliases);
  if (!names.length) return ctx.reply('No KILO_WORKSPACES_JSON configured.');
  const lines = names.map((n) => `- ${n} → ${aliases[n]}`);
  return ctx.reply(`Configured workdirs:\n${lines.join('\n')}`);
});

bot.command('project', (ctx) => {
  const arg = ctx.match;
  if (!arg) return ctx.reply('Usage: /project <name|path>');
  const aliases = parseWorkspaces();
  const wd = resolveWorkdir(arg, aliases);
  store.updateChat(ctx.chat.id, ctx.message?.message_thread_id, { activeWorkdir: wd });
  return ctx.reply(`Active workdir set to: ${wd}`);
});

bot.command('kilo', async (ctx) => {
  const prompt = ctx.match;
  if (!prompt) return ctx.reply('Usage: /kilo <prompt>');
  const threadId = ctx.message?.message_thread_id;
  const chat = store.getChat(ctx.chat.id, threadId);
  const workdir = chat.activeWorkdir;
  if (!workdir) return ctx.reply('Set a workdir first with /project <name|path>.');

  const key = taskKey(ctx.chat.id, threadId);
  if (activeTasks.has(key)) {
    return ctx.reply('A task is already running for this chat. Use /cancel first.');
  }

  const statusMsg = await ctx.reply('Running…');
  let firstChunk = true;

  const run = kilo.runPrompt({
    prompt,
    workdir,
    onText: async (text) => {
      // Best-effort streaming: append to the status message on Telegram.
      // Skip if the message is tiny to avoid edit storms; edit on each event.
      try {
        if (firstChunk) {
          firstChunk = false;
          await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, `Running…\n${text}`);
        }
      } catch (_) {
        // Editing can fail (e.g. identical content); ignore.
      }
    },
    onSession: (sessionId) => {
      store.recordSession(ctx.chat.id, threadId, {
        id: sessionId,
        key,
        workdir,
        prompt,
        active: true,
        createdAt: new Date().toISOString(),
      });
      store.updateChat(ctx.chat.id, threadId, { activeTaskKey: key, activeSession: sessionId });
    },
  });

  activeTasks.set(key, run);

  try {
    const result = await run;
    // Avoid a duplicate session entry: onSession already recorded it with
    // active:true. Only record here if onSession never captured a session ID.
    if (result.sessionId && !store.getSession(ctx.chat.id, threadId, result.sessionId)) {
      store.recordSession(ctx.chat.id, threadId, {
        id: result.sessionId,
        key,
        workdir,
        prompt,
        active: false,
        createdAt: new Date().toISOString(),
      });
    }
    const reply = result.text || '(no output)';
    if (reply.length > 4000) {
      await ctx.reply(reply.slice(0, 4000));
      await ctx.reply('…(truncated)');
    } else {
      await ctx.reply(reply);
    }
  } catch (err) {
    await ctx.reply(`Kilo error: ${String(err.message || err)}`);
  } finally {
    activeTasks.delete(key);
    store.markSessionInactive(ctx.chat.id, threadId, key);
  }
});

bot.command('sessions', (ctx) => {
  const tasks = store.listSessions(ctx.chat.id, ctx.message?.message_thread_id);
  if (!tasks.length) return ctx.reply('No bot-known sessions yet.');
  const lines = tasks.map((t) => `- ${t.id} @ ${t.workdir}${t.active ? ' (active)' : ''}`);
  return ctx.reply(`Known sessions:\n${lines.join('\n')}`);
});

bot.command('session', async (ctx) => {
  const id = ctx.match;
  if (!id) return ctx.reply('Usage: /session <id>');
  const threadId = ctx.message?.message_thread_id;
  const chat = store.getChat(ctx.chat.id, threadId);
  const workdir = chat.activeWorkdir;
  if (!workdir) return ctx.reply('Set a workdir first with /project <name|path>.');

  await ctx.reply(`Resuming ${id}…`);
  const rkey = taskKey(ctx.chat.id, threadId);
  if (activeTasks.has(rkey)) {
    return ctx.reply('A task is already running for this chat. Use /cancel first.');
  }
  const run = kilo.runPrompt({ prompt: 'continue', workdir, sessionId: id });
  activeTasks.set(rkey, run);
  try {
    const result = await run;
    store.updateChat(ctx.chat.id, threadId, { activeSession: id, activeTaskKey: rkey });
    return ctx.reply(result.text || '(no output)');
  } catch (err) {
    return ctx.reply(`Kilo error: ${String(err.message || err)}`);
  } finally {
    activeTasks.delete(rkey);
    store.markSessionInactive(ctx.chat.id, threadId, rkey);
  }
});

bot.command('cancel', (ctx) => {
  const key = taskKey(ctx.chat.id, ctx.message?.message_thread_id);
  const run = activeTasks.get(key);
  if (!run) return ctx.reply('No active task to cancel.');
  try {
    run.cancel();
  } catch (_) {
    // ignore
  }
  activeTasks.delete(key);
  store.markSessionInactive(ctx.chat.id, ctx.message?.message_thread_id, key);
  return ctx.reply('Cancel requested. The running task will be terminated.');
});

bot.catch((err) => {
  console.error('[bot] error', err);
});

console.log('[bot] starting long-poll');
bot.start({
  onStart: () => console.log('[bot] Telegram polling active'),
});
