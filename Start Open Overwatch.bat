@echo off
title Open Overwatch helper
cd /d "%~dp0"
echo Starting the Open Overwatch helper (keep this window open while you use the map)...
echo.
py -3 -c "print(1)" >nul 2>nul && ( py -3 serve.py & goto :done )
python -c "print(1)" >nul 2>nul && ( python serve.py & goto :done )
node -e "1" >nul 2>nul && ( node serve.js & goto :done )
bun -e "1" >nul 2>nul && ( bun serve.js & goto :done )
echo Neither Python nor Node.js was found on this PC.
echo Install one of them (https://www.python.org/downloads/ or https://nodejs.org/) and run this file again.
echo.
echo The map and the globe need this helper (or another local web server): browsers do not load
echo their code from a file opened directly. The feeds it relays are listed in README.txt.
:done
echo.
pause
