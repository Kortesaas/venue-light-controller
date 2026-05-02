# Venue Light Controller

Touch-first lighting control app for fixed venue installations.
It records Art-Net snapshots/scenes and lets operators recall them safely from a simple web UI and a local Stream Deck.

<p align="center">
  <img src="./docs/MatriX_Saal_Light.png" alt="Venue Light Controller - Operator Panel" width="220" />
</p>

## Features

- Static and animated scene recording/playback
- Scene management (create, rename, reorder, delete)
- Operator-safe controls (blackout, stop, control mode)
- Live client sync via SSE (`/api/events`)
- Runtime network/adaptor settings for Node and web access
- Optional fixture plan import (MA3 XML workflow)
- Atmosphere controls (fog flash + haze level)
- Stream Deck integration with:
  - scenes/levels views
  - lock screen with PIN keypad
  - screensaver + wake-to-lock behavior
  - dynamic scene updates (name/style/order changes)

## Project Structure

```text
venue-light-controller/
|- backend/
|  |- main.py
|  |- requirements.txt
|  |- assets/streamdeck/icons/
|  `- src/lighting/
|     |- api.py
|     |- artnet_core.py
|     |- config.py
|     |- fixture_plan.py
|     |- scenes.py
|     `- streamdeck_service.py
|- frontend/
|  `- src/
|     |- App.tsx
|     `- pages/
|        |- OperatorDashboard.tsx
|        `- AdminPanel.tsx
`- build_and_run.ps1
```

## Tech Stack

- Backend: Python, FastAPI, Pydantic v2
- Frontend: React + TypeScript + Vite + MUI
- Lighting transport: Art-Net (UDP)
- Realtime updates: Server-Sent Events (SSE)

## Requirements

- Python 3.10+
- Node.js 18+
- Network access to your Art-Net segment

## Local Development

### 1) Backend setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py
```

Backend runs on `http://localhost:8000`.

### 2) Frontend setup

```powershell
cd frontend
npm install
npm run dev
```

Frontend dev server runs on `http://localhost:5173`.

## Production / Venue Mode

Quick start from project root:

```powershell
.\build_and_run.ps1
```

This script builds the frontend, copies it to `backend/frontend_dist`, and starts the backend.
Then UI + API are served from `http://localhost:8000`.

## Stream Deck

### Supported hardware

- Stream Deck integration is enabled automatically when a compatible local device is detected.
- The current layout is optimized for Stream Deck XL (4x8).

### Dependencies

The backend needs these Python packages (already in `backend/requirements.txt`):

- `streamdeck`
- `hidapi`
- `pillow`

If device probing fails with a HID backend error, make sure the backend venv is active and reinstall:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pip install --upgrade hidapi streamdeck pillow
```

Then restart the backend.

### Behavior

- Deck content is rendered dynamically from backend state.
- Scene edits from web UI (name/icon/color/order) are reflected on the deck.
- Locking, unlock PIN entry, and screensaver are supported directly on the deck.
- Fog flash is a hold/flash action.
- Group "flash" actions in levels view are hold/flash actions.

### Stream Deck settings in browser UI

In `Admin Panel -> System Settings`:

- `Stream Deck Screensaver (s)` controls idle timeout.
- `0` disables the screensaver.

This value is persisted in `backend/settings.runtime.json` as `streamdeck_screensaver_seconds`.

### Custom Stream Deck icons

Place PNG icons in:

- `backend/assets/streamdeck/icons`

Naming format:

- `<icon_name>.png`

If an icon is missing, built-in placeholders are used.

You can auto-generate icon assets from MUI icons:

```powershell
python backend/scripts/generate_streamdeck_scene_icons.py --overwrite
```

Optional flags:

- `--write-svg`
- `--size 144`
- `--svg-only`

## Core UI/Control Concepts

- `control_mode`:
  - `panel`: app is allowed to send output
  - `external`: external controller has priority, panel actions are restricted
- Master dimmer and group dimmers are applied on top of the active scene payload.
- Atmosphere channels (fog/haze) are injected after dimmer processing.

## API Overview

### Status + realtime

- `GET /api/status`
- `GET /api/events`

### Scenes

- `GET /api/scenes`
- `GET /api/scenes/{scene_id}`
- `POST /api/scenes/record`
- `POST /api/scenes/{scene_id}/play`
- `POST /api/scenes/{scene_id}/rerecord`
- `PUT /api/scenes/{scene_id}`
- `PUT /api/scenes/{scene_id}/content`
- `DELETE /api/scenes/{scene_id}`
- `POST /api/scenes/reorder`

### Dynamic/animated recording

- `POST /api/scenes/dynamic/start`
- `POST /api/scenes/dynamic/stop`
- `POST /api/scenes/dynamic/cancel`
- `POST /api/scenes/dynamic/save`

### Playback + controls

- `POST /api/blackout`
- `POST /api/stop`
- `GET /api/master-dimmer`
- `POST /api/master-dimmer`
- `GET /api/group-dimmers`
- `POST /api/group-dimmers/{group_key}`
- `POST /api/group-dimmers/{group_key}/mute`
- `GET /api/atmosphere`
- `POST /api/atmosphere/haze`
- `POST /api/atmosphere/fog-flash`

### Settings + lock

- `GET /api/settings`
- `POST /api/settings`
- `GET /api/control-mode`
- `POST /api/control-mode`
- `POST /api/panel-lock`
- `POST /api/unlock`
- `POST /api/pin/change`

### Fixture plan

- `GET /api/fixture-plan`
- `GET /api/fixture-plan/details`
- `POST /api/fixture-plan/preview`
- `POST /api/fixture-plan/activate`
- `DELETE /api/fixture-plan`
- `GET /api/fixture-plan/lookup`

## Persistence

- Scenes are stored as JSON in the configured `scenes_path`.
- Scene order is stored in `_order.json`.
- Runtime settings are stored in `backend/settings.runtime.json`.

## Operational Notes

- Use only one active DMX source at a time.
- Switch to `external` mode when an external desk/controller has priority.
- Keep network adapter selection consistent with your Art-Net and web client paths.

## License

No explicit license yet.
