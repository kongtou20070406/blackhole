# Blackhole

[English](README.md) · 中文

在 macOS 的 [Colima](https://github.com/abiosoft/colima) 虚拟机容器中隔离运行 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) —— 只向容器暴露当前项目目录，同时保留 `virtiofs` 实时双向同步、持久化登录卷与终端剪贴板贴图支持。

## 背景

直接在 macOS 宿主机上运行 `claude` 会同时暴露两件事：一是宿主机文件系统（`~/.ssh`、云厂商凭据、Docker socket 及其他代码仓库），二是**宿主机环境指纹**（macOS 硬件标识、系统地区与语言设置、宿主机用户名、环境变量，以及代理闪退时的真实网络出口）。

Blackhole 用一个纯 Bash 启动器脚本（`~/.local/bin/claude -> bin/blackhole`）接管宿主机上的 `claude` 命令。**宿主机本机根本不需要安装 Claude Code** —— 真正的 `@anthropic-ai/claude-code` 只安装在 Colima 虚拟机的 Docker 镜像内部。当你在项目目录下敲 `claude` 时，宿主机软链接会拦截命令并在 Colima 虚拟机内拉起一个一次性 Linux 容器，让 Claude Code 只能看到标准化的 Linux 容器环境与受控的网络出口：

- **仅挂载当前目录**：通过 Colima 的 `virtiofs` 只把 `$PWD` 挂载到容器内 `/workspace`，绝不挂载宿主机 `$HOME`、SSH Agent 或 Docker socket。
- **宿主机指纹隔离**：运行在干净的 Debian 容器内，固定 `--hostname blackhole`，自动将 `node` 用户 UID/GID 对齐到 `/workspace` 属主，并严格限制透传的环境变量白名单（仅 `TERM`、`COLORTERM`、`NO_COLOR` 及可选 API Key），屏蔽宿主机系统特征、用户名与环境变量。
- **防泄漏网络出口保护（Fail-Close）**：内置 IPv6 彻底禁用（`net ipv6 off`）、VM 一键断网（`net off`）以及带独立心跳守护进程的代理监控（`net-watch`）；一旦宿主机 TUN 代理掉线立即掐断所有 VM 网络，防止流量回退直连暴露真实 IP。
- **登录态与 Session 自动归档**：登录凭据和对话记录保存在各 profile 独立的 Docker volume（`blackhole-claude-home-<profile>`）中，并通过 `SessionStart` / `SessionEnd` hook 自动记录 `profile <-> session <-> 宿主机路径` 映射。
- **剪贴板贴图直通与沙盒标识**：终端粘贴截图时写入宿主机 `$TMPDIR` 的临时图片会以相同绝对路径只读镜像进容器；同时通过启动横幅与 Claude 底部常驻的紫底 `⬤ BLACKHOLE` 徽标，一眼区分隔离容器与宿主机终端。

## 使用

> **推荐用法：交给 Agent 驾驭。** 你不需要死记硬背下面的所有子命令。直接让宿主机上的 Coding Agent 读取本仓库（内置了 [`AGENTS.md`](AGENTS.md) 操作手册），由它代你完成环境初始化、Colima profile 目录绑定、编写项目的 `.blackhole/Dockerfile`、开启 `net-watch` 断网保护以及导出或迁移历史会话。

在 `$HOME` 下的任意项目目录中直接运行 `claude`：

```bash
$ cd ~/Code/my-app
$ claude
 ⬤ BLACKHOLE  Colima VM isolated session · default
/Users/you/Code/my-app (only this directory is mounted)
```

所有原生参数都会直接透传给虚拟机内的 Claude Code：

```bash
claude -p "explain this repository"
claude --resume
```

在另一个终端随时检查启动器接管状态、镜像版本和活跃容器：

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

把项目目录绑定到指定的 Colima VM profile（子目录自动继承，绑定信息保存在仓库外的 `~/.blackhole/bindings/`）：

```bash
$ cd ~/Code/heavy-repo
$ blackhole bind work
blackhole: bound /Users/you/Code/heavy-repo -> profile 'work'
```

查看全部 VM profile、跨 VM 检索历史 session，并在任意目录下按 ID 前缀直接恢复会话：

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

如果需要进入完全相同的隔离容器环境手动排查或调试：

```bash
blackhole shell
```

## 安装

依赖 **macOS**、**[Colima](https://github.com/abiosoft/colima)** 和 **Docker CLI**（`brew install colima docker`）。**宿主机无需安装 Claude Code 或 Node.js**（`blackhole setup` 会直接在虚拟机镜像内安装 `@anthropic-ai/claude-code`）。启动 Colima 时建议开启 Apple Virtualization（`vz`）和 `virtiofs` 以获得接近原生的文件读写性能：

```bash
colima start --vm-type vz --mount-type virtiofs --cpu 4 --memory 8 --disk 60
```

构建基础镜像并安装 `claude` 与 `blackhole` 软链接（默认安装到 `~/.local/bin`）：

```bash
git clone https://github.com/tommy0103/blackhole.git ~/Code/blackhole
cd ~/Code/blackhole
./bin/blackhole setup
./bin/blackhole install
```

确保 `~/.local/bin` 排在 `PATH` 的最前面：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

如需指定其他安装目录，或替换宿主机已有的 `claude` 可执行文件：

```bash
./bin/blackhole install --prefix /opt/homebrew/bin --force
```

卸载时只需删除软链接（`rm -f ~/.local/bin/claude ~/.local/bin/blackhole`），并按需清理 `~/.blackhole`、`blackhole-claude:latest` 镜像以及 `blackhole-claude-home-*` Docker volume。

## 命令与配置

### 子命令速查

| 命令 | 说明 |
| --- | --- |
| `claude [args...]` | 在当前目录对应的 Colima 隔离容器中启动 Claude Code |
| `blackhole setup [--claude-version VER]` | 构建或重建基础镜像（若存在 `.blackhole/Dockerfile` 则一并构建项目镜像） |
| `blackhole update [--claude-version VER]` | `setup` 的别名，用于更新到最新（或指定版本）的 Claude Code |
| `blackhole install [--prefix DIR] [--force]` | 在 `DIR`（默认 `~/.local/bin`）下创建 `claude` 和 `blackhole` 软链接 |
| `blackhole status` | 查看当前 profile、启动器接管状态、镜像 ID、FUSE 状态及活跃会话 |
| `blackhole shell` | 在当前项目的隔离容器环境内启动交互式 `bash` |
| `blackhole bind <profile> [dir]` | 将项目目录（及其子目录）绑定到指定的 Colima profile |
| `blackhole bindings` / `blackhole unbind [dir]` | 查看所有目录绑定关系，或解除指定目录的绑定 |
| `blackhole profiles` | 列出所有 Colima profile 的运行状态、内存及已归档的项目/会话数 |
| `blackhole projects` | 列出所有运行中 VM 的项目映射（`PROFILE`、`PATH`、`LAST USED`、`SESSIONS`） |
| `blackhole sessions` | 列出所有运行中 VM 的会话记录及实时状态（`active` / `ended` / `unknown`） |
| `blackhole resume [--profile P] [--dry-run] <prefix>` | 自动切换回会话记录的宿主机目录与 profile 并恢复该会话 |
| `blackhole export [--profile P] [-o FILE] <prefix>` | 将会话 JSONL 记录从 Docker volume 导出到宿主机 `~/.blackhole/sessions/<profile>/` |
| `blackhole export-watch start\|status\|stop` | 后台定时检测会话 JSONL 变化并原子更新到宿主机导出目录 |
| `blackhole net off\|on\|status [--all \| --profile P]` | 通过 VM 内 `iptables` 一键切断或恢复外网访问 |
| `blackhole net ipv6 off\|on\|status [--all \| --profile P]` | 通过 `sysctl` 与 `ip6tables` 禁用或恢复 VM 的 IPv6 |
| `blackhole net-watch start\|status\|stop` | 故障闭锁（fail-close）代理守护进程，宿主机 TUN/代理掉线时立即切断 VM 网络 |
| `blackhole clipboard start\|status\|stop\|disable\|enable` | 管理宿主机 `$TMPDIR` 截图镜像服务以支持终端粘贴图片 |
| `blackhole signal send --file PATH (--data JSON \| --message TEXT \| --stdin)` | 从宿主机原子写入信号文件，唤醒容器内正在等待的 `blackhole-signal wait` |

### 环境变量

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `BLACKHOLE_COLIMA_PROFILE` | `default`（或目录绑定的 profile） | 覆盖 Colima profile 选择（优先级：环境变量 > 目录绑定 > `default`） |
| `BLACKHOLE_IMAGE` | `blackhole-claude:latest` | 强制使用指定容器镜像（同时跳过项目的 `.blackhole/Dockerfile`） |
| `BLACKHOLE_HOME_VOLUME` | `blackhole-claude-home-<profile>` | 自定义挂载到容器 `/home/node` 的 Docker volume 名称 |
| `BLACKHOLE_STATE_DIR` | `~/.blackhole` | 宿主机状态目录（存放目录绑定、导出的会话、剪贴板镜像及守护进程状态） |
| `BLACKHOLE_CLIPBOARD` | `1` | 设为 `0` 可在当前会话关闭 `$TMPDIR` 图片镜像与挂载 |
| `BLACKHOLE_FUSE` | `0` | 设为 `1` 为容器开启 `/dev/fuse` 支持（或在项目下创建 `.blackhole/fuse`） |
| `BLACKHOLE_ALLOW_BROAD_MOUNT` | `0` | 设为 `1` 绕过安全拦截，允许直接挂载 `/`、`/Users` 或 `$HOME` |
| `ANTHROPIC_API_KEY` | *(不传递)* | 仅在宿主机已导出该变量时透传进容器 |
| `CLAUDE_CODE_OAUTH_TOKEN` | *(不传递)* | 仅在宿主机已导出该变量时透传进容器 |
| `NO_COLOR` | *(不传递)* | 禁用启动横幅、status line 与 Shell 提示符的 ANSI 颜色 |

### 项目级 Linux 工具镜像

宿主机 `/opt/homebrew/bin` 下的 macOS Mach-O 二进制无法在 Linux VM 内直接运行。如果项目需要额外的 Linux CLI 工具或编译依赖，可以在项目目录下创建 `.blackhole/Dockerfile`：

```dockerfile
ARG BLACKHOLE_BASE=blackhole-claude:latest
FROM ${BLACKHOLE_BASE}

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        gh jq ffmpeg libfuse3-dev \
    && rm -rf /var/lib/apt/lists/*
```

随后运行 `blackhole setup`（或直接运行 `claude`，缺失项目镜像时会自动触发构建）。Docker 构建上下文仅包含 `.blackhole/` 目录，不会把整个项目源码传给 daemon；镜像 tag（`blackhole-claude:project-<hash>`）由项目路径与 Dockerfile 内容哈希共同决定。

### 网络控制与代理断网保护

通过虚拟机内的 `BLACKHOLE_AIRGAP` `iptables`/`ip6tables` 链，可以随时切断或恢复运行中 VM 的外网访问（保留 loopback、Docker 内网 `172.16.0.0/12` 及宿主机网关，断网期间 `colima ssh` 和 `docker` 依然可用）：

```bash
blackhole net off --all
blackhole net status
blackhole net on --all
blackhole net ipv6 off --all
```

如果宿主机通过 Shadowrocket、Surge 或 Clash 等 TUN 代理出网，希望在代理意外退出时立即切断 VM 网络防止直连泄漏，可以启动 `net-watch`：

```bash
blackhole net-watch start
blackhole net-watch status
blackhole net-watch stop   # 停止后保持断网（fail-close）；需手动运行 'blackhole net on --all' 恢复
```

`net-watch` 采用 **fail-close（故障闭锁）** 策略：启动时先切断 VM 网络，随后探测 `https://www.google.com/generate_204`（默认 `--interval 1`、`--fail-after 2`、`--recover-after 2`、`--timeout 15`，并校验默认路由是否经过 `utun*` 网卡）；同时会拉起独立的 `__net-guard` 进程监控心跳，即使主进程卡死或被 `SIGKILL` 杀掉，guard 也会立即锁死所有 VM 网络。非 TUN 模式的 HTTP 代理可传入 `--no-require-tun --proxy URL --url URL`。

### 跨进程文件信号

Claude Code 没有向空闲 TUI 异步推送消息的官方接口。当宿主机上的外部进程（如 Codex 或测试脚本）需要与容器内的 Claude 协同工作时，可以通过项目目录内的信号文件完成同步：

```bash
# 容器内（Claude）：阻塞等待 .blackhole/signals/tests.json 创建或更新
blackhole-signal wait --file .blackhole/signals/tests.json --timeout 1800

# 宿主机（外部工具）：原子写入信号内容并唤醒 Claude
blackhole signal send --file .blackhole/signals/tests.json \
  --data '{"status":"passed","summary":"42 tests passed"}'
```

`blackhole-signal wait` 会在文件内容稳定一个轮询周期后返回（默认 `--interval 500` 毫秒，支持 `--since <epoch|ISO>`，单文件上限 1 MiB；退出码：`0` 收到信号、`1` 错误、`124` 超时）。请将信号内容视作不可信数据，切勿直接 `eval`。

### 跨 Profile 迁移会话

会话 JSONL 保存在各 profile 的 Docker volume 内（`/home/node/.claude/projects/-workspace/<session-id>.jsonl`）。在不同 profile 之间迁移凭据与会话时，请在 `$HOME` 下创建中转目录（Colima 默认不挂载 `/tmp`）：

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

## 限制与边界

### 挂载与隔离边界

每次通过 `claude` 启动的容器默认启用 `--security-opt no-new-privileges` 和 `--pids-limit 512`，且仅包含以下三项挂载：

| 宿主机 / Volume 来源 | 容器内路径 | 权限 | 用途 |
| --- | --- | --- | --- |
| `$PWD` | `/workspace` | `rw` | 基于 `virtiofs` 的项目文件实时双向同步 |
| `blackhole-claude-home-<profile>` | `/home/node` | `rw` | Claude 登录凭据、设置与会话注册表 |
| `~/.blackhole/clipboard` | 宿主机 `$TMPDIR` 同名路径 | `ro` | 终端剪贴板粘贴截图只读镜像 |

- **文件系统级隔离，而非对抗恶意内核的沙盒**：未执行 `blackhole net off` 时，容器具备访问 Anthropic API 的外网权限。VM 内的 `iptables` 断网规则（`net off` / `net-watch`）属于防误连开关，VM 内拥有 root 权限的进程可自行清除。请勿将不可信镜像设为 `BLACKHOLE_IMAGE`。
- **FUSE 模式会降低隔离强度**：开启 FUSE（`touch .blackhole/fuse` 或 `BLACKHOLE_FUSE=1`）会移除 `no-new-privileges` 并附加 `--device /dev/fuse --cap-add SYS_ADMIN --security-opt apparmor=unconfined`，以便 `fusermount3` 在容器内挂载文件系统，请仅对可信项目启用。
- **剪贴板贴图范围与延迟**：仅镜像宿主机 `$TMPDIR` 下新生成的图片文件（`png`、`jpg`、`jpeg`、`gif`、`webp`、`heic`、`tiff`、`bmp`，每 `0.5s` 轮询一次，7 天后自动清理）。从 `~/Desktop` 或 `~/Downloads` 直接拖入终端的文件不会挂载进容器，需先拷入项目目录。
- **同 Profile 共享配置卷**：在同一 Colima profile 下并发运行多个会话会共享同一个 `/home/node` volume，配置写入可能相互覆盖。修改 `bin/blackhole` 或通过 `blackhole setup` 重建镜像只会对新启动的会话生效，不会影响已经在运行的容器。

### virtiofs 性能实测

以下是在 Apple Silicon macOS 上的实测结果，对比宿主机原生 `APFS`、容器 `/workspace`（`virtiofs` 共享挂载）以及容器 `/tmp`（VM 内部 `ext4` 虚拟磁盘）：

| 测试负载 | 宿主机原生 (`APFS`) | 容器 `/workspace` (`virtiofs`) | 容器 `/tmp` (`ext4`) | 说明 |
| --- | :---: | :---: | :---: | --- |
| **64 MB 顺序写 (`fsync`)** | `16.4 ms` (3.9 GB/s) | **`53.7 ms` (1.2 GB/s)** | `37.4 ms` (1.7 GB/s) | GB/s 级吞吐，大文件读写无瓶颈 |
| **64 MB 顺序读** | `5.0 ms` (12.8 GB/s) | **`20.1 ms` (3.2 GB/s)** | `3.6 ms` (17.7 GB/s) | 接近原生的缓存读取速度 |
| **创建 1,000 个 1 KB 文件** | `58.4 ms` | **`196.0 ms`** (0.19 ms/个) | `15.4 ms` | 每千个小文件耗时约 ~0.2 秒 |
| **`stat` 遍历 1,000 个文件** | `4.7 ms` | **`33.9 ms`** (0.03 ms/个) | `3.6 ms` | 扫描万级文件代码库仅需 ~0.3 秒 |
| **读取 1,000 个 1 KB 文件** | `10.4 ms` | **`126.3 ms`** (0.12 ms/个) | `5.1 ms` | `rg` 搜索与代码读写体感无异 |
| **删除 1,000 个 1 KB 文件** | `35.2 ms` | **`109.2 ms`** (0.11 ms/个) | `5.3 ms` | 每千个小文件删除约 ~0.1 秒 |

对于会产生数万个临时文件的重度构建（如 Rust `cargo build`），可以将构建缓存目录指向容器内的 `/tmp`（例如 `CARGO_TARGET_DIR=/tmp/target`），既能享受 VM 原生 `ext4` 的编译速度，又能保持 `/workspace` 下源码实时同步。

## 许可证

MIT — 详见 [LICENSE](LICENSE)。
