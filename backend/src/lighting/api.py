import asyncio
import json
import re
import threading
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .artnet_core import record_snapshot, start_stream, stop_stream
from .config import settings
from .scenes import (
    Scene,
    delete_scene,
    get_scene,
    list_scenes,
    save_scene,
    set_scene_order,
)

router = APIRouter()

ACTIVE_SCENE_ID: Optional[str] = None
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
    _broadcast_event("status", {"active_scene_id": ACTIVE_SCENE_ID})


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
            yield _format_sse("status", {"active_scene_id": ACTIVE_SCENE_ID})
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
    start_stream({0: bytes([255] * 512)})
    return {"status": "started", "universe": 0}


@router.post("/test/stop")
def test_stop():
    """
    Test: Stream stoppen.
    """
    stop_stream()
    return {"status": "stopped"}


class SceneRecordRequest(BaseModel):
    name: str
    universe: int = 0
    duration: float = 1.0


class SceneUpdateRequest(BaseModel):
    name: str


class SceneReorderRequest(BaseModel):
    scene_ids: List[str]


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

    updated = Scene(
        id=scene.id,
        name=name,
        universes=scene.universes,
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


@router.post("/scenes/{scene_id}/play")
def api_play_scene(scene_id: str):
    scene = get_scene(scene_id)
    if scene is None:
        raise HTTPException(status_code=404, detail="Scene not found")

    universe_to_dmx: Dict[int, bytes] = {
        universe: bytes(values[:512]).ljust(512, b"\x00")
        for universe, values in scene.universes.items()
    }

    start_stream(universe_to_dmx)
    _set_active_scene(scene_id)
    return {"status": "playing", "scene_id": scene_id}


@router.post("/scenes/record", response_model=Scene)
def api_record_scene(request: SceneRecordRequest):
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Scene name cannot be empty")
    if _scene_name_exists(name):
        raise HTTPException(status_code=409, detail="Scene name already exists")

    snapshot = record_snapshot(request.universe, request.duration)
    dmx_values = snapshot.get(request.universe, [0] * 512)

    scene = Scene(
        id=_build_unique_scene_id(name),
        name=name,
        universes={request.universe: dmx_values},
    )
    save_scene(scene)
    _broadcast_event("scenes", {"action": "created", "scene_id": scene.id})
    return scene


@router.post("/blackout")
def api_blackout():
    universe_to_dmx = {0: bytes([0] * 512)}
    start_stream(universe_to_dmx)
    _set_active_scene("__blackout__")
    return {"status": "blackout"}


@router.post("/stop")
def api_stop():
    stop_stream()
    _set_active_scene(None)
    return {"status": "stopped"}
