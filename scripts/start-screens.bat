@echo off
rem Открыть меню на всех телевизорах (двойной клик).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-screens.ps1" %*
