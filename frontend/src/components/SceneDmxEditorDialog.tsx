import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
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

function cloneUniverses(universes: Record<string, number[]>): Record<string, number[]> {
  const next: Record<string, number[]> = {};
  for (const [universe, values] of Object.entries(universes)) {
    next[universe] = [...values];
  }
  return next;
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

  const fixtureRows = useMemo(() => {
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

  const setChannelValue = (universeKey: string, channelIndex: number, value: number) => {
    setDraftUniverses((prev) => {
      const values = prev[universeKey];
      if (!values || channelIndex < 0 || channelIndex >= values.length) {
        return prev;
      }

      const nextUniverse = [...values];
      nextUniverse[channelIndex] = Math.max(0, Math.min(255, Math.round(value)));
      const next = { ...prev, [universeKey]: nextUniverse };
      pushLiveUpdate(next);
      return next;
    });
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
              {fixtureRows.map((fixture) => (
                <Paper key={fixture.fixture} variant="outlined" sx={{ p: 1.25 }}>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                    {fixture.fixture}
                  </Typography>
                  <Stack spacing={1}>
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
              ))}
            </Stack>
          )}

          {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
          {actionMessage ? <Alert severity="success">{actionMessage}</Alert> : null}
        </Stack>
      </Box>

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
