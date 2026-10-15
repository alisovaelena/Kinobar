@echo off
chcp 65001 >nul
rem Запуск сервера меню кинобара. Пароль менеджерской задаётся ниже.
cd /d "%~dp0.."
set ADMIN_PASSWORD=kinobar
set PORT=3000
:loop
node server.js
echo Сервер остановился, перезапуск через 3 секунды...
timeout /t 3 >nul
goto loop
