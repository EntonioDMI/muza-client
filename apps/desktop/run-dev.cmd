@echo off
set PATH=C:\Users\SiNPuFFY\.cargo\bin;%PATH%
cd /d "%~dp0"
pnpm tauri dev --config src-tauri/tauri.dev.conf.json
