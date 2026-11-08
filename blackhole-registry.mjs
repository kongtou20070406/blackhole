#!/usr/bin/env node
// Reads the Blackhole registry stored inside a profile's config volume.
// Output is tab-separated so the host launcher can align it with `column`.
const fs = require("fs");
const path = require("path");

const base = "/home/node/.claude/blackhole";
const profileFallback = process.env.BLACKHOLE_PROFILE || "?";

function readDir(dir) {
    try {
        return fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
        return [];
    }
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(path.join(file), "utf8"));
    } catch {
        return null;
    }
}

function fmt(value) {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toISOString().slice(0, 16).replace("T", " ");
}

function lastActive(record) {
    let best = record.lastActiveAt || record.lastStartedAt || record.startedAt || "";
    if (record.transcript) {
        try {
            const mtime = fs.statSync(record.transcript).mtime.toISOString();
            if (mtime > best) best = mtime;
        } catch {}
    }
    return best;
}

function sessions() {
    const mapped = new Map();
    for (const file of readDir(path.join(base, "sessions"))) {
        const record = readJson(path.join(base, "sessions", file));
        if (record && record.sessionId) mapped.set(record.sessionId, record);
    }

    const rows = [];
    for (const record of mapped.values()) {
        rows.push([
            record.profile || profileFallback,
            record.sessionId,
            record.path || "(unmapped)",
            fmt(record.startedAt),
            fmt(lastActive(record)),
            record.endedAt
                ? "ended"
                : record.hookEvent === "SessionStart"
                    ? "active"
                    : "unknown",
        ]);
    }

    // Historical sessions created before hooks existed remain visible.
    const projectsRoot = "/home/node/.claude/projects";
    let projectDirs = [];
    try {
        projectDirs = fs.readdirSync(projectsRoot, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
    } catch {}
    for (const projectDir of projectDirs) {
        const full = path.join(projectsRoot, projectDir);
        let files = [];
        try {
            files = fs.readdirSync(full).filter((f) => f.endsWith(".jsonl"));
        } catch {}
        for (const file of files) {
            const id = file.replace(/\.jsonl$/, "");
            if (mapped.has(id)) continue;
            let mtime = "";
            try {
                mtime = fs.statSync(path.join(full, file)).mtime.toISOString();
            } catch {}
            rows.push([profileFallback, id, "(unmapped)", "-", fmt(mtime), "unknown"]);
        }
    }

    rows.sort((a, b) => String(b[4]).localeCompare(String(a[4])));
    for (const row of rows) console.log(row.join("\t"));
}

function projects() {
    const counts = new Map();
    for (const file of readDir(path.join(base, "sessions"))) {
        const record = readJson(path.join(base, "sessions", file));
        if (record && record.path) {
            counts.set(record.path, (counts.get(record.path) || 0) + 1);
        }
    }

    const rows = [];
    for (const file of readDir(path.join(base, "projects"))) {
        const record = readJson(path.join(base, "projects", file));
        if (!record || !record.path) continue;
        rows.push([
            record.profile || profileFallback,
            record.path,
            fmt(record.lastUsed),
            String(counts.get(record.path) || 0),
        ]);
    }
    rows.sort((a, b) => String(b[2]).localeCompare(String(a[2])));
    for (const row of rows) console.log(row.join("\t"));
}

function lookup(prefix) {
    if (!prefix) return;
    for (const file of readDir(path.join(base, "sessions"))) {
        const record = readJson(path.join(base, "sessions", file));
        if (!record || !record.sessionId) continue;
        if (!record.sessionId.startsWith(prefix)) continue;
        console.log([
            record.sessionId,
            record.profile || profileFallback,
            record.path || "",
            fmt(record.startedAt),
            record.transcript || "",
        ].join("\t"));
    }
}

const command = process.argv[2];
if (command === "sessions") sessions();
else if (command === "projects") projects();
else if (command === "lookup") lookup(process.argv[3] || "");
else {
    console.error("usage: blackhole-registry sessions|projects|lookup <prefix>");
    process.exit(2);
}
