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

type EditFormState = {
  id: string;
  name: string;
  fadeIn: number;
  fadeOut: number;
};

const initialFormState: SceneFormState = {
  name: "",
  id: "",
  universe: 0,
  duration: 1,
  fadeIn: 0,
  fadeOut: 0,
};

function slugifyName(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "");
}

function formatUniverses(universes: Record<string, number[]>) {
  return Object.keys(universes ?? {})
    .sort((a, b) => Number(a) - Number(b))
    .map((value) => `U${value}`)
    .join(", ");
}

export default function AdminPanel() {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isLoadingScenes, setIsLoadingScenes] = useState(true);
  const [isPerformingAction, setIsPerformingAction] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [detailsScene, setDetailsScene] = useState<Scene | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
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
    } catch {
      setErrorMessage("Szenen konnten nicht geladen werden.");
    } finally {
      setIsLoadingScenes(false);
    }
  };

  useEffect(() => {
    void loadScenes();
  }, []);

  const loadSceneDetails = async (sceneId: string) => {
    setSelectedSceneId(sceneId);
    setIsLoadingDetails(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`${API_BASE}/api/scenes/${sceneId}`);
      if (!res.ok) {
        throw new Error("Failed to load scene details");
      }
      const data = (await res.json()) as Scene;
      setDetailsScene(data);
      setEditForm({
        id: data.id,
        name: data.name,
        fadeIn: data.fade_in ?? 0,
        fadeOut: data.fade_out ?? 0,
      });
    } catch {
      setErrorMessage("Scene-Details konnten nicht geladen werden.");
    } finally {
      setIsLoadingDetails(false);
    }
  };

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
      setActionMessage("Szene gesendet.");
      if (selectedSceneId === sceneId && detailsScene == null) {
        await loadSceneDetails(sceneId);
      }
    } catch {
      setErrorMessage("Szene konnte nicht gestartet werden.");
    } finally {
      setIsPerformingAction(false);
    }
  };

  const handleDelete = async (sceneId: string) => {
    setIsPerformingAction(true);
    setActionMessage(null);
    setErrorMessage(null);

    try {
      const res = await fetch(`${API_BASE}/api/scenes/${sceneId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error("Failed to delete scene");
      }
      if (selectedSceneId === sceneId) {
        setSelectedSceneId(null);
        setDetailsScene(null);
        setEditForm(null);
      }
      setActionMessage("Szene geloescht.");
      await loadScenes();
    } catch {
      setErrorMessage("Szene konnte nicht geloescht werden.");
    } finally {
      setIsPerformingAction(false);
    }
  };

  const handleEditSave = async () => {
    if (!selectedSceneId || !editForm) {
      return;
    }

    setIsPerformingAction(true);
    setErrorMessage(null);
    setActionMessage(null);

    try {
      const res = await fetch(`${API_BASE}/api/scenes/${selectedSceneId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name.trim(),
          fade_in: editForm.fadeIn,
          fade_out: editForm.fadeOut,
          new_id: editForm.id.trim(),
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to update scene");
      }

      const updated = (await res.json()) as Scene;
      setSelectedSceneId(updated.id);
      setDetailsScene(updated);
      setEditForm({
        id: updated.id,
        name: updated.name,
        fadeIn: updated.fade_in ?? 0,
        fadeOut: updated.fade_out ?? 0,
      });
      setActionMessage("Szene aktualisiert.");
      await loadScenes();
    } catch {
      setErrorMessage("Szene konnte nicht aktualisiert werden.");
    } finally {
      setIsPerformingAction(false);
    }
  };

  const handleTestAllOn = async () => {
    setIsPerformingAction(true);
    setErrorMessage(null);
    setActionMessage(null);

    try {
      const res = await fetch(`${API_BASE}/api/test/all-on`, { method: "POST" });
      if (!res.ok) {
        throw new Error("Failed to send all-on test");
      }
      setActionMessage("Test All-On gesendet.");
    } catch {
      setErrorMessage("Test All-On fehlgeschlagen.");
    } finally {
      setIsPerformingAction(false);
    }
  };

  const handleTestStop = async () => {
    setIsPerformingAction(true);
    setErrorMessage(null);
    setActionMessage(null);

    try {
      const res = await fetch(`${API_BASE}/api/test/stop`, { method: "POST" });
      if (!res.ok) {
        throw new Error("Failed to stop test");
      }
      setActionMessage("Test Stop gesendet.");
    } catch {
      setErrorMessage("Test Stop fehlgeschlagen.");
    } finally {
      setIsPerformingAction(false);
    }
  };

  const handleFormChange = <K extends keyof SceneFormState>(
    key: K,
    value: SceneFormState[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleNameChange = (value: string) => {
    setForm((prev) => {
      const next = { ...prev, name: value };
      if (!prev.id.trim()) {
        next.id = slugifyName(value);
      }
      return next;
    });
  };

  const canSubmit = useMemo(
    () =>
      form.name.trim().length > 0 &&
      form.id.trim().length > 0 &&
      form.duration > 0 &&
      !isRecording,
    [form, isRecording]
  );

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
      setActionMessage("Szene gespeichert.");
      await loadScenes();
    } catch {
      setErrorMessage("Szene konnte nicht aufgenommen werden.");
    } finally {
      setIsRecording(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="section-title">Admin Panel</h2>
          <p className="mt-1 text-sm text-slate-400">
            Szenen verwalten, testen und aufnehmen.
          </p>
        </div>
        <button
          type="button"
          onClick={loadScenes}
          disabled={isLoadingScenes}
          className="rounded-lg border border-slate-700/80 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-300 transition hover:bg-slate-800/80 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Reload
        </button>
      </div>

      {errorMessage && (
        <div className="rounded-xl border border-red-600/70 bg-red-900/35 px-4 py-2 text-sm text-red-100">
          {errorMessage}
        </div>
      )}

      {actionMessage && (
        <div className="rounded-xl border border-emerald-500/45 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">
          {actionMessage}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="panel p-5 sm:p-6">
          <div className="section-title mb-4">Szenenliste</div>

          {isLoadingScenes && (
            <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 px-4 py-5 text-sm text-slate-400">
              Szenen werden geladen...
            </div>
          )}

          {!isLoadingScenes && scenes.length === 0 && !errorMessage && (
            <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 px-4 py-5 text-sm text-slate-400">
              Noch keine Szenen gespeichert.
            </div>
          )}

          <div className="space-y-3">
            {scenes.map((scene) => {
              const isSelected = selectedSceneId === scene.id;
              return (
                <div
                  key={scene.id}
                  className={`rounded-xl border p-4 transition ${
                    isSelected
                      ? "border-emerald-500/50 bg-slate-900/85"
                      : "border-slate-800/80 bg-slate-900/55"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => loadSceneDetails(scene.id)}
                      className="min-w-0 text-left"
                    >
                      <div className="truncate text-base font-semibold text-slate-100">
                        {scene.name}
                      </div>
                      <div className="mt-1 font-mono text-xs text-slate-400">
                        {scene.id}
                      </div>
                      <div className="mt-2 text-xs text-slate-400">
                        {formatUniverses(scene.universes) || "-"}
                      </div>
                    </button>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handlePlay(scene.id)}
                        disabled={isPerformingAction}
                        className="rounded-lg bg-slate-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Testen
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(scene.id)}
                        disabled={isPerformingAction}
                        className="rounded-lg bg-red-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
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

        <div className="space-y-5">
          <section className="panel p-5">
            <div className="section-title">Neue Szene aufnehmen</div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="ui-label">Name</label>
                <input
                  className="ui-input mt-1.5"
                  value={form.name}
                  placeholder="Warm House"
                  onChange={(event) => handleNameChange(event.target.value)}
                />
              </div>
              <div>
                <label className="ui-label">ID</label>
                <input
                  className="ui-input mt-1.5 font-mono"
                  value={form.id}
                  placeholder="warm_house"
                  onChange={(event) => handleFormChange("id", event.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="ui-label">Universe</label>
                  <input
                    type="number"
                    min={0}
                    max={3}
                    className="ui-input mt-1.5"
                    value={form.universe}
                    onChange={(event) =>
                      handleFormChange("universe", Number(event.target.value))
                    }
                  />
                </div>
                <div>
                  <label className="ui-label">Dauer (s)</label>
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    className="ui-input mt-1.5"
                    value={form.duration}
                    onChange={(event) =>
                      handleFormChange("duration", Number(event.target.value))
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="ui-label">Fade-In</label>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    className="ui-input mt-1.5"
                    value={form.fadeIn}
                    onChange={(event) =>
                      handleFormChange("fadeIn", Number(event.target.value))
                    }
                  />
                </div>
                <div>
                  <label className="ui-label">Fade-Out</label>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    className="ui-input mt-1.5"
                    value={form.fadeOut}
                    onChange={(event) =>
                      handleFormChange("fadeOut", Number(event.target.value))
                    }
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={handleRecord}
                disabled={!canSubmit}
                className="ui-btn w-full rounded-xl bg-emerald-600 px-5 py-3 text-sm text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRecording ? "Aufnahme laeuft..." : "Szene aufnehmen"}
              </button>
            </div>
          </section>

          <section className="panel p-5">
            <div className="section-title">Scene Details</div>
            {isLoadingDetails && (
              <div className="mt-3 text-sm text-slate-400">Details werden geladen...</div>
            )}
            {!isLoadingDetails && !detailsScene && (
              <div className="mt-3 text-sm text-slate-400">
                Eine Szene in der Liste auswaehlen.
              </div>
            )}
            {!isLoadingDetails && detailsScene && editForm && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="ui-label">ID</label>
                  <input
                    className="ui-input mt-1.5 font-mono"
                    value={editForm.id}
                    onChange={(event) =>
                      setEditForm((prev) =>
                        prev ? { ...prev, id: event.target.value } : prev
                      )
                    }
                  />
                </div>
                <div>
                  <label className="ui-label">Name</label>
                  <input
                    className="ui-input mt-1.5"
                    value={editForm.name}
                    onChange={(event) =>
                      setEditForm((prev) =>
                        prev ? { ...prev, name: event.target.value } : prev
                      )
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="ui-label">Fade-In</label>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      className="ui-input mt-1.5"
                      value={editForm.fadeIn}
                      onChange={(event) =>
                        setEditForm((prev) =>
                          prev
                            ? { ...prev, fadeIn: Number(event.target.value) }
                            : prev
                        )
                      }
                    />
                  </div>
                  <div>
                    <label className="ui-label">Fade-Out</label>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      className="ui-input mt-1.5"
                      value={editForm.fadeOut}
                      onChange={(event) =>
                        setEditForm((prev) =>
                          prev
                            ? { ...prev, fadeOut: Number(event.target.value) }
                            : prev
                        )
                      }
                    />
                  </div>
                </div>
                <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
                  Universes: {formatUniverses(detailsScene.universes) || "-"}
                </div>
                <button
                  type="button"
                  onClick={handleEditSave}
                  disabled={
                    isPerformingAction ||
                    editForm.name.trim().length === 0 ||
                    editForm.id.trim().length === 0
                  }
                  className="ui-btn w-full rounded-xl bg-sky-600 px-4 py-2.5 text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Szene speichern
                </button>
              </div>
            )}
          </section>

          <section className="panel p-5">
            <div className="section-title">Diagnostics</div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={handleTestAllOn}
                disabled={isPerformingAction}
                className="flex-1 rounded-lg bg-amber-500/90 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Test All-On
              </button>
              <button
                type="button"
                onClick={handleTestStop}
                disabled={isPerformingAction}
                className="flex-1 rounded-lg bg-slate-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Test Stop
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
