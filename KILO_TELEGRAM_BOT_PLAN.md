# Kilo Telegram Bot (Option A) Implementation Plan

**Goal:** Build a dedicated Telegram bot Railway service for Kilo Code that talks directly to the Kilo service, without Hermes in the request path.

**Architecture:** Telegram long-polls into a dedicated `kilo-telegram-bot` Railway service. That service uses the documented Kilo CLI as a thin client against the remote Kilo server, primarily `kilo run --attach` for task execution and `kilo run --continue --session` for resumption. Project/workdir discovery is handled by an env-driven alias map only; CLI discovery is local-only debug tooling and is not part of the bot runtime. Bot state is persisted on its own `/data` volume; Kilo remains the source of truth for actual code-session execution.

**Tech Stack:** Node 22, a lightweight Telegram bot library, pinned `@kilocode/cli`, Railway Docker deployment, `/data` volume persistence, shell entrypoint.

---

## Pre-execution audit findings

These are the changes made before implementation:

1. **Do not depend on private/internal Kilo endpoints.**
   - The earlier draft assumed hidden endpoints such as `/pty/create`.
   - The plan now uses only documented Kilo CLI commands and documented public HTTP surfaces.

2. **Do not assume `kilo session list` can enumerate remote sessions from a separate bot service.**
   - The CLI supports `--format json`, but only against the local Kilo DB in the bot's own runtime.
   - Session listing is therefore bot-managed first; the CLI is not a remote session source of truth.

3. **Do not assume `kilo debug scrap` can discover remote projects from a separate bot service.**
   - `kilo debug scrap` reads the local Kilo DB only; a separate bot service starts with an empty local DB.
   - Workdir/project discovery therefore must come from an env-supplied alias map; CLI discovery is not part of the bot runtime.

4. **Use `KILO_SERVER_URL`, not a vague API URL.**
   - The connection target is the Kilo server, so the env var should read like an attach target.
   - Keep `KILO_SERVER_USERNAME` and `KILO_SERVER_PASSWORD` alongside it.

5. **Keep optional CLI flags conditional.**
   - Only pass `--model` or other optional flags when values are actually configured.
   - Avoid passing empty strings into the CLI.

6. **Keep bot state minimal and local.**
   - Persist only Telegram chat/thread → active workdir/session metadata on the bot’s `/data` volume.
   - Do not duplicate Kilo session history.

7. **Use plain JavaScript unless a build step is added on purpose.**
   - The service stays lean if the bot runtime is plain Node.
   - No TypeScript build pipeline is needed for the first slice.

8. **Use a separate Telegram bot token.**
   - Do not reuse the Hermes Telegram gateway token.
   - Shared tokens can cause Telegram polling/webhook conflicts.

---

## Scope

### In scope
- Dedicated Railway service: `kilo-telegram-bot`
- Telegram long-polling bot service with no public domain
- Kilo CLI-based task execution and session continuation
- Bot-side session/workdir routing state on `/data`
- Railway packaging and env sync
- Verification commands and smoke tests

### Out of scope
- Any change to Kilo server internals
- Any change to the main Kilo Console UI
- Hermes Telegram gateway changes
- Replacing Kilo’s existing session model

---

## Phase 0: Spike the Kilo CLI contract first

**Objective:** Verify the exact CLI behavior against the live Kilo service before writing the bot.

**Files:**
- No code files yet; this is a validation spike

**Checks to run:**
```bash
curl -u "kilo:$KILO_SERVER_PASSWORD" "$KILO_SERVER_URL/global/health"

kilo run --attach "$KILO_SERVER_URL" \
  --username "$KILO_SERVER_USERNAME" \
  --password "$KILO_SERVER_PASSWORD" \
  --dir "$KILO_DEFAULT_WORKDIR" \
  --auto \
  --format json \
  "ping"

kilo run --attach "$KILO_SERVER_URL" \
  --username "$KILO_SERVER_USERNAME" \
  --password "$KILO_SERVER_PASSWORD" \
  --dir "$KILO_DEFAULT_WORKDIR" \
  --continue \
  --session "$KNOWN_SESSION_ID" \
  --format json \
  "continue"

kilo debug scrap
kilo session list
```

**What this spike must answer:**
- Does `kilo run --attach` reliably produce machine-parseable output for the bot runner?
- Does `kilo run --continue --session` resume the expected remote session?
- Is `kilo debug scrap` useful for remote/project discovery, or should the bot rely entirely on an env alias map?
- Is `kilo session list` useful only as a debug/admin command, or can it be used in the bot flow?

**Expected outcome:**
- A clear yes/no on whether discovery can be bot-driven or must be env-driven.
- A confirmed command shape for the runner before any implementation starts.

---

## Phase 1: Scaffold the bot service

**Objective:** Create a self-contained `kilo-telegram-railway/` service folder inside the existing `kilocode-railway-template` repo.

**Files:**
- Create: `kilo-telegram-railway/Dockerfile`
- Create: `kilo-telegram-railway/entrypoint.sh`
- Create: `kilo-telegram-railway/package.json`
- Create: `kilo-telegram-railway/bot.js`
- Create: `kilo-telegram-railway/kilo-runner.js`
- Create: `kilo-telegram-railway/state-store.js`
- Create: `kilo-telegram-railway/railway.toml`
- Create: `kilo-telegram-railway/railway.json`
- Create: `kilo-telegram-railway/README.md`

**Implementation notes:**
- Use plain JavaScript modules to avoid a build pipeline.
- Use a lightweight Telegram library such as `grammy` or `telegraf`.
- Install a pinned `@kilocode/cli` version in the bot image so the bot can call the documented Kilo CLI.
- Persist only bot routing state and task metadata on the bot’s `/data` volume.
- Do **not** write a `.env` file unless a dependency absolutely requires it; pass Railway env vars directly to the bot process and child CLI calls.

**Verification:**
```bash
cd /data/home/workspace/kilo-telegram-plan
sh -n kilo-telegram-railway/entrypoint.sh
node --check kilo-telegram-railway/bot.js
node --check kilo-telegram-railway/kilo-runner.js
node --check kilo-telegram-railway/state-store.js
```

**Expected:** shell and syntax checks pass before any deploy work.

---

## Phase 2: Implement the Kilo runner

**Objective:** Create a thin wrapper that shells out to the documented Kilo CLI commands and normalizes results for the bot.

**Files:**
- Modify: `kilo-telegram-railway/kilo-runner.js`
- Modify: `kilo-telegram-railway/state-store.js`
- Modify: `kilo-telegram-railway/bot.js`

**Core command flow:**

### Send a prompt
Use the Kilo CLI attached to the Railway Kilo service:
```bash
kilo run --attach "$KILO_SERVER_URL" \
  --username "$KILO_SERVER_USERNAME" \
  --password "$KILO_SERVER_PASSWORD" \
  --dir "$WORKDIR" \
  --auto \
  --format json \
  "<prompt>"
```

If `KILO_DEFAULT_AGENT` is set, append `--agent "$KILO_DEFAULT_AGENT"`; otherwise omit it.
If `KILO_DEFAULT_MODEL` is set, append `--model "$KILO_DEFAULT_MODEL"`; otherwise omit it.

### Resume a session
```bash
kilo run --attach "$KILO_SERVER_URL" \
  --username "$KILO_SERVER_USERNAME" \
  --password "$KILO_SERVER_PASSWORD" \
  --dir "$WORKDIR" \
  --continue \
  --session "$SESSION_ID" \
  --format json
```

### Discovery helpers
- Prefer the bot’s env-driven workspace alias map for `/projects`.
- Treat `kilo debug scrap` and `kilo session list` as local debug/admin helpers only; never use them for bot routing or remote session discovery.

**Implementation notes:**
- Parse the JSON event stream from `kilo run --format json`.
- Capture the `sessionID` from the first `step_start` event and the completion state from the event stream.
- Keep the CLI wrapper isolated so the Telegram code never parses raw process output directly.
- MVP: collect `text` events and reply when `step_finish` arrives; do not require partial streaming in Phase 1.
- Store a small local index of bot-created sessions on `/data`; this is the source of truth for `/sessions`, because remote session listing is unavailable from the bot service.

**Verification:**
```bash
curl -u "kilo:$KILO_SERVER_PASSWORD" "$KILO_SERVER_URL/global/health"
kilo run --attach "$KILO_SERVER_URL" --username "$KILO_SERVER_USERNAME" --password "$KILO_SERVER_PASSWORD" --dir "$KILO_DEFAULT_WORKDIR" --auto --format json "ping"
```

**Expected:** health returns 200, and a simple prompt round-trips successfully.

---

## Phase 3: Implement Telegram commands and routing

**Objective:** Make the bot usable from Telegram with a small command surface that maps cleanly to Kilo sessions and workdirs.

**Files:**
- Modify: `kilo-telegram-railway/bot.js`
- Modify: `kilo-telegram-railway/state-store.js`

**Commands:**
- `/start` — show help and current routing context
- `/status` — show Kilo health, configured workdir, and active session
- `/projects` — list configured workdir aliases from env
- `/project <name-or-path>` — set the active workdir for this chat/thread
- `/kilo <prompt>` — run a new Kilo prompt in the active workdir
- `/sessions` — list bot-known sessions from local state (captured from `kilo run --attach` output)
- `/session <id>` — show or resume a prior session by ID; listing remains local-state only
- `/cancel` — stop the active local task if one is running

**State model:**
- Key by Telegram `chatId` + `threadId` when present.
- Store: active workdir, last Kilo session ID, last command timestamp, and optional display label.
- Keep the state file small and human-readable.

**Routing rule:**
- DMs default to one active workdir per user.
- Group chats can be made thread-aware later; keep the state model ready for that now.
- Workspace aliases should come from env, for example `KILO_WORKSPACES_JSON`, so the bot does not need access to the Kilo service filesystem.

**Verification:**
1. Send `/start` to the bot in Telegram.
2. Send `/status` and confirm the service health is reported.
3. Send `/projects` and confirm the configured workspace list is returned.
4. Send `/kilo Write a hello world script in JavaScript` and verify a Kilo session is created.
5. Send `/session <id>` and confirm resume/status behavior works.

**Expected:** Telegram requests are routed to the correct workdir and Kilo session without touching Hermes.

---

## Phase 4: Package and deploy the Railway service

**Objective:** Turn the bot into a reproducible Railway service that survives redeploys and restarts.

**Files:**
- Modify: `kilo-telegram-railway/Dockerfile`
- Modify: `kilo-telegram-railway/entrypoint.sh`
- Modify: `kilo-telegram-railway/railway.toml`
- Modify: `kilo-telegram-railway/railway.json`

**Current Railway UI state:** A blank `kilo-telegram-bot` service already exists in the Kilo Code project with its own `/data` volume mounted. Phase 4 now only needs source/root configuration, env vars, and the first deploy.

**Deployment requirements:**
- Install and pin `@kilocode/cli` in the bot image.
- Start the bot with long polling; no public domain needed.
- Mount `/data` for routing/session state.
- Restart on failure.
- Validate required env vars on boot.
- Set the Railway service root/build context to `kilo-telegram-railway/` so it uses the bot Dockerfile, not the repo-root Kilo server Dockerfile.
- Run Railway deploy/link steps from a CLI context that is linked to the Kilo Code project/environment; do not rely on an inherited Railway context from another project.

**Environment variables:**

Required:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_ID`
- `KILO_SERVER_URL`
- `KILO_SERVER_USERNAME` (default `kilo`)
- `KILO_SERVER_PASSWORD`
- `KILO_DEFAULT_WORKDIR`
- `KILO_TELEGRAM_HOME` (default `/data`)

Optional:
- `KILO_DEFAULT_AGENT` — default agent for `kilo run`; omit the flag when unset
- `KILO_DEFAULT_MODEL`
- `KILO_WORKSPACES_JSON` — alias map for `/projects` and `/project`
- `TELEGRAM_FORCE_IPV4`
- `KILO_LOG_LEVEL`

**Verification:**
```bash
curl -u "kilo:$KILO_SERVER_PASSWORD" "$KILO_SERVER_URL/global/health"
```
Then confirm the Railway service logs show the bot started and Telegram polling is active.

---

## Phase 5: Wire up the shared config pipeline

**Objective:** Make sure the new bot service is managed by the same sync path as the rest of the Kilo/OpenCode services.

**Files:**
- Modify: `prism-playbook/operations/connections-hub/scripts/sync-railway.sh`
- Modify: `prism-playbook/operations/connections-hub/README.md` if needed
- Modify: any secret/env source used by the connections-hub pipeline

**Changes to make:**
- Add a `kilo-telegram-bot` service section to the Railway sync logic.
- Point that service at the `kilo-telegram-railway/` build root so Railway builds the bot image, not the server image.
- Provide the dedicated Telegram token for this bot.
- Reuse the Kilo server password from the existing Kilo service only if the new service truly needs it.
- Keep token names distinct from the Hermes Telegram gateway.
- Sync the workspace alias map from the same source of truth used for the Kilo/OpenCode workspace set.

**Verification:**
- Run the sync step in a dry-run or staging context first.
- Confirm the Railway service receives the expected env vars.
- Confirm there is no token collision with the Hermes bot.

---

## Risks and open questions

| Risk | Why it matters | Mitigation |
|---|---|---|
| Kilo CLI contract drifts by version | The bot depends on the documented CLI behavior | Pin the CLI version and smoke test `kilo run --attach` early |
| Remote session discovery is unavailable from a separate bot service | The bot cannot enumerate remote sessions from the Kilo server’s DB | Keep session listing bot-managed and local-state based |
| No shared filesystem between bot and Kilo services | The bot cannot discover the Kilo service’s workspace by local file inspection | Use `KILO_WORKSPACES_JSON` or another env-supplied alias map |
| Telegram token reuse | Reusing the Hermes token can break polling/webhook state | Use a dedicated BotFather token for this bot |
| Hardcoded workdir | Would make the bot brittle across multiple repos | Keep workdir configurable per chat/thread |

---

## Phase 0 — COMPLETED (2026-07-20)

**Objective was:** verify the exact Kilo CLI contract against the live server before writing any bot code.

**Status:** ✅ Complete. All spikes ran against `https://kilo-production-083f.up.railway.app` (server v7.4.3) using `@kilocode/cli@7.4.11`.

**What was verified:**

| Spike | Command | Result |
|---|---|---|
| Health | `GET /global/health` + Basic Auth | ✅ `200 {"healthy":true,"version":"7.4.3"}` |
| Attach run | `kilo run --attach $URL --dir /data/workspace/prism-platform --auto --format json "ping"` | ✅ Returned `PONG`; clean JSON event stream with `sessionID` |
| Continue | `kilo run --attach ... --continue --session <id>` | ✅ Resumed same session, returned `RESUMED` |
| Debug scrap | `kilo debug scrap` (+ `--attach`) | ❌ Local-DB only — cannot see remote projects |
| Session list | `kilo session list --format json` (+ `--attach`) | ❌ Local-DB only — cannot enumerate remote sessions |

**Conclusions that shaped later phases:**
- Execution path: `kilo run --attach $KILO_SERVER_URL --dir <remote-path> --auto --format json "<prompt>"`
- Resume path: capture `sessionID` from JSON events → `--continue --session <id>`
- `--dir` is a path **on the remote server** (e.g. `/data/workspace/prism-platform`)
- `debug scrap` / `session list` are **local-DB only** → bot must use `KILO_WORKSPACES_JSON` for project discovery and track session IDs in its own `/data` state store
- Auth via `KILO_SERVER_USERNAME` / `KILO_SERVER_PASSWORD` env vars (Basic Auth)
- Pin `@kilocode/cli@7.4.11` (server is 7.4.3 — compatible)

Full output saved to `PHASE0_SPIKE_RESULTS.md`.

---

## Definition of done

- [x] **Phase 0:** Kilo CLI contract verified against live server (health, attach run, continue, scrap/session-list limitations confirmed)
- [x] **Phase 1:** `kilo-telegram-railway/` scaffolded — Dockerfile, entrypoint, package.json, bot.js, kilo-runner.js, state-store.js, railway.toml, railway.json, README (syntax + require smoke test pass)
- [x] **Phase 2:** Kilo runner hardened — `Bearer` auth fix, `step_start` sessionID capture, child PID + `.cancel()` for `/cancel`, `RUN_TIMEOUT_MS` cap, `onText`/`onSession` streaming callbacks, state-store `activeTaskKey` + trim + `markSessionInactive`, bot `/kilo` streaming + `/cancel` wired. Redeployed to Railway (deploy `30ee12ff`, SUCCESS, polling active). Unit tests for runner + store pass.
- [x] `kilo-telegram-bot` is created as a separate Railway service using `kilo-telegram-railway/` as the build root
- [x] Telegram long-polling works without a public domain
- [x] `/start`, `/status`, `/projects`, `/project`, `/kilo`, `/sessions`, `/session`, and `/cancel` work
- [x] The bot can launch Kilo tasks through the supported CLI attach/run path
- [x] Active workdir and session mapping persist across restarts via the bot’s `/data` volume
- [x] The bot uses a dedicated Telegram token and does not collide with Hermes
- [ ] The Railway sync pipeline is updated to provision the new service consistently

---

## Phase execution order

**Recommended sequence: Phase 4 → Phase 2 → Phase 3 → Phase 5** (deploy-early, then harden).

| Order | Phase | Rationale |
|---|---|---|
| 1st | **Phase 4 — Deploy** | The Phase 1 scaffold is already runnable. Get it live on Railway with a real BotFather token + env vars first. This proves long-poll + `kilo run --attach` works from inside a Railway container (network egress, IPv4, pinned CLI), not just from the local spike box. |
| 2nd | **Phase 2 — Runner hardening** | Once live, fix real gaps found in actual use: streaming replies, `/cancel` task handles, error edge cases. Harden against observed behavior rather than guessing. |
| 3rd | **Phase 3 — Command surface** | Commands are already stubbed in Phase 1. Phase 3 is routing/polish once the runner is solid and the bot has been used for real. |
| 4th | **Phase 5 — Sync pipeline** | Last, because it only copies a proven-working service config into `connections-hub`. No point syncing a service not yet verified live. |

**Why not the original 2 → 3 → 4 → 5 order?** Deploying last leaves the biggest unknown (Railway-runtime CLI behavior) unverified while we polish commands blindly. Deploy-early turns Phase 2/3 into targeted fixes instead of speculation.

**Prerequisites for Phase 4:**
- A dedicated BotFather token (not the Hermes token)
- Allowed Telegram user ID(s)
- Kilo server URL + Basic Auth password (known: `kilo-production-083f.up.railway.app`)
- If the BotFather token has been exposed in chat/logs, regenerate it before broader rollout and update Railway with the replacement secret.
