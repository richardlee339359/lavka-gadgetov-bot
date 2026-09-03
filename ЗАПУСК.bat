@echo off
chcp 65001 >nul
title Бот — Лавка Гаджетов
cd /d "%~dp0"

if not exist "node_modules" (
  echo.
  echo  [X] Зависимости не установлены.
  echo      Сначала запусти файл  УСТАНОВКА.bat
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  echo.
  echo  [X] Нет файла настроек .env
  echo      Сначала запусти файл  УСТАНОВКА.bat
  echo.
  pause
  exit /b 1
)

echo.
echo  Запускаю бота. Чтобы остановить — нажми Ctrl+C в этом окне.
echo  Просто закрыть окно НЕДОСТАТОЧНО: бот останется работать в фоне,
echo  и при следующем запуске будет отвечать дважды.
echo.

call npm run dev

echo.
echo  Бот остановлен.
pause
