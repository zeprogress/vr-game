# Развёртывание на VPS

Постоянный публичный сервер: друг заходит по обычной ссылке `https://…`,
без туннелей, заглушек и лимитов по времени. WebXR доволен (HTTPS).

Схема: **nginx** отдаёт собранный клиент из `dist/` и проксирует матчмейкинг и
WebSocket-комнаты на **Colyseus** (`127.0.0.1:2567`, живёт под systemd).
Клиент подключается к тому же origin — код менять не нужно.

---

## 1. Код на GitHub (один раз, с Mac)

```bash
cd "VR GAME"
gh repo create vr-game --private --source=. --remote=origin --push
```

Дальше при изменениях: `git push`, потом на сервере `bash deploy/update.sh`.

## 2. VPS

Любой провайдер, самый дешёвый тариф хватит (1 vCPU / 1–2 ГБ). Например
**Hetzner** CX22 (~€4/мес) или **CAX11** ARM (~€3.8). При заказе:

- образ **Ubuntu 24.04**
- добавить свой SSH-ключ (`~/.ssh/id_ed25519.pub`; нет — `ssh-keygen -t ed25519`)

Запиши публичный IP, например `203.0.113.10`.

## 3. Домен

WebXR требует HTTPS, значит нужен домен (не голый IP). Бесплатно и за 2 минуты — **DuckDNS**:

1. <https://www.duckdns.org> → войти → создать поддомен, например `zepgame`
2. в поле **current ip** вписать IP сервера → **update**

Получаешь `zepgame.duckdns.org`. (Свой домен позже — просто повторить установку с ним.)

## 4. Установка

```bash
ssh root@203.0.113.10
git clone https://github.com/ТВОЙ_ЛОГИН/vr-game.git /root/vr-game
cd /root/vr-game
bash deploy/setup.sh zepgame.duckdns.org https://github.com/ТВОЙ_ЛОГИН/vr-game.git
```

Скрипт ставит Node, nginx, certbot, собирает клиент, поднимает сервис и выпускает
сертификат. В конце печатает `https://zepgame.duckdns.org`.

## 5. Проверка

- Открыть `https://zepgame.duckdns.org` — грузится игра, вход по нику.
- Логи сервера: `journalctl -u vrgame -f`
- Друг заходит по той же ссылке с любого устройства и сети.
- В шлеме — та же ссылка, «Enter VR».

## Обновление после правок

```bash
# Mac
git push
# сервер
ssh root@203.0.113.10 'cd /root/vr-game && git pull && bash deploy/update.sh'
```

## Если что-то не так

| Симптом | Смотреть |
|---|---|
| 502 Bad Gateway | `journalctl -u vrgame -e` — сервер упал |
| нет сертификата | `certbot certificates`; DNS DuckDNS указывает на этот IP? |
| WebSocket не соединяется | `nginx -t`, раздел с регуляркой в `/etc/nginx/sites-available/vrgame` |
| сейвы игроков | `/opt/vrgame/src/server/.data/players.json` (переживают `update.sh`) |
