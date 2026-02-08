import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemSecondaryAction,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";

const API_BASE = "";

type Scene = {
  id: string;
  name: string;
  universes: Record<string, number[]>;
  fade_in?: number;
  fade_out?: number;
};

type SceneFormState = {
  name: string;
  id: string;
  universe: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
};

type EditFormState = {
  id: string;
  name: string;
  fadeIn: number;
  fadeOut: number;
};

const initialFormState: SceneFormState = {
  name: "",
  id: "",
  universe: 0,
  duration: 1,
  fadeIn: 0,
  fadeOut: 0,
};

function slugifyName(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "");
}

function formatUniverses(universes: Record<string, number[]>) {
  return Object.keys(universes ?? {})
    .sort((a, b) => Number(a) - Number(b))
    .map((value) => `U${value}`)
    .join(", ");
}

export default function AdminPanel() {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isLoadingScenes, setIsLoadingScenes] = useState(true);
  const [isPerformingAction, setIsPerformingAction] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [form, setForm] = useState<SceneFormState>(initialFormState);

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
  }, []);

  const handleSelectScene = (scene: Scene) => {
    setSelectedSceneId(scene.id);
    setEditForm({
      id: scene.id,
      name: scene.name,
      fadeIn: scene.fade_in ?? 0,
      fadeOut: scene.fade_out ?? 0,
    });
  };

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
      if (selectedSceneId === sceneId) {
        setSelectedSceneId(null);
        setEditForm(null);
      }
      setActionMessage("Szene geloescht.");
      await loadScenes();
    } catch {
      setErrorMessage("Szene konnte nicht geloescht werden.");
    } finally {
      setIsPerformingAction(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedSceneId || !editForm) {
      return;
    }

    setIsPerformingAction(true);
    setErrorMessage(null);
    setActionMessage(null);

    try {
      const res = await fetch(`${API_BASE}/api/scenes/${selectedSceneId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name.trim(),
          fade_in: editForm.fadeIn,
          fade_out: editForm.fadeOut,
          new_id: editForm.id.trim(),
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to update scene");
      }

      const updated = (await res.json()) as Scene;
      setSelectedSceneId(updated.id);
      setEditForm({
        id: updated.id,
        name: updated.name,
        fadeIn: updated.fade_in ?? 0,
        fadeOut: updated.fade_out ?? 0,
      });
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

  const handleNameChange = (value: string) => {
    setForm((prev) => {
      const next = { ...prev, name: value };
      if (!prev.id.trim()) {
        next.id = slugifyName(value);
      }
      return next;
    });
  };

  const canRecord = useMemo(
    () =>
      form.name.trim().length > 0 &&
      form.id.trim().length > 0 &&
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
        id: form.id.trim(),
        name: form.name.trim(),
        universe: form.universe,
        duration: form.duration,
        fade_in: form.fadeIn,
        fade_out: form.fadeOut,
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
        <Button variant="outlined" onClick={loadScenes} disabled={isLoadingScenes}>
          Reload
        </Button>
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
                    <ListItemButton
                      selected={selectedSceneId === scene.id}
                      onClick={() => handleSelectScene(scene)}
                    >
                      <ListItemText
                        primary={scene.name}
                        secondary={`${scene.id} | ${formatUniverses(scene.universes) || "-"}`}
                      />
                    </ListItemButton>
                    <ListItemSecondaryAction>
                      <Stack direction="row" spacing={0.5}>
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
                onChange={(event) => handleNameChange(event.target.value)}
                size="small"
                fullWidth
              />
              <TextField
                label="ID"
                value={form.id}
                onChange={(event) => handleFormChange("id", event.target.value)}
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
                <TextField
                  label="Fade-In"
                  type="number"
                  value={form.fadeIn}
                  onChange={(event) =>
                    handleFormChange("fadeIn", Number(event.target.value))
                  }
                  size="small"
                  fullWidth
                />
                <TextField
                  label="Fade-Out"
                  type="number"
                  value={form.fadeOut}
                  onChange={(event) =>
                    handleFormChange("fadeOut", Number(event.target.value))
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
              Szene bearbeiten
            </Typography>
            {!editForm ? (
              <Typography variant="body2" color="text.secondary">
                Waehle eine Szene aus der Liste.
              </Typography>
            ) : (
              <Stack spacing={1.5}>
                <TextField
                  label="ID"
                  value={editForm.id}
                  onChange={(event) =>
                    setEditForm((prev) =>
                      prev ? { ...prev, id: event.target.value } : prev
                    )
                  }
                  size="small"
                  fullWidth
                />
                <TextField
                  label="Name"
                  value={editForm.name}
                  onChange={(event) =>
                    setEditForm((prev) =>
                      prev ? { ...prev, name: event.target.value } : prev
                    )
                  }
                  size="small"
                  fullWidth
                />
                <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
                  <TextField
                    label="Fade-In"
                    type="number"
                    value={editForm.fadeIn}
                    onChange={(event) =>
                      setEditForm((prev) =>
                        prev ? { ...prev, fadeIn: Number(event.target.value) } : prev
                      )
                    }
                    size="small"
                    fullWidth
                  />
                  <TextField
                    label="Fade-Out"
                    type="number"
                    value={editForm.fadeOut}
                    onChange={(event) =>
                      setEditForm((prev) =>
                        prev ? { ...prev, fadeOut: Number(event.target.value) } : prev
                      )
                    }
                    size="small"
                    fullWidth
                  />
                </Box>
                <Button
                  variant="contained"
                  color="secondary"
                  startIcon={<SaveRoundedIcon />}
                  onClick={handleSaveEdit}
                  disabled={
                    isPerformingAction ||
                    editForm.id.trim().length === 0 ||
                    editForm.name.trim().length === 0
                  }
                >
                  Speichern
                </Button>
              </Stack>
            )}
          </Paper>
        </Stack>
      </Box>
    </Stack>
  );
}
