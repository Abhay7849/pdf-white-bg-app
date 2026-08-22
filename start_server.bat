@echo off
title PDF Background Converter Web Server
cd /d "%~dp0"
echo Starting PDF Background Converter Web Server on http://localhost:8000 ...
python main.py
pause
