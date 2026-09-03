@echo off
chcp 65001 >nul
title Установка бота — Лавка Гаджетов
cd /d "%~dp0"

echo.
echo  ============================================
echo    УСТАНОВКА БОТА  -  Лавка Гаджетов
echo  ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [X] Node.js не установлен.
  echo.
  echo      Скачай его тут:  https://nodejs.org
  echo      Бери версию LTS, ставь со всеми галочками по умолчанию.
  echo      Потом ЗАКРОЙ это окно и запусти этот файл заново.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODEVER=%%v
echo  [+] Node.js найден: %NODEVER%
echo.

echo  [1/3] Ставлю зависимости. Это займёт минуту-другую...
echo.
call npm install
if errorlevel 1 (
  echo.
  echo  [X] Не удалось поставить зависимости.
  echo      Проверь интернет и запусти файл ещё раз.
  echo.
  pause
  exit /b 1
)

echo.
echo  [2/3] Создаю магазин с товарами...
call npm run seed
if errorlevel 1 (
  echo.
  echo  [X] Не удалось создать базу магазина.
  pause
  exit /b 1
)

echo.
echo  [3/3] Готовлю файл настроек...
if exist ".env" (
  echo       Файл .env уже есть — не трогаю его.
) else (
  copy ".env.example" ".env" >nul
  echo       Создан файл .env
)

echo.
echo  ============================================
echo    ГОТОВО. Остался один шаг.
echo  ============================================
echo.
echo   Открой файл  .env  в Блокноте и впиши туда:
echo.
echo     1. Токен бота от @BotFather
echo        строка  TG_BOT_TOKEN=
echo.
echo     2. Ключи с https://aistudio.google.com
echo        строки  GEMINI_KEY_1=  GEMINI_KEY_2=  GEMINI_KEY_3=
echo.
echo   Потом запусти файл  ЗАПУСК.bat
echo.
echo  ============================================
echo.

start notepad .env
pause
