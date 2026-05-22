# Source this after compinit to bind agent-launch completion in zsh.
fpath=("$HOME/.zfunc" $fpath)
autoload -Uz _agent-launch 2>/dev/null
(( $+functions[compdef] )) && compdef _agent-launch agent-launch agl
