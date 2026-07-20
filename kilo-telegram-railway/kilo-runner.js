'use strict';

// Thin wrapper around the documented Kilo CLI.
// Contract verified in Phase 0: kilo run --attach ... --format json
// Only this module shells out to `kilo`; the bot never parses raw process output.

const { spawn } = require('child_process');

const KILO_BIN = 'kilo';
const SERVER_URL = process.env.KILO_SERVER_URL;
const USERNAME = process.env.KILO_SERVER_USERNAME || 'kilo';
const PASSWORD = process.env.KILO_SERVER_PASSWORD;
const DEFAULT_AGENT = process.env.KILO_DEFAULT_AGENT;
const DEFAULT_MODEL = process.env.KILO_DEFAULT_MODEL;

function buildArgs({ prompt, workdir, sessionId, agent, model }) {
  const args = ['run', '--attach', SERVER_URL, '--format', 'json'];
  if (USERNAME) args.push('--username', USERNAME);
  if (PASSWORD) args.push('--password', PASSWORD);
  if (workdir) args.push('--dir', workdir);
  if (sessionId) {
    args.push('--continue', '--session', sessionId);
  } else {
    if (agent || DEFAULT_AGENT) args.push('--agent', agent || DEFAULT_AGENT);
    if (model || DEFAULT_MODEL) args.push('--model', model || DEFAULT_MODEL);
  }
  args.push('--auto');
  args.push(prompt);
  return args;
}

// Runs a prompt. Returns a promise that resolves with { sessionId, text, ok }.
// `onText` is called with incremental assistant text events (optional).
function runPrompt({ prompt, workdir, sessionId, agent, model, onText }) {
  return new Promise((resolve, reject) => {
    const args = buildArgs({ prompt, workdir, sessionId, agent, model });
    const child = spawn(KILO_BIN, args, { env: process.env });

    let sessionIdOut = '';
    let textOut = '';
    let rawOut = '';
    let errOut = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      rawOut += text;
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let evt;
        try {
          evt = JSON.parse(trimmed);
        } catch (_) {
          continue;
        }
        if (evt.sessionID && !sessionIdOut) sessionIdOut = evt.sessionID;
        if (evt.type === 'text' && evt.text) {
          textOut += evt.text;
          if (typeof onText === 'function') onText(evt.text);
        }
        if (evt.type === 'step_finish') {
          // task complete
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      errOut += chunk.toString();
    });

    child.on('error', (err) => reject(err));

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`kilo exited ${code}: ${errOut || rawOut}`));
      }
      resolve({ sessionId: sessionIdOut, text: textOut, ok: true });
    });
  });
}

// Health check against the documented public endpoint.
async function health() {
  const url = `${SERVER_URL.replace(/\/$/, '')}/global/health`;
  const auth = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
  try {
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!res.ok) return { ok: false, status: res.status };
    const body = await res.json();
    return { ok: true, healthy: body.healthy, version: body.version };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

module.exports = { runPrompt, health };
