@echo off
rem Developer launcher: runs HIAS in development mode (hot reload).
rem End users should install release\Hall Invigilator Allocation System Setup *.exe instead.
cd /d "%~dp0eias"
echo Starting HIAS (development mode)...
npm run dev
pause
