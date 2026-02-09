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
  Fab,
  IconButton,
  Paper,
  Slider,
  Snackbar,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import WarningRoundedIcon from "@mui/icons-material/WarningRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
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
  liveEditSceneName: string | null;
  onActiveSceneChange: (sceneId: string | null) => void;
  sceneVersion: number;
  controlMode: "panel" | "external";
  panelLocked: boolean;
};

export default function OperatorDashboard({
  activeSceneId,
  liveEditSceneName,
  onActiveSceneChange,
  sceneVersion,
  controlMode,
  panelLocked,
}: OperatorDashboardProps) {
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down("sm"));
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPerformingAction, setIsPerformingAction] = useState(false);
  const [pendingSceneId, setPendingSceneId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showBlackoutConfirm, setShowBlackoutConfirm] = useState(false);
  const [masterDimmerPercent, setMasterDimmerPercent] = useState(100);
  const [isMasterDimmerExpandedMobile, setIsMasterDimmerExpandedMobile] = useState(false);
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
    const source = new EventSource(`${API_BASE}/api/events`);
    const handleStatusEvent = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as {
          master_dimmer_percent?: number;
          master_dimmer_mode?: "parameter-aware" | "raw";
        };
        if (typeof data.master_dimmer_percent === "number") {
          setMasterDimmerPercent(data.master_dimmer_percent);
          masterDimmerTargetRef.current = data.master_dimmer_percent;
        }
      } catch {
        // Ignore malformed SSE payloads.
      }
    };
    source.addEventListener("status", handleStatusEvent);
    return () => {
      source.removeEventListener("status", handleStatusEvent);
      source.close();
    };
  }, []);

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
    if (activeSceneId === "__editor_live__") {
      return liveEditSceneName ?? "Unknown";
    }
    if (activeSceneId === "__blackout__") {
      return "Blackout";
    }
    return scenes.find((scene) => scene.id === activeSceneId)?.name ?? activeSceneId;
  }, [activeSceneId, liveEditSceneName, scenes]);

  const isLiveEditActive = activeSceneId === "__editor_live__";

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

  const showMasterDimmerDock = !isPhone || isMasterDimmerExpandedMobile;

  return (
    <Stack spacing={2.5} sx={{ pr: { sm: 12 } }}>
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
            <Chip
              size="small"
              color={isLiveEditActive ? "default" : "primary"}
              label={isLiveEditActive ? `LIVE EDIT: ${activeSceneName}` : `AKTIV: ${activeSceneName}`}
              sx={
                isLiveEditActive
                  ? {
                      bgcolor: "warning.main",
                      color: "warning.contrastText",
                      "& .MuiChip-label": { fontWeight: 700 },
                    }
                  : undefined
              }
            />
          </Stack>
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

      {isPhone && !showMasterDimmerDock ? (
        <Fab
          color="primary"
          onClick={() => setIsMasterDimmerExpandedMobile(true)}
          sx={{
            position: "fixed",
            right: 14,
            bottom: 162,
            zIndex: (theme) => theme.zIndex.appBar + 2,
          }}
          aria-label="Master Dimmer öffnen"
        >
          <TuneRoundedIcon />
        </Fab>
      ) : null}

      {showMasterDimmerDock ? (
        <Box
          sx={{
            position: "fixed",
            right: { xs: 10, sm: 16 },
            bottom: { xs: 168, sm: 126 },
            zIndex: (theme) => theme.zIndex.appBar + 1,
            pointerEvents: "auto",
          }}
        >
          <Paper
            variant="outlined"
            sx={{
              width: { xs: 92, sm: 96 },
              p: 1.1,
              borderRadius: 1,
              bgcolor: "background.paper",
            }}
          >
            <Stack spacing={0.9} alignItems="center">
              <Stack
                direction="row"
                spacing={0.5}
                alignItems="center"
                justifyContent="space-between"
                sx={{ width: "100%" }}
              >
                <Typography
                  variant="caption"
                  fontWeight={700}
                  sx={{ flex: 1, textAlign: "center", lineHeight: 1.15, pl: isPhone ? 1 : 0 }}
                >
                  Master Dimmer
                </Typography>
                {isPhone ? (
                  <IconButton
                    size="small"
                    onClick={() => setIsMasterDimmerExpandedMobile(false)}
                    aria-label="Master Dimmer minimieren"
                    sx={{ p: 0.25 }}
                  >
                    <KeyboardArrowDownRoundedIcon fontSize="small" />
                  </IconButton>
                ) : null}
              </Stack>
              <Typography
                variant="subtitle2"
                fontWeight={800}
                sx={{ mt: 0.2, mb: 1, position: "relative", zIndex: 2 }}
              >
                {`${masterDimmerPercent}%`}
              </Typography>
              <Slider
                orientation="vertical"
                value={masterDimmerPercent}
                min={0}
                max={100}
                step={1}
                onChange={handleMasterDimmerChange}
                valueLabelDisplay="auto"
                disabled={panelLocked}
                sx={{
                  height: { xs: 210, sm: 228 },
                  mt: 0.4,
                  mb: 1.5,
                  py: 0,
                  "& .MuiSlider-rail": {
                    width: 24,
                    opacity: 0.28,
                    borderRadius: 1,
                    top: 0,
                    bottom: 0,
                  },
                  "& .MuiSlider-track": {
                    width: 24,
                    border: 0,
                    borderRadius: 1,
                  },
                  "& .MuiSlider-thumb": {
                    width: 16,
                    height: 16,
                    opacity: 0,
                    boxShadow: "none",
                    pointerEvents: "none",
                  },
                }}
              />
              <Button
                size="small"
                variant="outlined"
                onClick={handleMasterDimmerFull}
                disabled={panelLocked || masterDimmerPercent === 100}
                sx={{ minWidth: 0, width: "100%" }}
              >
                Full
              </Button>
            </Stack>
          </Paper>
        </Box>
      ) : null}

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
