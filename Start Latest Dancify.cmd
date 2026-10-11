@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-launcher.ps1" -Mode demo
if errorlevel 1 pause
