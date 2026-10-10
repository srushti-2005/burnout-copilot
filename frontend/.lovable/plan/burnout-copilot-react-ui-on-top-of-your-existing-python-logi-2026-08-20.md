# Burnout Copilot — React UI on top of your existing Python logic

This project is currently the blank Lovable template (no dashboard, no login, no data layer). So the work is: rebuild the UI exactly as in your screenshots, and wire every number to your existing FastAPI service. No burnout math is reimplemented in TypeScript.

## Architecture

```text
Browser (React UI)
   |  TanStack server functions (same origin, no CORS)
Lovable server (Cloudflare worker)
   |  fetch(PYTHON_API_URL, x-api-key)
Your FastAPI  ->  auth_manager / supabase_manager / cli_logic
                  suggestion_engine / forecaster
```

- All Python calls happen server-side; the API URL and key are never in the browser.
- React holds zero formulas. Every displayed value (CLI, rest quality, focus, balance, drivers, forecast, comparisons, insights) is read from the JSON payload.

## Contract expected from your FastAPI

- `POST /auth/login` `{email, password}` -> `{success, uid, email, display_name, error?}`
- `POST /auth/signup` `{email, password, name}` -> same shape
- `POST /auth/reset` `{email}` -> `{success, error?}`
- `GET /dashboard?uid=...` -> one payload containing, exactly as computed today in `show_dashboard()`:
  - `cli` (current) + `cli_category`
  - `rest_pct`, `focus_pct`, `balance_pct`, `late_night_count`, `session_count`, `avg_duration`
  - `latest` session row (typing_mean, typing_variance, task_switching, work_duration, late_night, hour_of_day, timestamp)
  - `trend` (session_index, timestamp, CLI, CLI_category)
  - `forecast` (7 rows of date + CLI, from `get_7_day_forecast`)
  - `suggestions` (from `get_suggestion_engine`) and `drivers` (explainability contributions)
  - `compare` (task switching / hours worked / typing steadiness / late-night vs average)

If your existing endpoints differ, say so and I'll match names instead of adding new ones. Where a screenshot value has no Python source yet (e.g. peer-average comparison), I will render it from the closest existing field rather than invent a formula, and flag it.

## Files to create

UI (matching the screenshots pixel-for-pixel: clay/pastel palette, Nunito/Quicksand, soft cards)
- `src/routes/index.tsx` — dashboard page (replaces placeholder), redirects to `/login` when no uid
- `src/routes/login.tsx` — login/sign-up/forgot-password card
- `src/components/dashboard/DashboardSidebar.tsx`, `StatCard.tsx`, `RiskGauge.tsx`, `ForecastChart.tsx`, `InsightsPanel.tsx`, `ComparePanel.tsx`
- `src/styles.css` — add the clay tokens as semantic design tokens (no hardcoded colors in components)

Data layer
- `src/lib/dashboard.types.ts` — payload types
- `src/lib/dashboard.fallback.ts` — zeroed empty payload (client-safe)
- `src/lib/dashboard.server.ts` — fetch helpers against `PYTHON_API_URL`
- `src/lib/dashboard.functions.ts` — thin `createServerFn` wrappers only (`getDashboard`, `loginUser`, `signupUser`, `resetPassword`)

## Technical notes

- Charts use Recharts (already installed) for the gauge/forecast/trend; they only plot values received from Python.
- Session: uid stored in `localStorage` under `bc_uid` and passed to the server function, mirroring your Streamlit `session_state` model. No Lovable Cloud auth added.
- Secrets: `PYTHON_API_URL` and optional `PYTHON_API_KEY` stored via the secret form before wiring; server functions read `process.env` inside the handler.
- If the API is unreachable, the dashboard renders the zeroed fallback plus a quiet notice — no crash, no fake data.

## Out of scope

No new dashboard sections, no palette change, no login redesign, no calculations in TypeScript, no Copilot removal.
