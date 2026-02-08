import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemSecondaryAction,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import ArrowUpwardRoundedIcon from "@mui/icons-material/ArrowUpwardRounded";
import ArrowDownwardRoundedIcon from "@mui/icons-material/ArrowDownwardRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";

const API_BASE = "";

type Scene = {
  id: string;
  name: string;
  universes: Record<string, number[]>;
};

type SceneFormState = {
  name: string;
  universe: number;
  duration: number;
};

const initialFormState: SceneFormState = {
  name: "",
  universe: 0,
  duration: 1,
};

type AdminPanelProps = {
  sceneVersion: number;
  controlMode: "panel" | "external";
  onControlModeChange: (mode: "panel" | "external") => void;
};

type SettingsState = {
  local_ip: string;
  node_ip: string;
  dmx_fps: number;
  poll_interval: number;
};

const FPS_OPTIONS = [15, 24, 30, 40, 44, 60];
const IPV4_REGEX =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

function formatUniverses(universes: Record<string, number[]>) {
  return Object.keys(universes ?? {})
    .sort((a, b) => Number(a) - Number(b))
    .map((value) => `U${value}`)
    .join(", ");
}

export default function AdminPanel({
  sceneVersion,
  controlMode,
  onControlModeChange,
}: AdminPanelProps) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isLoadingScenes, setIsLoadingScenes] = useState(true);
  const [isPerformingAction, setIsPerformingAction] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [renameSceneId, setRenameSceneId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [form, setForm] = useState<SceneFormState>(initialFormState);
  const [settingsForm, setSettingsForm] = useState<SettingsState>({
    local_ip: "",
    node_ip: "",
    dmx_fps: 30,
    poll_interval: 5,
  });
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isApplyingSettings, setIsApplyingSettings] = useState(false);

  const loadScenes = async () => {
    setIsLoadingScenes(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`${API_BASE}/api/scenes`);
      if (!res.ok) {
        throw new Error("Failed to load scenes");
      }
      const data = (await res.json()) as Scene[];
      setScenes(data);
    } catch {
      setErrorMessage("Szenen konnten nicht geladen werden.");
    } finally {
      setIsLoadingScenes(false);
    }
  };

  useEffect(() => {
    void loadScenes();
  }, [sceneVersion]);

  useEffect(() => {
    const loadSettings = async () => {
      setIsLoadingSettings(true);
      try {
        const res = await fetch(`${API_BASE}/api/settings`);
        if (!res.ok) {
          throw new Error("Failed to load settings");
        }
        const data = (await res.json()) as SettingsState;
        setSettingsForm(data);
      } catch {
        setErrorMessage("Settings konnten nicht geladen werden.");
      } finally {
        setIsLoadingSettings(false);
      }
    };
    void loadSettings();
  }, []);

  const handlePlay = async (sceneId: string) => {
    setIsPerformingAction(true);
    setErrorMessage(null);
    setActionMessage(null);

    try {
      const res = await fetch(`${API_BASE}/api/scenes/${sceneId}/play`, {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error("Failed to play scene");
      }
      setActionMessage("Szene gesendet.");
    } catch {
      setErrorMessage("Szene konnte nicht gestartet werden.");
    } finally {
      setIsPerformingAction(false);
    }
  };

  const handleDelete = async (sceneId: string) => {
    setIsPerformingAction(true);
    setErrorMessage(null);
    setActionMessage(null);

    try {
      const res = await fetch(`${API_BASE}/api/scenes/${sceneId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error("Failed to delete scene");
      }
      if (renameSceneId === sceneId) {
        setRenameSceneId(null);
        setRenameName("");
      }
      setActionMessage("Szene geloescht.");
      await loadScenes();
    } catch {
      setErrorMessage("Szene konnte nicht geloescht werden.");
    } finally {
      setIsPerformingAction(false);
    }
  };

  const handleReorder = async (sceneId: string, direction: "up" | "down") => {
    const currentIndex = scenes.findIndex((scene) => scene.id === sceneId);
    if (currentIndex < 0) {
      return;
    }

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= scenes.length) {
      return;
    }

    const nextScenes = [...scenes];
    const [moved] = nextScenes.splice(currentIndex, 1);
    nextScenes.splice(targetIndex, 0, moved);

    setScenes(nextScenes);
    setIsPerformingAction(true);
    setErrorMessage(null);
    setActionMessage(null);

    try {
      const res = await fetch(`${API_BASE}/api/scenes/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scene_ids: nextScenes.map((scene) => scene.id) }),
      });
      if (!res.ok) {
        throw new Error("Failed to reorder scenes");
      }
      setActionMessage("Reihenfolge gespeichert.");
    } catch {
      setErrorMessage("Reihenfolge konnte nicht gespeichert werden.");
      await loadScenes();
    } finally {
      setIsPerformingAction(false);
    }
  };

  const handleSaveRename = async (sceneId: string) => {
    if (!renameName.trim()) {
      return;
    }

    setIsPerformingAction(true);
    setErrorMessage(null);
    setActionMessage(null);

    try {
      const res = await fetch(`${API_BASE}/api/scenes/${sceneId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: renameName.trim(),
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to update scene");
      }

      setRenameSceneId(null);
      setRenameName("");
      setActionMessage("Szene aktualisiert.");
      await loadScenes();
    } catch {
      setErrorMessage("Szene konnte nicht aktualisiert werden.");
    } finally {
      setIsPerformingAction(false);
    }
  };

  const handleFormChange = <K extends keyof SceneFormState>(
    key: K,
    value: SceneFormState[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const canRecord = useMemo(
    () =>
      form.name.trim().length > 0 &&
      form.duration > 0 &&
      !isRecording,
    [form, isRecording]
  );

  const handleRecord = async () => {
    if (!canRecord) {
      return;
    }

    setIsRecording(true);
    setErrorMessage(null);
    setActionMessage(null);

    try {
      const payload = {
        name: form.name.trim(),
        universe: form.universe,
        duration: form.duration,
      };

      const res = await fetch(`${API_BASE}/api/scenes/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error("Failed to record scene");
      }

      setForm(initialFormState);
      setActionMessage("Szene gespeichert.");
      await loadScenes();
    } catch {
      setErrorMessage("Szene konnte nicht aufgenommen werden.");
    } finally {
      setIsRecording(false);
    }
  };

  const handleControlModeToggle = async (checked: boolean) => {
    const nextMode = checked ? "panel" : "external";
    setIsPerformingAction(true);
    setErrorMessage(null);
    setActionMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/control-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ control_mode: nextMode }),
      });
      if (!res.ok) {
        throw new Error("Failed to change control mode");
      }
      onControlModeChange(nextMode);
      setActionMessage(nextMode === "panel" ? "Panel aktiv." : "MA aktiv.");
    } catch {
      setErrorMessage("Control-Mode konnte nicht umgeschaltet werden.");
    } finally {
      setIsPerformingAction(false);
    }
  };

  const canApplySettings =
    IPV4_REGEX.test(settingsForm.node_ip.trim()) &&
    FPS_OPTIONS.includes(Number(settingsForm.dmx_fps)) &&
    settingsForm.poll_interval > 0 &&
    !isApplyingSettings;

  const handleApplySettings = async () => {
    if (!canApplySettings) {
      return;
    }
    setIsApplyingSettings(true);
    setErrorMessage(null);
    setActionMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          node_ip: settingsForm.node_ip.trim(),
          dmx_fps: Number(settingsForm.dmx_fps),
          poll_interval: Number(settingsForm.poll_interval),
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to update settings");
      }
      const data = (await res.json()) as SettingsState;
      setSettingsForm(data);
      setActionMessage("Settings angewendet.");
    } catch {
      setErrorMessage("Settings konnten nicht gespeichert werden.");
    } finally {
      setIsApplyingSettings(false);
    }
  };

  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1.5}>
        <Box>
          <Typography variant="h6" fontWeight={700}>
            Admin Panel
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Szenen verwalten, bearbeiten und aufnehmen.
          </Typography>
        </Box>
        <FormControlLabel
          control={
            <Switch
              checked={controlMode === "panel"}
              onChange={(_event, checked) => void handleControlModeToggle(checked)}
              disabled={isPerformingAction}
            />
          }
          label="Panel aktiv"
        />
      </Stack>

      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
      {actionMessage && <Alert severity="success">{actionMessage}</Alert>}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "1.4fr 1fr" },
          gap: 2,
        }}
      >
        <Paper variant="outlined" sx={{ p: 1 }}>
          {isLoadingScenes ? (
            <Box display="flex" justifyContent="center" py={6}>
              <CircularProgress />
            </Box>
          ) : (
            <List>
              {scenes.map((scene, index) => (
                <Box key={scene.id}>
                  <ListItem disablePadding>
                    <ListItemButton>
                      <ListItemText
                        primary={scene.name}
                        secondary={formatUniverses(scene.universes) || "-"}
                      />
                    </ListItemButton>
                    <ListItemSecondaryAction>
                      <Stack direction="row" spacing={0.5}>
                        <IconButton
                          edge="end"
                          aria-label="nach oben"
                          onClick={() => handleReorder(scene.id, "up")}
                          disabled={isPerformingAction || index === 0}
                        >
                          <ArrowUpwardRoundedIcon />
                        </IconButton>
                        <IconButton
                          edge="end"
                          aria-label="nach unten"
                          onClick={() => handleReorder(scene.id, "down")}
                          disabled={isPerformingAction || index === scenes.length - 1}
                        >
                          <ArrowDownwardRoundedIcon />
                        </IconButton>
                        <IconButton
                          edge="end"
                          aria-label="umbenennen"
                          onClick={() => {
                            setRenameSceneId(scene.id);
                            setRenameName(scene.name);
                          }}
                          disabled={isPerformingAction}
                        >
                          <EditRoundedIcon />
                        </IconButton>
                        <IconButton
                          edge="end"
                          aria-label="testen"
                          onClick={() => handlePlay(scene.id)}
                          disabled={isPerformingAction}
                        >
                          <PlayArrowRoundedIcon />
                        </IconButton>
                        <IconButton
                          edge="end"
                          aria-label="loeschen"
                          onClick={() => handleDelete(scene.id)}
                          disabled={isPerformingAction}
                        >
                          <DeleteOutlineRoundedIcon color="error" />
                        </IconButton>
                      </Stack>
                    </ListItemSecondaryAction>
                  </ListItem>
                  {renameSceneId === scene.id && (
                    <Box sx={{ px: 2, pb: 1.5 }}>
                      <Stack direction="row" spacing={1}>
                        <TextField
                          size="small"
                          fullWidth
                          label="Neuer Name"
                          value={renameName}
                          onChange={(event) => setRenameName(event.target.value)}
                        />
                        <Button
                          variant="contained"
                          onClick={() => void handleSaveRename(scene.id)}
                          disabled={isPerformingAction || renameName.trim().length === 0}
                        >
                          Rename
                        </Button>
                      </Stack>
                    </Box>
                  )}
                  {index < scenes.length - 1 && <Divider component="li" />}
                </Box>
              ))}
            </List>
          )}
        </Paper>

        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              Neue Szene aufnehmen
            </Typography>
            <Stack spacing={1.5}>
              <TextField
                label="Name"
                value={form.name}
                onChange={(event) => handleFormChange("name", event.target.value)}
                size="small"
                fullWidth
              />
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
                <TextField
                  label="Universe"
                  type="number"
                  value={form.universe}
                  onChange={(event) =>
                    handleFormChange("universe", Number(event.target.value))
                  }
                  size="small"
                  fullWidth
                />
                <TextField
                  label="Duration"
                  type="number"
                  value={form.duration}
                  onChange={(event) =>
                    handleFormChange("duration", Number(event.target.value))
                  }
                  size="small"
                  fullWidth
                />
              </Box>
              <Button variant="contained" onClick={handleRecord} disabled={!canRecord}>
                {isRecording ? "Aufnahme laeuft..." : "Szene aufnehmen"}
              </Button>
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              System Settings
            </Typography>
            {isLoadingSettings ? (
              <Box display="flex" justifyContent="center" py={2}>
                <CircularProgress size={24} />
              </Box>
            ) : (
              <Stack spacing={1.5}>
                <TextField
                  label="Local IP"
                  value={settingsForm.local_ip}
                  size="small"
                  fullWidth
                  InputProps={{ readOnly: true }}
                />
                <TextField
                  label="Node IP"
                  value={settingsForm.node_ip}
                  onChange={(event) =>
                    setSettingsForm((prev) => ({ ...prev, node_ip: event.target.value }))
                  }
                  size="small"
                  fullWidth
                  error={settingsForm.node_ip.length > 0 && !IPV4_REGEX.test(settingsForm.node_ip)}
                  helperText="IPv4, z.B. 2.0.0.10"
                />
                <TextField
                  select
                  label="DMX FPS"
                  value={settingsForm.dmx_fps}
                  onChange={(event) =>
                    setSettingsForm((prev) => ({
                      ...prev,
                      dmx_fps: Number(event.target.value),
                    }))
                  }
                  size="small"
                  fullWidth
                >
                  {FPS_OPTIONS.map((fps) => (
                    <MenuItem key={fps} value={fps}>
                      {fps}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Poll Interval (s)"
                  type="number"
                  value={settingsForm.poll_interval}
                  onChange={(event) =>
                    setSettingsForm((prev) => ({
                      ...prev,
                      poll_interval: Number(event.target.value),
                    }))
                  }
                  size="small"
                  fullWidth
                />
                <Button
                  variant="contained"
                  onClick={handleApplySettings}
                  disabled={!canApplySettings}
                >
                  Apply Settings
                </Button>
              </Stack>
            )}
          </Paper>
        </Stack>
      </Box>
    </Stack>
  );
}
