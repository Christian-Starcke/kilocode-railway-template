# Phase 0 Spike Results — Kilo Telegram Bot

**Date:** 2026-07-20
**Local CLI tested:** `@kilocode/cli@7.4.11`
**Remote Kilo server:** `https://kilo-production-083f.up.railway.app` (server version `7.4.3`)
**Auth:** `KILO_SERVER_USERNAME=kilo`, `KILO_SERVER_PASSWORD=***` (Basic Auth)

---

## Verified commands (all PASS)

### 1. Health check
```bash
curl -s -u "$KILO_SERVER_USERNAME:$KILO_SERVER_PASSWORD" "$KILO_SERVER_URL/global/health"
# → HTTP 200, body: {"healthy":true,"version":"7.4.3"}
```
**Use:** `/status` bot command. Reliable liveness probe.

### 2. Run a prompt on the remote server
```bash
kilo run --attach "$KILO_SERVER_URL" \
  --dir "/data/workspace/prism-platform" \
  --auto \
  --format json \
  "Reply with the single word PONG and nothing else."
```
**Result:** `EXIT 0`. Emitted JSON event stream:
```json
{"type":"step_start","sessionID":"ses_080032c08ffe06YWTtAUVhDInC",...}
{"type":"text","text":"PONG",...}
{"type":"step_finish","tokens":{...},"cost":0.12558039208}
```
**Key facts:**
- `--dir` is interpreted as a **path on the remote server** (e.g. `/data/workspace/prism-platform`).
- `--format json` produces clean, line-delimited JSON events — trivially parseable.
- The `sessionID` is present in EVERY event. Capture it from the first `step_start` event.
- `--auto` auto-approves all permissions (required for unattended bot use).
- `--username` / `--password` default to `KILO_SERVER_USERNAME` / `KILO_SERVER_PASSWORD` env vars.

### 3. Resume a session
```bash
kilo run --attach "$KILO_SERVER_URL" \
  --dir "/data/workspace/prism-platform" \
  --continue \
  --session "ses_080032c08ffe06YWTtAUVhDInC" \
  --auto --format json \
  "Reply with the single word RESUMED and nothing else."
```
**Result:** `EXIT 0`. Returned `RESUMED` in the same session `ses_080032c08ffe06YWTtAUVhDInC`.
**Key facts:**
- Resume works exactly as documented.
- The bot must store the `sessionID` it gets from a `kilo run --attach` call, then pass it back with `--continue --session` for follow-ups.

---

## Commands that DO NOT work for remote discovery (FAIL as bot discovery tools)

### 4. `kilo debug scrap` — local only
```bash
kilo debug scrap                 # → []  (empty, local DB only)
kilo debug scrap --attach "$URL" # → ignored --attach, ran locally, printed help/empty
```
**Conclusion:** `debug scrap` reads the **local** Kilo DB. A separate bot service has its own empty local DB, so it CANNOT discover the remote server's projects this way. **Do not use for `/projects`.**

### 5. `kilo session list` — local only, but supports JSON
```bash
kilo session list --format json -n 5          # → empty (local DB has no sessions)
kilo session list --format json --attach "$URL" # → --attach ignored, shows help
kilo export "ses_..."                           # → "Session not found" (local DB)
```
**Conclusion:**
- Sessions created via `--attach` live on the **remote server's DB**, not the local CLI's DB.
- `session list --format json` is valid syntax, but it only lists the *local* CLI's sessions.
- Therefore the bot CANNOT enumerate or export remote sessions through the CLI.
- **Implication:** the bot MUST track `sessionID`s itself (captured from `kilo run --attach` JSON output) and persist them in its own `/data` state store. `/sessions` and `/session <id>` are served from bot-local state, not from a CLI query.

---

## Decided approach (validates the audited plan)

| Concern | Decision |
|---|---|
| Task execution | `kilo run --attach "$KILO_SERVER_URL" --dir <remote-path> --auto --format json "<prompt>"` |
| Session resume | Capture `sessionID` from JSON events; resume with `--continue --session <id>` |
| Project/workdir discovery | **Env-driven alias map** (`KILO_WORKSPACES_JSON`), NOT `debug scrap` |
| Session listing in bot | Bot-local state store on `/data`, NOT `kilo session list` |
| Health check | `GET /global/health` with Basic Auth |
| Auth | Basic Auth via `KILO_SERVER_USERNAME` / `KILO_SERVER_PASSWORD` env vars |
| CLI version | Pin `@kilocode/cli@7.4.11` in the bot image; server is `7.4.3` — compatible for these commands |

---

## Open items for Phase 1+
- Confirm exact JSON event shape for multi-turn / tool-use steps (for streaming bot replies). The `text` event is enough for MVP.
- Decide streaming vs. wait-for-`step_finish`. MVP: collect `text` events, reply when `step_finish` with `reason:"stop"` arrives.
- `KILO_WORKSPACES_JSON` schema: `{"prism":"\/data\/workspace\/prism-platform","playbook":"\/data\/workspace\/prism-playbook","n8n":"\/data\/workspace\/n8n-as-code"}`
