# kilo-telegram-railway

Dedicated Telegram bot service for Kilo Code. Talks **directly** to the Kilo
server via the documented CLI (`kilo run --attach`) — Hermes is not in the
request path.

## Architecture

```
Telegram  ──long-poll──▶  kilo-telegram-bot (this service)
                              │
                              │ kilo run --attach $KILO_SERVER_URL
                              ▼
                         Kilo server (separate Railway service)
```

- The bot runs in **long-poll mode** (no public domain required).
- It shells out to a **pinned `@kilocode/cli`** for execution/resume.
- Project/workdir routing comes from **`KILO_WORKSPACES_JSON`** (env alias map).
- Session tracking is **bot-local** on `/data`, because `kilo session list`
  / `debug scrap` are local-DB only and cannot see the remote server's sessions
  from a separate service.

## Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Node 22 image, pins `@kilocode/cli`, installs deps |
| `entrypoint.sh` | Boot script, ensures `/data` state dir, optional IPv4 |
| `package.json` | `grammy` dependency, no build step |
| `bot.js` | Telegram command surface + routing |
| `kilo-runner.js` | Thin wrapper around `kilo run --attach --format json` |
| `state-store.js` | Persists chat→workdir→session routing on `/data` |
| `railway.toml` / `railway.json` | Railway deploy config |

## Required env vars

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_ID`
- `KILO_SERVER_URL`
- `KILO_SERVER_USERNAME` (default `kilo`)
- `KILO_SERVER_PASSWORD`
- `KILO_DEFAULT_WORKDIR`
- `KILO_TELEGRAM_HOME` (default `/data`)

## Optional env vars

- `KILO_DEFAULT_AGENT` — appended as `--agent` only when set
- `KILO_DEFAULT_MODEL` — appended as `--model` only when set
- `KILO_WORKSPACES_JSON` — `{"alias": "/remote/path", ...}`
- `TELEGRAM_FORCE_IPV4` — set non-empty to prefer IPv4 for polling
- `KILO_LOG_LEVEL`

## Commands

- `/start` — help + current routing context
- `/status` — Kilo health + active workdir/session
- `/projects` — list configured workdir aliases
- `/project <name|path>` — set active workdir for this chat/thread
- `/kilo <prompt>` — run a new Kilo prompt in the active workdir
- `/sessions` — list bot-known sessions
- `/session <id>` — resume a prior session
- `/cancel` — stub (wired in a later phase)

## Phase 0 contract (verified)

- `kilo run --attach $URL --dir <remote-path> --auto --format json "<prompt>"` works
- `--continue --session <id>` resumes the same remote session
- `--dir` is a path **on the remote server**
- `sessionID` is captured from the JSON event stream
- Auth via `KILO_SERVER_USERNAME` / `KILO_SERVER_PASSWORD` (Basic Auth)
