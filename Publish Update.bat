@echo off
rem Publish a new version: catches up with origin/main, bumps the version in the app, commits everything, tags it and
rem pushes the current branch to main. GitHub then rebuilds the website (about 1 minute) and the download zip (about 1 minute).
rem It stops before changing anything if origin/main has commits this branch lacks (a merged Dependabot PR, say), and
rem a push that fails (atomic: the branch and the tag go together or not at all) takes back its tag and commit, so
rem running it again is clean.
setlocal
cd /d "%~dp0"
git fetch origin main || goto :fail
git merge --ff-only origin/main || goto :behind
for /f "tokens=2 delims='" %%v in ('findstr /c:"const OW_VERSION" src\map\version.js') do set CUR=%%v
for /f %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b
echo Current version: %CUR%   (branch %BRANCH% goes to main)
set /p VER=New version number (e.g. 0.6): 
if "%VER%"=="" goto :eof
set /p MSG=What changed? (one line): 
if "%MSG%"=="" set MSG=Update
rem No carets or inner double quotes in this line (cmd strips ^ outside its quote pairing, which broke the pattern),
rem and write UTF-8 without a BOM (Windows PowerShell's Set-Content -Encoding UTF8 adds one).
powershell -NoProfile -Command "$f = Join-Path (Get-Location) 'src\map\version.js'; $t = [IO.File]::ReadAllText($f); $t = $t -replace 'const OW_VERSION = ''[0-9A-Za-z.\-]*''', 'const OW_VERSION = ''%VER%'''; [IO.File]::WriteAllText($f, $t, (New-Object Text.UTF8Encoding $false))"
findstr /c:"const OW_VERSION = '%VER%'" src\map\version.js >nul || (echo The version number in src\map\version.js was not updated. & goto :fail)
git add -A || goto :fail
git commit -m "v%VER%: %MSG%" || goto :fail
git tag -a "v%VER%" -m "%MSG%" || goto :undocommit
git push --atomic origin HEAD:main --follow-tags || goto :undotag
echo.
echo Done. Site:     https://destinjones.github.io/open-overwatch/
echo       Release:  https://github.com/destinjones/open-overwatch/releases/tag/v%VER%
pause
goto :eof
:behind
echo.
echo Could not catch up with origin/main: it has commits this branch lacks while this branch has commits of its own,
echo or uncommitted changes touch the same files. Nothing was changed.
echo Merge first with:  git merge origin/main   then run this again.
pause
goto :eof
:undotag
git tag -d "v%VER%"
:undocommit
git reset --soft HEAD~1
echo.
echo Not published. The version commit was taken back, and the tag v%VER% too if it was made; your changes are still
echo there, staged. src\map\version.js already holds %VER%: enter the same number again.
echo Check the message above and run this again.
pause
goto :eof
:fail
echo Something went wrong - nothing was committed or pushed. Check the message above and try again.
pause
