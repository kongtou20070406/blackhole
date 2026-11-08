#!/usr/bin/env bash
# Claude Code SessionStart hook: records session -> profile -> host path.
# Runs inside the session container; must never block or fail the session.
set -uo pipefail

payload="${BLACKHOLE_HOOK_PAYLOAD:-}"
if [[ -z "$payload" ]]; then
    payload="$(cat)"
fi
[[ -n "$payload" ]] || exit 0

BLACKHOLE_HOOK_PAYLOAD="$payload" node - <<'NODE' >/dev/null 2>&1 || true
const fs = require("fs");
const payload = JSON.parse(process.env.BLACKHOLE_HOOK_PAYLOAD || "{}");
const sessionId = String(payload.session_id || "").replace(/[^A-Za-z0-9._-]/g, "_");
if (!sessionId) process.exit(0);

const dir = "/home/node/.claude/blackhole/sessions";
fs.mkdirSync(dir, { recursive: true });
const file = `${dir}/${sessionId}.json`;

let previous = {};
try {
    previous = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {}

const now = new Date().toISOString();
const event = payload.hook_event_name || "SessionStart";
const ended = event === "SessionEnd";
const record = {
    sessionId,
    profile: process.env.BLACKHOLE_PROFILE || previous.profile || "",
    path: process.env.BLACKHOLE_PROJECT_PATH || previous.path || "",
    cwd: payload.cwd || previous.cwd || "/workspace",
    transcript: payload.transcript_path || previous.transcript || "",
    startedAt: previous.startedAt || now,
    lastStartedAt: previous.lastStartedAt || now,
    lastActiveAt: now,
    hookEvent: event,
};
if (ended) {
    record.endedAt = now;
} else {
    record.lastStartedAt = now;
}

const tmp = `${file}.${process.pid}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n");
fs.renameSync(tmp, file);

// Also refresh the project entry so profile <-> path exists even for
// sessions started before hooks were installed.
if (record.path) {
    const crypto = require("crypto");
    const id = crypto.createHash("sha256").update(record.path).digest("hex").slice(0, 16);
    const projectDir = "/home/node/.claude/blackhole/projects";
    fs.mkdirSync(projectDir, { recursive: true });
    const projectFile = `${projectDir}/${id}.json`;
    let project = {};
    try {
        project = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    } catch {}
    fs.writeFileSync(projectFile, JSON.stringify({
        path: record.path,
        profile: record.profile || project.profile || "",
        lastUsed: now,
    }, null, 2) + "\n");
}
NODE

exit 0
