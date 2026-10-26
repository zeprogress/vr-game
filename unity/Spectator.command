#!/bin/sh
# Спектатор для OBS, подключается к прод-серверу. Другой сервер: ./Spectator.command ws://localhost:2567
cd "$(dirname "$0")"
open -n "Builds/Spectator-mac/ZEP Spectator.app" --args -server "${1:-wss://zepgame.duckdns.org}"
