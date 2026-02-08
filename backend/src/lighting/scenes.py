import json
import logging
from pathlib import Path
from typing import Dict, List, Optional

from pydantic import BaseModel, field_validator

from .config import settings

_log = logging.getLogger(__name__)

DMX_CHANNELS = 512
DMX_MIN = 0
DMX_MAX = 255
ORDER_FILE = "_order.json"


class Scene(BaseModel):
    id: str
    name: str
    description: str = ""
    universes: Dict[int, List[int]]

    @field_validator("universes")
    @classmethod
    def _validate_universes(cls, universes: Dict[int, List[int]]) -> Dict[int, List[int]]:
        _validate_universes(universes)
        return universes


def _scenes_dir() -> Path:
    return Path(settings.scenes_path)


def _ensure_scenes_dir() -> Path:
    scenes_dir = _scenes_dir()
    scenes_dir.mkdir(parents=True, exist_ok=True)
    return scenes_dir


def _order_path() -> Path:
    return _ensure_scenes_dir() / ORDER_FILE


def _load_order() -> List[str]:
    path = _order_path()
    if not path.exists():
        return []

    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, list):
            return []
        return [scene_id for scene_id in data if isinstance(scene_id, str)]
    except (OSError, json.JSONDecodeError):
        _log.warning("Failed to read scene order file, ignoring")
        return []


def _save_order(scene_ids: List[str]) -> None:
    path = _order_path()
    with path.open("w", encoding="utf-8") as f:
        json.dump(scene_ids, f, indent=2)


def _current_scene_ids() -> List[str]:
    scenes_dir = _ensure_scenes_dir()
    return sorted(path.stem for path in scenes_dir.glob("*.json") if path.name != ORDER_FILE)


def _normalize_order() -> List[str]:
    existing = _current_scene_ids()
    existing_set = set(existing)

    order = [scene_id for scene_id in _load_order() if scene_id in existing_set]
    for scene_id in existing:
        if scene_id not in order:
            order.append(scene_id)

    _save_order(order)
    return order


def _validate_universes(universes: Dict[int, List[int]]) -> None:
    for universe, dmx in universes.items():
        if len(dmx) != DMX_CHANNELS:
            raise ValueError(
                f"Universe {universe} must have exactly {DMX_CHANNELS} values"
            )
        for value in dmx:
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError(
                    f"Universe {universe} has non-integer DMX value: {value!r}"
                )
            if value < DMX_MIN or value > DMX_MAX:
                raise ValueError(
                    f"Universe {universe} has DMX value out of range: {value}"
                )


def list_scenes() -> List[Scene]:
    scenes_dir = _ensure_scenes_dir()
    scenes_by_id: Dict[str, Scene] = {}

    for path in sorted(scenes_dir.glob("*.json")):
        if path.name == ORDER_FILE:
            continue
        try:
            with path.open("r", encoding="utf-8") as f:
                data = json.load(f)
            scene = Scene.model_validate(data)
            scenes_by_id[scene.id] = scene
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            _log.warning("Skipping invalid scene file %s: %s", path.name, exc)

    order = _normalize_order()
    scenes: List[Scene] = []
    for scene_id in order:
        scene = scenes_by_id.get(scene_id)
        if scene is not None:
            scenes.append(scene)

    # Include scenes missing from order just in case.
    for scene_id in sorted(scenes_by_id.keys()):
        if scene_id not in order:
            scenes.append(scenes_by_id[scene_id])

    return scenes


def get_scene(scene_id: str) -> Optional[Scene]:
    path = _scenes_dir() / f"{scene_id}.json"
    if not path.exists():
        return None

    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return Scene.model_validate(data)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        _log.warning("Failed to load scene %s: %s", scene_id, exc)
        return None


def save_scene(scene: Scene) -> None:
    scenes_dir = _ensure_scenes_dir()
    _validate_universes(scene.universes)

    existing = get_scene(scene.id)

    path = scenes_dir / f"{scene.id}.json"
    with path.open("w", encoding="utf-8") as f:
        json.dump(scene.model_dump(), f, indent=2)

    if existing is None:
        order = _normalize_order()
        if scene.id not in order:
            order.append(scene.id)
            _save_order(order)


def delete_scene(scene_id: str) -> None:
    path = _scenes_dir() / f"{scene_id}.json"
    try:
        path.unlink()
    except FileNotFoundError:
        return

    order = [value for value in _normalize_order() if value != scene_id]
    _save_order(order)


def set_scene_order(scene_ids: List[str]) -> List[str]:
    existing = _current_scene_ids()
    existing_set = set(existing)

    ordered: List[str] = []
    for scene_id in scene_ids:
        if scene_id in existing_set and scene_id not in ordered:
            ordered.append(scene_id)

    for scene_id in existing:
        if scene_id not in ordered:
            ordered.append(scene_id)

    _save_order(ordered)
    return ordered
