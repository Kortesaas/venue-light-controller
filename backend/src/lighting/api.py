import asyncio
import json
import re
import socket
import struct
import threading
import time
from datetime import datetime, timezone
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .artnet_core import (
    ARTNET_PORT,
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
    get_intensity_groups,
    get_intensity_addresses,
    get_fixture_plan_details,
    get_fixture_plan_summary,
    lookup_fixture_parameter,
    preview_fixture_plan,
)
from .scenes import (
    AnimatedFrame,
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
HAZE_PERCENT: int = 0
FOG_FLASH_ACTIVE: bool = False
GROUP_DIMMER_VALUES: Dict[str, int] = {}
GROUP_DIMMER_MUTED: set[str] = set()
_BASE_STREAM_PAYLOAD: Optional[Dict[int, bytes]] = None
_LIVE_EDITOR_STATE: Optional[dict] = None
_ANIMATED_PLAYBACK_STATE: Optional[dict] = None
_ANIMATED_RECORDING_STATE: Optional[dict] = None
_playback_state_lock = threading.Lock()
_recording_state_lock = threading.Lock()
_subscribers: set[asyncio.Queue[str]] = set()
_subscribers_lock = threading.Lock()
_event_loop: Optional[asyncio.AbstractEventLoop] = None

ANIMATED_RECORDING_MIN_DURATION_MS = 1500
ANIMATED_RECORDING_MAX_DURATION_MS = 60000


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
    _broadcast_event("status", _build_status_payload())


def _set_control_mode(mode: str) -> None:
    global CONTROL_MODE
    CONTROL_MODE = mode
    _broadcast_event("status", {"control_mode": CONTROL_MODE})


def _set_master_dimmer_percent(value: int) -> None:
    global MASTER_DIMMER_PERCENT
    MASTER_DIMMER_PERCENT = max(0, min(100, int(value)))


def _set_haze_percent(value: int) -> None:
    global HAZE_PERCENT
    HAZE_PERCENT = max(0, min(100, int(value)))


def _set_fog_flash_active(value: bool) -> None:
    global FOG_FLASH_ACTIVE
    FOG_FLASH_ACTIVE = bool(value)


def _has_fog_channel_configured() -> bool:
    return settings.fog_flash_channel > 0 and settings.fog_flash_universe > 0


def _has_haze_channel_configured() -> bool:
    return settings.haze_channel > 0 and settings.haze_universe > 0


def _get_group_dimmer_layout() -> Optional[List[dict]]:
    groups = get_intensity_groups()
    with _playback_state_lock:
        global GROUP_DIMMER_VALUES, GROUP_DIMMER_MUTED
        if groups is None:
            GROUP_DIMMER_VALUES = {}
            GROUP_DIMMER_MUTED = set()
            return None

        keys = {group["key"] for group in groups}
        GROUP_DIMMER_VALUES = {
            key: max(0, min(100, int(GROUP_DIMMER_VALUES.get(key, 100))))
            for key in keys
        }
        GROUP_DIMMER_MUTED = {key for key in GROUP_DIMMER_MUTED if key in keys}
        values = dict(GROUP_DIMMER_VALUES)
        muted = set(GROUP_DIMMER_MUTED)

    layout: List[dict] = []
    for group in groups:
        key = group["key"]
        layout.append(
            {
                "key": key,
                "name": group["name"],
                "fixture_count": group["fixture_count"],
                "channel_count": group["channel_count"],
                "addresses": group["addresses"],
                "value_percent": values.get(key, 100),
                "muted": key in muted,
            }
        )
    return layout


def _build_group_dimmer_status() -> dict:
    layout = _get_group_dimmer_layout()
    if layout is None:
        return {"group_dimmer_available": False, "group_dimmers": []}
    return {
        "group_dimmer_available": True,
        "group_dimmers": [
            {
                "key": group["key"],
                "name": group["name"],
                "fixture_count": group["fixture_count"],
                "channel_count": group["channel_count"],
                "value_percent": group["value_percent"],
                "muted": group["muted"],
            }
            for group in layout
        ],
    }


def _find_group_dimmer_or_raise(group_key: str) -> dict:
    layout = _get_group_dimmer_layout()
    if layout is None:
        raise HTTPException(
            status_code=409,
            detail="Group dimmer mixer requires an active fixture plan",
        )
    for group in layout:
        if group["key"] == group_key:
            return group
    raise HTTPException(status_code=404, detail="Group dimmer group not found")


def _build_status_payload() -> dict:
    payload = {
        "active_scene_id": ACTIVE_SCENE_ID,
        "live_edit_scene_name": _get_live_editor_scene_name(),
        "control_mode": CONTROL_MODE,
        "master_dimmer_percent": MASTER_DIMMER_PERCENT,
        "master_dimmer_mode": _get_master_dimmer_mode(),
        "haze_percent": HAZE_PERCENT,
        "fog_flash_active": FOG_FLASH_ACTIVE,
        "fog_flash_universe": settings.fog_flash_universe,
        "fog_flash_channel": settings.fog_flash_channel,
        "haze_universe": settings.haze_universe,
        "haze_channel": settings.haze_channel,
        "fog_flash_configured": _has_fog_channel_configured(),
        "haze_configured": _has_haze_channel_configured(),
        "show_scene_created_at_on_operator": settings.show_scene_created_at_on_operator,
    }
    payload.update(_build_group_dimmer_status())
    return payload


def _parse_artdmx_packet(data: bytes) -> Optional[tuple[int, bytes]]:
    if len(data) < 18 or data[0:8] != b"Art-Net\x00":
        return None

    opcode = struct.unpack("<H", data[8:10])[0]
    if opcode != 0x5000:
        return None

    universe = struct.unpack("<H", data[14:16])[0]
    length = struct.unpack(">H", data[16:18])[0]
    if length < 1 or len(data) < 18 + length:
        return None

    return universe, data[18 : 18 + length]


def _normalize_animated_frames(frames: list[dict], duration_ms: int) -> list[AnimatedFrame]:
    if not frames:
        return []

    sorted_frames = sorted(frames, key=lambda item: int(item["timestamp_ms"]))
    first_timestamp = int(sorted_frames[0]["timestamp_ms"])
    normalized: list[dict] = []
    last_signature: Optional[str] = None

    for frame in sorted_frames:
        ts = max(0, int(frame["timestamp_ms"]) - first_timestamp)
        universes = frame["universes"]
        signature = json.dumps(universes, separators=(",", ":"), sort_keys=True)
        if signature == last_signature and ts != duration_ms:
            continue
        last_signature = signature
        normalized.append({"timestamp_ms": ts, "universes": universes})

    if not normalized:
        return []

    if int(normalized[-1]["timestamp_ms"]) < duration_ms:
        normalized.append(
            {
                "timestamp_ms": duration_ms,
                "universes": normalized[-1]["universes"],
            }
        )

    return [AnimatedFrame.model_validate(frame) for frame in normalized]


def _trim_animated_frames_to_duration(
    frames: list[AnimatedFrame], duration_ms: int
) -> list[AnimatedFrame]:
    if not frames:
        return []
    if duration_ms >= frames[-1].timestamp_ms:
        return frames

    kept = [frame for frame in frames if frame.timestamp_ms <= duration_ms]
    if not kept:
        kept = [
            AnimatedFrame(
                timestamp_ms=0,
                universes=frames[0].universes,
            )
        ]

    last = kept[-1]
    if last.timestamp_ms < duration_ms:
        kept.append(
            AnimatedFrame(
                timestamp_ms=duration_ms,
                universes=last.universes,
            )
        )
    return kept


def _apply_bpm_quantization(
    frames: list[AnimatedFrame], duration_ms: int, bpm: Optional[float]
) -> tuple[list[AnimatedFrame], int, Optional[dict]]:
    if bpm is None:
        return frames, duration_ms, None
    if bpm <= 0:
        raise HTTPException(status_code=400, detail="BPM must be > 0")

    beat_ms = 60000.0 / bpm
    bar_ms = beat_ms * 4.0
    if bar_ms <= 0:
        return frames, duration_ms, None

    bars_nearest = max(1, int(round(duration_ms / bar_ms)))
    quantized_target = int(round(bars_nearest * bar_ms))
    if quantized_target > duration_ms:
        bars_floor = max(1, int(duration_ms // bar_ms))
        quantized_target = int(round(bars_floor * bar_ms))
    quantized_duration = max(1, min(duration_ms, quantized_target))

    quantized_frames = _trim_animated_frames_to_duration(frames, quantized_duration)
    details = {
        "bpm": round(float(bpm), 3),
        "beat_ms": int(round(beat_ms)),
        "bar_ms": int(round(bar_ms)),
        "bars": max(1, int(round(quantized_duration / bar_ms))),
        "quantized_duration_ms": quantized_duration,
        "source_duration_ms": duration_ms,
    }
    return quantized_frames, quantized_duration, details


def _stop_animated_playback() -> None:
    with _playback_state_lock:
        global _ANIMATED_PLAYBACK_STATE
        state = _ANIMATED_PLAYBACK_STATE
        _ANIMATED_PLAYBACK_STATE = None

    if not isinstance(state, dict):
        return

    stop_event = state.get("stop_event")
    thread = state.get("thread")
    if isinstance(stop_event, threading.Event):
        stop_event.set()
    if isinstance(thread, threading.Thread) and thread.is_alive():
        thread.join(timeout=1.0)


def _start_animated_playback(scene: Scene) -> None:
    if scene.type != "dynamic" or not scene.animated_frames:
        return

    _stop_animated_playback()

    frames = sorted(scene.animated_frames, key=lambda frame: frame.timestamp_ms)
    duration_ms = max(1, int(scene.duration_ms or frames[-1].timestamp_ms or 1))
    mode = scene.playback_mode or "loop"
    stop_event = threading.Event()

    def worker() -> None:
        start_time = time.monotonic()
        last_index = -1
        while not stop_event.is_set():
            elapsed_ms = int((time.monotonic() - start_time) * 1000)
            if elapsed_ms >= duration_ms:
                if mode == "loop":
                    elapsed_ms %= duration_ms
                    start_time = time.monotonic() - (elapsed_ms / 1000.0)
                    last_index = -1
                else:
                    break

            frame_index = 0
            for index, frame in enumerate(frames):
                if frame.timestamp_ms <= elapsed_ms:
                    frame_index = index
                else:
                    break

            if frame_index != last_index:
                payload = _build_stream_payload_from_universes(frames[frame_index].universes)
                _set_base_stream_payload(payload)
                _refresh_stream_from_base_payload(broadcast_status=False)
                last_index = frame_index

            if frame_index + 1 < len(frames):
                next_timestamp = frames[frame_index + 1].timestamp_ms
            else:
                next_timestamp = duration_ms
            wait_ms = max(1, next_timestamp - elapsed_ms)
            stop_event.wait(min(0.05, wait_ms / 1000.0))

        if not stop_event.is_set() and mode == "once":
            _set_base_stream_payload(None)
            stop_stream()
            _set_active_scene(None)
            _broadcast_master_dimmer_status()

    thread = threading.Thread(target=worker, daemon=True)
    with _playback_state_lock:
        global _ANIMATED_PLAYBACK_STATE
        _ANIMATED_PLAYBACK_STATE = {"scene_id": scene.id, "thread": thread, "stop_event": stop_event}
    thread.start()


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


def _apply_group_dimmers(payload: Dict[int, bytes]) -> Dict[int, bytes]:
    layout = _get_group_dimmer_layout()
    if layout is None:
        return payload

    per_channel_percent: Dict[tuple[int, int], int] = {}
    for group in layout:
        percent = 0 if group["muted"] else max(0, min(100, int(group["value_percent"])))
        if percent >= 100:
            continue
        for universe, channel in group["addresses"]:
            if channel < 1 or channel > 512:
                continue
            key = (int(universe), channel - 1)
            existing = per_channel_percent.get(key, 100)
            per_channel_percent[key] = min(existing, percent)

    if not per_channel_percent:
        return payload

    output = _clone_payload(payload)
    by_universe: Dict[int, List[tuple[int, int]]] = {}
    for (universe, channel_index), percent in per_channel_percent.items():
        by_universe.setdefault(universe, []).append((channel_index, percent))

    for universe, entries in by_universe.items():
        dmx = output.get(universe)
        if dmx is None:
            continue
        values = bytearray(bytes(dmx[:512]).ljust(512, b"\x00"))
        for channel_index, percent in entries:
            values[channel_index] = max(
                0, min(255, round((values[channel_index] * percent) / 100))
            )
        output[universe] = bytes(values)

    return output


def _apply_atmosphere_controls(payload: Dict[int, bytes]) -> Dict[int, bytes]:
    output = _clone_payload(payload)

    def ensure_universe(universe: int) -> bytearray:
        existing = output.get(universe)
        if existing is None:
            return bytearray(b"\x00" * 512)
        return bytearray(bytes(existing[:512]).ljust(512, b"\x00"))

    if _has_haze_channel_configured():
        haze_universe = settings.haze_universe - 1
        haze_index = settings.haze_channel - 1
        if 0 <= haze_index < 512:
            values = ensure_universe(haze_universe)
            values[haze_index] = max(0, min(255, round((HAZE_PERCENT * 255) / 100)))
            output[haze_universe] = bytes(values)

    if _has_fog_channel_configured():
        fog_universe = settings.fog_flash_universe - 1
        fog_index = settings.fog_flash_channel - 1
        if 0 <= fog_index < 512:
            values = ensure_universe(fog_universe)
            values[fog_index] = 255 if FOG_FLASH_ACTIVE else 0
            output[fog_universe] = bytes(values)

    return output


def _broadcast_master_dimmer_status(mode: Optional[str] = None) -> None:
    payload = _build_status_payload()
    if mode is not None:
        payload["master_dimmer_mode"] = mode
    _broadcast_event("status", payload)


def _refresh_stream_from_base_payload(*, broadcast_status: bool = True) -> None:
    with _playback_state_lock:
        base_payload = _clone_payload(_BASE_STREAM_PAYLOAD or {})
        dimmer_percent = MASTER_DIMMER_PERCENT

    scaled_payload, mode = _apply_master_dimmer(base_payload, dimmer_percent)
    grouped_payload = _apply_group_dimmers(scaled_payload)
    effective_payload = _apply_atmosphere_controls(grouped_payload)

    if effective_payload:
        if is_stream_running():
            update_stream(effective_payload)
        else:
            start_stream(effective_payload)
    else:
        stop_stream()
    if broadcast_status:
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
        **_build_status_payload(),
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
                _build_status_payload(),
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
    _stop_animated_playback()
    _set_base_stream_payload({0: bytes([255] * 512)})
    _refresh_stream_from_base_payload()
    return {"status": "started", "universe": 0}


@router.post("/test/stop")
def test_stop():
    """
    Test: Stream stoppen.
    """
    _clear_live_editor_state()
    _stop_animated_playback()
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


class AnimatedSceneSaveRequest(BaseModel):
    name: str
    description: str = ""
    style: Optional[SceneStyle] = None
    mode: Literal["loop", "once"] = "loop"


class AnimatedSceneStopRequest(BaseModel):
    bpm: Optional[float] = None


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
    fog_flash_universe: int
    fog_flash_channel: int
    haze_universe: int
    haze_channel: int
    show_scene_created_at_on_operator: bool


class SettingsUpdateRequest(BaseModel):
    node_ip: str
    dmx_fps: float
    poll_interval: float
    universe_count: int
    fog_flash_universe: int
    fog_flash_channel: int
    haze_universe: int
    haze_channel: int
    show_scene_created_at_on_operator: bool


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


class HazeUpdateRequest(BaseModel):
    value_percent: int


class FogFlashUpdateRequest(BaseModel):
    active: bool


class GroupDimmerValueUpdateRequest(BaseModel):
    value_percent: int


class GroupDimmerMuteUpdateRequest(BaseModel):
    active: bool


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
        fog_flash_universe=settings.fog_flash_universe,
        fog_flash_channel=settings.fog_flash_channel,
        haze_universe=settings.haze_universe,
        haze_channel=settings.haze_channel,
        show_scene_created_at_on_operator=settings.show_scene_created_at_on_operator,
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


@router.get("/group-dimmers")
def api_get_group_dimmers():
    return _build_group_dimmer_status()


@router.post("/group-dimmers/{group_key}")
def api_set_group_dimmer(group_key: str, request: GroupDimmerValueUpdateRequest):
    _assert_panel_mode()
    if request.value_percent < 0 or request.value_percent > 100:
        raise HTTPException(status_code=400, detail="value_percent must be in range 0..100")

    group = _find_group_dimmer_or_raise(group_key)
    with _playback_state_lock:
        GROUP_DIMMER_VALUES[group["key"]] = max(0, min(100, int(request.value_percent)))

    _refresh_stream_from_base_payload()
    updated_group = _find_group_dimmer_or_raise(group_key)
    return {
        "key": updated_group["key"],
        "name": updated_group["name"],
        "value_percent": updated_group["value_percent"],
        "muted": updated_group["muted"],
    }


@router.post("/group-dimmers/{group_key}/mute")
def api_set_group_dimmer_mute(group_key: str, request: GroupDimmerMuteUpdateRequest):
    _assert_panel_mode()
    group = _find_group_dimmer_or_raise(group_key)
    with _playback_state_lock:
        if request.active:
            GROUP_DIMMER_MUTED.add(group["key"])
        else:
            GROUP_DIMMER_MUTED.discard(group["key"])

    _refresh_stream_from_base_payload()
    updated_group = _find_group_dimmer_or_raise(group_key)
    return {
        "key": updated_group["key"],
        "name": updated_group["name"],
        "value_percent": updated_group["value_percent"],
        "muted": updated_group["muted"],
    }


@router.get("/atmosphere")
def api_get_atmosphere():
    return {
        "haze_percent": HAZE_PERCENT,
        "fog_flash_active": FOG_FLASH_ACTIVE,
        "fog_flash_configured": _has_fog_channel_configured(),
        "haze_configured": _has_haze_channel_configured(),
        "fog_flash_universe": settings.fog_flash_universe,
        "fog_flash_channel": settings.fog_flash_channel,
        "haze_universe": settings.haze_universe,
        "haze_channel": settings.haze_channel,
    }


@router.post("/atmosphere/haze")
def api_set_haze(request: HazeUpdateRequest):
    _assert_panel_mode()
    if request.value_percent < 0 or request.value_percent > 100:
        raise HTTPException(status_code=400, detail="value_percent must be in range 0..100")

    _set_haze_percent(request.value_percent)
    _refresh_stream_from_base_payload()
    return {
        "haze_percent": HAZE_PERCENT,
        "haze_configured": _has_haze_channel_configured(),
    }


@router.post("/atmosphere/fog-flash")
def api_set_fog_flash(request: FogFlashUpdateRequest):
    _assert_panel_mode()
    _set_fog_flash_active(request.active)
    _refresh_stream_from_base_payload()
    return {
        "fog_flash_active": FOG_FLASH_ACTIVE,
        "fog_flash_configured": _has_fog_channel_configured(),
    }


@router.post("/scene-editor/live/start")
def api_scene_editor_live_start(request: SceneEditorLiveStartRequest):
    _assert_panel_mode()
    _stop_animated_playback()

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


@router.post("/scenes/dynamic/start")
@router.post("/scenes/animated/start")
def api_start_animated_scene_recording():
    return _start_animated_recording_session()


@router.post("/scenes/dynamic/stop")
@router.post("/scenes/animated/stop")
def api_stop_animated_scene_recording(request: Optional[AnimatedSceneStopRequest] = None):
    bpm = request.bpm if request is not None else None
    return _stop_animated_recording_session(bpm=bpm)


@router.post("/scenes/dynamic/cancel")
@router.post("/scenes/animated/cancel")
def api_cancel_animated_scene_recording():
    return _cancel_animated_recording_session()


@router.post("/scenes/dynamic/save", response_model=Scene)
@router.post("/scenes/animated/save", response_model=Scene)
def api_save_animated_scene(request: AnimatedSceneSaveRequest):
    global _ANIMATED_RECORDING_STATE
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Scene name cannot be empty")
    if _scene_name_exists(name):
        raise HTTPException(status_code=409, detail="Scene name already exists")

    with _recording_state_lock:
        state = _ANIMATED_RECORDING_STATE
        if not isinstance(state, dict) or state.get("phase") != "ready":
            raise HTTPException(
                status_code=409,
                detail="No recorded dynamic loop available. Start and stop a dynamic recording first.",
            )

    duration_ms = int(state.get("duration_ms", 0))
    frames = state.get("animated_frames")
    if not isinstance(frames, list) or len(frames) < 2:
        raise HTTPException(status_code=400, detail="Dynamic recording is too short")
    if duration_ms < ANIMATED_RECORDING_MIN_DURATION_MS:
        raise HTTPException(status_code=400, detail="Dynamic recording is below minimum duration")

    first_frame = frames[0]
    scene = Scene(
        id=_build_unique_scene_id(name),
        name=name,
        description=request.description.strip(),
        type="dynamic",
        universes=first_frame.universes,
        duration_ms=duration_ms,
        playback_mode=request.mode,
        animated_frames=frames,
        created_at=datetime.now(timezone.utc).isoformat(),
        style=request.style,
    )
    save_scene(scene)
    with _recording_state_lock:
        if _ANIMATED_RECORDING_STATE is state:
            _ANIMATED_RECORDING_STATE = None
    _broadcast_event("scenes", {"action": "created", "scene_id": scene.id})
    return scene


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
    if scene.type == "dynamic" and scene.animated_frames:
        return {
            universe: bytes(values[:512]).ljust(512, b"\x00")
            for universe, values in scene.animated_frames[0].universes.items()
        }
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
    if scene.type != "static":
        raise HTTPException(
            status_code=400,
            detail="Only static scenes support direct universe content editing",
        )
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
    _stop_animated_playback()
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


def _restore_after_animated_recording(state: dict) -> None:
    if state.get("restored"):
        return
    restore_payload = state.get("restore_payload")
    restore_scene_id = state.get("restore_scene_id")
    if isinstance(restore_payload, dict) and restore_payload:
        _set_base_stream_payload(restore_payload)
        _refresh_stream_from_base_payload()
    else:
        _set_base_stream_payload(None)
        stop_stream()
        _broadcast_master_dimmer_status()
    if isinstance(restore_scene_id, str):
        _set_active_scene(restore_scene_id)
    else:
        _set_active_scene(None)
    state["restored"] = True


def _animated_recording_worker(state: dict) -> None:
    sock = state["socket"]
    stop_event = state["stop_event"]
    done_event = state["done_event"]
    target_universes = state["target_universes"]
    max_duration_ms = state["max_duration_ms"]
    start_time = state["start_time"]
    buffers = state["buffers"]
    frames: list[dict] = []
    last_signature: Optional[str] = None

    try:
        while not stop_event.is_set():
            elapsed_ms = int((time.monotonic() - start_time) * 1000)
            if elapsed_ms >= max_duration_ms:
                state["auto_stopped"] = True
                break

            try:
                data, _addr = sock.recvfrom(2048)
            except socket.timeout:
                continue

            parsed = _parse_artdmx_packet(data)
            if parsed is None:
                continue
            universe, dmx = parsed
            if universe not in target_universes:
                continue

            buffer = buffers[universe]
            for index in range(min(len(dmx), 512)):
                buffer[index] = dmx[index]

            snapshot = {u: list(values) for u, values in buffers.items()}
            signature = json.dumps(snapshot, separators=(",", ":"), sort_keys=True)
            if signature == last_signature:
                continue
            last_signature = signature
            frames.append({"timestamp_ms": elapsed_ms, "universes": snapshot})
    except OSError as exc:
        state["error"] = str(exc)
    finally:
        end_elapsed_ms = int((time.monotonic() - start_time) * 1000)
        state["duration_ms"] = max(1, min(max_duration_ms, end_elapsed_ms))
        state["frames_raw"] = frames
        state["frame_count"] = len(frames)
        try:
            sock.close()
        except OSError:
            pass
        done_event.set()


def _start_animated_recording_session() -> dict:
    with _recording_state_lock:
        global _ANIMATED_RECORDING_STATE
        existing = _ANIMATED_RECORDING_STATE
        if isinstance(existing, dict) and existing.get("phase") == "recording":
            raise HTTPException(status_code=409, detail="Dynamic recording already in progress")

    with _playback_state_lock:
        restore_payload = _clone_payload(_BASE_STREAM_PAYLOAD or {})
    restore_scene_id = ACTIVE_SCENE_ID

    _stop_animated_playback()
    stop_stream()

    target_universes = list(range(settings.universe_count))
    buffers = {universe: [0] * 512 for universe in target_universes}
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind(("", ARTNET_PORT))
        sock.settimeout(0.05)
    except OSError as exc:
        if restore_payload:
            _set_base_stream_payload(restore_payload)
            _refresh_stream_from_base_payload()
            _set_active_scene(restore_scene_id)
        raise HTTPException(
            status_code=409,
            detail="Art-Net port 6454 is already in use",
        ) from exc

    state = {
        "phase": "recording",
        "start_time": time.monotonic(),
        "max_duration_ms": ANIMATED_RECORDING_MAX_DURATION_MS,
        "stop_event": threading.Event(),
        "done_event": threading.Event(),
        "thread": None,
        "socket": sock,
        "target_universes": target_universes,
        "buffers": buffers,
        "frames_raw": [],
        "duration_ms": 0,
        "frame_count": 0,
        "auto_stopped": False,
        "error": None,
        "restore_payload": restore_payload,
        "restore_scene_id": restore_scene_id,
        "restored": False,
    }
    thread = threading.Thread(target=_animated_recording_worker, args=(state,), daemon=True)
    state["thread"] = thread
    thread.start()

    with _recording_state_lock:
        _ANIMATED_RECORDING_STATE = state
    return {
        "status": "recording",
        "min_duration_ms": ANIMATED_RECORDING_MIN_DURATION_MS,
        "max_duration_ms": ANIMATED_RECORDING_MAX_DURATION_MS,
    }


def _stop_animated_recording_session(bpm: Optional[float] = None) -> dict:
    global _ANIMATED_RECORDING_STATE
    with _recording_state_lock:
        state = _ANIMATED_RECORDING_STATE
    if not isinstance(state, dict):
        raise HTTPException(status_code=409, detail="No dynamic recording session active")

    if state.get("phase") == "ready":
        frames = state.get("animated_frames") or []
        duration_ms = int(state.get("duration_ms", 0))
        quantize_info = state.get("bpm_quantization")
        if bpm is not None:
            raw_frames = state.get("raw_animated_frames") or frames
            raw_duration_ms = int(state.get("raw_duration_ms", duration_ms))
            frames, duration_ms, quantize_info = _apply_bpm_quantization(
                raw_frames, raw_duration_ms, bpm
            )
            state["animated_frames"] = frames
            state["duration_ms"] = duration_ms
            state["frame_count"] = len(frames)
            state["bpm_quantization"] = quantize_info

        return {
            "status": "recorded",
            "duration_ms": duration_ms,
            "frame_count": state["frame_count"],
            "auto_stopped": bool(state.get("auto_stopped")),
            "min_duration_ms": ANIMATED_RECORDING_MIN_DURATION_MS,
            "max_duration_ms": ANIMATED_RECORDING_MAX_DURATION_MS,
            "bpm_quantization": quantize_info,
        }

    stop_event = state["stop_event"]
    done_event = state["done_event"]
    stop_event.set()
    done_event.wait(timeout=2.0)

    thread = state.get("thread")
    if isinstance(thread, threading.Thread) and thread.is_alive():
        thread.join(timeout=0.5)

    if state.get("error"):
        _restore_after_animated_recording(state)
        with _recording_state_lock:
            _ANIMATED_RECORDING_STATE = None
        raise HTTPException(status_code=500, detail="Dynamic recording failed")

    duration_ms = int(state.get("duration_ms", 0))
    raw_duration_ms = duration_ms
    frames_raw = state.get("frames_raw") or []
    raw_frames = _normalize_animated_frames(frames_raw, duration_ms)
    frames, duration_ms, quantize_info = _apply_bpm_quantization(raw_frames, duration_ms, bpm)
    state["raw_duration_ms"] = raw_duration_ms
    state["raw_animated_frames"] = raw_frames
    state["animated_frames"] = frames
    state["frame_count"] = len(frames)
    state["duration_ms"] = duration_ms
    state["bpm_quantization"] = quantize_info
    state["phase"] = "ready"
    _restore_after_animated_recording(state)

    if len(frames) < 2:
        return {
            "status": "too_short",
            "duration_ms": duration_ms,
            "frame_count": len(frames),
            "auto_stopped": bool(state.get("auto_stopped")),
            "min_duration_ms": ANIMATED_RECORDING_MIN_DURATION_MS,
            "max_duration_ms": ANIMATED_RECORDING_MAX_DURATION_MS,
            "warning": "No meaningful DMX changes captured",
            "bpm_quantization": quantize_info,
        }

    if duration_ms < ANIMATED_RECORDING_MIN_DURATION_MS:
        return {
            "status": "too_short",
            "duration_ms": duration_ms,
            "frame_count": len(frames),
            "auto_stopped": bool(state.get("auto_stopped")),
            "min_duration_ms": ANIMATED_RECORDING_MIN_DURATION_MS,
            "max_duration_ms": ANIMATED_RECORDING_MAX_DURATION_MS,
            "warning": "Loop duration is below minimum",
            "bpm_quantization": quantize_info,
        }

    return {
        "status": "recorded",
        "duration_ms": duration_ms,
        "frame_count": len(frames),
        "auto_stopped": bool(state.get("auto_stopped")),
        "min_duration_ms": ANIMATED_RECORDING_MIN_DURATION_MS,
        "max_duration_ms": ANIMATED_RECORDING_MAX_DURATION_MS,
        "bpm_quantization": quantize_info,
    }


def _cancel_animated_recording_session() -> dict:
    with _recording_state_lock:
        global _ANIMATED_RECORDING_STATE
        state = _ANIMATED_RECORDING_STATE
        _ANIMATED_RECORDING_STATE = None

    if not isinstance(state, dict):
        return {"status": "inactive"}

    if state.get("phase") == "recording":
        stop_event = state["stop_event"]
        done_event = state["done_event"]
        stop_event.set()
        done_event.wait(timeout=2.0)
        thread = state.get("thread")
        if isinstance(thread, threading.Thread) and thread.is_alive():
            thread.join(timeout=0.5)

    _restore_after_animated_recording(state)
    return {"status": "cancelled"}


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
        type=scene.type,
        universes=scene.universes,
        duration_ms=scene.duration_ms,
        playback_mode=scene.playback_mode,
        animated_frames=scene.animated_frames,
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
        type=scene.type,
        universes=request.universes,
        duration_ms=scene.duration_ms,
        playback_mode=scene.playback_mode,
        animated_frames=scene.animated_frames,
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
        _stop_animated_playback()
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
    for key, value in (
        ("fog_flash_universe", request.fog_flash_universe),
        ("haze_universe", request.haze_universe),
    ):
        if value < 1:
            raise HTTPException(status_code=400, detail=f"{key} must be >= 1")
    for key, value in (
        ("fog_flash_channel", request.fog_flash_channel),
        ("haze_channel", request.haze_channel),
    ):
        if value < 0 or value > 512:
            raise HTTPException(status_code=400, detail=f"{key} must be in range 0..512")

    _clear_live_editor_state()
    _cancel_animated_recording_session()
    _stop_animated_playback()
    settings.node_ip = request.node_ip
    settings.dmx_fps = request.dmx_fps
    settings.poll_interval = request.poll_interval
    settings.universe_count = request.universe_count
    settings.fog_flash_universe = request.fog_flash_universe
    settings.fog_flash_channel = request.fog_flash_channel
    settings.haze_universe = request.haze_universe
    settings.haze_channel = request.haze_channel
    settings.show_scene_created_at_on_operator = request.show_scene_created_at_on_operator
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
        _cancel_animated_recording_session()
        _stop_animated_playback()
        _set_fog_flash_active(False)
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
    _stop_animated_playback()
    _set_base_stream_payload(_build_stream_payload_from_scene(scene))
    _refresh_stream_from_base_payload()
    if scene.type == "dynamic":
        _start_animated_playback(scene)
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
    if scene.type != "static":
        raise HTTPException(status_code=400, detail="Only static scenes can be rerecorded")

    duration = request.duration if request is not None else 1.0
    snapshot = _record_scene_snapshot(duration)

    updated = Scene(
        id=scene.id,
        name=scene.name,
        description=scene.description,
        type=scene.type,
        universes=snapshot,
        duration_ms=scene.duration_ms,
        playback_mode=scene.playback_mode,
        animated_frames=scene.animated_frames,
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
    _cancel_animated_recording_session()
    _stop_animated_playback()
    _set_fog_flash_active(False)
    _set_base_stream_payload(_build_blackout_payload())
    _refresh_stream_from_base_payload()
    _set_active_scene("__blackout__")
    return {"status": "blackout"}


@router.post("/stop")
def api_stop():
    _clear_live_editor_state()
    _cancel_animated_recording_session()
    _stop_animated_playback()
    _set_fog_flash_active(False)
    _set_base_stream_payload(None)
    stop_stream()
    _set_active_scene(None)
    _broadcast_master_dimmer_status()
    return {"status": "stopped"}
