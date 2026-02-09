import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Slider,
  Snackbar,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import WarningRoundedIcon from "@mui/icons-material/WarningRounded";
import { getSceneCardSx, getSceneIcon, type SceneStyleMeta } from "../sceneStyle";

const API_BASE = "";

type StatusResponse = {
  status: string;
  local_ip: string;
  node_ip: string;
  master_dimmer_percent?: number;
  master_dimmer_mode?: "parameter-aware" | "raw";
};

type Scene = {
  id: string;
  name: string;
  description?: string;
  universes: Record<string, number[]>;
  created_at?: string;
  style?: SceneStyleMeta | null;
};

type OperatorDashboardProps = {
  activeSceneId: string | null;
  onActiveSceneChange: (sceneId: string | null) => void;
  sceneVersion: number;
  controlMode: "panel" | "external";
  panelLocked: boolean;
};

export default function OperatorDashboard({
  activeSceneId,
  onActiveSceneChange,
  sceneVersion,
  controlMode,
  panelLocked,
}: OperatorDashboardProps) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPerformingAction, setIsPerformingAction] = useState(false);
  const [pendingSceneId, setPendingSceneId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showBlackoutConfirm, setShowBlackoutConfirm] = useState(false);
  const [masterDimmerPercent, setMasterDimmerPercent] = useState(100);
  const [masterDimmerMode, setMasterDimmerMode] =
    useState<"parameter-aware" | "raw">("raw");
  const masterDimmerTargetRef = useRef(100);
  const masterDimmerTimerRef = useRef<number | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const [statusRes, scenesRes] = await Promise.all([
        fetch(`${API_BASE}/api/status`),
        fetch(`${API_BASE}/api/scenes`),
      ]);

      if (!statusRes.ok || !scenesRes.ok) {
        throw new Error("Failed to load data");
      }

      const statusData = (await statusRes.json()) as StatusResponse;
      const scenesData = (await scenesRes.json()) as Scene[];
      setStatus(statusData);
      setScenes(scenesData);
      if (typeof statusData.master_dimmer_percent === "number") {
        setMasterDimmerPercent(statusData.master_dimmer_percent);
        masterDimmerTargetRef.current = statusData.master_dimmer_percent;
      }
      if (
        statusData.master_dimmer_mode === "parameter-aware" ||
        statusData.master_dimmer_mode === "raw"
      ) {
        setMasterDimmerMode(statusData.master_dimmer_mode);
      }
    } catch {
      setErrorMessage("Status oder Szenen konnten nicht geladen werden.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [sceneVersion]);

  useEffect(() => {
    return () => {
      if (masterDimmerTimerRef.current !== null) {
        window.clearTimeout(masterDimmerTimerRef.current);
      }
    };
  }, []);

  const pushMasterDimmer = async (valuePercent: number) => {
    try {
      const res = await fetch(`${API_BASE}/api/master-dimmer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value_percent: valuePercent }),
      });
      if (!res.ok) {
        throw new Error("Master dimmer update failed");
      }
      const data = (await res.json()) as {
        value_percent: number;
        mode: "parameter-aware" | "raw";
      };
      setMasterDimmerPercent(data.value_percent);
      masterDimmerTargetRef.current = data.value_percent;
      setMasterDimmerMode(data.mode);
    } catch {
      setErrorMessage("Master Dimmer konnte nicht gesetzt werden.");
    }
  };

  const queueMasterDimmerUpdate = (valuePercent: number) => {
    masterDimmerTargetRef.current = valuePercent;
    if (masterDimmerTimerRef.current !== null) {
      return;
    }
    masterDimmerTimerRef.current = window.setTimeout(() => {
      masterDimmerTimerRef.current = null;
      void pushMasterDimmer(masterDimmerTargetRef.current);
    }, 80);
  };

  const handleMasterDimmerChange = (_event: Event, value: number | number[]) => {
    const next = Array.isArray(value) ? value[0] : value;
    setMasterDimmerPercent(next);
    queueMasterDimmerUpdate(next);
  };

  const handleMasterDimmerFull = () => {
    setMasterDimmerPercent(100);
    masterDimmerTargetRef.current = 100;
    if (masterDimmerTimerRef.current !== null) {
      window.clearTimeout(masterDimmerTimerRef.current);
      masterDimmerTimerRef.current = null;
    }
    void pushMasterDimmer(100);
  };

  const handlePlayScene = async (sceneId: string) => {
    if (controlMode !== "panel" || panelLocked) {
      return;
    }
    setPendingSceneId(sceneId);
    setErrorMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/scenes/${sceneId}/play`, {
        method: "POST",
      });
      if (!res.ok) {
        if (res.status === 409) {
          throw new Error("locked");
        }
        throw new Error("Scene play failed");
      }
      onActiveSceneChange(sceneId);
    } catch {
      setErrorMessage(
        controlMode !== "panel"
          ? "Panel gesperrt - MA aktiv."
          : "Szene konnte nicht gestartet werden."
      );
    } finally {
      setPendingSceneId(null);
    }
  };

  const handleBlackout = async () => {
    if (panelLocked) {
      return;
    }
    setIsPerformingAction(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/blackout`, { method: "POST" });
      if (!res.ok) {
        throw new Error("Blackout failed");
      }
      onActiveSceneChange("__blackout__");
      setShowBlackoutConfirm(false);
    } catch {
      setErrorMessage("Blackout konnte nicht ausgeloest werden.");
    } finally {
      setIsPerformingAction(false);
    }
  };

  const handleStop = async () => {
    if (panelLocked) {
      return;
    }
    setIsPerformingAction(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/stop`, { method: "POST" });
      if (!res.ok) {
        throw new Error("Stop failed");
      }
      onActiveSceneChange(null);
    } catch {
      setErrorMessage("Stop konnte nicht ausgefuehrt werden.");
    } finally {
      setIsPerformingAction(false);
    }
  };

  const activeSceneName = useMemo(() => {
    if (!activeSceneId) {
      return "Keine";
    }
    if (activeSceneId === "__blackout__") {
      return "Blackout";
    }
    return scenes.find((scene) => scene.id === activeSceneId)?.name ?? activeSceneId;
  }, [activeSceneId, scenes]);

  const formatCreatedAt = (value?: string) => {
    if (!value) {
      return null;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toLocaleString();
  };

  return (
    <Stack spacing={2.5}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          alignItems={{ sm: "center" }}
          justifyContent="flex-start"
        >
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Chip size="small" label={`NODE: ${status?.node_ip ?? "-"}`} />
            <Chip size="small" label={`SCENES: ${scenes.length}`} />
            <Chip size="small" color="primary" label={`AKTIV: ${activeSceneName}`} />
          </Stack>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1.2}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="subtitle1" fontWeight={700}>
              Master Dimmer
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h6" fontWeight={800}>
                {`${masterDimmerPercent}%`}
              </Typography>
              <Button
                size="small"
                variant="outlined"
                onClick={handleMasterDimmerFull}
                disabled={panelLocked || masterDimmerPercent === 100}
              >
                Full
              </Button>
            </Stack>
          </Stack>
          <Slider
            value={masterDimmerPercent}
            min={0}
            max={100}
            step={1}
            onChange={handleMasterDimmerChange}
            valueLabelDisplay="auto"
            disabled={panelLocked}
            sx={{ py: 1.4 }}
          />
          <Typography variant="caption" color="text.secondary">
            {masterDimmerMode === "parameter-aware"
              ? "Mode: Parameter-aware (only intensity channels)"
              : "Mode: Raw fallback (all DMX channels)"}
          </Typography>
        </Stack>
      </Paper>

      <Snackbar
        open={Boolean(errorMessage)}
        autoHideDuration={2200}
        onClose={() => setErrorMessage(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        sx={{
          zIndex: (theme) => theme.zIndex.tooltip + 100,
          bottom: { xs: 86, sm: 92 },
        }}
      >
        <Alert severity="error" onClose={() => setErrorMessage(null)}>
          {errorMessage ?? ""}
        </Alert>
      </Snackbar>
      {controlMode !== "panel" && (
        <Alert severity="warning">Panel gesperrt - MA aktiv</Alert>
      )}

      {isLoading ? (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              sm: "repeat(2, minmax(0, 1fr))",
              lg: "repeat(3, minmax(0, 1fr))",
            },
            gap: 2,
          }}
        >
          {scenes.map((scene) => {
            const isActive = scene.id === activeSceneId;
            const isPending = pendingSceneId === scene.id;
            const createdAtText = formatCreatedAt(scene.created_at);
            const createdAtShort = scene.created_at
              ? new Date(scene.created_at).toLocaleDateString()
              : null;
            return (
              <Card
                key={scene.id}
                variant="outlined"
                sx={getSceneCardSx(scene.style ?? undefined, isActive)}
              >
                <CardActionArea
                  onClick={() => handlePlayScene(scene.id)}
                  disabled={isPending || controlMode !== "panel" || panelLocked}
                  sx={{ minHeight: 140 }}
                >
                  <CardContent>
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      alignItems="center"
                      spacing={1}
                    >
                      <Box minWidth={0}>
                        <Typography variant="h6" noWrap>
                          {scene.name}
                        </Typography>
                        {scene.description ? (
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
                            {scene.description}
                          </Typography>
                        ) : null}
                      </Box>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        {scene.style?.icon && scene.style.icon !== "none" ? (
                          <Box
                            color="text.secondary"
                            sx={{
                              fontSize: 30,
                              width: 32,
                              height: 32,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {getSceneIcon(scene.style.icon)}
                          </Box>
                        ) : null}
                        {isPending && <CircularProgress size={18} />}
                      </Stack>
                    </Stack>
                    {createdAtText && createdAtShort ? (
                      <Tooltip title={`Created: ${createdAtText}`}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: "block", mt: 0.75 }}
                        >
                          {`Created ${createdAtShort}`}
                        </Typography>
                      </Tooltip>
                    ) : null}
                  </CardContent>
                </CardActionArea>
              </Card>
            );
          })}
        </Box>
      )}

      <Paper
        variant="outlined"
        sx={{
          position: "sticky",
          bottom: 72,
          p: 1.5,
          bgcolor: "background.paper",
        }}
      >
        <Stack direction="row" spacing={1.5}>
          <Button
            fullWidth
            size="large"
            color="error"
            variant="contained"
            startIcon={<WarningRoundedIcon />}
            onClick={() => setShowBlackoutConfirm(true)}
            disabled={isPerformingAction || controlMode !== "panel" || panelLocked}
          >
            Blackout
          </Button>
          <Button
            fullWidth
            size="large"
            color="primary"
            variant="outlined"
            startIcon={<StopRoundedIcon />}
            onClick={handleStop}
            disabled={isPerformingAction || panelLocked}
          >
            Stop
          </Button>
        </Stack>
      </Paper>

      <Dialog open={showBlackoutConfirm} onClose={() => setShowBlackoutConfirm(false)}>
        <DialogTitle>Blackout auslösen?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Alle Kanäle werden sofort auf 0 gesetzt.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowBlackoutConfirm(false)}>Abbrechen</Button>
          <Button color="error" variant="contained" onClick={handleBlackout}>
            Blackout
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
