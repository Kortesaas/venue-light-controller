import { useEffect, useState } from "react";

const API_BASE = "";

type StatusResponse = {
  status: string;
  local_ip: string;
  node_ip: string;
};

type Scene = {
  id: string;
  name: string;
  universes: Record<string, number[]>;
  fade_in?: number;
  fade_out?: number;
};

type SceneCardProps = {
  scene: Scene;
  isActive: boolean;
  isBusy: boolean;
  onPlay: (sceneId: string) => void;
};

function SceneCard({ scene, isActive, isBusy, onPlay }: SceneCardProps) {
  return (
    <button
      className={`min-h-[140px] w-full rounded-2xl border p-5 text-left shadow-lg transition focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
        isActive
          ? "border-emerald-500 bg-slate-800/90 ring-2 ring-emerald-500"
          : "border-slate-800 bg-slate-800/60 hover:-translate-y-0.5 hover:border-slate-700 hover:bg-slate-800/80"
      } ${isBusy ? "cursor-not-allowed opacity-60" : "active:scale-[0.99]"}`}
      onClick={() => onPlay(scene.id)}
      disabled={isBusy}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold text-slate-100">
            {scene.name}
          </div>
          <div className="mt-2 font-mono text-xs uppercase tracking-wide text-slate-400">
            ID: {scene.id}
          </div>
        </div>
        {isActive && (
          <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-200">
            Aktiv
          </span>
        )}
      </div>
      <div className="mt-6 text-sm font-semibold text-emerald-300">
        {isActive ? "Aktiv" : "Tippen zum Abspielen"}
      </div>
    </button>
  );
}

export default function OperatorDashboard() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [isLoadingScenes, setIsLoadingScenes] = useState(true);
  const [isPerformingAction, setIsPerformingAction] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showBlackoutConfirm, setShowBlackoutConfirm] = useState(false);

  useEffect(() => {
    let alive = true;

    const loadData = async () => {
      setIsLoadingScenes(true);
      setErrorMessage(null);

      try {
        const [statusRes, scenesRes] = await Promise.all([
          fetch(`${API_BASE}/api/status`),
          fetch(`${API_BASE}/api/scenes`),
        ]);

        if (!statusRes.ok) {
          throw new Error("Failed to load status");
        }
        if (!scenesRes.ok) {
          throw new Error("Failed to load scenes");
        }

        const statusData = (await statusRes.json()) as StatusResponse;
        const scenesData = (await scenesRes.json()) as Scene[];

        if (!alive) {
          return;
        }

        setStatus(statusData);
        setScenes(scenesData);
      } catch (err) {
        if (!alive) {
          return;
        }
        const message = err instanceof Error ? err.message : "Unknown error";
        setErrorMessage(message);
      } finally {
        if (alive) {
          setIsLoadingScenes(false);
        }
      }
    };

    void loadData();

    return () => {
      alive = false;
    };
  }, []);

  const postAction = async (path: string) => {
    setErrorMessage(null);
    const res = await fetch(`${API_BASE}${path}`, { method: "POST" });
    if (!res.ok) {
      throw new Error(`Request failed: ${path}`);
    }
  };

  const handlePlay = async (sceneId: string) => {
    setIsPerformingAction(true);
    try {
      await postAction(`/api/scenes/${sceneId}/play`);
      setActiveSceneId(sceneId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setErrorMessage(message);
    } finally {
      setIsPerformingAction(false);
    }
  };

  const handleBlackout = async () => {
    setIsPerformingAction(true);
    try {
      await postAction("/api/blackout");
      setActiveSceneId("__blackout__");
      setShowBlackoutConfirm(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setErrorMessage(message);
    } finally {
      setIsPerformingAction(false);
    }
  };

  const handleStop = async () => {
    setIsPerformingAction(true);
    try {
      await postAction("/api/stop");
      setActiveSceneId(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setErrorMessage(message);
    } finally {
      setIsPerformingAction(false);
    }
  };

  const activeScene = scenes.find((scene) => scene.id === activeSceneId);

  return (
    <div className="flex min-h-screen flex-col bg-slate-900 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="flex items-start justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">
            Venue Light Controller
          </h1>
          <div className="text-right text-xs uppercase tracking-wide text-slate-400">
            <div className="font-mono">MODE: Panel</div>
            <div className="font-mono text-slate-300">
              NODE: {status?.node_ip ?? "â€”"}
            </div>
          </div>
        </div>
        {activeSceneId && (
          <div className="mt-2 text-sm text-slate-300">
            Aktive Szene:{" "}
            <span className="font-semibold text-slate-100">
              {activeScene?.name ?? activeSceneId}
            </span>
          </div>
        )}
      </header>

      {errorMessage && (
        <div className="px-6 pt-4">
          <div className="rounded-xl border border-red-600 bg-red-900/40 px-4 py-2 text-sm text-red-100">
            {errorMessage}
          </div>
        </div>
      )}

      <main className="flex-1 px-6 py-6">
        {isLoadingScenes && (
          <div className="text-sm text-slate-400">Loading scenes...</div>
        )}

        {!isLoadingScenes && scenes.length === 0 && !errorMessage && (
          <div className="text-sm text-slate-400">
            Noch keine Szenen gespeichert.
          </div>
        )}

        {scenes.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {scenes.map((scene) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                isActive={scene.id === activeSceneId}
                isBusy={isPerformingAction}
                onPlay={handlePlay}
              />
            ))}
          </div>
        )}
      </main>

      {showBlackoutConfirm && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/80 px-6">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <div className="text-lg font-semibold text-slate-100">
              Blackout wirklich ausloesen?
            </div>
            <div className="mt-2 text-sm text-slate-300">
              Alle Kanaele werden auf 0 gesetzt.
            </div>
            <div className="mt-6 flex gap-3">
              <button
                className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-base font-semibold text-white shadow-md transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleBlackout}
                disabled={isPerformingAction}
                type="button"
              >
                Ja, Blackout
              </button>
              <button
                className="flex-1 rounded-xl border border-slate-600 px-4 py-3 text-base font-semibold text-slate-200 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => setShowBlackoutConfirm(false)}
                disabled={isPerformingAction}
                type="button"
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="flex items-center justify-between border-t border-slate-800 px-6 py-4">
        <button
          className="rounded-xl bg-red-600 px-6 py-3 text-lg font-semibold text-white shadow-md transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => setShowBlackoutConfirm(true)}
          disabled={isPerformingAction}
          type="button"
        >
          Blackout
        </button>
        <button
          className="rounded-xl bg-slate-700 px-6 py-3 text-lg font-semibold text-white shadow-md transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={handleStop}
          disabled={isPerformingAction}
          type="button"
        >
          Stop
        </button>
      </footer>
    </div>
  );
}
