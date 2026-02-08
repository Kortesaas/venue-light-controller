# MatriX Saal Lichtszenen

Touch-optimierte Lichtsteuerungs-App für feste Venue-Installationen, mit klarem Fokus auf das Speichern und Abrufen von Art-Net-Szenen.
Die Szenen werden im Vorfeld mit beliebigen Art-Net-fähigen Lichtsteuerungssystemen (z. B. MA-Systemen) erstellt und als Art-Net-Daten aufgezeichnet.

Die App ermöglicht das sichere, reproduzierbare Abrufen dieser gespeicherten Art-Net-Szenen über ein intuitives Operator-Panel, ohne dass tiefgehende Kenntnisse eines Lichtpults erforderlich sind.

## Features

- Art-Net Snapshot-Recording (mehrere Universen)
- Stabiler Art-Net Stream mit konstantem Node-Polling
- Szenenverwaltung (anlegen, umbenennen, beschreiben, löschen, sortieren)
- Blackout und Stop aus dem Operator-Panel
- Control-Mode gegen Konflikte:
  - `panel`: App darf senden
  - `external`: MA/externe Quelle hat Vorrang, Panel ist gesperrt
- Live-Synchronisation zwischen Clients via SSE (`/api/events`)
- Runtime-Settings (persistiert):
  - `node_ip`
  - `dmx_fps`
  - `poll_interval`
  - `universe_count`

## Projektstruktur

```text
venue-light-controller/
|- backend/
|  |- main.py
|  `- src/lighting/
|     |- api.py
|     |- artnet_core.py
|     |- config.py
|     `- scenes.py
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
- Frontend: React + TypeScript (Vite), MUI
- Transport: Art-Net (UDP)
- Realtime UI Sync: Server-Sent Events (SSE)

## Voraussetzungen

- Python 3.10+
- Node.js 18+
- Netzwerkzugang ins Art-Net Segment (typisch `2.x.x.x`)

## Lokale Entwicklung

### Backend starten

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python main.py
```

Backend erreichbar unter `http://localhost:8000`.

### Frontend starten

```powershell
cd frontend
npm install
npm run dev
```

Frontend Dev-URL: `http://localhost:5173`.

## Production / Venue-Modus

Schnellstart aus dem Projekt-Root:

```powershell
.\build_and_run.ps1
```

Das Script baut das Frontend und startet anschließend das Backend, sodass UI und API direkt verfügbar sind.

1. Frontend bauen:

```powershell
cd frontend
npm run build
```

2. Build nach `backend/frontend_dist` kopieren.
3. Backend starten (`python main.py`).
4. UI + API laufen dann gemeinsam über `http://localhost:8000`.

## Bedienlogik

### Operator

- Große Szenen-Buttons
- Aktive Szene sichtbar markiert
- `Blackout` und `Stop`
- Bei `MODE: MA` (external) sind Play- und Blackout-Aktionen gesperrt

### Admin

- Szenen aufnehmen
- Szenen umbenennen + Beschreibung pflegen
- Szenen löschen (mit Bestätigungsdialog)
- Reihenfolge der Szenen verändern
- System Settings:
  - `local_ip` (read-only)
  - `node_ip`
  - `dmx_fps`
  - `poll_interval`
  - `universe_count`

Hinweis zu `universe_count`:  
Wenn z. B. `2` gesetzt ist, werden bei einer Aufnahme automatisch `Universe 1` und `Universe 2` erfasst.

## API Überblick

### Status und Realtime

- `GET /api/status`
- `GET /api/events`

### Szenen

- `GET /api/scenes`
- `GET /api/scenes/{scene_id}`
- `POST /api/scenes/record`
- `PUT /api/scenes/{scene_id}`
- `DELETE /api/scenes/{scene_id}`
- `POST /api/scenes/reorder`
- `POST /api/scenes/{scene_id}/play`

### Playback

- `POST /api/blackout`
- `POST /api/stop`

### Settings

- `GET /api/settings`
- `POST /api/settings`

### Control Mode

- `GET /api/control-mode`
- `POST /api/control-mode`

## Persistenz

- Szenen liegen als JSON-Dateien im konfigurierten `scenes_path`.
- Szenenreihenfolge wird in `_order.json` gespeichert.
- Runtime-Settings werden in `backend/settings.runtime.json` gespeichert und beim Start geladen.

## Sicherheit / Betriebshinweise

- Immer nur **eine** aktive DMX-Quelle verwenden.
- Bei parallel laufender MA-Steuerung auf `external` schalten.

## Lizenz

Aktuell ohne explizite Lizenz.
