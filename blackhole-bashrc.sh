# Interactive debugging shell inside Blackhole.
[[ -f /etc/bash.bashrc ]] && source /etc/bash.bashrc
[[ -f /home/node/.bashrc ]] && source /home/node/.bashrc

if [[ -n "${NO_COLOR:-}" ]]; then
    PS1='[BLACKHOLE] \w \$ '
else
    PS1='\[\033[1;97;45m\] ⬤ BLACKHOLE \[\033[0m\] \[\033[1;36m\]\w\[\033[0m\] \[\033[1;35m\]\$\[\033[0m\] '
fi
export PS1
