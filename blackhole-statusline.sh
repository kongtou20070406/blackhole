#!/usr/bin/env bash
# Claude Code invokes this command repeatedly for its status line.
# Bright magenta is Blackhole's persistent visual identity.
if [[ -n "${NO_COLOR:-}" ]]; then
    printf '[BLACKHOLE] Colima VM · %s' "${PWD:-/workspace}"
else
    printf '\033[1;97;45m ⬤ BLACKHOLE \033[0m \033[1;35mCOLIMA VM\033[0m \033[2m·\033[0m \033[36m%s\033[0m' "${PWD:-/workspace}"
fi
