#!/usr/bin/env bash
# TURN-сервер (coturn) для голосового чата: ретранслирует голос, когда прямое
# соединение между игроками не проходит (NAT/CGNAT/VPN у одного из них).
# Запускать от root один раз:  bash deploy/setup-turn.sh
#
# Логин/пароль и домен зашиты в src/client/voice/VoiceChat.ts (VOICE.turn) —
# если меняешь их здесь, поменяй и там.
set -euo pipefail

DOMAIN="zepgame.duckdns.org"
TURN_USER="vrgame"
TURN_PASS="slime-boss-2026"
# Узкий диапазон relay-портов — меньше дырок в файрволе, на пару игроков хватит.
MIN_PORT=49160
MAX_PORT=49220

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq coturn

IP=$(curl -s --max-time 10 ifconfig.me || hostname -I | awk '{print $1}')

cat > /etc/turnserver.conf <<EOF
listening-port=3478
listening-ip=0.0.0.0
external-ip=${IP}
realm=${DOMAIN}
server-name=${DOMAIN}

# Долгоживущие учётки (общие для игры).
lt-cred-mech
user=${TURN_USER}:${TURN_PASS}

min-port=${MIN_PORT}
max-port=${MAX_PORT}

no-cli
no-tlsv1
no-tlsv1_1
# Не даём ретранслировать во внутренние сети / на сам сервер.
no-loopback-peers
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
EOF

# Включить сервис (в пакете он по умолчанию выключен).
sed -i 's/^#*TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn

ufw allow 3478 >/dev/null 2>&1 || true
ufw allow "${MIN_PORT}:${MAX_PORT}/udp" >/dev/null 2>&1 || true

systemctl enable coturn >/dev/null 2>&1 || true
systemctl restart coturn

sleep 1
echo
if systemctl is-active --quiet coturn; then
  echo "TURN работает: turn:${DOMAIN}:3478  (${TURN_USER} / ${TURN_PASS})"
  echo "Проверка снаружи: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/"
else
  echo "coturn не поднялся — journalctl -u coturn -e"
fi
