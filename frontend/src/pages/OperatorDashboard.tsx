import { useEffect, useState } from "react";

const API_BASE = "";

type Scene = {
  id: string;
  name: string;
  universes: Record<string, number[]>;
  fade_in?: number;
  fade_out?: number;
};

type OperatorDashboardProps = {
  activeSceneId: string | null;
  nodeIp: string | null;
  onActiveSceneChange: (sceneId: string | null) => void;
};

type SceneCardProps = {
  scene: Scene;
  isActive: boolean;
  isPending: boolean;
  onPlay: (sceneId: string) => void;
};

function SceneCard({ scene, isActive, isPending, onPlay }: SceneCardProps) {
  return (
    <button
      type="button"
      onClick={() => onPlay(scene.id)}
      disabled={isPending}
      className={`min-h-[136px] w-full rounded-2xl border p-5 text-left transition ${
        isActive
          ? "border-emerald-400/70 bg-slate-900/90 shadow-lg shadow-emerald-900/20"
          : "border-slate-800/80 bg-slate-900/70 hover:border-slate-700/80 hover:bg-slate-900"
      } ${isPending ? "cursor-wait" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xl font-semibold text-slate-100">
            {scene.name}
          </div>
          <div className="mt-2 font-mono text-xs uppercase tracking-wide text-slate-400">
            {scene.id}
          </div>
        </div>
        {isActive && (
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-200">
            Active
          </span>
        )}
        {isPending && (
          <span className="rounded-full border border-slate-600/70 bg-slate-800/70 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200">
            Sending
          </span>
        )}
      </div>
    </button>
  );
}

export default function OperatorDashboard({
  activeSceneId,
  nodeIp,
  onActiveSceneChange,
}: OperatorDashboardProps) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isLoadingScenes, setIsLoadingScenes] = useState(true);
  const [isPerformingAction, setIsPerformingAction] = useState(false);
  const [pendingSceneId, setPendingSceneId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showBlackoutConfirm, setShowBlackoutConfirm] = useState(false);

  const loadScenes = async () => {
    setIsLoadingScenes(true);
    setErrorMessage(null);

    try {
      const scenesRes = await fetch(`${API_BASE}/api/scenes`);
      if (!scenesRes.ok) {
        throw new Error("Failed to load scenes");
      }

      const scenesData = (await scenesRes.json()) as Scene[];
      setScenes(scenesData);
    } catch {
      setErrorMessage("Szenen konnten nicht geladen werden.");
    } finally {
      setIsLoadingScenes(false);
    }
  };

  useEffect(() => {
    void loadScenes();
  }, []);

  const postAction = async (path: string) => {
    setErrorMessage(null);
    const res = await fetch(`${API_BASE}${path}`, { method: "POST" });
    if (!res.ok) {
      throw new Error(`Request failed: ${path}`);
    }
  };

  const handlePlay = async (sceneId: string) => {
    setPendingSceneId(sceneId);
    try {
      await postAction(`/api/scenes/${sceneId}/play`);
      onActiveSceneChange(sceneId);
    } catch {
      setErrorMessage("Szene konnte nicht gestartet werden.");
    } finally {
      setPendingSceneId(null);
    }
  };

  const handleBlackout = async () => {
    setIsPerformingAction(true);
    try {
      await postAction("/api/blackout");
      onActiveSceneChange("__blackout__");
      setShowBlackoutConfirm(false);
    } catch {
      setErrorMessage("Blackout konnte nicht ausgeloest werden.");
    } finally {
      setIsPerformingAction(false);
    }
  };

  const handleStop = async () => {
    setIsPerformingAction(true);
    try {
      await postAction("/api/stop");
      onActiveSceneChange(null);
    } catch {
      setErrorMessage("Stop konnte nicht ausgefuehrt werden.");
    } finally {
      setIsPerformingAction(false);
    }
  };

  const activeScene = scenes.find((scene) => scene.id === activeSceneId);
  const activeSceneLabel = activeSceneId
    ? activeSceneId === "__blackout__"
      ? "Blackout"
      : activeScene?.name ?? activeSceneId
    : "Keine";

  return (
    <div className="space-y-5">
      <section className="panel px-5 py-4">
        <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-slate-400">
          <span className="rounded-full border border-slate-700/80 bg-slate-900/70 px-3 py-1 font-mono">
            Node: {nodeIp ?? "-"}
          </span>
          <span className="rounded-full border border-slate-700/80 bg-slate-900/70 px-3 py-1">
            Scenes: {scenes.length}
          </span>
          <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1 text-emerald-200">
            Active: {activeSceneLabel}
          </span>
        </div>
      </section>

      {errorMessage && (
        <div className="rounded-xl border border-red-600/70 bg-red-900/35 px-4 py-2 text-sm text-red-100">
          {errorMessage}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="section-title">Szenen</h2>
          <button
            type="button"
            onClick={loadScenes}
            className="ui-btn rounded-lg border border-slate-700/80 text-xs uppercase tracking-wide text-slate-300 hover:bg-slate-800/80"
          >
            Reload
          </button>
        </div>

        {isLoadingScenes && (
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/55 px-4 py-5 text-sm text-slate-400">
            Szenen werden geladen...
          </div>
        )}

        {!isLoadingScenes && scenes.length === 0 && !errorMessage && (
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/55 px-4 py-5 text-sm text-slate-400">
            Noch keine Szenen gespeichert.
          </div>
        )}

        {scenes.length > 0 && (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {scenes.map((scene) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                isActive={scene.id === activeSceneId}
                isPending={pendingSceneId === scene.id}
                onPlay={handlePlay}
              />
            ))}
          </div>
        )}
      </section>

      {showBlackoutConfirm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/82 px-6">
          <div className="panel w-full max-w-md p-6 shadow-xl">
            <div className="text-lg font-semibold text-slate-100">
              Blackout wirklich ausloesen?
            </div>
            <div className="mt-2 text-sm text-slate-300">
              Alle Kanaele werden auf 0 gesetzt.
            </div>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={handleBlackout}
                disabled={isPerformingAction}
                className="ui-btn flex-1 rounded-xl bg-red-600 px-4 py-3 text-base text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Blackout
              </button>
              <button
                type="button"
                onClick={() => setShowBlackoutConfirm(false)}
                disabled={isPerformingAction}
                className="ui-btn flex-1 rounded-xl border border-slate-600/80 px-4 py-3 text-base text-slate-200 hover:bg-slate-800/80 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="h-28" aria-hidden="true" />

      <div className="fixed bottom-20 left-0 right-0 z-30 px-5 sm:px-6">
        <div className="panel mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={() => setShowBlackoutConfirm(true)}
            disabled={isPerformingAction}
            className="ui-btn flex-1 rounded-xl bg-red-600 px-6 py-3 text-base text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Blackout
          </button>
          <button
            type="button"
            onClick={handleStop}
            disabled={isPerformingAction}
            className="ui-btn flex-1 rounded-xl bg-slate-700 px-6 py-3 text-base text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPerformingAction ? "Wird ausgefuehrt..." : "Stop"}
          </button>
        </div>
      </div>
    </div>
  );
}
