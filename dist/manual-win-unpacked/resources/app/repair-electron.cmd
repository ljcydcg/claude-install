@echo off
cd /d D:\claude-install
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm rebuild electron --verbose
pause
