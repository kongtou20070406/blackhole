#!/usr/bin/env node
// File-based signals for sessions. Runs inside the Blackhole container.
const fs = require("fs");
const crypto = require("crypto");

const MAX_BYTES = 1024 * 1024;

function fail(message, code = 1) {
    console.error(`blackhole-signal: ${message}`);
    process.exit(code);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function signature(file) {
    try {
        const stat = fs.statSync(file);
        return { mtimeMs: stat.mtimeMs, size: stat.size };
    } catch {
        return null;
    }
}

function readSignal(file) {
    let stat;
    try {
        stat = fs.statSync(file);
    } catch {
        fail(`signal file not found: ${file}`);
    }
    if (stat.size > MAX_BYTES) {
        fail(`signal file is too large (${stat.size} bytes; limit ${MAX_BYTES})`);
    }
    return fs.readFileSync(file);
}

function digest(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

function parseSince(value) {
    if (/^\d+(\.\d+)?$/.test(value)) {
        const number = Number(value);
        return number > 1e12 ? number : number * 1000;
    }
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) fail(`invalid --since value: ${value}`);
    return parsed;
}

function parseArgs(argv) {
    const options = {
        file: "",
        timeout: 1800,
        interval: 500,
        since: null,
    };
    while (argv.length > 0) {
        const arg = argv.shift();
        switch (arg) {
            case "--file":
            case "-f":
                options.file = argv.shift() || "";
                break;
            case "--timeout":
            case "-t":
                options.timeout = Number(argv.shift());
                break;
            case "--interval":
                options.interval = Number(argv.shift());
                break;
            case "--since":
                options.since = argv.shift();
                break;
            case "--help":
            case "-h":
                usage(0);
                break;
            default:
                fail(`unknown option: ${arg}`);
        }
    }
    if (!options.file) fail("--file is required");
    if (!Number.isFinite(options.timeout) || options.timeout <= 0) {
        fail("--timeout must be a positive number of seconds");
    }
    if (!Number.isFinite(options.interval) || options.interval < 50) {
        fail("--interval must be at least 50 milliseconds");
    }
    return options;
}

function usage(code) {
    console.log(`Usage:
  blackhole-signal read --file PATH
  blackhole-signal wait --file PATH [--timeout SECONDS] [--interval MS] [--since EPOCH|ISO]

wait prints the signal content after the file appears or changes. By default it
waits for a change relative to the file state at startup; --since returns
immediately when the file is newer than the given time.
Exit codes: 0 signal, 1 error, 124 timeout.`);
    process.exit(code);
}

async function waitForSignal(options) {
    const sinceMs = options.since === null ? null : parseSince(options.since);
    const initial = signature(options.file);
    const baseline = initial ? digest(readSignal(options.file)) : null;
    const startedAt = Date.now();

    for (;;) {
        const current = signature(options.file);
        if (current) {
            const content = readSignal(options.file);
            const changed = sinceMs !== null
                ? current.mtimeMs > sinceMs
                : baseline === null || digest(content) !== baseline;

            if (changed) {
                // Return only once the content is stable, so a non-atomic writer
                // cannot hand us a partial result.
                await sleep(options.interval);
                const again = signature(options.file);
                if (again) {
                    const stable = readSignal(options.file);
                    if (digest(stable) === digest(content)) {
                        process.stdout.write(stable);
                        if (!stable.toString("utf8").endsWith("\n")) {
                            process.stdout.write("\n");
                        }
                        return;
                    }
                }
            }
        }

        if (Date.now() - startedAt >= options.timeout * 1000) {
            fail(`timed out after ${options.timeout}s waiting for ${options.file}`, 124);
        }
        await sleep(options.interval);
    }
}

const command = process.argv[2];
const argv = process.argv.slice(3);

if (command === "read") {
    const file = (() => {
        let value = "";
        while (argv.length > 0) {
            const arg = argv.shift();
            if (arg === "--file" || arg === "-f") value = argv.shift() || "";
            else if (arg === "--help" || arg === "-h") usage(0);
            else fail(`unknown option: ${arg}`);
        }
        return value;
    })();
    if (!file) fail("--file is required");
    const content = readSignal(file);
    process.stdout.write(content);
    if (!content.toString("utf8").endsWith("\n")) process.stdout.write("\n");
} else if (command === "wait") {
    waitForSignal(parseArgs(argv)).catch((error) => {
        fail(error && error.message ? error.message : String(error));
    });
} else {
    usage(2);
}
