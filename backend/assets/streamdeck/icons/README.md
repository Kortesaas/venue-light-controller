Drop custom Stream Deck icons here as PNG files.

Filename format:
- `<icon_name>.png`

Examples:
- `scenes.png`
- `levels.png`
- `prev.png`
- `next.png`
- `stop.png`
- `blackout.png`
- `mode.png`
- `active.png`
- `scene_static.png`
- `scene_dynamic.png`
- `master.png`
- `group.png`
- `mute.png`
- `up.png`
- `down.png`
- `full.png`
- `groups.png`
- `back.png`
- `status.png`

Notes:
- Transparent PNG recommended.
- Square assets (128x128 or 144x144) work best.
- Missing icons automatically fall back to built-in placeholders.

Stream Deck Icon Auto-Generator
- You can auto-generate Stream Deck icon assets from the frontend's installed MUI icon package.
- Script: `backend/scripts/generate_streamdeck_scene_icons.py`
- Command:
  - `python backend/scripts/generate_streamdeck_scene_icons.py --overwrite`
- Optional:
  - `--write-svg` to also save intermediate SVG files.
  - `--size 144` (or another size) to change output resolution.
  - `--svg-only` to only export SVG files (no PNG conversion).

Requirements for the generator script
- Frontend dependencies installed (`frontend/node_modules` must exist).
- Python SVG->PNG converter installed (one of):
  - Recommended: `pip install resvg-py`
  - Alternative: `pip install cairosvg`

Generated files include scene style icons and common deck controls, for example:
- `scenes.png`
- `levels.png`
- `back.png`
- `prev.png`
- `next.png`
- `stop.png`
- `blackout.png`
- `master.png`
- `group.png`
- `mute.png`
- `up.png`
- `down.png`
- `full.png`
- `fog.png`
- `haze.png`
- `scene_static.png`
- `scene_dynamic.png`
- `speaker.png`
- `party.png`
- `chill.png`
- `dinner.png`
- `ceremony.png`
- `show.png`
- `technical.png`

Once generated, the Stream Deck service automatically uses these PNGs in scene buttons.
