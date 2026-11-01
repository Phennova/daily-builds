#!/bin/bash
# usage: dom.sh <WxH> <query> [budget]  -> prints data-report JSON + console lines
E="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"; D=$(pwd -W)
"$E" --headless=old --disable-gpu --window-size=${1/x/,} --virtual-time-budget=${3:-9000} --enable-logging=stderr --v=0 --dump-dom "file:///$D/index.html$2" 2>$TEMP/err.txt | grep -o 'data-report="[^"]*"' | sed 's/&quot;/"/g'
grep CONSOLE $TEMP/err.txt | grep -v ProtocolLaunch
