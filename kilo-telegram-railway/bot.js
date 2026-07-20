'use strict';

// Kilo Telegram bot — Phase 1 scaffold.
// Long-poll mode (no public domain required).

const { Bot, InlineKeyboard } = require('grammy');
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
  msg += `Workdir: ${chat.activeWorkdir || '(none)'}\n`;
  msg += `Active session: ${chat.activeSession || '(none)'}\n`;
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
  const chat = store.getChat(ctx.chat.id, ctx.message?.message_thread_id);
  const workdir = chat.activeWorkdir;
  if (!workdir) return ctx.reply('Set a workdir first with /project <name|path>.');

  await ctx.reply('Running…');
  try {
    const result = await kilo.runPrompt({ prompt, workdir });
    if (result.sessionId) {
      store.recordSession(ctx.chat.id, ctx.message?.message_thread_id, {
        id: result.sessionId,
        workdir,
        prompt,
        active: true,
        createdAt: new Date().toISOString(),
      });
    }
    return ctx.reply(result.text || '(no output)');
  } catch (err) {
    return ctx.reply(`Kilo error: ${String(err.message || err)}`);
  }
});

bot.command('sessions', (ctx) => {
  const tasks = store.listSessions(ctx.chat.id, ctx.message?.message_thread_id);
  if (!tasks.length) return ctx.reply('No bot-known sessions yet.');
  const lines = tasks.map((t) => `- ${t.id} @ ${t.workdir}`);
  return ctx.reply(`Known sessions:\n${lines.join('\n')}`);
});

bot.command('session', async (ctx) => {
  const id = ctx.match;
  if (!id) return ctx.reply('Usage: /session <id>');
  const chat = store.getChat(ctx.chat.id, ctx.message?.message_thread_id);
  const workdir = chat.activeWorkdir;
  if (!workdir) return ctx.reply('Set a workdir first with /project <name|path>.');

  await ctx.reply(`Resuming ${id}…`);
  try {
    const result = await kilo.runPrompt({ prompt: 'continue', workdir, sessionId: id });
    store.updateChat(ctx.chat.id, ctx.message?.message_thread_id, { activeSession: id });
    return ctx.reply(result.text || '(no output)');
  } catch (err) {
    return ctx.reply(`Kilo error: ${String(err.message || err)}`);
  }
});

bot.command('cancel', (ctx) => {
  return ctx.reply('Cancel is not yet wired in Phase 1 (requires task handle tracking).');
});

bot.catch((err) => {
  console.error('[bot] error', err);
});

console.log('[bot] starting long-poll');
bot.start({
  onStart: () => console.log('[bot] Telegram polling active'),
});
