# Builds MindEaseAgent.exe and copies it into the website's public/downloads folder.
# Run from the repo root or the agent folder, in PowerShell:
#   cd agent
#   .\build_agent.ps1 -ApiUrl "https://YOUR-SERVICE.onrender.com" -Origins "https://burnout-copilot.vercel.app"
param(
    [Parameter(Mandatory = $true)][string]$ApiUrl,
    [string]$Origins = "https://burnout-copilot-git-main-srushtiii2005-1873s-projects.vercel.app/"
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if ($ApiUrl -notmatch '^https://') { throw "ApiUrl must start with https://" }
$ApiUrl = $ApiUrl.TrimEnd('/')

python -m pip install --quiet --upgrade pyinstaller

# The agent reuses the real tracker. Copy it next to the agent for the build.
Copy-Item ..\backend\src\data\tracker.py .\tracker.py -Force

# Bake the two settings into a temporary copy (the source file stays untouched).
$src = Get-Content .\mindease_agent.py -Raw
$src = $src.Replace('https://YOUR-SERVICE.onrender.com', $ApiUrl)
$src = $src.Replace('https://burnout-copilot-git-main-srushtiii2005-1873s-projects.vercel.app/,http://localhost:3000', $Origins)
Set-Content .\_build_agent.py $src -Encoding UTF8

python -m PyInstaller --onefile --noconsole --clean --name MindEaseAgent .\_build_agent.py

New-Item -ItemType Directory -Force ..\frontend\public\downloads | Out-Null
Copy-Item .\dist\MindEaseAgent.exe ..\frontend\public\downloads\MindEaseAgent.exe -Force

Remove-Item .\_build_agent.py, .\tracker.py, .\MindEaseAgent.spec -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .\build, .\dist -ErrorAction SilentlyContinue
Write-Host "Done: frontend\public\downloads\MindEaseAgent.exe"
Write-Host "Now commit and push so Vercel serves it at /downloads/MindEaseAgent.exe"
