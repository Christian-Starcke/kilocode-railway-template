#!/bin/sh
set -e

export HOME="${HOME:-/data}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-/data/workspace}"

mkdir -p /data/logs "${WORKSPACE_ROOT}"

echo "[workspace-bootstrap] start $(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [ -x "${SCRIPT_DIR}/kilo-volume-maintain.sh" ]; then
  "${SCRIPT_DIR}/kilo-volume-maintain.sh" >> /data/logs/volume-maintain.log 2>&1 || true
fi

if [ -x "${SCRIPT_DIR}/kilo-mcp-bootstrap.sh" ]; then
  "${SCRIPT_DIR}/kilo-mcp-bootstrap.sh" >> /data/logs/mcp-bootstrap.log 2>&1 || true
elif [ -n "${KILO_SCRIPT_RAW_BASE:-}" ] && command -v curl >/dev/null 2>&1; then
  curl -fsSL "${KILO_SCRIPT_RAW_BASE}/kilo-mcp-bootstrap.sh" | bash >> /data/logs/mcp-bootstrap.log 2>&1 || true
fi

configure_git_auth() {
  if [ -n "${GITHUB_TOKEN:-}" ] && command -v git >/dev/null 2>&1; then
    git config --global url."https://x-access-token:${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/" || true
    echo "[workspace-bootstrap] configured git auth for github.com"
  else
    echo "[workspace-bootstrap] GITHUB_TOKEN missing; private repo clones may fail"
  fi
}

clone_or_pull_repo() {
  repo_url="$1"
  repo_dir="$2"

  if [ -z "${repo_url}" ]; then
    echo "[workspace-bootstrap] ${repo_dir}: no repo URL configured; skipping"
    return 0
  fi

  if [ -d "${repo_dir}/.git" ]; then
    echo "[workspace-bootstrap] pulling ${repo_dir}"
    git -C "${repo_dir}" pull --ff-only --prune || {
      echo "[workspace-bootstrap] WARNING: failed to pull ${repo_dir}" >&2
      return 0
    }
  elif [ -e "${repo_dir}" ]; then
    echo "[workspace-bootstrap] ${repo_dir} exists but is not a git repo; skipping clone"
  else
    echo "[workspace-bootstrap] cloning ${repo_dir} from ${repo_url}"
    git clone "${repo_url}" "${repo_dir}" || {
      echo "[workspace-bootstrap] WARNING: failed to clone ${repo_dir}" >&2
      return 0
    }
  fi
}

if [ "${WORKSPACE_BOOTSTRAP:-false}" = "true" ]; then
  configure_git_auth
  clone_or_pull_repo "${GIT_REPO_N8N:-}" "${WORKSPACE_ROOT}/n8n-as-code"
  clone_or_pull_repo "${GIT_REPO_PLAYBOOK:-}" "${WORKSPACE_ROOT}/prism-playbook"
  clone_or_pull_repo "${GIT_REPO_PLATFORM:-}" "${WORKSPACE_ROOT}/prism-platform"
  clone_or_pull_repo "${GIT_REPO_KNOWLEDGE:-}" "${WORKSPACE_ROOT}/prism-knowledge"
else
  echo "[workspace-bootstrap] WORKSPACE_BOOTSTRAP=false; skipping repo clone/pull"
fi

echo "[workspace-bootstrap] done"
