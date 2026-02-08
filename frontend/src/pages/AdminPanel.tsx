import { useEffect, useMemo, useState } from "react";

const API_BASE = "";

type Scene = {
  id: string;
  name: string;
  universes: Record<string, number[]>;
  fade_in?: number;
  fade_out?: number;
};

type SceneFormState = {
  name: string;
  id: string;
  universe: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
};

const initialFormState: SceneFormState = {
  name: "",
  id: "",
  universe: 0,
  duration: 1.0,
  fadeIn: 0.0,
  fadeOut: 0.0,
};

function slugifyName(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "");
}

export default function AdminPanel() {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isLoadingScenes, setIsLoadingScenes] = useState(true);
  const [isPerformingAction, setIsPerformingAction] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [form, setForm] = useState<SceneFormState>(initialFormState);

  const loadScenes = async () => {
    setIsLoadingScenes(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/scenes`);
      if (!res.ok) {
        throw new Error("Failed to load scenes");
      }
      const data = (await res.json()) as Scene[];
      setScenes(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setErrorMessage(message);
    } finally {
      setIsLoadingScenes(false);
    }
  };

  useEffect(() => {
    void loadScenes();
  }, []);

  const handlePlay = async (sceneId: string) => {
    setIsPerformingAction(true);
    setErrorMessage(null);
    setActionMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/scenes/${sceneId}/play`, {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error("Failed to play scene");
      }
      setActionMessage("Scene gesendet");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setErrorMessage(message);
    } finally {
      setIsPerformingAction(false);
    }
  };

  const handleDelete = async (sceneId: string) => {
    setActionMessage(null);
    // TODO: Add backend DELETE endpoint for scenes, then wire it here.
    setErrorMessage(`Loeschen ist noch nicht verfuegbar. (${sceneId})`);
  };

  const handleFormChange = <K extends keyof SceneFormState>(
    key: K,
    value: SceneFormState[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleNameChange = (value: string) => {
    setForm((prev) => {
      const next: SceneFormState = { ...prev, name: value };
      if (!prev.id.trim()) {
        next.id = slugifyName(value);
      }
      return next;
    });
  };

  const canSubmit = useMemo(() => {
    return (
      form.name.trim().length > 0 &&
      form.id.trim().length > 0 &&
      form.duration > 0 &&
      !isRecording
    );
  }, [form, isRecording]);

  const handleRecord = async () => {
    if (!canSubmit) {
      return;
    }

    setIsRecording(true);
    setErrorMessage(null);
    setActionMessage(null);

    try {
      const payload = {
        id: form.id.trim(),
        name: form.name.trim(),
        universe: form.universe,
        duration: form.duration,
        fade_in: form.fadeIn,
        fade_out: form.fadeOut,
      };

      const res = await fetch(`${API_BASE}/api/scenes/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error("Failed to record scene");
      }

      setForm(initialFormState);
      setActionMessage("Szene gespeichert");
      await loadScenes();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setErrorMessage(message);
    } finally {
      setIsRecording(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <div className="px-6 py-6">
        <h1 className="text-2xl font-semibold">Admin Panel</h1>
        <p className="mt-1 text-sm text-slate-400">
          Szenen verwalten und neue Szenen aufnehmen.
        </p>
      </div>

      {errorMessage && (
        <div className="px-6">
          <div className="mb-4 rounded-xl border border-red-600 bg-red-900/40 px-4 py-2 text-sm text-red-100">
            {errorMessage}
          </div>
        </div>
      )}

      {actionMessage && (
        <div className="px-6">
          <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">
            {actionMessage}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-6 px-6 pb-10 lg:flex-row">
        <section className="flex-1 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Szenenliste</h2>
            <button
              className="rounded-lg border border-slate-700 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:bg-slate-800"
              onClick={loadScenes}
              type="button"
              disabled={isLoadingScenes}
            >
              Reload
            </button>
          </div>

          {isLoadingScenes && (
            <div className="text-sm text-slate-400">Szenen werden geladen...</div>
          )}

          {!isLoadingScenes && scenes.length === 0 && !errorMessage && (
            <div className="text-sm text-slate-400">
              Noch keine Szenen gespeichert. Du kannst unten eine neue Szene
              aufnehmen.
            </div>
          )}

          <div className="space-y-4">
            {scenes.map((scene) => {
              const universes = Object.keys(scene.universes ?? {})
                .sort((a, b) => Number(a) - Number(b))
                .join(", ");
              return (
                <div
                  key={scene.id}
                  className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-slate-100">
                        {scene.name}
                      </div>
                      <div className="mt-1 font-mono text-xs text-slate-400">
                        ID: {scene.id}
                      </div>
                      <div className="mt-2 text-xs text-slate-400">
                        Universes: {universes || "—"}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => handlePlay(scene.id)}
                        disabled={isPerformingAction}
                        type="button"
                      >
                        Play
                      </button>
                      <button
                        className="rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => handleDelete(scene.id)}
                        disabled={isPerformingAction}
                        type="button"
                      >
                        Loeschen
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="w-full rounded-2xl border border-slate-800 bg-slate-900/60 p-6 lg:max-w-md">
          <h2 className="text-lg font-semibold">Neue Szene aufnehmen</h2>
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-sm font-semibold text-slate-200">
                Name
              </label>
              <input
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base text-slate-100 focus:border-emerald-500 focus:outline-none"
                placeholder="Warm House"
                value={form.name}
                onChange={(event) => handleNameChange(event.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-slate-200">ID</label>
              <input
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 font-mono text-base text-slate-100 focus:border-emerald-500 focus:outline-none"
                placeholder="warm_house"
                value={form.id}
                onChange={(event) =>
                  handleFormChange("id", event.target.value)
                }
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-semibold text-slate-200">
                  Universe
                </label>
                <input
                  type="number"
                  min={0}
                  max={3}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base text-slate-100 focus:border-emerald-500 focus:outline-none"
                  value={form.universe}
                  onChange={(event) =>
                    handleFormChange("universe", Number(event.target.value))
                  }
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-200">
                  Duration (s)
                </label>
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base text-slate-100 focus:border-emerald-500 focus:outline-none"
                  value={form.duration}
                  onChange={(event) =>
                    handleFormChange("duration", Number(event.target.value))
                  }
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-semibold text-slate-200">
                  Fade-In (s)
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base text-slate-100 focus:border-emerald-500 focus:outline-none"
                  value={form.fadeIn}
                  onChange={(event) =>
                    handleFormChange("fadeIn", Number(event.target.value))
                  }
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-200">
                  Fade-Out (s)
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base text-slate-100 focus:border-emerald-500 focus:outline-none"
                  value={form.fadeOut}
                  onChange={(event) =>
                    handleFormChange("fadeOut", Number(event.target.value))
                  }
                />
              </div>
            </div>
            <button
              className="w-full rounded-xl bg-emerald-600 px-6 py-3 text-lg font-semibold text-white shadow-md transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleRecord}
              disabled={!canSubmit}
              type="button"
            >
              {isRecording ? "Aufnahme laeuft..." : "Szene aufnehmen"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
