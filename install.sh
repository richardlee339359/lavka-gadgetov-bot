#!/usr/bin/env bash
# Установка бота — Linux / macOS
# Запуск:  bash install.sh

set -e
cd "$(dirname "$0")"

echo
echo " ============================================"
echo "   УСТАНОВКА БОТА  —  Лавка Гаджетов"
echo " ============================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo " [X] Node.js не установлен."
  echo "     Поставь его: https://nodejs.org (версия 20 или новее)"
  echo
  exit 1
fi

echo " [+] Node.js найден: $(node -v)"
echo
echo " [1/3] Ставлю зависимости..."
npm install

echo
echo " [2/3] Создаю магазин с товарами..."
npm run seed

echo
echo " [3/3] Готовлю файл настроек..."
if [ -f .env ]; then
  echo "       Файл .env уже есть — не трогаю его."
else
  cp .env.example .env
  echo "       Создан файл .env"
fi

echo
echo " ============================================"
echo "   ГОТОВО. Остался один шаг."
echo " ============================================"
echo
echo "  Открой файл .env и впиши:"
echo
echo "    1. Токен бота от @BotFather      → TG_BOT_TOKEN="
echo "    2. Ключи с aistudio.google.com   → GEMINI_KEY_1=  GEMINI_KEY_2="
echo
echo "  Потом запусти:  npm run dev"
echo
