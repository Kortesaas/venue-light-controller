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


class Scene(BaseModel):
    id: str
    name: str
    universes: Dict[int, List[int]]
    fade_in: float = 0.0
    fade_out: float = 0.0

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
    scenes: List[Scene] = []

    for path in sorted(scenes_dir.glob("*.json")):
        try:
            with path.open("r", encoding="utf-8") as f:
                data = json.load(f)
            scenes.append(Scene.model_validate(data))
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            _log.warning("Skipping invalid scene file %s: %s", path.name, exc)

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

    path = scenes_dir / f"{scene.id}.json"
    with path.open("w", encoding="utf-8") as f:
        json.dump(scene.model_dump(), f, indent=2)


def delete_scene(scene_id: str) -> None:
    path = _scenes_dir() / f"{scene_id}.json"
    try:
        path.unlink()
    except FileNotFoundError:
        return
