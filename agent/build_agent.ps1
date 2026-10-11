# Builds MindEaseAgent.exe and copies it into the website's public/downloads folder.
# Run from the repo root or the agent folder, in PowerShell:
#   cd agent
#   .\build_agent.ps1
param(
    [string]$ApiUrl = "https://burnout-copilot.onrender.com",
    [string]$Origins = "https://burnout-copilot.vercel.app,https://burnout-copilot-git-main-srushtiii2005-1873s-projects.vercel.app,http://localhost:3000,http://localhost:5173"
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if ($ApiUrl -notmatch '^https?://') { throw "ApiUrl must start with http:// or https://" }
$ApiUrl = $ApiUrl.TrimEnd('/')

python -m pip install --quiet --upgrade pyinstaller

# The agent reuses the real tracker. Copy it next to the agent for the build.
Copy-Item ..\backend\src\data\tracker.py .\tracker.py -Force

# Copy mindease_agent.py as the build source
$src = Get-Content .\mindease_agent.py -Raw
Set-Content .\_build_agent.py $src -Encoding UTF8

python -m PyInstaller --onefile --noconsole --clean --name MindEaseAgent .\_build_agent.py

New-Item -ItemType Directory -Force ..\frontend\public\downloads | Out-Null
Copy-Item .\dist\MindEaseAgent.exe ..\frontend\public\downloads\MindEaseAgent.exe -Force
Compress-Archive -Path ..\frontend\public\downloads\MindEaseAgent.exe -DestinationPath ..\frontend\public\downloads\MindEaseAgent.zip -Force

Remove-Item .\_build_agent.py, .\tracker.py, .\MindEaseAgent.spec -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .\build, .\dist -ErrorAction SilentlyContinue
Write-Host "Done: frontend\public\downloads\MindEaseAgent.exe & MindEaseAgent.zip"
Write-Host "Now commit and push so Vercel serves them at /downloads/"
