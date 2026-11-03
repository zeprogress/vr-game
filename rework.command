#!/bin/bash
# Двойной клик по этому файлу: сервер + клиент реворка, пароль админа 1234.
cd "$(dirname "$0")" || exit 1
export ADMIN_PASS="${ADMIN_PASS:-1234}"
exec npm run dev:rework
