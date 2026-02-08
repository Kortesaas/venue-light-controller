import { useEffect, useState } from "react";
import {
  AppBar,
  BottomNavigation,
  BottomNavigationAction,
  Box,
  Container,
  Toolbar,
  Typography,
} from "@mui/material";
import DashboardRoundedIcon from "@mui/icons-material/DashboardRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import AdminPanel from "./pages/AdminPanel";
import OperatorDashboard from "./pages/OperatorDashboard";

const API_BASE = "";

type Mode = "operator" | "admin";

type StatusResponse = {
  status: string;
  local_ip: string;
  node_ip: string;
  active_scene_id?: string | null;
  control_mode?: "panel" | "external";
};

function App() {
  const [mode, setMode] = useState<Mode>("operator");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const [controlMode, setControlMode] = useState<"panel" | "external">("panel");

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
          control_mode?: "panel" | "external";
        };
        if (typeof data.active_scene_id !== "undefined") {
          setActiveSceneId(data.active_scene_id ?? null);
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
    const handleSettingsEvent = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as {
          node_ip: string;
        };
        setStatus((prev) => (prev ? { ...prev, node_ip: data.node_ip } : prev));
      } catch {
        // Ignore malformed SSE payloads.
      }
    };
    source.addEventListener("scenes", handleScenesEvent);
    source.addEventListener("settings", handleSettingsEvent);
    return () => {
      source.removeEventListener("status", handleStatusEvent);
      source.removeEventListener("scenes", handleScenesEvent);
      source.removeEventListener("settings", handleSettingsEvent);
      source.close();
    };
  }, []);

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
          <Box textAlign="right">
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              MODE: {controlMode === "panel" ? "PANEL" : "MA"}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              NODE: {status?.node_ip ?? "-"}
            </Typography>
          </Box>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ py: 3, pb: 12, position: "relative", zIndex: 1 }}>
        {mode === "operator" ? (
          <OperatorDashboard
            activeSceneId={activeSceneId}
            onActiveSceneChange={setActiveSceneId}
            sceneVersion={sceneVersion}
            controlMode={controlMode}
          />
        ) : (
          <AdminPanel
            sceneVersion={sceneVersion}
            controlMode={controlMode}
            onControlModeChange={setControlMode}
          />
        )}
      </Container>

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
    </Box>
  );
}

export default App;
