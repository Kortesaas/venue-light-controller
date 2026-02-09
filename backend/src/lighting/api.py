import asyncio
import json
import re
import threading
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .artnet_core import (
    is_stream_running,
    record_snapshots,
    start_stream,
    stop_stream,
    update_stream,
)
from .config import hash_pin, persist_runtime_settings, settings
from .fixture_plan import (
    activate_fixture_plan,
    clear_fixture_plan,
    get_intensity_addresses,
    get_fixture_plan_details,
    get_fixture_plan_summary,
    lookup_fixture_parameter,
    preview_fixture_plan,
)
from .scenes import (
    Scene,
    SceneStyle,
    delete_scene,
    get_scene,
    list_scenes,
    save_scene,
    set_scene_order,
)

router = APIRouter()

ACTIVE_SCENE_ID: Optional[str] = None
CONTROL_MODE: str = "panel"
MASTER_DIMMER_PERCENT: int = 100
_BASE_STREAM_PAYLOAD: Optional[Dict[int, bytes]] = None
_LIVE_EDITOR_STATE: Optional[dict] = None
_playback_state_lock = threading.Lock()
_subscribers: set[asyncio.Queue[str]] = set()
_subscribers_lock = threading.Lock()
_event_loop: Optional[asyncio.AbstractEventLoop] = None


def _format_sse(event: str, data: dict) -> str:
    payload = json.dumps(data, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


def _broadcast_event(event: str, data: dict) -> None:
    message = _format_sse(event, data)
    with _subscribers_lock:
        subscribers = list(_subscribers)
        loop = _event_loop
    if loop is None:
        return
    for queue in subscribers:
        loop.call_soon_threadsafe(queue.put_nowait, message)


def _set_active_scene(scene_id: Optional[str]) -> None:
    global ACTIVE_SCENE_ID
    ACTIVE_SCENE_ID = scene_id
    _broadcast_event(
        "status",
        {
            "active_scene_id": ACTIVE_SCENE_ID,
            "live_edit_scene_name": _get_live_editor_scene_name(),
        },
    )


def _set_control_mode(mode: str) -> None:
    global CONTROL_MODE
    CONTROL_MODE = mode
    _broadcast_event("status", {"control_mode": CONTROL_MODE})


def _set_master_dimmer_percent(value: int) -> None:
    global MASTER_DIMMER_PERCENT
    MASTER_DIMMER_PERCENT = max(0, min(100, int(value)))


def _get_live_editor_scene_id() -> Optional[str]:
    with _playback_state_lock:
        state = _LIVE_EDITOR_STATE
        if not isinstance(state, dict):
            return None
        scene_id = state.get("scene_id")
        return scene_id if isinstance(scene_id, str) else None


def _get_live_editor_scene_name() -> Optional[str]:
    scene_id = _get_live_editor_scene_id()
    if not scene_id:
        return None
    scene = get_scene(scene_id)
    if scene is None:
        return None
    return scene.name


def _clone_payload(payload: Dict[int, bytes]) -> Dict[int, bytes]:
    return {universe: bytes(dmx) for universe, dmx in payload.items()}


def _get_master_dimmer_mode() -> str:
    intensity_addresses = get_intensity_addresses()
    return "parameter-aware" if intensity_addresses is not None else "raw"


def _apply_master_dimmer(
    payload: Dict[int, bytes], dimmer_percent: int
) -> tuple[Dict[int, bytes], str]:
    clamped_percent = max(0, min(100, int(dimmer_percent)))
    intensity_addresses = get_intensity_addresses()

    if clamped_percent == 100:
        mode = "parameter-aware" if intensity_addresses is not None else "raw"
        return _clone_payload(payload), mode

    if intensity_addresses is None:
        # Raw fallback: scale all channels uniformly.
        scaled_payload: Dict[int, bytes] = {}
        for universe, dmx in payload.items():
            values = bytearray(bytes(dmx[:512]).ljust(512, b"\x00"))
            for index, value in enumerate(values):
                values[index] = max(0, min(255, round((value * clamped_percent) / 100)))
            scaled_payload[universe] = bytes(values)
        return scaled_payload, "raw"

    # Parameter-aware mode: scale only channels classified as intensity.
    intensity_by_universe: Dict[int, List[int]] = {}
    for universe, channel in intensity_addresses:
        if 1 <= channel <= 512:
            intensity_by_universe.setdefault(universe, []).append(channel - 1)

    scaled_payload = _clone_payload(payload)
    for universe, indices in intensity_by_universe.items():
        dmx = scaled_payload.get(universe)
        if dmx is None:
            continue
        values = bytearray(bytes(dmx[:512]).ljust(512, b"\x00"))
        for index in indices:
            values[index] = max(
                0, min(255, round((values[index] * clamped_percent) / 100))
            )
        scaled_payload[universe] = bytes(values)

    return scaled_payload, "parameter-aware"


def _broadcast_master_dimmer_status(mode: Optional[str] = None) -> None:
    _broadcast_event(
        "status",
        {
            "master_dimmer_percent": MASTER_DIMMER_PERCENT,
            "master_dimmer_mode": mode or _get_master_dimmer_mode(),
        },
    )


def _refresh_stream_from_base_payload() -> None:
    with _playback_state_lock:
        base_payload = _clone_payload(_BASE_STREAM_PAYLOAD or {})
        dimmer_percent = MASTER_DIMMER_PERCENT

    if not base_payload:
        _broadcast_master_dimmer_status()
        return

    scaled_payload, mode = _apply_master_dimmer(base_payload, dimmer_percent)
    if is_stream_running():
        update_stream(scaled_payload)
    else:
        start_stream(scaled_payload)
    _broadcast_master_dimmer_status(mode)


def _set_base_stream_payload(payload: Optional[Dict[int, bytes]]) -> None:
    with _playback_state_lock:
        global _BASE_STREAM_PAYLOAD
        if payload is None:
            _BASE_STREAM_PAYLOAD = None
        else:
            _BASE_STREAM_PAYLOAD = _clone_payload(payload)


def _assert_panel_mode() -> None:
    if CONTROL_MODE != "panel":
        raise HTTPException(
            status_code=409,
            detail="Panel control is disabled while external control mode is active",
        )


def _is_valid_pin(pin: str) -> bool:
    return bool(re.fullmatch(r"\d{4}", pin))


def _verify_pin(pin: str) -> bool:
    return hash_pin(pin) == settings.operator_pin_hash


@router.get("/status")
def get_status():
    """
    Einfacher Healthcheck-Endpunkt.
    Hier kann Codex später erweitern: Node-Status, aktive Szene, etc.
    """
    return {
        "status": "ok",
        "local_ip": settings.local_ip,
        "node_ip": settings.node_ip,
        "active_scene_id": ACTIVE_SCENE_ID,
        "live_edit_scene_name": _get_live_editor_scene_name(),
        "control_mode": CONTROL_MODE,
        "master_dimmer_percent": MASTER_DIMMER_PERCENT,
        "master_dimmer_mode": _get_master_dimmer_mode(),
    }


@router.get("/events")
async def api_events():
    async def event_stream():
        queue: asyncio.Queue[str] = asyncio.Queue()
        with _subscribers_lock:
            _subscribers.add(queue)
            global _event_loop
            if _event_loop is None:
                _event_loop = asyncio.get_running_loop()

        try:
            yield _format_sse(
                "status",
                {
                    "active_scene_id": ACTIVE_SCENE_ID,
                    "live_edit_scene_name": _get_live_editor_scene_name(),
                    "control_mode": CONTROL_MODE,
                    "master_dimmer_percent": MASTER_DIMMER_PERCENT,
                    "master_dimmer_mode": _get_master_dimmer_mode(),
                },
            )
            while True:
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                yield message
        finally:
            with _subscribers_lock:
                _subscribers.discard(queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/test/all-on")
def test_all_on():
    """
    Test: Universe 0 alle Kanaele auf 255.
    """
    _assert_panel_mode()
    _clear_live_editor_state()
    _set_base_stream_payload({0: bytes([255] * 512)})
    _refresh_stream_from_base_payload()
    return {"status": "started", "universe": 0}


@router.post("/test/stop")
def test_stop():
    """
    Test: Stream stoppen.
    """
    _clear_live_editor_state()
    _set_base_stream_payload(None)
    stop_stream()
    _broadcast_master_dimmer_status()
    return {"status": "stopped"}


class SceneRecordRequest(BaseModel):
    name: str
    description: str = ""
    duration: float = 1.0
    style: Optional[SceneStyle] = None


class SceneRerecordRequest(BaseModel):
    duration: float = 1.0


class SceneUpdateRequest(BaseModel):
    name: str
    description: str = ""
    style: Optional[SceneStyle] = None


class SceneContentUpdateRequest(BaseModel):
    universes: Dict[int, List[int]]


class SceneReorderRequest(BaseModel):
    scene_ids: List[str]


class SettingsResponse(BaseModel):
    local_ip: str
    node_ip: str
    dmx_fps: float
    poll_interval: float
    universe_count: int


class SettingsUpdateRequest(BaseModel):
    node_ip: str
    dmx_fps: float
    poll_interval: float
    universe_count: int


class ControlModeResponse(BaseModel):
    control_mode: str


class ControlModeUpdateRequest(BaseModel):
    control_mode: str


class UnlockRequest(BaseModel):
    pin: str


class PinChangeRequest(BaseModel):
    current_pin: str
    new_pin: str
    confirm_pin: str


class FixturePlanImportRequest(BaseModel):
    xml: str
    filename: Optional[str] = None


class MasterDimmerUpdateRequest(BaseModel):
    value_percent: int


class SceneEditorLiveStartRequest(BaseModel):
    scene_id: str
    universes: Dict[int, List[int]]


class SceneEditorLiveUpdateRequest(BaseModel):
    universes: Dict[int, List[int]]


class SceneEditorLiveStopRequest(BaseModel):
    restore_previous: bool = True


def _get_settings_payload() -> SettingsResponse:
    return SettingsResponse(
        local_ip=settings.local_ip,
        node_ip=settings.node_ip,
        dmx_fps=settings.dmx_fps,
        poll_interval=settings.poll_interval,
        universe_count=settings.universe_count,
    )


@router.post("/unlock")
def api_unlock_panel(request: UnlockRequest):
    pin = request.pin.strip()
    if not _is_valid_pin(pin):
        raise HTTPException(status_code=400, detail="PIN must be exactly 4 digits")
    if not _verify_pin(pin):
        raise HTTPException(status_code=401, detail="Invalid PIN")
    return {"status": "ok"}


@router.post("/pin/change")
def api_change_pin(request: PinChangeRequest):
    current_pin = request.current_pin.strip()
    new_pin = request.new_pin.strip()
    confirm_pin = request.confirm_pin.strip()

    if not _is_valid_pin(current_pin):
        raise HTTPException(status_code=400, detail="Current PIN must be exactly 4 digits")
    if not _is_valid_pin(new_pin):
        raise HTTPException(status_code=400, detail="New PIN must be exactly 4 digits")
    if new_pin != confirm_pin:
        raise HTTPException(status_code=400, detail="PIN confirmation mismatch")
    if not _verify_pin(current_pin):
        raise HTTPException(status_code=401, detail="Invalid current PIN")

    settings.operator_pin_hash = hash_pin(new_pin)
    persist_runtime_settings()
    return {"status": "updated"}


@router.get("/fixture-plan")
def api_get_fixture_plan():
    return get_fixture_plan_summary().model_dump()


@router.get("/fixture-plan/details")
def api_get_fixture_plan_details():
    return get_fixture_plan_details().model_dump()


@router.post("/fixture-plan/preview")
def api_preview_fixture_plan(request: FixturePlanImportRequest):
    try:
        summary = preview_fixture_plan(request.xml, source_filename=request.filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return summary.model_dump()


@router.post("/fixture-plan/activate")
def api_activate_fixture_plan(request: FixturePlanImportRequest):
    try:
        summary = activate_fixture_plan(request.xml, source_filename=request.filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    payload = summary.model_dump()
    _refresh_stream_from_base_payload()
    _broadcast_event("fixture-plan", payload)
    return payload


@router.delete("/fixture-plan")
def api_clear_fixture_plan():
    try:
        clear_fixture_plan()
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    payload = get_fixture_plan_summary().model_dump()
    _refresh_stream_from_base_payload()
    _broadcast_event("fixture-plan", payload)
    return {"status": "cleared"}


@router.get("/fixture-plan/lookup")
def api_lookup_fixture_parameter(universe: int, channel: int):
    if universe < 1:
        raise HTTPException(status_code=400, detail="universe must be >= 1")
    if channel < 1 or channel > 512:
        raise HTTPException(status_code=400, detail="channel must be in range 1..512")

    entry = lookup_fixture_parameter(universe - 1, channel)
    if entry is None:
        return {"matched": False}
    return {"matched": True, "parameter": entry.model_dump()}


@router.get("/master-dimmer")
def api_get_master_dimmer():
    return {
        "value_percent": MASTER_DIMMER_PERCENT,
        "mode": _get_master_dimmer_mode(),
    }


@router.post("/master-dimmer")
def api_set_master_dimmer(request: MasterDimmerUpdateRequest):
    if request.value_percent < 0 or request.value_percent > 100:
        raise HTTPException(status_code=400, detail="value_percent must be in range 0..100")

    _set_master_dimmer_percent(request.value_percent)
    _refresh_stream_from_base_payload()
    return {
        "value_percent": MASTER_DIMMER_PERCENT,
        "mode": _get_master_dimmer_mode(),
    }


@router.post("/scene-editor/live/start")
def api_scene_editor_live_start(request: SceneEditorLiveStartRequest):
    _assert_panel_mode()

    scene = get_scene(request.scene_id)
    if scene is None:
        raise HTTPException(status_code=404, detail="Scene not found")

    _validate_scene_universes(scene, request.universes)
    payload = _build_stream_payload_from_universes(request.universes)

    with _playback_state_lock:
        global _LIVE_EDITOR_STATE
        if _LIVE_EDITOR_STATE is not None:
            raise HTTPException(status_code=409, detail="Live editor is already active")

        _LIVE_EDITOR_STATE = {
            "scene_id": request.scene_id,
            "previous_payload": _clone_payload(_BASE_STREAM_PAYLOAD or {}),
            "previous_active_scene_id": ACTIVE_SCENE_ID,
        }

    _set_base_stream_payload(payload)
    _refresh_stream_from_base_payload()
    _set_active_scene("__editor_live__")
    return {"status": "live", "scene_id": request.scene_id}


@router.post("/scene-editor/live/update")
def api_scene_editor_live_update(request: SceneEditorLiveUpdateRequest):
    with _playback_state_lock:
        state = _LIVE_EDITOR_STATE
    if state is None:
        raise HTTPException(status_code=409, detail="Live editor is not active")

    scene_id = state.get("scene_id")
    scene = get_scene(scene_id) if isinstance(scene_id, str) else None
    if scene is None:
        raise HTTPException(status_code=404, detail="Scene not found")

    _validate_scene_universes(scene, request.universes)
    payload = _build_stream_payload_from_universes(request.universes)
    _set_base_stream_payload(payload)
    _refresh_stream_from_base_payload()
    _set_active_scene("__editor_live__")
    return {"status": "live"}


@router.post("/scene-editor/live/stop")
def api_scene_editor_live_stop(request: SceneEditorLiveStopRequest):
    return _stop_live_editor_session(request.restore_previous)


@router.get("/scenes", response_model=list[Scene])
def api_list_scenes():
    return list_scenes()


@router.get("/scenes/{scene_id}", response_model=Scene)
def api_get_scene(scene_id: str):
    scene = get_scene(scene_id)
    if scene is None:
        raise HTTPException(status_code=404, detail="Scene not found")
    return scene


def _slugify_name(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return slug or "scene"


def _scene_name_exists(name: str, ignore_id: Optional[str] = None) -> bool:
    wanted = name.strip().lower()
    for scene in list_scenes():
        if ignore_id is not None and scene.id == ignore_id:
            continue
        if scene.name.strip().lower() == wanted:
            return True
    return False


def _build_unique_scene_id(scene_name: str) -> str:
    base = _slugify_name(scene_name)
    existing_ids = {scene.id for scene in list_scenes()}
    if base not in existing_ids:
        return base

    counter = 2
    while True:
        candidate = f"{base}_{counter}"
        if candidate not in existing_ids:
            return candidate
        counter += 1


def _build_stream_payload_from_scene(scene: Scene) -> Dict[int, bytes]:
    return {
        universe: bytes(values[:512]).ljust(512, b"\x00")
        for universe, values in scene.universes.items()
    }


def _build_stream_payload_from_universes(
    universes: Dict[int, List[int]]
) -> Dict[int, bytes]:
    return {
        universe: bytes(values[:512]).ljust(512, b"\x00")
        for universe, values in universes.items()
    }


def _validate_scene_universes(scene: Scene, universes: Dict[int, List[int]]) -> None:
    existing_universes = set(scene.universes.keys())
    incoming_universes = set(universes.keys())
    if incoming_universes != existing_universes:
        raise HTTPException(
            status_code=400,
            detail="Universe layout mismatch: edited content must keep the original scene universes",
        )

    # Re-validate against Scene model constraints (length 512, value range, etc.).
    Scene(
        id=scene.id,
        name=scene.name,
        description=scene.description,
        universes=universes,
        created_at=scene.created_at,
        style=scene.style,
    )


def _stop_live_editor_session(restore_previous: bool) -> dict:
    with _playback_state_lock:
        global _LIVE_EDITOR_STATE
        state = _LIVE_EDITOR_STATE
        _LIVE_EDITOR_STATE = None

    if state is None:
        return {"status": "inactive"}

    previous_payload = state.get("previous_payload")
    previous_active_scene_id = state.get("previous_active_scene_id")

    if restore_previous:
        if isinstance(previous_payload, dict) and previous_payload:
            _set_base_stream_payload(previous_payload)
            _refresh_stream_from_base_payload()
        else:
            _set_base_stream_payload(None)
            stop_stream()
            _broadcast_master_dimmer_status()
        if isinstance(previous_active_scene_id, str):
            _set_active_scene(previous_active_scene_id)
        else:
            _set_active_scene(None)
    else:
        _set_active_scene("__editor_live__")

    return {"status": "stopped"}


def _clear_live_editor_state() -> None:
    with _playback_state_lock:
        global _LIVE_EDITOR_STATE
        _LIVE_EDITOR_STATE = None


def _build_blackout_payload() -> Dict[int, bytes]:
    # Universes are zero-based internally (UI/user-facing numbering may be 1-based).
    return {
        universe: bytes([0] * 512)
        for universe in range(settings.universe_count)
    }


def _record_scene_snapshot(duration: float) -> Dict[int, List[int]]:
    # Universes are zero-based internally (UI/user-facing numbering may be 1-based).
    target_universes = list(range(settings.universe_count))
    with _playback_state_lock:
        restore_payload = _clone_payload(_BASE_STREAM_PAYLOAD or {})
    restore_scene_id = ACTIVE_SCENE_ID

    # Ensure port 6454 is free for snapshot recording.
    stop_stream()
    try:
        return record_snapshots(target_universes, duration)
    except OSError as exc:
        raise HTTPException(
            status_code=409,
            detail="Art-Net port 6454 is already in use",
        ) from exc
    finally:
        if restore_payload and CONTROL_MODE == "panel":
            _set_base_stream_payload(restore_payload)
            _refresh_stream_from_base_payload()
            _set_active_scene(restore_scene_id)
        else:
            _set_base_stream_payload(None)
            _set_active_scene(None)


@router.put("/scenes/{scene_id}", response_model=Scene)
def api_update_scene(scene_id: str, request: SceneUpdateRequest):
    scene = get_scene(scene_id)
    if scene is None:
        raise HTTPException(status_code=404, detail="Scene not found")

    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Scene name cannot be empty")
    if _scene_name_exists(name, ignore_id=scene_id):
        raise HTTPException(status_code=409, detail="Scene name already exists")

    style = scene.style
    if "style" in request.model_fields_set:
        style = request.style

    updated = Scene(
        id=scene.id,
        name=name,
        description=request.description.strip(),
        universes=scene.universes,
        created_at=scene.created_at,
        style=style,
    )
    save_scene(updated)
    _broadcast_event("scenes", {"action": "updated", "scene_id": scene.id})
    return updated


@router.put("/scenes/{scene_id}/content", response_model=Scene)
def api_update_scene_content(scene_id: str, request: SceneContentUpdateRequest):
    scene = get_scene(scene_id)
    if scene is None:
        raise HTTPException(status_code=404, detail="Scene not found")

    _validate_scene_universes(scene, request.universes)

    updated = Scene(
        id=scene.id,
        name=scene.name,
        description=scene.description,
        universes=request.universes,
        created_at=scene.created_at,
        style=scene.style,
    )
    save_scene(updated)
    _broadcast_event("scenes", {"action": "updated", "scene_id": scene.id})
    return updated


@router.delete("/scenes/{scene_id}")
def api_delete_scene(scene_id: str):
    scene = get_scene(scene_id)
    if scene is None:
        raise HTTPException(status_code=404, detail="Scene not found")

    delete_scene(scene_id)
    if ACTIVE_SCENE_ID == scene_id:
        _set_active_scene(None)
    _broadcast_event("scenes", {"action": "deleted", "scene_id": scene_id})
    return {"status": "deleted", "scene_id": scene_id}


@router.post("/scenes/reorder")
def api_reorder_scenes(request: SceneReorderRequest):
    order = set_scene_order(request.scene_ids)
    _broadcast_event("scenes", {"action": "reordered", "scene_ids": order})
    return {"status": "ok", "scene_ids": order}


@router.get("/settings", response_model=SettingsResponse)
def api_get_settings():
    return _get_settings_payload()


@router.post("/settings", response_model=SettingsResponse)
def api_update_settings(request: SettingsUpdateRequest):
    if request.universe_count < 1:
        raise HTTPException(status_code=400, detail="universe_count must be >= 1")

    _clear_live_editor_state()
    settings.node_ip = request.node_ip
    settings.dmx_fps = request.dmx_fps
    settings.poll_interval = request.poll_interval
    settings.universe_count = request.universe_count
    persist_runtime_settings()

    # Force reconnect/re-init with updated runtime settings on next play.
    _set_base_stream_payload(None)
    stop_stream()
    _set_active_scene(None)
    _broadcast_master_dimmer_status()
    _broadcast_event("settings", _get_settings_payload().model_dump())
    return _get_settings_payload()


@router.get("/control-mode", response_model=ControlModeResponse)
def api_get_control_mode():
    return ControlModeResponse(control_mode=CONTROL_MODE)


@router.post("/control-mode", response_model=ControlModeResponse)
def api_set_control_mode(request: ControlModeUpdateRequest):
    mode = request.control_mode.strip().lower()
    if mode not in {"panel", "external"}:
        raise HTTPException(status_code=400, detail="Invalid control mode")

    if mode == "external":
        _clear_live_editor_state()
        _set_base_stream_payload(None)
        stop_stream()
        _set_active_scene(None)
        _broadcast_master_dimmer_status()

    _set_control_mode(mode)
    return ControlModeResponse(control_mode=CONTROL_MODE)


@router.post("/scenes/{scene_id}/play")
def api_play_scene(scene_id: str):
    _assert_panel_mode()
    scene = get_scene(scene_id)
    if scene is None:
        raise HTTPException(status_code=404, detail="Scene not found")

    _clear_live_editor_state()
    _set_base_stream_payload(_build_stream_payload_from_scene(scene))
    _refresh_stream_from_base_payload()
    _set_active_scene(scene_id)
    return {"status": "playing", "scene_id": scene_id}


@router.post("/scenes/record", response_model=Scene)
def api_record_scene(request: SceneRecordRequest):
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Scene name cannot be empty")
    if _scene_name_exists(name):
        raise HTTPException(status_code=409, detail="Scene name already exists")

    snapshot = _record_scene_snapshot(request.duration)

    scene = Scene(
        id=_build_unique_scene_id(name),
        name=name,
        description=request.description.strip(),
        universes=snapshot,
        created_at=datetime.now(timezone.utc).isoformat(),
        style=request.style,
    )
    save_scene(scene)
    _broadcast_event("scenes", {"action": "created", "scene_id": scene.id})
    return scene


@router.post("/scenes/{scene_id}/rerecord", response_model=Scene)
def api_rerecord_scene(
    scene_id: str, request: Optional[SceneRerecordRequest] = None
):
    scene = get_scene(scene_id)
    if scene is None:
        raise HTTPException(status_code=404, detail="Scene not found")

    duration = request.duration if request is not None else 1.0
    snapshot = _record_scene_snapshot(duration)

    updated = Scene(
        id=scene.id,
        name=scene.name,
        description=scene.description,
        universes=snapshot,
        created_at=scene.created_at,
        style=scene.style,
    )
    save_scene(updated)
    _broadcast_event("scenes", {"action": "updated", "scene_id": scene.id})
    return updated


@router.post("/blackout")
def api_blackout():
    _assert_panel_mode()
    _clear_live_editor_state()
    _set_base_stream_payload(_build_blackout_payload())
    _refresh_stream_from_base_payload()
    _set_active_scene("__blackout__")
    return {"status": "blackout"}


@router.post("/stop")
def api_stop():
    _clear_live_editor_state()
    _set_base_stream_payload(None)
    stop_stream()
    _set_active_scene(None)
    _broadcast_master_dimmer_status()
    return {"status": "stopped"}
