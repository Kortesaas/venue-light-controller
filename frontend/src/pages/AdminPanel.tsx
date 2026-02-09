import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
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
  Snackbar,
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
import AutorenewRoundedIcon from "@mui/icons-material/AutorenewRounded";
import BlockRoundedIcon from "@mui/icons-material/BlockRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import SceneDmxEditorDialog from "../components/SceneDmxEditorDialog";
import {
  getSceneCardSx,
  getSceneIcon,
  normalizeSceneStyleForPayload,
  SCENE_COLOR_OPTIONS,
  SCENE_ICON_OPTIONS,
  SCENE_STYLE_LABELS,
  type SceneStyleMeta,
} from "../sceneStyle";

const API_BASE = "";

type Scene = {
  id: string;
  name: string;
  description?: string;
  universes: Record<string, number[]>;
  created_at?: string;
  style?: SceneStyleMeta | null;
};

type SceneFormState = {
  name: string;
  description: string;
  style: SceneStyleMeta;
};

const initialFormState: SceneFormState = {
  name: "",
  description: "",
  style: {
    color: "default",
    icon: "none",
  },
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
  universe_count: number;
};

type FixturePlanParameterExample = {
  universe: number;
  channel: number;
  name: string;
  fixture: string;
  role: string;
  ma3_universe: number;
};

type FixturePlanSummary = {
  active: boolean;
  source_filename?: string | null;
  imported_at?: string | null;
  fixture_count: number;
  parameter_count: number;
  universes: number[];
  example_parameters: FixturePlanParameterExample[];
};

const FPS_OPTIONS = [15, 24, 30, 40, 44, 60];
const IPV4_REGEX =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

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
  const [renameDescription, setRenameDescription] = useState("");
  const [renameStyle, setRenameStyle] = useState<SceneStyleMeta>(initialFormState.style);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [form, setForm] = useState<SceneFormState>(initialFormState);
  const [settingsForm, setSettingsForm] = useState<SettingsState>({
    local_ip: "",
    node_ip: "",
    dmx_fps: 30,
    poll_interval: 5,
    universe_count: 1,
  });
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isApplyingSettings, setIsApplyingSettings] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [isApplyingPin, setIsApplyingPin] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<Scene | null>(null);
  const [rerecordCandidate, setRerecordCandidate] = useState<Scene | null>(null);
  const [editorScene, setEditorScene] = useState<Scene | null>(null);
  const [fixturePlanStatus, setFixturePlanStatus] = useState<FixturePlanSummary>({
    active: false,
    fixture_count: 0,
    parameter_count: 0,
    universes: [],
    example_parameters: [],
  });
  const [fixturePlanFile, setFixturePlanFile] = useState<File | null>(null);
  const [fixturePlanXml, setFixturePlanXml] = useState<string | null>(null);
  const [fixturePlanPreview, setFixturePlanPreview] = useState<FixturePlanSummary | null>(null);
  const [isPreviewingFixturePlan, setIsPreviewingFixturePlan] = useState(false);
  const [isActivatingFixturePlan, setIsActivatingFixturePlan] = useState(false);
  const [isRemovingFixturePlan, setIsRemovingFixturePlan] = useState(false);

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

  const loadFixturePlanStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/fixture-plan`);
      if (!res.ok) {
        throw new Error("Failed to load fixture plan status");
      }
      const data = (await res.json()) as FixturePlanSummary;
      setFixturePlanStatus(data);
    } catch {
      setErrorMessage("Fixture-Plan Status konnte nicht geladen werden.");
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
    void loadFixturePlanStatus();
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
        setRenameDescription("");
        setRenameStyle(initialFormState.style);
      }
      setActionMessage("Szene gelöscht.");
      await loadScenes();
    } catch {
      setErrorMessage("Szene konnte nicht gelöscht werden.");
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

  const handleRerecord = async (sceneId: string) => {
    setIsPerformingAction(true);
    setErrorMessage(null);
    setActionMessage(null);

    try {
      const res = await fetch(`${API_BASE}/api/scenes/${sceneId}/rerecord`, {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error("Failed to update scene content");
      }
      setActionMessage("Szeneninhalt aktualisiert.");
      await loadScenes();
    } catch {
      setErrorMessage("Szeneninhalt konnte nicht aktualisiert werden.");
    } finally {
      setIsPerformingAction(false);
    }
  };

  const handleSceneEditorSaved = async (_sceneId: string) => {
    await loadScenes();
    setActionMessage("Szeneninhalt gespeichert.");
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
          description: renameDescription.trim(),
          style: normalizeSceneStyleForPayload(renameStyle),
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to update scene");
      }

      setRenameSceneId(null);
      setRenameName("");
      setRenameDescription("");
      setRenameStyle(initialFormState.style);
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

  const handleFormStyleChange = <K extends keyof SceneStyleMeta>(
    key: K,
    value: SceneStyleMeta[K]
  ) => {
    setForm((prev) => ({
      ...prev,
      style: {
        ...prev.style,
        [key]: value,
      },
    }));
  };

  const handleRenameStyleChange = <K extends keyof SceneStyleMeta>(
    key: K,
    value: SceneStyleMeta[K]
  ) => {
    setRenameStyle((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const canRecord = useMemo(
    () =>
      form.name.trim().length > 0 &&
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
        description: form.description.trim(),
        style: normalizeSceneStyleForPayload(form.style),
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
    Number.isInteger(Number(settingsForm.universe_count)) &&
    Number(settingsForm.universe_count) > 0 &&
    settingsForm.poll_interval > 0 &&
    !isApplyingSettings;

  const universeExampleText = (() => {
    const count = Number(settingsForm.universe_count);
    if (!Number.isInteger(count) || count < 1) {
      return "Bitte eine ganze Zahl >= 1 eingeben.";
    }
    if (count === 1) {
      return "Erfasst wird: Universe 1";
    }
    return `Erfasst werden: Universe 1 bis ${count}`;
  })();

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
          universe_count: Number(settingsForm.universe_count),
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

  const isValidPin = (value: string) => /^\d{4}$/.test(value);
  const canApplyPin =
    isValidPin(currentPin) &&
    isValidPin(newPin) &&
    isValidPin(confirmPin) &&
    !isApplyingPin;

  const handleApplyPin = async () => {
    if (!canApplyPin) {
      return;
    }
    setIsApplyingPin(true);
    setErrorMessage(null);
    setActionMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/pin/change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_pin: currentPin,
          new_pin: newPin,
          confirm_pin: confirmPin,
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to update PIN");
      }
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      setActionMessage("PIN aktualisiert.");
    } catch {
      setErrorMessage("PIN konnte nicht geändert werden.");
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
    } finally {
      setIsApplyingPin(false);
    }
  };

  const readApiErrorDetail = async (res: Response, fallback: string) => {
    try {
      const payload = (await res.json()) as { detail?: string };
      if (payload.detail && payload.detail.trim()) {
        return payload.detail;
      }
    } catch {
      // ignore
    }
    return fallback;
  };

  const handleFixturePlanFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setFixturePlanFile(file);
    setFixturePlanXml(null);
    setFixturePlanPreview(null);
  };

  const handlePreviewFixturePlan = async () => {
    if (!fixturePlanFile) {
      return;
    }

    setIsPreviewingFixturePlan(true);
    setErrorMessage(null);
    setActionMessage(null);

    try {
      const xml = await fixturePlanFile.text();
      const res = await fetch(`${API_BASE}/api/fixture-plan/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          xml,
          filename: fixturePlanFile.name,
        }),
      });
      if (!res.ok) {
        throw new Error(await readApiErrorDetail(res, "Fixture-Plan Preview fehlgeschlagen."));
      }
      const data = (await res.json()) as FixturePlanSummary;
      setFixturePlanXml(xml);
      setFixturePlanPreview(data);
    } catch (error) {
      setFixturePlanPreview(null);
      setFixturePlanXml(null);
      setErrorMessage(
        error instanceof Error ? error.message : "Fixture-Plan Preview fehlgeschlagen."
      );
    } finally {
      setIsPreviewingFixturePlan(false);
    }
  };

  const handleActivateFixturePlan = async () => {
    if (!fixturePlanXml || !fixturePlanFile) {
      return;
    }

    setIsActivatingFixturePlan(true);
    setErrorMessage(null);
    setActionMessage(null);

    try {
      const res = await fetch(`${API_BASE}/api/fixture-plan/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          xml: fixturePlanXml,
          filename: fixturePlanFile.name,
        }),
      });
      if (!res.ok) {
        throw new Error(await readApiErrorDetail(res, "Fixture-Plan Aktivierung fehlgeschlagen."));
      }
      const data = (await res.json()) as FixturePlanSummary;
      setFixturePlanStatus(data);
      setFixturePlanPreview(null);
      setActionMessage("Fixture-Plan aktiviert.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Fixture-Plan Aktivierung fehlgeschlagen."
      );
    } finally {
      setIsActivatingFixturePlan(false);
    }
  };

  const handleRemoveFixturePlan = async () => {
    setIsRemovingFixturePlan(true);
    setErrorMessage(null);
    setActionMessage(null);

    try {
      const res = await fetch(`${API_BASE}/api/fixture-plan`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(await readApiErrorDetail(res, "Fixture-Plan konnte nicht entfernt werden."));
      }
      setFixturePlanPreview(null);
      setFixturePlanXml(null);
      setFixturePlanStatus({
        active: false,
        fixture_count: 0,
        parameter_count: 0,
        universes: [],
        example_parameters: [],
      });
      setActionMessage("Fixture-Plan entfernt.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Fixture-Plan konnte nicht entfernt werden."
      );
    } finally {
      setIsRemovingFixturePlan(false);
    }
  };

  const previewCreatedAt = new Date().toLocaleDateString();

  const renderScenePreview = (name: string, description: string, style: SceneStyleMeta) => (
    <Card variant="outlined" sx={getSceneCardSx(style, false)}>
      <CardContent sx={{ py: 1.25 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Box minWidth={0}>
            <Typography variant="subtitle1" fontWeight={700} noWrap>
              {name.trim() || "Scene Preview"}
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                mt: 0.5,
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              {description.trim() || "Optional description"}
            </Typography>
          </Box>
          {style.icon && style.icon !== "none" ? (
            <Box color="text.secondary">{getSceneIcon(style.icon)}</Box>
          ) : null}
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: "block" }}>
          {`Created ${previewCreatedAt}`}
        </Typography>
      </CardContent>
    </Card>
  );

  const renderIconGrid = (
    value: SceneStyleMeta["icon"] | undefined,
    onChange: (next: SceneStyleMeta["icon"]) => void
  ) => (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 1,
      }}
    >
      {SCENE_ICON_OPTIONS.map((option) => {
        const selected = (value ?? "none") === option;
        return (
          <Button
            key={option}
            variant={selected ? "contained" : "outlined"}
            color={selected ? "primary" : "inherit"}
            onClick={() => onChange(option)}
            aria-label={SCENE_STYLE_LABELS.icon[option]}
            sx={{
              minHeight: 48,
              px: 0,
              borderColor: selected ? "primary.main" : "divider",
            }}
          >
            <Box sx={{ fontSize: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {option === "none" ? <BlockRoundedIcon fontSize="inherit" /> : getSceneIcon(option)}
            </Box>
          </Button>
        );
      })}
    </Box>
  );

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

      <Snackbar
        open={Boolean(errorMessage) || Boolean(actionMessage)}
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
                      {(() => {
                        const createdText = scene.created_at
                          ? new Date(scene.created_at).toLocaleDateString()
                          : null;
                        const descriptionText = scene.description?.trim() ? scene.description : "-";
                        const secondary = createdText
                          ? `${descriptionText} • Created ${createdText}`
                          : descriptionText;
                        return (
                      <ListItemText
                        primary={scene.name}
                        secondary={secondary}
                      />
                        );
                      })()}
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
                            setRenameDescription(scene.description ?? "");
                            setRenameStyle({
                              color: scene.style?.color ?? "default",
                              icon: scene.style?.icon ?? "none",
                            });
                          }}
                          disabled={isPerformingAction}
                        >
                          <EditRoundedIcon />
                        </IconButton>
                        <IconButton
                          edge="end"
                          aria-label="dmx bearbeiten"
                          onClick={() => setEditorScene(scene)}
                          disabled={isPerformingAction}
                        >
                          <TuneRoundedIcon />
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
                          aria-label="inhalt aktualisieren"
                          onClick={() => setRerecordCandidate(scene)}
                          disabled={isPerformingAction}
                        >
                          <AutorenewRoundedIcon />
                        </IconButton>
                        <IconButton
                          edge="end"
                          aria-label="löschen"
                          onClick={() => setDeleteCandidate(scene)}
                          disabled={isPerformingAction}
                        >
                          <DeleteOutlineRoundedIcon color="error" />
                        </IconButton>
                      </Stack>
                    </ListItemSecondaryAction>
                  </ListItem>
                  {renameSceneId === scene.id && (
                    <Box sx={{ px: 2, pb: 1.5 }}>
                      <Stack spacing={1}>
                        <TextField
                          size="small"
                          fullWidth
                          label="Neuer Name"
                          value={renameName}
                          onChange={(event) => setRenameName(event.target.value)}
                        />
                        <TextField
                          size="small"
                          fullWidth
                          label="Beschreibung"
                          value={renameDescription}
                          onChange={(event) => setRenameDescription(event.target.value)}
                        />
                        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                          <TextField
                            select
                            size="small"
                            fullWidth
                            label="Color"
                            value={renameStyle.color ?? "default"}
                            onChange={(event) =>
                              handleRenameStyleChange(
                                "color",
                                event.target.value as SceneStyleMeta["color"]
                              )
                            }
                          >
                            {SCENE_COLOR_OPTIONS.map((option) => (
                              <MenuItem key={option} value={option}>
                                {SCENE_STYLE_LABELS.color[option]}
                              </MenuItem>
                            ))}
                          </TextField>
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          Icon
                        </Typography>
                        {renderIconGrid(renameStyle.icon, (next) =>
                          handleRenameStyleChange("icon", next)
                        )}
                        {renderScenePreview(renameName, renameDescription, renameStyle)}
                        <Button
                          variant="contained"
                          onClick={() => void handleSaveRename(scene.id)}
                          disabled={isPerformingAction || renameName.trim().length === 0}
                        >
                          Update Scene
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
              <TextField
                label="Beschreibung"
                value={form.description}
                onChange={(event) => handleFormChange("description", event.target.value)}
                size="small"
                fullWidth
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <TextField
                  select
                  size="small"
                  fullWidth
                  label="Color"
                  value={form.style.color ?? "default"}
                  onChange={(event) =>
                    handleFormStyleChange("color", event.target.value as SceneStyleMeta["color"])
                  }
                >
                  {SCENE_COLOR_OPTIONS.map((option) => (
                    <MenuItem key={option} value={option}>
                      {SCENE_STYLE_LABELS.color[option]}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Icon
              </Typography>
              {renderIconGrid(form.style.icon, (next) =>
                handleFormStyleChange("icon", next)
              )}
              {renderScenePreview(form.name, form.description, form.style)}
              <Button variant="contained" onClick={handleRecord} disabled={!canRecord}>
                {isRecording ? "Aufnahme läuft..." : "Szene aufnehmen"}
              </Button>
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              MA3 Fixture Plan (Optional)
            </Typography>

            <Stack spacing={1.25}>
              {fixturePlanStatus.active ? (
                <Alert severity="success">
                  {`Aktiv: ${fixturePlanStatus.source_filename ?? "Fixture-Plan"}`}
                </Alert>
              ) : (
                <Alert severity="info">
                  Kein Fixture-Plan aktiv. System nutzt rohe Universe/Channel Daten.
                </Alert>
              )}

              {fixturePlanStatus.active ? (
                <Typography variant="body2" color="text.secondary">
                  {`Fixtures: ${fixturePlanStatus.fixture_count} • Parameter: ${fixturePlanStatus.parameter_count} • Universes: ${fixturePlanStatus.universes.join(", ") || "-"}`}
                </Typography>
              ) : null}

              <Button variant="outlined" component="label" disabled={isPreviewingFixturePlan}>
                XML Datei wählen
                <input
                  hidden
                  type="file"
                  accept=".xml,text/xml,application/xml"
                  onChange={handleFixturePlanFileSelected}
                />
              </Button>
              <Typography variant="caption" color="text.secondary">
                {fixturePlanFile ? fixturePlanFile.name : "Keine Datei ausgewählt"}
              </Typography>
              <Button
                variant="contained"
                onClick={handlePreviewFixturePlan}
                disabled={!fixturePlanFile || isPreviewingFixturePlan}
              >
                {isPreviewingFixturePlan ? "Preview..." : "Preview Import"}
              </Button>

              {fixturePlanPreview ? (
                <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1.25 }}>
                  <Typography variant="subtitle2" fontWeight={700}>
                    Import Summary
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {`Fixtures: ${fixturePlanPreview.fixture_count} • Parameter: ${fixturePlanPreview.parameter_count}`}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {`Universes: ${fixturePlanPreview.universes.join(", ") || "-"}`}
                  </Typography>

                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                    Beispiel-Parameter
                  </Typography>
                  <Stack spacing={0.3} sx={{ mt: 0.5 }}>
                    {fixturePlanPreview.example_parameters.slice(0, 6).map((example, index) => (
                      <Typography key={`${example.fixture}-${example.channel}-${index}`} variant="caption">
                        {`U${example.ma3_universe} Ch${example.channel} • ${example.fixture} • ${example.name} (${example.role})`}
                      </Typography>
                    ))}
                  </Stack>

                  <Button
                    variant="contained"
                    color="success"
                    sx={{ mt: 1.25 }}
                    onClick={handleActivateFixturePlan}
                    disabled={isActivatingFixturePlan || !fixturePlanXml}
                  >
                    {isActivatingFixturePlan ? "Aktiviere..." : "Activate Plan"}
                  </Button>
                </Box>
              ) : null}

              <Button
                variant="outlined"
                color="error"
                onClick={handleRemoveFixturePlan}
                disabled={!fixturePlanStatus.active || isRemovingFixturePlan}
              >
                {isRemovingFixturePlan ? "Entferne..." : "Remove Active Plan"}
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
                <TextField
                  label="Universes in use"
                  type="number"
                  value={settingsForm.universe_count}
                  onChange={(event) =>
                    setSettingsForm((prev) => ({
                      ...prev,
                      universe_count: Number(event.target.value),
                    }))
                  }
                  size="small"
                  fullWidth
                  helperText={universeExampleText}
                />
                <Button
                  variant="contained"
                  onClick={handleApplySettings}
                  disabled={!canApplySettings}
                >
                  Apply Settings
                </Button>

                <Divider />

                <Typography variant="subtitle2" fontWeight={700}>
                  Screen Lock PIN
                </Typography>
                <TextField
                  label="Current PIN"
                  type="password"
                  value={currentPin}
                  onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
                  size="small"
                  fullWidth
                  helperText="4 digits"
                />
                <TextField
                  label="New PIN"
                  type="password"
                  value={newPin}
                  onChange={(event) => setNewPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
                  size="small"
                  fullWidth
                  helperText="exactly 4 digits"
                />
                <TextField
                  label="Confirm New PIN"
                  type="password"
                  value={confirmPin}
                  onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
                  size="small"
                  fullWidth
                  error={confirmPin.length > 0 && newPin.length > 0 && confirmPin !== newPin}
                  helperText={
                    confirmPin.length > 0 && newPin.length > 0 && confirmPin !== newPin
                      ? "PINs do not match"
                      : "repeat new PIN"
                  }
                />
                <Button
                  variant="outlined"
                  onClick={handleApplyPin}
                  disabled={!canApplyPin}
                >
                  Update PIN
                </Button>
              </Stack>
            )}
          </Paper>
        </Stack>
      </Box>

      <Dialog
        open={deleteCandidate !== null}
        onClose={() => setDeleteCandidate(null)}
      >
        <DialogTitle>Szene löschen?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Soll die Szene "{deleteCandidate?.name ?? ""}" wirklich gelöscht werden?
            Dieser Schritt kann nicht rueckgängig gemacht werden.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteCandidate(null)}>Abbrechen</Button>
          <Button
            color="error"
            variant="contained"
            onClick={async () => {
              if (!deleteCandidate) {
                return;
              }
              const sceneId = deleteCandidate.id;
              setDeleteCandidate(null);
              await handleDelete(sceneId);
            }}
          >
            Löschen
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={rerecordCandidate !== null}
        onClose={() => setRerecordCandidate(null)}
      >
        <DialogTitle>Szene neu aufnehmen?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Soll der Inhalt der Szene "{rerecordCandidate?.name ?? ""}" mit den
            aktuellen Art-Net-Daten überschrieben werden?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRerecordCandidate(null)}>Abbrechen</Button>
          <Button
            variant="contained"
            onClick={async () => {
              if (!rerecordCandidate) {
                return;
              }
              const sceneId = rerecordCandidate.id;
              setRerecordCandidate(null);
              await handleRerecord(sceneId);
            }}
          >
            Aktualisieren
          </Button>
        </DialogActions>
      </Dialog>

      <SceneDmxEditorDialog
        open={editorScene !== null}
        scene={editorScene}
        controlMode={controlMode}
        onClose={() => setEditorScene(null)}
        onSaved={(sceneId) => {
          void handleSceneEditorSaved(sceneId);
        }}
      />
    </Stack>
  );
}


