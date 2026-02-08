from typing import Dict, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .artnet_core import record_snapshot, start_stream, stop_stream
from .config import settings
from .scenes import Scene, delete_scene, get_scene, list_scenes, save_scene

router = APIRouter()


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
    }


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
    id: str
    name: str
    universe: int = 0
    duration: float = 1.0
    fade_in: float = 0.0
    fade_out: float = 0.0


@router.get("/scenes", response_model=list[Scene])
def api_list_scenes():
    return list_scenes()


@router.get("/scenes/{scene_id}", response_model=Scene)
def api_get_scene(scene_id: str):
    scene = get_scene(scene_id)
    if scene is None:
        raise HTTPException(status_code=404, detail="Scene not found")
    return scene


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
    return {"status": "playing", "scene_id": scene_id}


@router.post("/scenes/record", response_model=Scene)
def api_record_scene(request: SceneRecordRequest):
    snapshot = record_snapshot(request.universe, request.duration)
    dmx_values = snapshot.get(request.universe, [0] * 512)

    scene = Scene(
        id=request.id,
        name=request.name,
        universes={request.universe: dmx_values},
        fade_in=request.fade_in,
        fade_out=request.fade_out,
    )
    save_scene(scene)
    return scene


@router.post("/blackout")
def api_blackout():
    universe_to_dmx = {0: bytes([0] * 512)}
    start_stream(universe_to_dmx)
    return {"status": "blackout"}


@router.post("/stop")
def api_stop():
    stop_stream()
    return {"status": "stopped"}
