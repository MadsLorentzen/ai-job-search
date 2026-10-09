@echo off
setlocal
cd /d "%~dp0.."
python webapp\server.py
endlocal
