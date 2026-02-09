import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  Alert,
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Snackbar,
  Slider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";

const API_BASE = "";
const CHANNELS_PER_PAGE = 16;

type Scene = {
  id: string;
  name: string;
  description?: string;
  universes: Record<string, number[]>;
};

type FixturePlanParameter = {
  universe: number;
  channel: number;
  name: string;
  fixture: string;
  role: string;
  ma3_universe: number;
};

type FixturePlanFixture = {
  fixture: string;
  parameters: FixturePlanParameter[];
};

type FixturePlanDetails = {
  active: boolean;
  fixture_count: number;
  parameter_count: number;
  fixtures: FixturePlanFixture[];
};

type EditMode = "silent" | "live";
type ViewMode = "raw" | "fixture";

type SceneDmxEditorDialogProps = {
  open: boolean;
  scene: Scene | null;
  controlMode: "panel" | "external";
  onClose: () => void;
  onSaved: (sceneId: string) => void;
};

type FixtureParameterRow = {
  fixture: string;
  parameter: FixturePlanParameter;
  value: number;
  universeKey: string;
  channelIndex: number;
};

type FixtureRow = {
  fixture: string;
  parameters: FixtureParameterRow[];
};

type ColorComponentKey = "r" | "g" | "b" | "w" | "amber" | "uv";

type FixtureColorChannels = Partial<Record<ColorComponentKey, FixtureParameterRow>>;
type PositionComponentKey = "pan" | "tilt";
type FixturePositionChannels = Partial<Record<PositionComponentKey, FixtureParameterRow>>;

function cloneUniverses(universes: Record<string, number[]>): Record<string, number[]> {
  const next: Record<string, number[]> = {};
  for (const [universe, values] of Object.entries(universes)) {
    next[universe] = [...values];
  }
  return next;
}

function clampDmxValue(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgbToHex(red: number, green: number, blue: number): string {
  const toHex = (value: number) => clampDmxValue(value).toString(16).padStart(2, "0");
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function rgbToHsv(red: number, green: number, blue: number): { h: number; s: number; v: number } {
  const r = clampDmxValue(red) / 255;
  const g = clampDmxValue(green) / 255;
  const b = clampDmxValue(blue) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let hue = 0;
  if (delta > 0) {
    if (max === r) {
      hue = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      hue = 60 * ((b - r) / delta + 2);
    } else {
      hue = 60 * ((r - g) / delta + 4);
    }
  }
  if (hue < 0) {
    hue += 360;
  }

  const saturation = max === 0 ? 0 : (delta / max) * 100;
  const value = max * 100;
  return { h: hue, s: saturation, v: value };
}

function hsvToRgb(hue: number, saturation: number, value: number): [number, number, number] {
  const h = ((hue % 360) + 360) % 360;
  const s = clampPercent(saturation) / 100;
  const v = clampPercent(value) / 100;
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const match = v - chroma;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (h < 60) {
    r1 = chroma;
    g1 = x;
  } else if (h < 120) {
    r1 = x;
    g1 = chroma;
  } else if (h < 180) {
    g1 = chroma;
    b1 = x;
  } else if (h < 240) {
    g1 = x;
    b1 = chroma;
  } else if (h < 300) {
    r1 = x;
    b1 = chroma;
  } else {
    r1 = chroma;
    b1 = x;
  }

  return [
    clampDmxValue((r1 + match) * 255),
    clampDmxValue((g1 + match) * 255),
    clampDmxValue((b1 + match) * 255),
  ];
}

function detectColorComponent(parameterName: string): ColorComponentKey | null {
  const name = parameterName.toUpperCase();

  if (name.includes("AMBER")) {
    return "amber";
  }
  if (name.includes("WHITE") || name.includes("RGB_W") || name.includes("COLORRGB_W")) {
    return "w";
  }
  if (name.includes("UV") || name.includes("ULTRAVIOLET")) {
    return "uv";
  }
  if (name.includes("RGB_R") || name.includes("COLORRGB_R") || name.includes("RED")) {
    return "r";
  }
  if (name.includes("RGB_G") || name.includes("COLORRGB_G") || name.includes("GREEN")) {
    return "g";
  }
  if (name.includes("RGB_B") || name.includes("COLORRGB_B") || name.includes("BLUE")) {
    return "b";
  }
  return null;
}

function getFixtureColorChannels(parameters: FixtureParameterRow[]): FixtureColorChannels {
  const channels: FixtureColorChannels = {};
  for (const parameter of parameters) {
    const component = detectColorComponent(parameter.parameter.name);
    if (!component || channels[component]) {
      continue;
    }
    channels[component] = parameter;
  }
  return channels;
}

function detectPositionComponent(parameterName: string): PositionComponentKey | null {
  const name = parameterName.toUpperCase();
  if (
    name.includes("FINE") ||
    name.includes("SPEED") ||
    name.includes("RATE") ||
    name.includes("MACRO") ||
    name.includes("PROGRAM") ||
    name.includes("CONTROL")
  ) {
    return null;
  }
  if (name.includes("PAN") || name.includes("POSITIONX") || name.includes("POSX")) {
    return "pan";
  }
  if (name.includes("TILT") || name.includes("POSITIONY") || name.includes("POSY")) {
    return "tilt";
  }
  return null;
}

function getFixturePositionChannels(parameters: FixtureParameterRow[]): FixturePositionChannels {
  const channels: FixturePositionChannels = {};
  for (const parameter of parameters) {
    const component = detectPositionComponent(parameter.parameter.name);
    if (!component || channels[component]) {
      continue;
    }
    channels[component] = parameter;
  }
  return channels;
}

async function stopLiveSessionRequest(restorePrevious: boolean): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/scene-editor/live/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restore_previous: restorePrevious }),
    });
    return res.ok;
  } catch {
    // Keep close/unmount resilient.
    return false;
  }
}

export default function SceneDmxEditorDialog({
  open,
  scene,
  controlMode,
  onClose,
  onSaved,
}: SceneDmxEditorDialogProps) {
  const [editMode, setEditMode] = useState<EditMode>("silent");
  const [viewMode, setViewMode] = useState<ViewMode>("raw");
  const [draftUniverses, setDraftUniverses] = useState<Record<string, number[]>>({});
  const [originalUniverses, setOriginalUniverses] = useState<Record<string, number[]>>({});
  const [selectedUniverse, setSelectedUniverse] = useState<string>("");
  const [channelPage, setChannelPage] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isLiveSession, setIsLiveSession] = useState(false);
  const [isLoadingPlan, setIsLoadingPlan] = useState(false);
  const [fixturePlan, setFixturePlan] = useState<FixturePlanDetails | null>(null);
  const [expandedColorFixture, setExpandedColorFixture] = useState<string | null>(null);
  const [expandedPositionFixture, setExpandedPositionFixture] = useState<string | null>(null);
  const [fixtureHueMap, setFixtureHueMap] = useState<Record<string, number>>({});
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const liveDraftRef = useRef<Record<string, number[]>>({});
  const livePushTimerRef = useRef<number | null>(null);
  const isLiveSessionRef = useRef(false);

  const universeKeys = useMemo(
    () => Object.keys(draftUniverses).sort((a, b) => Number(a) - Number(b)),
    [draftUniverses]
  );

  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(draftUniverses) !== JSON.stringify(originalUniverses),
    [draftUniverses, originalUniverses]
  );

  const activeUniverseValues = draftUniverses[selectedUniverse] ?? [];
  const totalPages = Math.max(1, Math.ceil(activeUniverseValues.length / CHANNELS_PER_PAGE));
  const safePage = Math.min(channelPage, totalPages - 1);

  const rawViewChannels = useMemo(() => {
    const start = safePage * CHANNELS_PER_PAGE;
    const endExclusive = Math.min(activeUniverseValues.length, start + CHANNELS_PER_PAGE);
    return Array.from({ length: Math.max(0, endExclusive - start) }, (_, offset) => {
      const index = start + offset;
      return {
        channel: index + 1,
        value: activeUniverseValues[index] ?? 0,
      };
    });
  }, [activeUniverseValues, safePage]);

  const fixtureRows = useMemo<FixtureRow[]>(() => {
    if (!fixturePlan?.active) {
      return [];
    }

    return fixturePlan.fixtures
      .map((fixture) => {
        const parameters = fixture.parameters
          .map((parameter) => {
            const universeKey = String(parameter.universe);
            if (universeKey !== selectedUniverse) {
              return null;
            }
            const values = draftUniverses[universeKey];
            if (!values) {
              return null;
            }
            const index = parameter.channel - 1;
            if (index < 0 || index >= values.length) {
              return null;
            }
            return {
              fixture: fixture.fixture,
              parameter,
              value: values[index],
              universeKey,
              channelIndex: index,
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

        return { fixture: fixture.fixture, parameters };
      })
      .filter((entry) => entry.parameters.length > 0);
  }, [fixturePlan, draftUniverses, selectedUniverse]);

  const selectedUniverseIndex = useMemo(
    () => universeKeys.findIndex((value) => value === selectedUniverse),
    [universeKeys, selectedUniverse]
  );

  const canSelectPreviousUniverse = selectedUniverseIndex > 0;
  const canSelectNextUniverse =
    selectedUniverseIndex >= 0 && selectedUniverseIndex < universeKeys.length - 1;

  const selectUniverseAtIndex = (index: number) => {
    if (index < 0 || index >= universeKeys.length) {
      return;
    }
    setSelectedUniverse(universeKeys[index]);
    setChannelPage(0);
  };

  useEffect(() => {
    isLiveSessionRef.current = isLiveSession;
  }, [isLiveSession]);

  useEffect(() => {
    if (!open || scene === null) {
      return;
    }

    const cloned = cloneUniverses(scene.universes);
    setDraftUniverses(cloned);
    setOriginalUniverses(cloneUniverses(scene.universes));
    liveDraftRef.current = cloned;

    const firstUniverse = Object.keys(cloned).sort((a, b) => Number(a) - Number(b))[0] ?? "0";
    setSelectedUniverse(firstUniverse);
    setChannelPage(0);
    setEditMode("silent");
    setViewMode("raw");
    setIsLiveSession(false);
    isLiveSessionRef.current = false;
    setExpandedColorFixture(null);
    setExpandedPositionFixture(null);
    setFixtureHueMap({});
    setShowDiscardConfirm(false);
    setErrorMessage(null);
    setActionMessage(null);

    const loadFixturePlan = async () => {
      setIsLoadingPlan(true);
      try {
        const res = await fetch(`${API_BASE}/api/fixture-plan/details`);
        if (!res.ok) {
          throw new Error("Fixture plan could not be loaded");
        }
        const data = (await res.json()) as FixturePlanDetails;
        setFixturePlan(data);
        if (data.active) {
          setViewMode("fixture");
        }
      } catch {
        setFixturePlan(null);
      } finally {
        setIsLoadingPlan(false);
      }
    };

    void loadFixturePlan();
  }, [open, scene]);

  useEffect(() => {
    if (!open || selectedUniverse === "" || draftUniverses[selectedUniverse]) {
      return;
    }
    const first = universeKeys[0];
    if (first) {
      setSelectedUniverse(first);
      setChannelPage(0);
    }
  }, [open, selectedUniverse, draftUniverses, universeKeys]);

  useEffect(() => {
    if (!open && isLiveSessionRef.current) {
      void stopLiveSessionRequest(true);
      setIsLiveSession(false);
      setEditMode("silent");
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (livePushTimerRef.current !== null) {
        window.clearTimeout(livePushTimerRef.current);
      }
      if (isLiveSessionRef.current) {
        void stopLiveSessionRequest(true);
      }
    };
  }, []);

  const stopLiveSession = async (restorePrevious: boolean) => {
    if (!isLiveSessionRef.current) {
      return;
    }
    const stopped = await stopLiveSessionRequest(restorePrevious);
    if (!stopped) {
      setErrorMessage("Live Edit stop could not be confirmed. Please retry.");
      return;
    }
    setIsLiveSession(false);
    setEditMode("silent");
    isLiveSessionRef.current = false;
  };

  const startLiveSession = async () => {
    if (!scene) {
      return false;
    }
    if (controlMode !== "panel") {
      setErrorMessage("Live Edit is only available in panel mode.");
      return false;
    }

    const startRequest = () =>
      fetch(`${API_BASE}/api/scene-editor/live/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scene_id: scene.id,
          universes: draftUniverses,
        }),
      });

    try {
      let res = await startRequest();

      // Recover from stale/conflicting sessions: stop once, then retry start once.
      if (res.status === 409) {
        await stopLiveSessionRequest(true);
        res = await startRequest();
      }

      if (!res.ok) {
        throw new Error("Live session could not be started");
      }
      setIsLiveSession(true);
      isLiveSessionRef.current = true;
      setEditMode("live");
      setActionMessage("Live Edit enabled.");
      return true;
    } catch {
      setIsLiveSession(false);
      isLiveSessionRef.current = false;
      setEditMode("silent");
      setErrorMessage("Live Edit could not be started. If another editor is active, close it and retry.");
      return false;
    }
  };

  const pushLiveUpdate = (universes: Record<string, number[]>) => {
    liveDraftRef.current = universes;
    if (!isLiveSessionRef.current || editMode !== "live") {
      return;
    }
    if (livePushTimerRef.current !== null) {
      return;
    }

    livePushTimerRef.current = window.setTimeout(async () => {
      livePushTimerRef.current = null;
      try {
        const res = await fetch(`${API_BASE}/api/scene-editor/live/update`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ universes: liveDraftRef.current }),
        });
        if (!res.ok) {
          if (res.status === 409) {
            setIsLiveSession(false);
            isLiveSessionRef.current = false;
            setEditMode("silent");
            setErrorMessage("Live Edit session was lost. Switched back to Silent Edit.");
            return;
          }
          throw new Error("live update failed");
        }
      } catch {
        setErrorMessage("Live update failed.");
      }
    }, 70);
  };

  const applyChannelUpdates = (
    updates: Array<{ universeKey: string; channelIndex: number; value: number }>
  ) => {
    setDraftUniverses((prev) => {
      if (updates.length === 0) {
        return prev;
      }

      const next = { ...prev };
      const touchedUniverses = new Set<string>();
      let hasChanges = false;

      for (const update of updates) {
        const values = next[update.universeKey];
        if (!values) {
          continue;
        }
        if (update.channelIndex < 0 || update.channelIndex >= values.length) {
          continue;
        }

        if (!touchedUniverses.has(update.universeKey)) {
          next[update.universeKey] = [...values];
          touchedUniverses.add(update.universeKey);
        }

        const clamped = clampDmxValue(update.value);
        if (next[update.universeKey][update.channelIndex] === clamped) {
          continue;
        }
        next[update.universeKey][update.channelIndex] = clamped;
        hasChanges = true;
      }

      if (!hasChanges) {
        return prev;
      }

      pushLiveUpdate(next);
      return next;
    });
  };

  const setChannelValue = (universeKey: string, channelIndex: number, value: number) => {
    applyChannelUpdates([{ universeKey, channelIndex, value }]);
  };

  const getFixtureHsv = (fixtureKey: string, channels: FixtureColorChannels) => {
    if (!channels.r || !channels.g || !channels.b) {
      return { h: 0, s: 0, v: 0 };
    }

    const hsv = rgbToHsv(channels.r.value, channels.g.value, channels.b.value);
    const resolvedHue = hsv.s > 0.5 ? hsv.h : (fixtureHueMap[fixtureKey] ?? hsv.h);
    return { h: resolvedHue, s: hsv.s, v: hsv.v };
  };

  const setFixtureHsvColor = (
    fixtureKey: string,
    channels: FixtureColorChannels,
    hue: number,
    saturation: number,
    value: number
  ) => {
    if (!channels.r || !channels.g || !channels.b) {
      return;
    }

    const normalizedHue = ((hue % 360) + 360) % 360;
    const [red, green, blue] = hsvToRgb(normalizedHue, saturation, value);
    setFixtureHueMap((prev) => ({ ...prev, [fixtureKey]: normalizedHue }));
    applyChannelUpdates([
      { universeKey: channels.r.universeKey, channelIndex: channels.r.channelIndex, value: red },
      { universeKey: channels.g.universeKey, channelIndex: channels.g.channelIndex, value: green },
      { universeKey: channels.b.universeKey, channelIndex: channels.b.channelIndex, value: blue },
    ]);
  };

  const updateFixtureFromPad = (
    event: ReactPointerEvent<HTMLDivElement>,
    fixtureKey: string,
    channels: FixtureColorChannels,
    hue: number
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    const saturation = (x / rect.width) * 100;
    const value = 100 - (y / rect.height) * 100;
    setFixtureHsvColor(fixtureKey, channels, hue, saturation, value);
  };

  const setFixturePosition = (
    channels: FixturePositionChannels,
    panValue: number,
    tiltValue: number
  ) => {
    const updates: Array<{ universeKey: string; channelIndex: number; value: number }> = [];
    if (channels.pan) {
      updates.push({
        universeKey: channels.pan.universeKey,
        channelIndex: channels.pan.channelIndex,
        value: panValue,
      });
    }
    if (channels.tilt) {
      updates.push({
        universeKey: channels.tilt.universeKey,
        channelIndex: channels.tilt.channelIndex,
        value: tiltValue,
      });
    }
    applyChannelUpdates(updates);
  };

  const updateFixturePositionPad = (
    event: ReactPointerEvent<HTMLDivElement>,
    channels: FixturePositionChannels
  ) => {
    if (!channels.pan || !channels.tilt) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    const pan = ((rect.width - x) / rect.width) * 255;
    const tilt = ((rect.height - y) / rect.height) * 255;
    setFixturePosition(channels, pan, tilt);
  };

  const handleEditModeChange = async (_event: React.MouseEvent<HTMLElement>, next: EditMode | null) => {
    if (!next || next === editMode) {
      return;
    }
    setErrorMessage(null);
    setActionMessage(null);

    if (next === "live") {
      await startLiveSession();
      return;
    }

    await stopLiveSession(true);
    setActionMessage("Silent Edit enabled.");
  };

  const handleAttemptClose = async () => {
    if (hasUnsavedChanges) {
      setShowDiscardConfirm(true);
      return;
    }
    await stopLiveSession(true);
    onClose();
  };

  const handleDiscardConfirmed = async () => {
    setShowDiscardConfirm(false);
    await stopLiveSession(true);
    onClose();
  };

  const handleSave = async () => {
    if (!scene) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setActionMessage(null);

    try {
      const res = await fetch(`${API_BASE}/api/scenes/${scene.id}/content`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ universes: draftUniverses }),
      });
      if (!res.ok) {
        throw new Error("Save failed");
      }

      await stopLiveSession(true);
      onSaved(scene.id);
      onClose();
    } catch {
      setErrorMessage("Changes could not be saved.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!scene) {
    return null;
  }

  return (
    <Dialog fullScreen open={open} onClose={() => void handleAttemptClose()}>
      <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
          <Box>
            <Typography variant="h5" fontWeight={800}>
              DMX Editor
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {scene.name}
            </Typography>
          </Box>
          <Button variant="outlined" onClick={() => void handleAttemptClose()}>
            Close
          </Button>
        </Stack>
      </Box>

      <Box sx={{ p: 2, pb: 13, overflowY: "auto" }}>
        <Stack spacing={2}>
          <Paper
            variant="outlined"
            sx={{
              position: "sticky",
              top: -8,
              zIndex: 3,
              p: 0.75,
              bgcolor: "background.default",
            }}
          >
            <ToggleButtonGroup
              exclusive
              value={editMode}
              onChange={handleEditModeChange}
              fullWidth
              color="primary"
            >
              <ToggleButton value="silent">Silent Edit</ToggleButton>
              <ToggleButton value="live" disabled={controlMode !== "panel"}>
                Live Edit
              </ToggleButton>
            </ToggleButtonGroup>
          </Paper>

          {editMode === "silent" ? (
            <Alert severity="info">Silent - fixtures will not react while editing.</Alert>
          ) : (
            <Alert severity="warning">Live - changes are live on the rig.</Alert>
          )}

          {fixturePlan?.active ? (
            <ToggleButtonGroup
              exclusive
              value={viewMode}
              onChange={(_event, next: ViewMode | null) => {
                if (next) {
                  setViewMode(next);
                }
              }}
              fullWidth
              color="primary"
            >
              <ToggleButton value="fixture">Fixture View</ToggleButton>
              <ToggleButton value="raw">Raw View</ToggleButton>
            </ToggleButtonGroup>
          ) : null}

          {isLoadingPlan ? <Typography variant="body2">Loading fixture plan...</Typography> : null}

          {universeKeys.length > 0 ? (
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
              <Button
                variant="outlined"
                onClick={() => selectUniverseAtIndex(selectedUniverseIndex - 1)}
                disabled={!canSelectPreviousUniverse}
              >
                Previous Universe
              </Button>
              <Typography variant="body2" fontWeight={700}>
                {`Universe ${Number(selectedUniverse) + 1}`}
              </Typography>
              <Button
                variant="outlined"
                onClick={() => selectUniverseAtIndex(selectedUniverseIndex + 1)}
                disabled={!canSelectNextUniverse}
              >
                Next Universe
              </Button>
            </Stack>
          ) : null}

          {viewMode === "raw" || !fixturePlan?.active ? (
            <Stack spacing={1.25}>
              <Typography variant="subtitle1" fontWeight={700}>
                Raw DMX
              </Typography>

              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Button
                  variant="outlined"
                  onClick={() => setChannelPage((prev) => Math.max(0, prev - 1))}
                  disabled={safePage <= 0}
                >
                  Prev
                </Button>
                <Typography variant="body2" color="text.secondary">
                  {`Channels ${safePage * CHANNELS_PER_PAGE + 1} - ${Math.min(
                    activeUniverseValues.length,
                    safePage * CHANNELS_PER_PAGE + CHANNELS_PER_PAGE
                  )}`}
                </Typography>
                <Button
                  variant="outlined"
                  onClick={() => setChannelPage((prev) => Math.min(totalPages - 1, prev + 1))}
                  disabled={safePage >= totalPages - 1}
                >
                  Next
                </Button>
              </Stack>

              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(62px, 1fr))",
                  gap: 0.9,
                }}
              >
                {rawViewChannels.map((entry) => (
                  <Paper
                    key={entry.channel}
                    variant="outlined"
                    sx={{
                      px: 0.6,
                      py: 0.75,
                      minHeight: 148,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <Typography variant="caption" fontWeight={700}>
                      {`Ch ${entry.channel}`}
                    </Typography>
                    <Slider
                      orientation="vertical"
                      value={entry.value}
                      min={0}
                      max={255}
                      step={1}
                      valueLabelDisplay="off"
                      onChange={(_event, value) =>
                        setChannelValue(
                          selectedUniverse,
                          entry.channel - 1,
                          Array.isArray(value) ? value[0] : value
                        )
                      }
                      sx={{
                        height: 92,
                        my: 0.5,
                        "& .MuiSlider-thumb": {
                          width: 0,
                          height: 0,
                          opacity: 0,
                          boxShadow: "none",
                        },
                      }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {entry.value}
                    </Typography>
                  </Paper>
                ))}
              </Box>
            </Stack>
          ) : (
            <Stack spacing={1.25}>
              <Typography variant="subtitle1" fontWeight={700}>
                Fixture View
              </Typography>
              {fixtureRows.length === 0 ? (
                <Alert severity="info">
                  No matching fixture parameters were found for this scene. You can switch to Raw
                  View.
                </Alert>
              ) : null}
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "1fr",
                    sm: "repeat(auto-fit, minmax(320px, 1fr))",
                  },
                  gap: 1.25,
                }}
              >
                {fixtureRows.map((fixture) => {
                  const channels = getFixtureColorChannels(fixture.parameters);
                  const positionChannels = getFixturePositionChannels(fixture.parameters);
                  const hasRgb = Boolean(channels.r && channels.g && channels.b);
                  const hasPanTilt = Boolean(positionChannels.pan && positionChannels.tilt);
                  const fixtureColorKey = `${selectedUniverse}:${fixture.fixture}`;
                  const isColorOpen = expandedColorFixture === fixtureColorKey;
                  const isPositionOpen = expandedPositionFixture === fixtureColorKey;
                  const currentHsv = getFixtureHsv(fixtureColorKey, channels);
                  const currentHex = hasRgb
                    ? rgbToHex(channels.r?.value ?? 0, channels.g?.value ?? 0, channels.b?.value ?? 0)
                    : "#000000";
                  const presetHues = [0, 25, 45, 90, 145, 190, 230, 275, 320];
                  const currentPan = positionChannels.pan?.value ?? 0;
                  const currentTilt = positionChannels.tilt?.value ?? 0;

                  return (
                    <Paper key={fixture.fixture} variant="outlined" sx={{ p: 1.25 }}>
                      <Stack spacing={1}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Typography variant="subtitle2" fontWeight={700}>
                            {fixture.fixture}
                          </Typography>
                          <Stack direction="row" spacing={0.6}>
                            {hasPanTilt ? (
                              <Button
                                size="small"
                                variant={isPositionOpen ? "contained" : "outlined"}
                                onClick={() =>
                                  setExpandedPositionFixture((prev) =>
                                    prev === fixtureColorKey ? null : fixtureColorKey
                                  )
                                }
                              >
                                {isPositionOpen ? "Hide Position" : "Open Position"}
                              </Button>
                            ) : null}
                            {hasRgb ? (
                              <Button
                                size="small"
                                variant={isColorOpen ? "contained" : "outlined"}
                                onClick={() =>
                                  setExpandedColorFixture((prev) =>
                                    prev === fixtureColorKey ? null : fixtureColorKey
                                  )
                                }
                              >
                                {isColorOpen ? "Hide Color" : "Open Color"}
                              </Button>
                            ) : null}
                          </Stack>
                        </Stack>

                        {hasRgb ? (
                          <Collapse in={isColorOpen}>
                            <Paper
                              variant="outlined"
                              sx={{
                                px: 1,
                                py: 1,
                                bgcolor: "rgba(255,255,255,0.04)",
                                borderColor: "rgba(255,255,255,0.16)",
                              }}
                            >
                              <Stack spacing={1.25}>
                                <Stack direction="row" alignItems="center" spacing={1.1}>
                                  <Box
                                    sx={{
                                      width: 26,
                                      height: 26,
                                      borderRadius: 0.8,
                                      border: "1px solid",
                                      borderColor: "divider",
                                      bgcolor: currentHex,
                                      flexShrink: 0,
                                    }}
                                  />
                                  <Typography variant="body2" fontWeight={700}>
                                    Fixture Color
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                                    {currentHex.toUpperCase()}
                                  </Typography>
                                </Stack>

                                <Box
                                  sx={{
                                    position: "relative",
                                    width: "100%",
                                    height: 156,
                                    borderRadius: 1.1,
                                    border: "1px solid",
                                    borderColor: "divider",
                                    overflow: "hidden",
                                    touchAction: "none",
                                    backgroundClip: "padding-box",
                                    backgroundColor: `hsl(${currentHsv.h}, 100%, 50%)`,
                                    backgroundImage:
                                      "linear-gradient(to right, #ffffff, rgba(255,255,255,0)), linear-gradient(to top, #000000, rgba(0,0,0,0))",
                                  }}
                                  onPointerDown={(event) => {
                                    event.preventDefault();
                                    event.currentTarget.setPointerCapture(event.pointerId);
                                    updateFixtureFromPad(event, fixtureColorKey, channels, currentHsv.h);
                                  }}
                                  onPointerMove={(event) => {
                                    if (event.buttons === 0 && event.pointerType !== "touch") {
                                      return;
                                    }
                                    updateFixtureFromPad(event, fixtureColorKey, channels, currentHsv.h);
                                  }}
                                >
                                  <Box
                                    sx={{
                                      position: "absolute",
                                      left: `${currentHsv.s}%`,
                                      top: `${100 - currentHsv.v}%`,
                                      width: 18,
                                      height: 18,
                                      borderRadius: "50%",
                                      border: "2px solid #fff",
                                      boxShadow: "0 0 0 1px rgba(0,0,0,0.45)",
                                      transform: "translate(-50%, -50%)",
                                      pointerEvents: "none",
                                    }}
                                  />
                                </Box>

                                <Box sx={{ px: 0.25 }}>
                                  <Typography variant="caption" color="text.secondary">
                                    Hue
                                  </Typography>
                                  <Slider
                                    value={currentHsv.h}
                                    min={0}
                                    max={359}
                                    step={1}
                                    valueLabelDisplay="off"
                                    onChange={(_event, value) => {
                                      const nextHue = Array.isArray(value) ? value[0] : value;
                                      setFixtureHsvColor(
                                        fixtureColorKey,
                                        channels,
                                        nextHue,
                                        currentHsv.s,
                                        currentHsv.v
                                      );
                                    }}
                                    sx={{
                                      mt: 0.4,
                                      py: 0.7,
                                      "& .MuiSlider-rail": {
                                        opacity: 1,
                                        background:
                                          "linear-gradient(90deg,#ff0000 0%,#ffff00 17%,#00ff00 33%,#00ffff 50%,#0000ff 67%,#ff00ff 83%,#ff0000 100%)",
                                      },
                                      "& .MuiSlider-track": { backgroundColor: "transparent", border: 0 },
                                      "& .MuiSlider-thumb": {
                                        width: 0,
                                        height: 0,
                                        opacity: 0,
                                        boxShadow: "none",
                                      },
                                    }}
                                  />
                                </Box>

                                <Stack direction="row" spacing={0.6} flexWrap="wrap">
                                  {presetHues.map((presetHue) => (
                                    <Box
                                      key={`${fixtureColorKey}-preset-${presetHue}`}
                                      role="button"
                                      onClick={() =>
                                        setFixtureHsvColor(
                                          fixtureColorKey,
                                          channels,
                                          presetHue,
                                          Math.max(currentHsv.s, 70),
                                          Math.max(currentHsv.v, 85)
                                        )
                                      }
                                      sx={{
                                        width: 24,
                                        height: 24,
                                        borderRadius: 0.8,
                                        border: "1px solid",
                                        borderColor: "divider",
                                        bgcolor: `hsl(${presetHue}, 100%, 50%)`,
                                        cursor: "pointer",
                                        touchAction: "manipulation",
                                      }}
                                    />
                                  ))}
                                </Stack>

                                {(Object.entries({
                                  w: channels.w,
                                  amber: channels.amber,
                                  uv: channels.uv,
                                }) as Array<[ColorComponentKey, FixtureParameterRow | undefined]>)
                                  .filter(([, channel]) => channel)
                                  .map(([component, channel]) => (
                                    <Box
                                      key={`${fixture.fixture}-${component}`}
                                    >
                                      <Stack direction="row" justifyContent="space-between">
                                        <Typography variant="caption" fontWeight={700}>
                                          {component === "w"
                                            ? "White"
                                            : component === "amber"
                                              ? "Amber"
                                              : "UV"}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                          {channel?.value ?? 0}
                                        </Typography>
                                      </Stack>
                                      <Slider
                                        value={channel?.value ?? 0}
                                        min={0}
                                        max={255}
                                        step={1}
                                        valueLabelDisplay="off"
                                        onChange={(_event, value) =>
                                          setChannelValue(
                                            channel?.universeKey ?? selectedUniverse,
                                            channel?.channelIndex ?? 0,
                                            Array.isArray(value) ? value[0] : value
                                          )
                                        }
                                        sx={{
                                          py: 0.7,
                                          "& .MuiSlider-thumb": {
                                            width: 0,
                                            height: 0,
                                            opacity: 0,
                                            boxShadow: "none",
                                          },
                                        }}
                                      />
                                    </Box>
                                  ))}
                              </Stack>
                            </Paper>
                          </Collapse>
                        ) : null}

                        {hasPanTilt ? (
                          <Collapse in={isPositionOpen}>
                            <Paper
                              variant="outlined"
                              sx={{
                                px: 1,
                                py: 1,
                                bgcolor: "rgba(255,255,255,0.04)",
                                borderColor: "rgba(255,255,255,0.16)",
                              }}
                            >
                              <Stack spacing={1.2}>
                                <Stack direction="row" alignItems="center" spacing={1.1}>
                                  <Typography variant="body2" fontWeight={700}>
                                    Fixture Position
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                                    {`Pan ${currentPan} • Tilt ${currentTilt}`}
                                  </Typography>
                                </Stack>

                                <Box
                                  sx={{
                                    position: "relative",
                                    width: "100%",
                                    height: 170,
                                    borderRadius: 1.1,
                                    border: "1px solid",
                                    borderColor: "divider",
                                    overflow: "hidden",
                                    touchAction: "none",
                                    backgroundClip: "padding-box",
                                    backgroundColor: "rgba(255,255,255,0.02)",
                                    backgroundImage:
                                      "linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(to top, rgba(255,255,255,0.08) 1px, transparent 1px)",
                                    backgroundSize: "24px 24px",
                                  }}
                                  onPointerDown={(event) => {
                                    event.preventDefault();
                                    event.currentTarget.setPointerCapture(event.pointerId);
                                    updateFixturePositionPad(event, positionChannels);
                                  }}
                                  onPointerMove={(event) => {
                                    if (event.buttons === 0 && event.pointerType !== "touch") {
                                      return;
                                    }
                                    updateFixturePositionPad(event, positionChannels);
                                  }}
                                >
                                  <Box
                                    sx={{
                                      position: "absolute",
                                      left: `${100 - (currentPan / 255) * 100}%`,
                                      top: `${100 - (currentTilt / 255) * 100}%`,
                                      width: 18,
                                      height: 18,
                                      borderRadius: "50%",
                                      border: "2px solid #fff",
                                      bgcolor: "rgba(255,255,255,0.2)",
                                      boxShadow: "0 0 0 1px rgba(0,0,0,0.45)",
                                      transform: "translate(-50%, -50%)",
                                      pointerEvents: "none",
                                    }}
                                  />
                                  <Box
                                    sx={{
                                      position: "absolute",
                                      left: "50%",
                                      top: "50%",
                                      width: 8,
                                      height: 8,
                                      borderRadius: "50%",
                                      bgcolor: "rgba(255,255,255,0.35)",
                                      transform: "translate(-50%, -50%)",
                                      pointerEvents: "none",
                                    }}
                                  />
                                </Box>

                                <Stack direction="row" spacing={0.8}>
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={() => setFixturePosition(positionChannels, 128, 128)}
                                  >
                                    Center
                                  </Button>
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={() => setFixturePosition(positionChannels, currentPan, 255)}
                                  >
                                    Tilt Up
                                  </Button>
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={() => setFixturePosition(positionChannels, currentPan, 0)}
                                  >
                                    Tilt Down
                                  </Button>
                                </Stack>
                              </Stack>
                            </Paper>
                          </Collapse>
                        ) : null}

                        {fixture.parameters.map((entry) => (
                          <Box key={`${entry.parameter.universe}:${entry.parameter.channel}:${entry.parameter.name}`}>
                            <Stack direction="row" justifyContent="space-between">
                              <Typography variant="body2" fontWeight={600}>
                                {entry.parameter.name}
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                {entry.value}
                              </Typography>
                            </Stack>
                            <Slider
                              value={entry.value}
                              min={0}
                              max={255}
                              step={1}
                              valueLabelDisplay="auto"
                              onChange={(_event, value) =>
                                setChannelValue(
                                  entry.universeKey,
                                  entry.channelIndex,
                                  Array.isArray(value) ? value[0] : value
                                )
                              }
                              sx={{
                                py: 1,
                                width: { xs: "100%", sm: "86%" },
                                mx: { xs: 0, sm: "auto" },
                                "& .MuiSlider-thumb": {
                                  width: 0,
                                  height: 0,
                                  opacity: 0,
                                  boxShadow: "none",
                                },
                              }}
                            />
                          </Box>
                        ))}
                      </Stack>
                    </Paper>
                  );
                })}
              </Box>
            </Stack>
          )}

        </Stack>
      </Box>

      <Snackbar
        open={Boolean(errorMessage || actionMessage)}
        autoHideDuration={2200}
        onClose={() => {
          setErrorMessage(null);
          setActionMessage(null);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        sx={{
          zIndex: (theme) => theme.zIndex.tooltip + 100,
          bottom: { xs: 86, sm: 92 },
        }}
      >
        <Alert
          severity={errorMessage ? "error" : "success"}
          onClose={() => {
            setErrorMessage(null);
            setActionMessage(null);
          }}
        >
          {errorMessage ?? actionMessage ?? ""}
        </Alert>
      </Snackbar>

      <Paper
        variant="outlined"
        sx={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          p: 1.5,
          borderRadius: 0,
          borderLeft: 0,
          borderRight: 0,
          borderBottom: 0,
        }}
      >
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <Button
            variant="outlined"
            color="inherit"
            onClick={() => void handleAttemptClose()}
            disabled={isSaving}
            fullWidth
          >
            Discard / Cancel
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={!hasUnsavedChanges || isSaving} fullWidth>
            Save changes
          </Button>
        </Stack>
      </Paper>

      <Dialog open={showDiscardConfirm} onClose={() => setShowDiscardConfirm(false)}>
        <DialogTitle>Unsaved changes</DialogTitle>
        <DialogContent>
          <DialogContentText>
            You have unsaved changes. Close and discard them?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDiscardConfirm(false)}>Keep editing</Button>
          <Button color="error" variant="contained" onClick={() => void handleDiscardConfirmed()}>
            Discard
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}

