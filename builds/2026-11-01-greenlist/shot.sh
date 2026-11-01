#!/bin/bash
# usage: shot.sh <out.png> <WxH> <query>   (headless Edge; prints console errors)
E="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"; D=$(pwd -W)
"$E" --headless=old --disable-gpu --hide-scrollbars --window-size=${2/x/,} --virtual-time-budget=${4:-9000} --enable-logging=stderr --v=0 --screenshot="$1" "file:///$D/index.html$3" 2>&1 | grep "CONSOLE" | grep -v "ProtocolLaunch"
