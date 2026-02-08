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
};

function App() {
  const [mode, setMode] = useState<Mode>("operator");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);

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
        };
        if (typeof data.active_scene_id !== "undefined") {
          setActiveSceneId(data.active_scene_id ?? null);
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

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="sticky" color="default" elevation={0}>
        <Toolbar sx={{ justifyContent: "space-between", py: 0.5 }}>
          <Box>
            <Typography variant="h6" fontWeight={700}>
              Venue Light Controller
            </Typography>
            <Typography variant="caption" color="text.secondary">
              MatriX Licht Szenen
            </Typography>
          </Box>
          <Box textAlign="right">
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              MODE: {mode === "admin" ? "Admin" : "Panel"}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              NODE: {status?.node_ip ?? "-"}
            </Typography>
          </Box>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ py: 3, pb: 12 }}>
        {mode === "operator" ? (
          <OperatorDashboard
            activeSceneId={activeSceneId}
            onActiveSceneChange={setActiveSceneId}
          />
        ) : (
          <AdminPanel />
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
