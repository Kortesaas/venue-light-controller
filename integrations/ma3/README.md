# MA3 Integration Assets

This folder contains MA3 plugin/export assets used to generate and store ParameterList exports.

## Why This Export Is Needed

Without a parameter export, the app only sees raw DMX bytes per universe/channel (a snapshot/replay view).
With the MA3 ParameterList export, the app can map DMX addresses to semantic fixture parameters (for example `Dimmer`, `Pan`, `Tilt`, `ColorRGB_R`) and fixture identities.

That mapping is the foundation for building smarter controls, such as:

- parameter-aware grouping and UI labels
- fixture-type intensity banks
- safer targeted adjustments instead of blind channel edits
- future interpretation logic beyond simple Art-Net screenshot playback

## Current Files In This Repo

- Plugin script:
  - `plugin/ParameterListExportPlugin.lua`
- Example export:
  - `parameter-list-exports/ParameterListExport_MatriX_05_05_2026.xml`

## What The Plugin Script Does

`plugin/ParameterListExportPlugin.lua`:

- creates/uses MA3 library export folder:
  - `...\grandMA3\gma3_library\export\`
- writes the file:
  - `ParameterListExport.xml`
- loops through subfixtures and RT channels
- parses coarse DMX addresses like `1.059`
- exports XML lines in this format:
  - `<Parameter universe="1" number="59" name="Dimmer" fixture="MH 1"/>`

## Example Export Content

`parameter-list-exports/ParameterListExport_MatriX_05_05_2026.xml` currently contains:

- `480` parameter entries
- fixtures such as `MH 1`, `Wash 1`, `Spot 1`, ...
- parameters such as `Dimmer`, `Pan`, `Tilt`, `Shutter1`, `ColorRGB_R`, ...

Example rows:

- `<Parameter universe="1" number="59" name="Dimmer" fixture="MH 1"/>`
- `<Parameter universe="1" number="118" name="ColorRGB_R" fixture="Wash 1"/>`
- `<Parameter universe="1" number="142" name="ColorRGB_R" fixture="Wash 3"/>`

## Recommended Workflow

1. In the target MA3 showfile, create a new plugin, copy/paste the content of `plugin/ParameterListExportPlugin.lua`, then run that plugin.
   - If needed, adjust the export path in the Lua script (`basePath` / `exportDir`) to match your MA3 installation or workflow.
2. In MA3 export folder, take `ParameterListExport.xml`.
3. Copy it into `parameter-list-exports/` and rename with context/date.
4. Keep plugin updates in `plugin/` and exports in `parameter-list-exports/`.
5. Commit both when changing export logic.

## Naming Convention

- Plugin:
  - `ParameterListExportPlugin.lua`
- Export snapshots:
  - `ParameterListExport_<ShowOrVenue>_<DD_MM_YYYY>.xml`
  - example: `ParameterListExport_MatriX_05_05_2026.xml`

## Notes

- This folder is intentionally separate from runtime backend data.
- Runtime app data (scenes/settings) remains managed under `backend/`.
