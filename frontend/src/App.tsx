import { useEffect, useState } from "react";
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

  const isAdmin = mode === "admin";

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
      // Status is optional for UI rendering; ignore errors here.
    }
  };

  useEffect(() => {
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
        // Ignore malformed event payloads.
      }
    };

    source.addEventListener("status", handleStatusEvent);

    return () => {
      source.removeEventListener("status", handleStatusEvent);
      source.close();
    };
  }, []);

  return (
    <div className="app-shell">
      <div className="app-layer">
        <header className="sticky top-0 z-30 border-b border-slate-800/60 bg-slate-950/70 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-6">
            <div>
              <div className="text-xl font-semibold tracking-tight text-slate-100">
                Venue Light Controller
              </div>
              <div className="mt-1 text-[11px] uppercase tracking-[0.22em] text-slate-500">
                MatriX Control
              </div>
            </div>
            <div className="text-right text-[11px] uppercase tracking-[0.14em] text-slate-400">
              <div className="font-mono opacity-90">
                MODE: {isAdmin ? "Admin" : "Panel"}
              </div>
              <div className="font-mono text-slate-300/90">
                NODE: {status?.node_ip ?? "-"}
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-5 pb-32 pt-6 sm:px-6">
          <div className={isAdmin ? "hidden" : "block"}>
            <OperatorDashboard
              activeSceneId={activeSceneId}
              nodeIp={status?.node_ip ?? null}
              onActiveSceneChange={setActiveSceneId}
            />
          </div>
          <div className={isAdmin ? "block" : "hidden"}>
            <AdminPanel />
          </div>
        </main>

        <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-800/70 bg-slate-950/82 backdrop-blur">
          <div className="mx-auto flex max-w-md items-center justify-between gap-2 px-5 py-3 sm:px-6">
            <button
              className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                !isAdmin
                  ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/30"
                  : "bg-slate-800/80 text-slate-200 hover:bg-slate-700/90"
              }`}
              onClick={() => setMode("operator")}
              type="button"
            >
              Operator
            </button>
            <button
              className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                isAdmin
                  ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/30"
                  : "bg-slate-800/80 text-slate-200 hover:bg-slate-700/90"
              }`}
              onClick={() => setMode("admin")}
              type="button"
            >
              Admin
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}

export default App;
