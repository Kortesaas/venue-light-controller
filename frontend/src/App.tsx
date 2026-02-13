import { useEffect, useState } from "react";
import {
  Alert,
  AppBar,
  BottomNavigation,
  BottomNavigationAction,
  Box,
  Button,
  Container,
  Dialog,
  DialogContent,
  DialogTitle,
  Snackbar,
  Stack,
  Toolbar,
  Typography,
} from "@mui/material";
import DashboardRoundedIcon from "@mui/icons-material/DashboardRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import LockRoundedIcon from "@mui/icons-material/LockRounded";
import QrCode2RoundedIcon from "@mui/icons-material/QrCode2Rounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import { QRCodeSVG } from "qrcode.react";
import AdminPanel from "./pages/AdminPanel";
import OperatorDashboard from "./pages/OperatorDashboard";

const API_BASE = "";

type Mode = "operator" | "admin";

type StatusResponse = {
  status: string;
  local_ip: string;
  node_ip: string;
  active_scene_id?: string | null;
  live_edit_scene_name?: string | null;
  control_mode?: "panel" | "external";
};

const PANEL_LOCK_STORAGE_KEY = "operator_panel_locked";

function App() {
  const [mode, setMode] = useState<Mode>("operator");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [liveEditSceneName, setLiveEditSceneName] = useState<string | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const [controlMode, setControlMode] = useState<"panel" | "external">("panel");
  const [panelLocked, setPanelLocked] = useState<boolean>(() => {
    const persisted = localStorage.getItem(PANEL_LOCK_STORAGE_KEY);
    if (persisted === "true" || persisted === "false") {
      return persisted === "true";
    }
    return true;
  });
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [snackbar, setSnackbar] = useState<{
    severity: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [isQrDialogOpen, setIsQrDialogOpen] = useState(false);

  useEffect(() => {
    const loadStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/status`);
        if (!res.ok) {
          throw new Error("Failed to load status");
        }
        const data = (await res.json()) as StatusResponse;
        setStatus(data);
        if (typeof data.active_scene_id !== "undefined") {
          setActiveSceneId(data.active_scene_id ?? null);
        }
        if (typeof data.live_edit_scene_name !== "undefined") {
          setLiveEditSceneName(data.live_edit_scene_name ?? null);
        }
        if (typeof data.control_mode !== "undefined") {
          setControlMode(data.control_mode);
        }
      } catch {
        // Ignore status fetch errors for initial render.
      }
    };

    void loadStatus();
  }, []);

  useEffect(() => {
    const source = new EventSource(`${API_BASE}/api/events`);
    const handleStatusEvent = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as {
          active_scene_id?: string | null;
          live_edit_scene_name?: string | null;
          control_mode?: "panel" | "external";
        };
        if (typeof data.active_scene_id !== "undefined") {
          setActiveSceneId(data.active_scene_id ?? null);
        }
        if (typeof data.live_edit_scene_name !== "undefined") {
          setLiveEditSceneName(data.live_edit_scene_name ?? null);
        }
        if (data.control_mode === "panel" || data.control_mode === "external") {
          setControlMode(data.control_mode);
        }
      } catch {
        // Ignore malformed SSE payloads.
      }
    };

    source.addEventListener("status", handleStatusEvent);
    const handleScenesEvent = () => {
      setSceneVersion((prev) => prev + 1);
    };
    const handleFixturePlanEvent = () => {
      setSceneVersion((prev) => prev + 1);
    };
    const handleSettingsEvent = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as {
          node_ip: string;
          local_ip?: string;
        };
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                node_ip: data.node_ip,
                local_ip: data.local_ip ?? prev.local_ip,
              }
            : prev
        );
      } catch {
        // Ignore malformed SSE payloads.
      }
    };
    source.addEventListener("scenes", handleScenesEvent);
    source.addEventListener("fixture-plan", handleFixturePlanEvent);
    source.addEventListener("settings", handleSettingsEvent);
    return () => {
      source.removeEventListener("status", handleStatusEvent);
      source.removeEventListener("scenes", handleScenesEvent);
      source.removeEventListener("fixture-plan", handleFixturePlanEvent);
      source.removeEventListener("settings", handleSettingsEvent);
      source.close();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(PANEL_LOCK_STORAGE_KEY, panelLocked ? "true" : "false");
  }, [panelLocked]);

  const handleLockPanel = async () => {
    setPanelLocked(true);
    setPinInput("");
    setPinError(null);
    setSnackbar({ severity: "info", message: "Panel locked." });
  };

  const handlePinDigit = (digit: string) => {
    if (isUnlocking) {
      return;
    }
    setPinError(null);
    setPinInput((prev) => (prev.length >= 4 ? prev : `${prev}${digit}`));
  };

  const handleClearPin = () => {
    if (isUnlocking) {
      return;
    }
    setPinInput("");
    setPinError(null);
  };

  const handleUnlockPanel = async () => {
    if (isUnlocking) {
      return;
    }
    if (pinInput.length !== 4) {
      setPinError("Enter 4 digits.");
      return;
    }

    setIsUnlocking(true);
    setPinError(null);
    try {
      const res = await fetch(`${API_BASE}/api/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinInput }),
      });
      if (!res.ok) {
        throw new Error("Unlock failed");
      }
      setPanelLocked(false);
      setPinInput("");
      setSnackbar({ severity: "success", message: "Panel unlocked." });
    } catch {
      setPinError("Invalid PIN.");
      setPinInput("");
    } finally {
      setIsUnlocking(false);
    }
  };

  const connectUrl = `http://${status?.local_ip ?? window.location.hostname}:8000`;

  const handleCopyConnectUrl = async () => {
    try {
      await navigator.clipboard.writeText(connectUrl);
      setSnackbar({ severity: "success", message: "Link copied." });
    } catch {
      setSnackbar({ severity: "error", message: "Could not copy link." });
    }
  };

  const keypadKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const digitButtonSx = {
    py: 1.75,
    fontSize: 24,
    fontWeight: 700,
    borderWidth: 1,
    borderColor: "divider",
    bgcolor: "background.paper",
    color: "text.primary",
    "&:hover": {
      borderColor: "primary.main",
      bgcolor: "rgba(255,255,255,0.12)",
    },
  } as const;

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", position: "relative" }}>
      <Box
        sx={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          opacity: 0.2,
          backgroundImage: "url('/MatriX_Saal_Light_BG.png')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />
      <AppBar position="sticky" color="default" elevation={0}>
        <Toolbar sx={{ justifyContent: "space-between", py: 0.5 }}>
          <Box>
            <Typography variant="h6" fontWeight={700}>
              MatriX Saal Lichtszenen
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Art-Net Snapshot Controller
            </Typography>
          </Box>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Button
              size="small"
              color="inherit"
              variant="outlined"
              startIcon={<QrCode2RoundedIcon />}
              onClick={() => setIsQrDialogOpen(true)}
            >
              Connect
            </Button>
            {!panelLocked ? (
              <Button
                size="small"
                color="inherit"
                variant="outlined"
                startIcon={<LockRoundedIcon />}
                onClick={() => void handleLockPanel()}
              >
                Lock
              </Button>
            ) : null}
            <Box textAlign="right">
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                MODE: {controlMode === "panel" ? "PANEL" : "MA"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                NODE: {status?.node_ip ?? "-"}
              </Typography>
            </Box>
          </Stack>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ py: 3, pb: 12, position: "relative", zIndex: 1 }}>
        {mode === "operator" ? (
          <OperatorDashboard
            activeSceneId={activeSceneId}
            liveEditSceneName={liveEditSceneName}
            onActiveSceneChange={setActiveSceneId}
            sceneVersion={sceneVersion}
            controlMode={controlMode}
            panelLocked={panelLocked}
          />
        ) : (
          <AdminPanel
            sceneVersion={sceneVersion}
            controlMode={controlMode}
            onControlModeChange={setControlMode}
          />
        )}
      </Container>

      {panelLocked ? (
        <Box
          sx={{
            position: "fixed",
            inset: 0,
            zIndex: (theme) => theme.zIndex.modal + 2,
            bgcolor: "rgba(7, 11, 20, 0.58)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            p: 2,
          }}
        >
          <Box
            sx={{
              width: "100%",
              maxWidth: 460,
              borderRadius: 3,
              border: "1px solid rgba(255,255,255,0.16)",
              bgcolor: "rgba(13, 21, 36, 0.18)",
              backdropFilter: "blur(12px)",
              p: { xs: 2, sm: 3 },
              boxShadow: "0 16px 44px rgba(0,0,0,0.36)",
            }}
          >
            <Typography variant="h4" fontWeight={800} textAlign="center">
              Panel Locked
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              textAlign="center"
              sx={{ mt: 0.5 }}
            >
              Tap digits to unlock
            </Typography>

            <Stack direction="row" spacing={1.2} justifyContent="center" sx={{ mt: 2.5, mb: 2 }}>
              {[0, 1, 2, 3].map((index) => (
                <Box
                  key={index}
                  sx={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    border: "2px solid",
                    borderColor: pinInput.length > index ? "primary.main" : "rgba(255,255,255,0.35)",
                    bgcolor: pinInput.length > index ? "primary.main" : "transparent",
                  }}
                />
              ))}
            </Stack>

            {pinError ? (
              <Typography variant="body2" color="error.main" textAlign="center" sx={{ mb: 1.5 }}>
                {pinError}
              </Typography>
            ) : (
              <Box sx={{ height: 28 }} />
            )}

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 1,
              }}
            >
              {keypadKeys.map((key) => (
                <Button
                  key={key}
                  variant="outlined"
                  color="inherit"
                  sx={digitButtonSx}
                  onClick={() => handlePinDigit(key)}
                  disabled={isUnlocking}
                >
                  {key}
                </Button>
              ))}
              <Button
                variant="outlined"
                color="inherit"
                sx={{ py: 1.75, fontWeight: 700 }}
                onClick={handleClearPin}
                disabled={isUnlocking}
              >
                Clear
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                sx={digitButtonSx}
                onClick={() => handlePinDigit("0")}
                disabled={isUnlocking}
              >
                0
              </Button>
              <Button
                variant="contained"
                color="success"
                sx={{ py: 1.75, fontWeight: 700 }}
                onClick={() => void handleUnlockPanel()}
                disabled={isUnlocking}
              >
                OK
              </Button>
            </Box>
          </Box>
        </Box>
      ) : null}

      <Box
        sx={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          borderTop: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
          zIndex: (theme) => theme.zIndex.appBar,
        }}
      >
        <BottomNavigation
          showLabels
          value={mode}
          onChange={(_event, newValue: Mode) => setMode(newValue)}
        >
          <BottomNavigationAction
            label="Operator"
            value="operator"
            icon={<DashboardRoundedIcon />}
          />
          <BottomNavigationAction
            label="Admin"
            value="admin"
            icon={<SettingsRoundedIcon />}
          />
        </BottomNavigation>
      </Box>

      <Snackbar
        open={snackbar !== null}
        autoHideDuration={2200}
        onClose={() => setSnackbar(null)}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        sx={{ zIndex: (theme) => theme.zIndex.tooltip + 100 }}
      >
        <Alert severity={snackbar?.severity ?? "info"} onClose={() => setSnackbar(null)}>
          {snackbar?.message ?? ""}
        </Alert>
      </Snackbar>

      <Dialog open={isQrDialogOpen} onClose={() => setIsQrDialogOpen(false)}>
        <DialogTitle sx={{ pb: 1 }}>
          <Typography variant="h6" fontWeight={800}>
            Open On Another Device
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Scan this QR code to open the panel directly.
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pb: 2.5 }}>
          <Box
            sx={{
              borderRadius: 2,
              border: "1px solid rgba(255,255,255,0.12)",
              bgcolor: "rgba(255,255,255,0.04)",
              p: 2,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 1.5,
            }}
          >
            <Box
              sx={{
                p: 1.5,
                borderRadius: 1.5,
                bgcolor: "#fff",
              }}
            >
              <QRCodeSVG value={connectUrl} size={220} level="M" includeMargin />
            </Box>
            <Typography
              variant="body2"
              sx={{
                px: 1,
                py: 0.5,
                borderRadius: 1,
                border: "1px solid",
                borderColor: "divider",
                bgcolor: "background.paper",
                fontFamily: "monospace",
                wordBreak: "break-all",
                textAlign: "center",
              }}
            >
              {connectUrl}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={<ContentCopyRoundedIcon />}
              onClick={() => void handleCopyConnectUrl()}
            >
              Copy Link
            </Button>
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  );
}

export default App;

