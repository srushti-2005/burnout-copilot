# Burnout Bridge

Connect the existing Burnout Copilot UI to my existing Python application logic. Do not redesign the UI and do not add any new features.

The React/TypeScript/Vite frontend is the presentation layer.

The existing app (1).py, components (1).py, and styles (1).py contain the existing Python application logic and should be treated as the source of truth for the burnout calculations and dashboard data.

First inspect those Python files and identify:

 burnout risk calculation

 rest quality

 focus score

 work-life balance

 task switching

 hours worked

 typing variance/steadiness

 late-night work

 7-day forecast

 AI insights

 key drivers

 comparison metrics

Do NOT duplicate or invent these calculations in TypeScript.

Create the necessary API/data layer so the React frontend can consume the existing Python calculations.

Keep the current React UI exactly as it is visually.

Do not add new dashboard sections.

Do not change the color palette.

Do not change the login design.

Do not remove the Copilot.

First explain the integration architecture and which files need to be changed before making major change

Now the prop-driven components (visuals untouched).

Edited
RiskGauge.tsx
Edited
ForecastChart.tsx
Edited
InsightsPanel.tsx
Edited
ComparePanel.tsx
Now the sidebar, routes, and the Python service file.

Edited
DashboardSidebar.tsx
Edited
DashboardSidebar.tsx
Read
DashboardSidebar.tsx
Edited
DashboardSidebar.tsx
Thought for 23s
Edited
index.tsx
I'm out of credits mid-change, so the app is currently in a broken state with one missing file. Here's exactly what remains:

Blocking fix (one new file): src/lib/dashboard.fallback.ts — move the emptyDashboard() function out of src/lib/dashboard.server.ts (lines 8–36) into this new client-safe module, and have dashboard.server.ts import it from there instead of declaring it. src/routes/index.tsx already imports @/lib/dashboard.fallback, which is why the build fails.

Then still to do:

src/routes/login.tsx — wire the existing form to loginUser / signupUser / resetPassword from src/lib/dashboard.functions.ts, store the returned uid in localStorage under bc_uid, and navigate to /. Design untouched.
python-api/api_server.py — the thin FastAPI file that imports your existing auth_manager, supabase_manager, cli_logic, suggestion_engine and forecaster and returns the JSON payload.
Save PYTHON_API_URL as a secret once you have the service URL.
Already done: the payload types, the server-side fetch/auth layer, the server functions, and all components made prop-driven (RiskGauge, ForecastChart, InsightsPanel, ComparePanel, DashboardSidebar, dashboard route) with zeroed fallbacks — no visual, palette or layout changes anywhere.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/957dfbf1-0995-4b9c-8706-5ac3b9bb7bb4).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
