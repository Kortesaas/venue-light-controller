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
import KeyboardArrowLeftRoundedIcon from "@mui/icons-material/KeyboardArrowLeftRounded";
import KeyboardArrowRightRoundedIcon from "@mui/icons-material/KeyboardArrowRightRounded";
import { getSceneCardSx, getSceneIcon, type SceneStyleMeta } from "../sceneStyle";

const API_BASE = "";

type GroupDimmerState = {
  key: string;
  name: string;
  value_percent: number;
  muted: boolean;
  fixture_count: number;
  channel_count: number;
};

type StatusResponse = {
  status: string;
  local_ip: string;
  node_ip: string;
  master_dimmer_percent?: number;
  master_dimmer_mode?: "parameter-aware" | "raw";
  haze_percent?: number;
  fog_flash_active?: boolean;
  haze_configured?: boolean;
  fog_flash_configured?: boolean;
  show_scene_created_at_on_operator?: boolean;
  group_dimmer_available?: boolean;
  group_dimmers?: GroupDimmerState[];
};

type Scene = {
  id: string;
  name: string;
  description?: string;
  type?: "static" | "dynamic" | "animated";
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
  const [hazePercent, setHazePercent] = useState(0);
  const [fogFlashActive, setFogFlashActive] = useState(false);
  const [isHazeConfigured, setIsHazeConfigured] = useState(false);
  const [isFogConfigured, setIsFogConfigured] = useState(false);
  const [isMasterDimmerExpandedMobile, setIsMasterDimmerExpandedMobile] = useState(false);
  const [isGroupMixerExpanded, setIsGroupMixerExpanded] = useState(false);
  const [isGroupDimmerAvailable, setIsGroupDimmerAvailable] = useState(false);
  const [groupDimmers, setGroupDimmers] = useState<GroupDimmerState[]>([]);
  const [showSceneCreatedAt, setShowSceneCreatedAt] = useState(true);
  const masterDimmerTargetRef = useRef(100);
  const masterDimmerTimerRef = useRef<number | null>(null);
  const masterDimmerRequestSeqRef = useRef(0);
  const masterDimmerLocalHoldUntilRef = useRef(0);
  const hazeTargetRef = useRef(0);
  const hazeTimerRef = useRef<number | null>(null);
  const hazeRequestSeqRef = useRef(0);
  const hazeLocalHoldUntilRef = useRef(0);
  const fogDesiredRef = useRef(false);
  const fogRequestSeqRef = useRef(0);
  const fogLocalHoldUntilRef = useRef(0);
  const groupDimmerTargetRef = useRef<Record<string, number>>({});
  const groupDimmerTimerRef = useRef<Record<string, number>>({});
  const groupDimmerRequestSeqRef = useRef<Record<string, number>>({});
  const groupDimmerLocalHoldUntilRef = useRef<Record<string, number>>({});
  const groupMuteDesiredRef = useRef<Record<string, boolean>>({});
  const groupMuteRequestSeqRef = useRef<Record<string, number>>({});
  const groupMuteLocalHoldUntilRef = useRef<Record<string, number>>({});

  const holdMasterDimmerRemoteSync = (durationMs: number) => {
    const nextUntil = Date.now() + durationMs;
    if (nextUntil > masterDimmerLocalHoldUntilRef.current) {
      masterDimmerLocalHoldUntilRef.current = nextUntil;
    }
  };

  const shouldIgnoreRemoteMasterDimmer = (incomingValue: number) =>
    Date.now() < masterDimmerLocalHoldUntilRef.current &&
    incomingValue !== masterDimmerTargetRef.current;

  const holdHazeRemoteSync = (durationMs: number) => {
    const nextUntil = Date.now() + durationMs;
    if (nextUntil > hazeLocalHoldUntilRef.current) {
      hazeLocalHoldUntilRef.current = nextUntil;
    }
  };

  const shouldIgnoreRemoteHaze = (incomingValue: number) =>
    Date.now() < hazeLocalHoldUntilRef.current && incomingValue !== hazeTargetRef.current;

  const holdFogRemoteSync = (durationMs: number) => {
    const nextUntil = Date.now() + durationMs;
    if (nextUntil > fogLocalHoldUntilRef.current) {
      fogLocalHoldUntilRef.current = nextUntil;
    }
  };

  const shouldIgnoreRemoteFog = (incomingValue: boolean) =>
    Date.now() < fogLocalHoldUntilRef.current && incomingValue !== fogDesiredRef.current;

  const holdGroupDimmerRemoteSync = (key: string, durationMs: number) => {
    const nextUntil = Date.now() + durationMs;
    const current = groupDimmerLocalHoldUntilRef.current[key] ?? 0;
    if (nextUntil > current) {
      groupDimmerLocalHoldUntilRef.current[key] = nextUntil;
    }
  };

  const shouldIgnoreRemoteGroupDimmer = (key: string, incomingValue: number) =>
    Date.now() < (groupDimmerLocalHoldUntilRef.current[key] ?? 0) &&
    incomingValue !== (groupDimmerTargetRef.current[key] ?? incomingValue);

  const holdGroupMuteRemoteSync = (key: string, durationMs: number) => {
    const nextUntil = Date.now() + durationMs;
    const current = groupMuteLocalHoldUntilRef.current[key] ?? 0;
    if (nextUntil > current) {
      groupMuteLocalHoldUntilRef.current[key] = nextUntil;
    }
  };

  const shouldIgnoreRemoteGroupMute = (key: string, incomingValue: boolean) =>
    Date.now() < (groupMuteLocalHoldUntilRef.current[key] ?? 0) &&
    incomingValue !== (groupMuteDesiredRef.current[key] ?? incomingValue);

  const mergeGroupDimmerStatus = (
    available: boolean | undefined,
    remoteGroups: GroupDimmerState[] | undefined
  ) => {
    if (typeof available === "boolean") {
      setIsGroupDimmerAvailable(available);
      if (!available) {
        setIsGroupMixerExpanded(false);
      }
    }
    if (!Array.isArray(remoteGroups)) {
      return;
    }

    const nextGroups = remoteGroups.map((group) => {
      const value = shouldIgnoreRemoteGroupDimmer(group.key, group.value_percent)
        ? (groupDimmerTargetRef.current[group.key] ?? group.value_percent)
        : group.value_percent;
      const muted = shouldIgnoreRemoteGroupMute(group.key, group.muted)
        ? (groupMuteDesiredRef.current[group.key] ?? group.muted)
        : group.muted;
      groupDimmerTargetRef.current[group.key] = value;
      groupMuteDesiredRef.current[group.key] = muted;
      return { ...group, value_percent: value, muted };
    });

    const validKeys = new Set(nextGroups.map((group) => group.key));
    for (const key of Object.keys(groupDimmerTargetRef.current)) {
      if (!validKeys.has(key)) {
        delete groupDimmerTargetRef.current[key];
        delete groupDimmerRequestSeqRef.current[key];
        delete groupDimmerLocalHoldUntilRef.current[key];
        delete groupMuteDesiredRef.current[key];
        delete groupMuteRequestSeqRef.current[key];
        delete groupMuteLocalHoldUntilRef.current[key];
        const timer = groupDimmerTimerRef.current[key];
        if (typeof timer === "number") {
          window.clearTimeout(timer);
          delete groupDimmerTimerRef.current[key];
        }
      }
    }
    setGroupDimmers(nextGroups);
  };

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
      if (typeof statusData.haze_percent === "number") {
        if (!shouldIgnoreRemoteHaze(statusData.haze_percent)) {
          setHazePercent(statusData.haze_percent);
          hazeTargetRef.current = statusData.haze_percent;
        }
      }
      if (typeof statusData.fog_flash_active === "boolean") {
        if (!shouldIgnoreRemoteFog(statusData.fog_flash_active)) {
          setFogFlashActive(statusData.fog_flash_active);
          fogDesiredRef.current = statusData.fog_flash_active;
        }
      }
      setIsHazeConfigured(Boolean(statusData.haze_configured));
      setIsFogConfigured(Boolean(statusData.fog_flash_configured));
      if (typeof statusData.show_scene_created_at_on_operator === "boolean") {
        setShowSceneCreatedAt(statusData.show_scene_created_at_on_operator);
      }
      mergeGroupDimmerStatus(statusData.group_dimmer_available, statusData.group_dimmers);
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
          haze_percent?: number;
          fog_flash_active?: boolean;
          haze_configured?: boolean;
          fog_flash_configured?: boolean;
          show_scene_created_at_on_operator?: boolean;
          group_dimmer_available?: boolean;
          group_dimmers?: GroupDimmerState[];
        };
        if (typeof data.master_dimmer_percent === "number") {
          if (!shouldIgnoreRemoteMasterDimmer(data.master_dimmer_percent)) {
            setMasterDimmerPercent(data.master_dimmer_percent);
            masterDimmerTargetRef.current = data.master_dimmer_percent;
          }
        }
        if (typeof data.haze_percent === "number") {
          if (!shouldIgnoreRemoteHaze(data.haze_percent)) {
            setHazePercent(data.haze_percent);
            hazeTargetRef.current = data.haze_percent;
          }
        }
        if (typeof data.fog_flash_active === "boolean") {
          if (!shouldIgnoreRemoteFog(data.fog_flash_active)) {
            setFogFlashActive(data.fog_flash_active);
            fogDesiredRef.current = data.fog_flash_active;
          }
        }
        if (typeof data.haze_configured === "boolean") {
          setIsHazeConfigured(data.haze_configured);
        }
        if (typeof data.fog_flash_configured === "boolean") {
          setIsFogConfigured(data.fog_flash_configured);
        }
        if (typeof data.show_scene_created_at_on_operator === "boolean") {
          setShowSceneCreatedAt(data.show_scene_created_at_on_operator);
        }
        mergeGroupDimmerStatus(data.group_dimmer_available, data.group_dimmers);
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
      if (hazeTimerRef.current !== null) {
        window.clearTimeout(hazeTimerRef.current);
      }
      for (const timer of Object.values(groupDimmerTimerRef.current)) {
        window.clearTimeout(timer);
      }
      groupDimmerTimerRef.current = {};
    };
  }, []);

  const pushMasterDimmer = async (valuePercent: number) => {
    const requestSeq = masterDimmerRequestSeqRef.current + 1;
    masterDimmerRequestSeqRef.current = requestSeq;
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
      if (requestSeq !== masterDimmerRequestSeqRef.current) {
        return;
      }
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
    holdMasterDimmerRemoteSync(600);
    queueMasterDimmerUpdate(next);
  };

  const handleMasterDimmerCommit = () => {
    holdMasterDimmerRemoteSync(600);
    if (masterDimmerTimerRef.current !== null) {
      window.clearTimeout(masterDimmerTimerRef.current);
      masterDimmerTimerRef.current = null;
      void pushMasterDimmer(masterDimmerTargetRef.current);
    }
  };

  const handleMasterDimmerFull = () => {
    setMasterDimmerPercent(100);
    masterDimmerTargetRef.current = 100;
    holdMasterDimmerRemoteSync(600);
    if (masterDimmerTimerRef.current !== null) {
      window.clearTimeout(masterDimmerTimerRef.current);
      masterDimmerTimerRef.current = null;
    }
    void pushMasterDimmer(100);
  };

  const pushHaze = async (valuePercent: number) => {
    const requestSeq = hazeRequestSeqRef.current + 1;
    hazeRequestSeqRef.current = requestSeq;
    try {
      const res = await fetch(`${API_BASE}/api/atmosphere/haze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value_percent: valuePercent }),
      });
      if (!res.ok) {
        throw new Error("haze update failed");
      }
      const data = (await res.json()) as {
        haze_percent: number;
      };
      if (requestSeq !== hazeRequestSeqRef.current) {
        return;
      }
      setHazePercent(data.haze_percent);
      hazeTargetRef.current = data.haze_percent;
    } catch {
      setErrorMessage("Haze konnte nicht gesetzt werden.");
    }
  };

  const queueHazeUpdate = (valuePercent: number) => {
    hazeTargetRef.current = valuePercent;
    if (hazeTimerRef.current !== null) {
      return;
    }
    hazeTimerRef.current = window.setTimeout(() => {
      hazeTimerRef.current = null;
      void pushHaze(hazeTargetRef.current);
    }, 80);
  };

  const handleHazeChange = (_event: Event, value: number | number[]) => {
    const next = Array.isArray(value) ? value[0] : value;
    setHazePercent(next);
    holdHazeRemoteSync(600);
    queueHazeUpdate(next);
  };

  const handleHazeCommit = () => {
    holdHazeRemoteSync(600);
    if (hazeTimerRef.current !== null) {
      window.clearTimeout(hazeTimerRef.current);
      hazeTimerRef.current = null;
      void pushHaze(hazeTargetRef.current);
    }
  };

  const setFogFlash = async (active: boolean) => {
    if (!isFogConfigured || panelLocked || controlMode !== "panel") {
      return;
    }
    const requestSeq = fogRequestSeqRef.current + 1;
    fogRequestSeqRef.current = requestSeq;
    fogDesiredRef.current = active;
    holdFogRemoteSync(400);
    setFogFlashActive(active);
    try {
      const res = await fetch(`${API_BASE}/api/atmosphere/fog-flash`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      if (!res.ok) {
        throw new Error("fog update failed");
      }
      const data = (await res.json()) as {
        fog_flash_active?: boolean;
      };
      if (requestSeq !== fogRequestSeqRef.current) {
        return;
      }
      if (typeof data.fog_flash_active === "boolean") {
        setFogFlashActive(data.fog_flash_active);
        fogDesiredRef.current = data.fog_flash_active;
      }
    } catch {
      setErrorMessage("Fog Flash konnte nicht gesetzt werden.");
    }
  };

  const updateLocalGroupDimmer = (
    groupKey: string,
    updater: (group: GroupDimmerState) => GroupDimmerState
  ) => {
    setGroupDimmers((prev) => prev.map((group) => (group.key === groupKey ? updater(group) : group)));
  };

  const pushGroupDimmer = async (groupKey: string, valuePercent: number) => {
    const requestSeq = (groupDimmerRequestSeqRef.current[groupKey] ?? 0) + 1;
    groupDimmerRequestSeqRef.current[groupKey] = requestSeq;
    try {
      const res = await fetch(`${API_BASE}/api/group-dimmers/${encodeURIComponent(groupKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value_percent: valuePercent }),
      });
      if (!res.ok) {
        throw new Error("group dimmer update failed");
      }
      const data = (await res.json()) as { value_percent: number; muted: boolean };
      if (requestSeq !== groupDimmerRequestSeqRef.current[groupKey]) {
        return;
      }
      groupDimmerTargetRef.current[groupKey] = data.value_percent;
      groupMuteDesiredRef.current[groupKey] = data.muted;
      updateLocalGroupDimmer(groupKey, (group) => ({
        ...group,
        value_percent: data.value_percent,
        muted: data.muted,
      }));
    } catch {
      setErrorMessage("Group Dimmer konnte nicht gesetzt werden.");
    }
  };

  const queueGroupDimmerUpdate = (groupKey: string, valuePercent: number) => {
    groupDimmerTargetRef.current[groupKey] = valuePercent;
    if (typeof groupDimmerTimerRef.current[groupKey] === "number") {
      return;
    }
    groupDimmerTimerRef.current[groupKey] = window.setTimeout(() => {
      delete groupDimmerTimerRef.current[groupKey];
      void pushGroupDimmer(groupKey, groupDimmerTargetRef.current[groupKey] ?? valuePercent);
    }, 80);
  };

  const handleGroupDimmerChange = (groupKey: string, value: number | number[]) => {
    const next = Array.isArray(value) ? value[0] : value;
    holdGroupDimmerRemoteSync(groupKey, 600);
    updateLocalGroupDimmer(groupKey, (group) => ({ ...group, value_percent: next }));
    queueGroupDimmerUpdate(groupKey, next);
  };

  const handleGroupDimmerCommit = (groupKey: string) => {
    holdGroupDimmerRemoteSync(groupKey, 600);
    const timer = groupDimmerTimerRef.current[groupKey];
    if (typeof timer === "number") {
      window.clearTimeout(timer);
      delete groupDimmerTimerRef.current[groupKey];
      void pushGroupDimmer(groupKey, groupDimmerTargetRef.current[groupKey] ?? 100);
    }
  };

  const setGroupMute = async (groupKey: string, active: boolean) => {
    if (!isGroupDimmerAvailable || panelLocked || controlMode !== "panel") {
      return;
    }
    const requestSeq = (groupMuteRequestSeqRef.current[groupKey] ?? 0) + 1;
    groupMuteRequestSeqRef.current[groupKey] = requestSeq;
    holdGroupMuteRemoteSync(groupKey, 600);
    groupMuteDesiredRef.current[groupKey] = active;
    updateLocalGroupDimmer(groupKey, (group) => ({ ...group, muted: active }));
    try {
      const res = await fetch(
        `${API_BASE}/api/group-dimmers/${encodeURIComponent(groupKey)}/mute`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active }),
        }
      );
      if (!res.ok) {
        throw new Error("group dimmer mute update failed");
      }
      const data = (await res.json()) as { value_percent: number; muted: boolean };
      if (requestSeq !== groupMuteRequestSeqRef.current[groupKey]) {
        return;
      }
      groupDimmerTargetRef.current[groupKey] = data.value_percent;
      groupMuteDesiredRef.current[groupKey] = data.muted;
      updateLocalGroupDimmer(groupKey, (group) => ({
        ...group,
        value_percent: data.value_percent,
        muted: data.muted,
      }));
    } catch {
      setErrorMessage("Group Dimmer Mute konnte nicht gesetzt werden.");
    }
  };

  const handleToggleGroupMixer = () => {
    if (!isGroupDimmerAvailable) {
      setErrorMessage("Group Dimmer Mixer benötigt einen aktiven MA3 Fixture-Plan.");
      return;
    }
    setIsGroupMixerExpanded((prev) => !prev);
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
  const isDynamicScene = (scene: Scene) => scene.type === "dynamic" || scene.type === "animated";

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
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 1,
          }}
        >
          {isGroupMixerExpanded && isGroupDimmerAvailable ? (
            <Paper
              variant="outlined"
              sx={{
                maxWidth: { xs: "calc(100vw - 132px)", sm: "min(72vw, 760px)" },
                p: 1,
                borderRadius: 1,
                bgcolor: "background.paper",
              }}
            >
              <Stack direction="row" spacing={0.9} sx={{ overflowX: "auto", pb: 0.2 }}>
                {groupDimmers.length === 0 ? (
                  <Box sx={{ px: 1.5, py: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                      Keine Dimmer-Gruppen im aktiven Fixture-Plan gefunden.
                    </Typography>
                  </Box>
                ) : (
                  groupDimmers.map((group) => (
                    <Paper
                      key={group.key}
                      variant="outlined"
                      sx={{
                        width: 94,
                        p: 0.75,
                        borderRadius: 1,
                        flex: "0 0 auto",
                        bgcolor: "background.paper",
                      }}
                    >
                      <Stack spacing={0.7} alignItems="center">
                        <Button
                          size="small"
                          variant={group.muted ? "contained" : "outlined"}
                          color={group.muted ? "warning" : "inherit"}
                          disabled={panelLocked || controlMode !== "panel"}
                          onClick={() => void setGroupMute(group.key, !group.muted)}
                          sx={{
                            minWidth: 0,
                            width: "100%",
                            minHeight: 34,
                            py: 0.2,
                            fontWeight: 800,
                            lineHeight: 1,
                            fontSize: 10.5,
                          }}
                        >
                          MUTE
                        </Button>
                        <Tooltip
                          title={`${group.fixture_count} fixtures • ${group.channel_count} dimmer channels`}
                        >
                          <Typography
                            variant="caption"
                            fontWeight={700}
                            sx={{
                              width: "100%",
                              lineHeight: 1.1,
                              textAlign: "center",
                              minHeight: 22,
                              display: "-webkit-box",
                              overflow: "hidden",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                            }}
                          >
                            {group.name}
                          </Typography>
                        </Tooltip>
                        <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 0.4 }}>
                          {`${group.value_percent}%`}
                        </Typography>
                        <Slider
                          orientation="vertical"
                          value={group.value_percent}
                          min={0}
                          max={100}
                          step={1}
                          onChange={(_event, value) => handleGroupDimmerChange(group.key, value)}
                          onChangeCommitted={() => handleGroupDimmerCommit(group.key)}
                          valueLabelDisplay="off"
                          disabled={panelLocked || controlMode !== "panel"}
                          sx={{
                            height: { xs: 170, sm: 186 },
                            mt: 0.2,
                            mb: 0.4,
                            py: 0,
                            "& .MuiSlider-rail": {
                              width: 18,
                              opacity: 0.28,
                              borderRadius: 1,
                              top: 0,
                              bottom: 0,
                            },
                            "& .MuiSlider-track": {
                              width: 18,
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
                      </Stack>
                    </Paper>
                  ))
                )}
              </Stack>
            </Paper>
          ) : null}

          <Paper
            variant="outlined"
            sx={{
              width: { xs: 92, sm: 96 },
              p: 1,
              borderRadius: 1,
              bgcolor: "background.paper",
            }}
          >
            <Stack spacing={0.9} alignItems="center">
              <Button
                size="small"
                variant={fogFlashActive ? "contained" : "outlined"}
                color={fogFlashActive ? "warning" : "inherit"}
                disabled={panelLocked || controlMode !== "panel" || !isFogConfigured}
                onPointerDown={() => void setFogFlash(true)}
                onPointerUp={() => void setFogFlash(false)}
                onPointerCancel={() => void setFogFlash(false)}
                onPointerLeave={() => void setFogFlash(false)}
                sx={{
                  minWidth: 0,
                  width: "100%",
                  minHeight: 38,
                  py: 0.2,
                  fontWeight: 800,
                  lineHeight: 1,
                  fontSize: 10.5,
                  whiteSpace: "pre-line",
                }}
              >
                {"FOG\nFLASH"}
              </Button>
              <Stack spacing={0.2} sx={{ width: "100%" }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="caption" fontWeight={700} sx={{ fontSize: 10 }}>
                    Haze
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                    {`${hazePercent}%`}
                  </Typography>
                </Stack>
                <Slider
                  value={hazePercent}
                  min={0}
                  max={100}
                  step={1}
                  onChange={handleHazeChange}
                  onChangeCommitted={handleHazeCommit}
                  valueLabelDisplay="off"
                  disabled={panelLocked || controlMode !== "panel" || !isHazeConfigured}
                  sx={{
                    py: 0.15,
                    "& .MuiSlider-thumb": {
                      width: 0,
                      height: 0,
                      opacity: 0,
                      boxShadow: "none",
                    },
                  }}
                />
              </Stack>
              <Box sx={{ width: "100%", borderTop: "1px solid", borderColor: "divider", my: 0.15 }} />
              <Stack
                direction="row"
                spacing={0.3}
                alignItems="center"
                justifyContent="space-between"
                sx={{ width: "100%" }}
              >
                <IconButton
                  size="small"
                  onClick={handleToggleGroupMixer}
                  aria-label="Group Dimmer Mixer umschalten"
                  sx={{
                    p: 0.25,
                    color: isGroupDimmerAvailable ? "text.primary" : "text.disabled",
                  }}
                >
                  {isGroupMixerExpanded ? (
                    <KeyboardArrowRightRoundedIcon fontSize="small" />
                  ) : (
                    <KeyboardArrowLeftRoundedIcon fontSize="small" />
                  )}
                </IconButton>
                <Typography
                  variant="caption"
                  fontWeight={700}
                  sx={{ flex: 1, textAlign: "center", lineHeight: 1.15 }}
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
                ) : (
                  <Box sx={{ width: 20 }} />
                )}
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
                onChangeCommitted={handleMasterDimmerCommit}
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
                        <Typography
                          variant="caption"
                          sx={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            px: 0.55,
                            py: 0.25,
                            minHeight: 20,
                            lineHeight: 1,
                            borderRadius: 0.6,
                            border: "1px solid",
                            borderColor: "divider",
                            color: "text.secondary",
                            fontWeight: 700,
                            letterSpacing: 0.2,
                          }}
                        >
                          {isDynamicScene(scene) ? "DYNAMIC" : "STATIC"}
                        </Typography>
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
                    {showSceneCreatedAt && createdAtText && createdAtShort ? (
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
