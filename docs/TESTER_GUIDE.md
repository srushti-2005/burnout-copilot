# MindEase: tester guide (Windows PC)

You only need a Windows PC with Chrome or Edge. You do not need Python, accounts other than your own MindEase account, or any source code.

## What the PC agent records
Only counts: how many keys you press per minute (never which keys), how often you switch windows, how long you have been working, and whether it is late at night. It never reads what you type, and never reads window contents. Remove it any time (step 6).

## One-time setup (about 3 minutes)
1. Open **https://burnout-copilot-git-main-srushtiii2005-1873s-projects.vercel.app/** and create an account (Sign up).
2. Download the agent: **https://burnout-copilot.vercel.app/downloads/MindEaseAgent.exe**
3. Double-click it.
   - Windows may show "Windows protected your PC" because the file is not code-signed. Click **More info**, then **Run anyway**.
   - Some antivirus tools warn about unsigned keyboard-monitoring programs. If yours blocks it, allow it, or tell the person who sent you this guide.
   - A box says "MindEase agent is installed and running". Click OK. It now starts automatically whenever you sign in to Windows.
4. Go back to the website, **sign out, then sign in again**. This hands your login to the agent.
   - Chrome may ask to "access devices on your local network" for the MindEase site. Click **Allow**. This is the website talking to the agent on your own PC.

## Every day
- Just sign in on the website. Tracking starts automatically and stops when you click Sign out.
- The first request after a quiet period can take up to a minute while the free server wakes up.

## Check it is working
- A new session is saved every **60 minutes**. After your first hour of normal use, open the website: the dashboard shows your session. Your personal baseline appears after about 5 sessions.
- To see the agent's own log: press Win+R, paste `%LOCALAPPDATA%\MindEase\agent.log`, press Enter. A line saying "Session saved" confirms an upload.

## Stop or pause tracking
- Click **Sign out** on the website. Tracking stops immediately.

## 6. Remove the agent completely
1. Press Win+R, paste `%LOCALAPPDATA%\MindEase\MindEaseAgent.exe --uninstall`, press Enter.
2. Delete the folder `%LOCALAPPDATA%\MindEase` when it tells you to.

## Troubleshooting
| Problem | Fix |
|---|---|
| No sessions after an hour | Sign out and in again on the website. Make sure Chrome did not block the local-network prompt (lock icon in the address bar, then Site settings, Local network access, Allow). |
| Windows blocked the file | Right-click the file, Properties, tick **Unblock**, OK, then run it again. |
| Website says it cannot connect | Wait one minute (server waking up) and retry. |
