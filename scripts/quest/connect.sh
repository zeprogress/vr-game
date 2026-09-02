#!/usr/bin/env bash
# Проброс DevTools-порта Quest Browser на localhost:9222.
# Запускать один раз, когда шлем подключён (USB или Wi-Fi ADB). VPN не мешает.
set -e
PORT="${CDP_PORT:-9222}"

metavr adb forward "tcp:${PORT}" localabstract:chrome_devtools_remote

echo "проброшено: localhost:${PORT} -> Quest Browser CDP"
echo
curl -s "http://localhost:${PORT}/json/list" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const p of JSON.parse(s))if(p.type==="page")console.log(" •",p.title,"—",p.url)})' \
  || echo "  (страниц нет — открой игру в шлеме)"
