import { useEffect, useMemo, useState } from "react";
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
  Stack,
  Typography,
} from "@mui/material";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import WarningRoundedIcon from "@mui/icons-material/WarningRounded";

const API_BASE = "";

type StatusResponse = {
  status: string;
  local_ip: string;
  node_ip: string;
};

type Scene = {
  id: string;
  name: string;
  description?: string;
  universes: Record<string, number[]>;
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
    } catch {
      setErrorMessage("Status oder Szenen konnten nicht geladen werden.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [sceneVersion]);

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

      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
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
            return (
              <Card
                key={scene.id}
                variant="outlined"
                sx={{
                  borderColor: isActive ? "primary.main" : "divider",
                  borderWidth: isActive ? 2 : 1,
                  height: "100%",
                }}
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
                      alignItems="flex-start"
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
                      {isPending && <CircularProgress size={18} />}
                    </Stack>
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
