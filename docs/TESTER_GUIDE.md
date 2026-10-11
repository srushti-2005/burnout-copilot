# MindEase: Tester Guide (Windows PC)

You only need a Windows PC with Chrome or Edge. You do not need Python, developer tools, or any source code.

## What the PC agent records
Only counts: how many keys you press per minute (never which keys), how often you switch windows, how long you have been working, and whether it is late at night. It never reads what you type, and never reads window contents. You can remove it at any time.

## One-time setup (about 2 minutes)
1. Open the MindEase web app and create an account (**Sign Up**) or **Login**.
2. **MindEaseAgent.exe** will automatically begin downloading in your browser:
   - If prompted by your browser or Windows SmartScreen, click **Keep** / **More info** -> **Run anyway**.
   - If Smart App Control is enabled on your Windows edition and blocks unsigned apps, see the Smart App Control note below.
3. Open your `Downloads` folder and double-click **`MindEaseAgent.exe`**.
   - A box appears saying *"MindEase agent is installed and running."*
   - It will now run silently in the background and auto-start with Windows.
4. If Chrome or Edge asks for permission to **"access devices on your local network"**, click **Allow**. This enables the web app to connect to the local tracking agent.

---

### If Chrome / Edge shows "Unverified / suspicious download blocked" (.crdownload):
Chrome/Edge pauses newly hosted .exe files and shows an unconfirmed `.crdownload` file.
1. Press `Ctrl + J` to open Chrome/Edge Downloads.
2. Find `MindEaseAgent.exe` and click **Keep** -> **Keep anyway**. The file will immediately complete downloading as `.exe`.
3. *Or:* Download the **`MindEaseAgent.zip`** format from the dashboard, which browsers do not flag. Extract the zip and double-click `MindEaseAgent.exe`.

### If Windows Smart App Control blocks installation:
1. Open **Windows Security** (search in Start menu).
2. Go to **App & browser control** -> **Smart App Control settings**.
3. Toggle it to **Off**.
4. Double-click `MindEaseAgent.exe` again.

---

## Daily use
- Just use your computer normally. Typing rhythm and task-switching are continuously recorded.
- Session rows and burnout risk scores appear on your dashboard.
- Clicking **Sign Out** on the website stops tracking.

## Verify it is working
- View the live agent log: Press `Win + R`, paste `%LOCALAPPDATA%\MindEase\agent.log`, and press `Enter`.
- Look for lines indicating active tracking:
  ```
  [MindEaseAgent] Window poller started
  [MindEaseAgent] Windows-native keyboard collector started
  [MindEaseAgent] Signed in as ...; tracking active
  ```

## Remove the agent completely
1. Press `Win + R`, paste `%LOCALAPPDATA%\MindEase\MindEaseAgent.exe --uninstall`, and press `Enter`.
2. Delete the `%LOCALAPPDATA%\MindEase` folder if desired.
