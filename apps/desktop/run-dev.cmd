@echo off
set PATH=C:\Users\SiNPuFFY\.cargo\bin;%PATH%
cd /d "%~dp0"
pnpm tauri dev > tauri-dev.log 2>&1
