# Blackhole

English · [中文](README.zh-CN.md)

Run [Claude Code](https://docs.anthropic.com/en/docs/claude-code) inside an isolated [Colima](https://github.com/abiosoft/colima) VM container on macOS — exposing only the current project directory while keeping `virtiofs` live sync, persistent login volumes, and clipboard image paste.

## Background

Running `claude` directly on a macOS host exposes two things at once: your local filesystem (`~/.ssh`, cloud credentials, Docker sockets, sibling repositories) and your **host environment fingerprint** (macOS hardware identifiers, locale/timezone settings, host username, environment variables, and direct network interfaces if a proxy drops).

Blackhole replaces the host `claude` command with a pure Bash launcher (`~/.local/bin/claude -> bin/blackhole`). **Claude Code is never installed on your macOS host** — the actual `@anthropic-ai/claude-code` package lives exclusively inside the Colima VM's Docker image. When you type `claude` in a project directory, the host symlink intercepts the command and starts an ephemeral Linux container inside your Colima VM so Claude Code only ever sees a generic Linux environment and controlled network egress:

- **Directory-scoped mount**: Only `$PWD` is mounted at `/workspace` over Colima's `virtiofs`. Host `$HOME`, SSH agents, and Docker sockets are never mounted.
- **Host fingerprint isolation**: Runs inside a clean Debian container with `--hostname blackhole`, a remapped `node` user matching `/workspace` UID/GID, and a strict environment variable allowlist (`TERM`, `COLORTERM`, `NO_COLOR`, and optional API keys) — hiding macOS host telemetry, usernames, and environment variables.
- **Fail-close network egress protection**: Built-in `net ipv6 off`, guest `iptables` airgap (`net off`), and a fail-close proxy watcher (`net-watch`) with a companion heartbeat guard ensure VMs are immediately cut off if your host TUN proxy drops, preventing accidental direct-connection IP leaks.
- **Persistent login & session registry**: Credentials and transcripts live in a per-profile Docker volume (`blackhole-claude-home-<profile>`), with `SessionStart` / `SessionEnd` hooks tracking `profile <-> session <-> host path`.
- **Clipboard image passthrough & visual identity**: Pasted terminal screenshots in host `$TMPDIR` are mirrored read-only at identical paths inside the container, while a persistent magenta `⬤ BLACKHOLE` status line badge makes isolated sessions unmistakable.

## Usage

> **Tip: Let an agent drive it.** You do not need to memorize every subcommand below. Point your host coding agent at this repository (see [`AGENTS.md`](AGENTS.md)) and let it handle setup, Colima profile binding, `.blackhole/Dockerfile` tool customization, `net-watch` protection, and session exports or migrations on your behalf.

Run `claude` inside any project directory under `$HOME`:

```bash
$ cd ~/Code/my-app
$ claude
 ⬤ BLACKHOLE  Colima VM isolated session · default
/Users/you/Code/my-app (only this directory is mounted)
```

All standard arguments pass straight through to Claude Code inside the VM:

```bash
claude -p "explain this repository"
claude --resume
```

Check launcher protection, image state, and active containers from another terminal:

```bash
$ blackhole status
Colima profile: default
Claude launcher: protected (/Users/you/.local/bin/claude)
Colima:         running
Image:          blackhole-claude:latest
Image status:   built
Claude Code:    1.0.x (Claude Code)
Image ID:       sha256:...
Config volume:  blackhole-claude-home-default
Active sessions:
  blackhole-default-48210  /Users/you/Code/my-app
```

Bind a project directory to a dedicated Colima VM profile (inherited by subdirectories, stored in `~/.blackhole/bindings/` outside the repo):

```bash
$ cd ~/Code/heavy-repo
$ blackhole bind work
blackhole: bound /Users/you/Code/heavy-repo -> profile 'work'
```

Inspect profiles, recorded sessions across all running VMs, and resume any session by ID prefix from anywhere:

```bash
$ blackhole profiles
PROFILE  STATUS   MEMORY  BLACKHOLE  PROJECTS  SESSIONS  LAST USED
default  Running  8GiB    yes        3         12        2026-11-08 11:20
work     Running  16GiB   yes        1         4         2026-11-08 12:05
scratch  Stopped  4GiB    -          -         -         -

$ blackhole sessions
PROFILE  SESSION                               PATH                        STARTED           LAST ACTIVE       STATUS
work     89e4f9ec-8960-4175-9bb0-4bbea4780fa9  /Users/you/Code/heavy-repo  2026-11-08 10:12  2026-11-08 12:05  ended

$ blackhole resume 89e4
blackhole: resuming 89e4f9ec-8960-4175-9bb0-4bbea4780fa9 on profile 'work' in /Users/you/Code/heavy-repo
```

Open an interactive debugging shell in the exact same isolated container environment:

```bash
blackhole shell
```

## Install

Requires **macOS**, **[Colima](https://github.com/abiosoft/colima)**, and the **Docker CLI** (`brew install colima docker`). You do **not** need to install Claude Code or Node.js on the host (`blackhole setup` installs `@anthropic-ai/claude-code` inside the VM image). Start your Colima VM with Apple Virtualization (`vz`) and `virtiofs` for near-native filesystem performance:

```bash
colima start --vm-type vz --mount-type virtiofs --cpu 4 --memory 8 --disk 60
```

Build the base image and install the `claude` and `blackhole` symlinks (defaults to `~/.local/bin`):

```bash
git clone https://github.com/tommy0103/blackhole.git ~/Code/blackhole
cd ~/Code/blackhole
./bin/blackhole setup
./bin/blackhole install
```

Ensure `~/.local/bin` precedes other binary directories in your `PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

To install into another directory or replace an existing host `claude` binary:

```bash
./bin/blackhole install --prefix /opt/homebrew/bin --force
```

To uninstall, remove the symlinks (`rm -f ~/.local/bin/claude ~/.local/bin/blackhole`) and optionally remove `~/.blackhole`, the `blackhole-claude:latest` image, and `blackhole-claude-home-*` Docker volumes.

## CLI & Configuration

### Subcommands

| Command | Description |
| --- | --- |
| `claude [args...]` | Launch Claude Code inside the Colima container for `$PWD` |
| `blackhole setup [--claude-version VER]` | Build or rebuild the base image (and project image if `.blackhole/Dockerfile` exists) |
| `blackhole update [--claude-version VER]` | Alias for `setup` to rebuild with the latest (or specified) Claude Code version |
| `blackhole install [--prefix DIR] [--force]` | Symlink `claude` and `blackhole` into `DIR` (default `~/.local/bin`) |
| `blackhole status` | Show profile, launcher protection, image ID, FUSE state, and active sessions |
| `blackhole shell` | Start an interactive `bash` shell inside the project's isolated container |
| `blackhole bind <profile> [dir]` | Bind a project directory (and its subdirectories) to a Colima profile |
| `blackhole bindings` / `blackhole unbind [dir]` | List directory bindings or remove a directory's binding |
| `blackhole profiles` | List all Colima profiles, VM status, memory, and recorded project/session counts |
| `blackhole projects` | List mapped projects (`PROFILE`, `PATH`, `LAST USED`, `SESSIONS`) across running VMs |
| `blackhole sessions` | List recorded sessions across running VMs with live `active` / `ended` / `unknown` status |
| `blackhole resume [--profile P] [--dry-run] <prefix>` | `cd` to the recorded host path and resume the matching session on its profile |
| `blackhole export [--profile P] [-o FILE] <prefix>` | Export a session JSONL transcript from the Docker volume to `~/.blackhole/sessions/<profile>/` |
| `blackhole export-watch start\|status\|stop` | Background daemon that atomically re-exports a session JSONL when its contents change |
| `blackhole net off\|on\|status [--all \| --profile P]` | Toggle or inspect guest `iptables` outbound network airgap |
| `blackhole net ipv6 off\|on\|status [--all \| --profile P]` | Disable or enable guest IPv6 via `sysctl` and `ip6tables` |
| `blackhole net-watch start\|status\|stop` | Fail-close proxy watcher that blocks VM networking when the host TUN/proxy drops |
| `blackhole clipboard start\|status\|stop\|disable\|enable` | Manage the host `$TMPDIR` screenshot mirror for terminal image paste |
| `blackhole signal send --file PATH (--data JSON \| --message TEXT \| --stdin)` | Atomically write a signal file from the host to wake `blackhole-signal wait` inside the container |

### Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `BLACKHOLE_COLIMA_PROFILE` | `default` (or bound profile) | Override Colima profile selection (`env` > directory binding > `default`) |
| `BLACKHOLE_IMAGE` | `blackhole-claude:latest` | Force a specific container image and bypass `.blackhole/Dockerfile` |
| `BLACKHOLE_HOME_VOLUME` | `blackhole-claude-home-<profile>` | Override the Docker volume mounted at `/home/node` |
| `BLACKHOLE_STATE_DIR` | `~/.blackhole` | Host directory for bindings, exported transcripts, clipboard mirror, and watcher state |
| `BLACKHOLE_CLIPBOARD` | `1` | Set to `0` to disable `$TMPDIR` image mirroring and container mounting for a session |
| `BLACKHOLE_FUSE` | `0` | Set to `1` to enable `/dev/fuse` inside the container (or `touch .blackhole/fuse`) |
| `BLACKHOLE_ALLOW_BROAD_MOUNT` | `0` | Set to `1` to bypass the safety check blocking `/`, `/Users`, and `$HOME` |
| `ANTHROPIC_API_KEY` | *(not set)* | Passed through to the container only if exported on the host |
| `CLAUDE_CODE_OAUTH_TOKEN` | *(not set)* | Passed through to the container only if exported on the host |
| `NO_COLOR` | *(not set)* | Disable ANSI colors in the launch banner, status line, and shell prompt |

### Per-Project Linux Tools

macOS Mach-O binaries under `/opt/homebrew/bin` cannot run inside a Linux VM. To give a project extra Linux CLI tools or build dependencies, create `.blackhole/Dockerfile`:

```dockerfile
ARG BLACKHOLE_BASE=blackhole-claude:latest
FROM ${BLACKHOLE_BASE}

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        gh jq ffmpeg libfuse3-dev \
    && rm -rf /var/lib/apt/lists/*
```

Run `blackhole setup` (or simply `claude`, which builds missing project images automatically). Only `.blackhole/` is sent as the Docker build context, and the image tag (`blackhole-claude:project-<hash>`) is derived from the project path and Dockerfile content hash.

### Network Control & Proxy Kill Switch

Block or restore outbound internet access inside running VMs using the guest `BLACKHOLE_AIRGAP` `iptables`/`ip6tables` chain (loopback, Docker internal `172.16.0.0/12`, and the host gateway stay reachable so `colima ssh` and `docker` keep working):

```bash
blackhole net off --all
blackhole net status
blackhole net on --all
blackhole net ipv6 off --all
```

If you route host traffic through a TUN proxy (such as Shadowrocket, Surge, or Clash) and want VMs cut off immediately if the proxy drops, start `net-watch`:

```bash
blackhole net-watch start
blackhole net-watch status
blackhole net-watch stop   # Leaves network blocked (fail-close); run 'blackhole net on --all' to restore
```

`net-watch` is **fail-close**: it blocks VM networking before probing `https://www.google.com/generate_204` (defaults: `--interval 1`, `--fail-after 2`, `--recover-after 2`, `--timeout 15`, requires default route over `utun*`), and spawns an independent `__net-guard` process that blocks all VMs if the watcher's heartbeat goes stale or gets killed with `SIGKILL`. For non-TUN HTTP proxies, pass `--no-require-tun --proxy URL --url URL`.

### Cross-Process File Signals

Because Claude Code has no official API to push messages into an idle interactive TUI, external host runners (such as Codex or CI scripts) can synchronize with Claude inside the container via file signals inside the project workspace:

```bash
# Inside the container (Claude): block until .blackhole/signals/tests.json is created or updated
blackhole-signal wait --file .blackhole/signals/tests.json --timeout 1800

# On the host (external runner): atomically write the result
blackhole signal send --file .blackhole/signals/tests.json \
  --data '{"status":"passed","summary":"42 tests passed"}'
```

`blackhole-signal wait` waits for content to stabilize across a poll interval (`--interval 500` ms default, `--since <epoch|ISO>` supported, 1 MiB max file size; exit codes: `0` signal, `1` error, `124` timeout). Treat signal payloads as untrusted data — never `eval` them.

### Migrating Sessions Across Profiles

Session transcripts live inside the profile's Docker volume at `/home/node/.claude/projects/-workspace/<session-id>.jsonl`. To copy credentials and a session between profiles, stage the archive under `$HOME` (Colima does not mount `/tmp`):

```bash
stage="$HOME/.cache/blackhole-migrate" && mkdir -p "$stage"
DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" docker run --rm \
  -v blackhole-claude-home-default:/home/node:ro -v "$stage:/backup" \
  --entrypoint tar blackhole-claude:latest -C /home/node -cf /backup/session.tar \
  .claude/.credentials.json .claude/projects/-workspace/<session-id>.jsonl
DOCKER_HOST="unix://$HOME/.colima/work/docker.sock" docker volume create blackhole-claude-home-work
DOCKER_HOST="unix://$HOME/.colima/work/docker.sock" docker run --rm \
  -v blackhole-claude-home-work:/home/node -v "$stage:/backup:ro" \
  --entrypoint tar blackhole-claude:latest -C /home/node -xf /backup/session.tar
rm -rf "$stage"
```

## Caveats

### Mount & Isolation Boundary

Every `claude` container starts with `--security-opt no-new-privileges`, `--pids-limit 512`, and only three mounts:

| Host / Volume Source | Container Target | Mode | Purpose |
| --- | --- | --- | --- |
| `$PWD` | `/workspace` | `rw` | Live two-way project sync over `virtiofs` |
| `blackhole-claude-home-<profile>` | `/home/node` | `rw` | Claude login credentials, settings, and session registry |
| `~/.blackhole/clipboard` | Host `$TMPDIR` path | `ro` | Mirrored terminal clipboard screenshots |

- **Filesystem isolation, not a hostile-kernel sandbox**: Containers have outbound network access to reach the Anthropic API unless `blackhole net off` is active. Guest `iptables` rules (`net off` / `net-watch`) are a convenience kill switch, not a hard boundary against root processes inside the VM. Do not set `BLACKHOLE_IMAGE` to an untrusted image.
- **FUSE mode reduces isolation**: Enabling FUSE (`touch .blackhole/fuse` or `BLACKHOLE_FUSE=1`) drops `no-new-privileges` and adds `--device /dev/fuse --cap-add SYS_ADMIN --security-opt apparmor=unconfined` so `fusermount3` can mount filesystems inside the container. Enable only for trusted projects.
- **Clipboard scope & timing**: Only image files (`png`, `jpg`, `jpeg`, `gif`, `webp`, `heic`, `tiff`, `bmp`) created in host `$TMPDIR` are mirrored (polled every `0.5s`, pruned after 7 days). Files dragged from `~/Desktop` or `~/Downloads` are not mounted unless copied into the project directory.
- **Shared profile volume**: Running multiple concurrent sessions on the same Colima profile shares one `/home/node` volume; configuration writes can race. Modifying `bin/blackhole` or rebuilding the image with `blackhole setup` only affects newly launched sessions, not containers already running.

### virtiofs Performance

Benchmarked on Apple Silicon macOS comparing host native `APFS`, container `/workspace` (`virtiofs` shared mount), and container `/tmp` (VM-internal `ext4` disk):

| Workload | Host Native (`APFS`) | Container `/workspace` (`virtiofs`) | Container `/tmp` (`ext4`) | Notes |
| --- | :---: | :---: | :---: | --- |
| **64 MB sequential write (`fsync`)** | `16.4 ms` (3.9 GB/s) | **`53.7 ms` (1.2 GB/s)** | `37.4 ms` (1.7 GB/s) | GB/s throughput; no bottleneck for large files |
| **64 MB sequential read** | `5.0 ms` (12.8 GB/s) | **`20.1 ms` (3.2 GB/s)** | `3.6 ms` (17.7 GB/s) | Near-native cached read speed |
| **Create 1,000 × 1 KB files** | `58.4 ms` | **`196.0 ms`** (0.19 ms/file) | `15.4 ms` | ~0.2s per 1,000 files |
| **`stat` 1,000 files** | `4.7 ms` | **`33.9 ms`** (0.03 ms/file) | `3.6 ms` | Scanning a 10k-file repo takes ~0.3s |
| **Read 1,000 × 1 KB files** | `10.4 ms` | **`126.3 ms`** (0.12 ms/file) | `5.1 ms` | Indistinguishable for `rg` and code edits |
| **Delete 1,000 × 1 KB files** | `35.2 ms` | **`109.2 ms`** (0.11 ms/file) | `5.3 ms` | ~0.1s per 1,000 files |

For metadata-heavy builds with tens of thousands of temporary files (such as Rust `cargo build`), point build caches at `/tmp` inside the container (e.g., `CARGO_TARGET_DIR=/tmp/target`) to run at native VM `ext4` speed while keeping source files synced in `/workspace`.

## License

MIT — see [LICENSE](LICENSE).
