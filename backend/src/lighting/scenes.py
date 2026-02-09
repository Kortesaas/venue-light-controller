import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from .config import settings

_log = logging.getLogger(__name__)

DMX_CHANNELS = 512
DMX_MIN = 0
DMX_MAX = 255
ORDER_FILE = "_order.json"
ANIMATED_ENCODING_DELTA_V1 = "delta-v1"


class SceneStyle(BaseModel):
    color: Optional[
        Literal[
            "default",
            "cyan",
            "blue",
            "teal",
            "green",
            "violet",
            "amber",
            "rose",
            "red",
            "rainbow",
        ]
    ] = None
    variant: Optional[Literal["default", "solid", "soft", "outline"]] = None
    icon: Optional[
        Literal[
            "none",
            "beam",
            "wash",
            "strobe",
            "movement",
            "color",
            "fx",
            "speaker",
            "party",
            "chill",
            "dinner",
            "ceremony",
            "show",
            "technical",
        ]
    ] = None
    emphasis: Optional[Literal["normal", "primary", "warning"]] = None


class AnimatedFrame(BaseModel):
    timestamp_ms: int
    universes: Dict[int, List[int]]

    @field_validator("timestamp_ms")
    @classmethod
    def _validate_timestamp_ms(cls, value: int) -> int:
        if value < 0:
            raise ValueError("timestamp_ms must be >= 0")
        return value

    @field_validator("universes")
    @classmethod
    def _validate_frame_universes(
        cls, universes: Dict[int, List[int]]
    ) -> Dict[int, List[int]]:
        _validate_universes(universes)
        return universes


class Scene(BaseModel):
    id: str
    name: str
    description: str = ""
    type: Literal["static", "dynamic"] = "static"
    universes: Dict[int, List[int]] = Field(default_factory=dict)
    duration_ms: Optional[int] = None
    playback_mode: Optional[Literal["loop", "once"]] = None
    animated_frames: Optional[List[AnimatedFrame]] = None
    created_at: Optional[str] = None
    style: Optional[SceneStyle] = None

    @field_validator("universes")
    @classmethod
    def _validate_universes(cls, universes: Dict[int, List[int]]) -> Dict[int, List[int]]:
        _validate_universes(universes)
        return universes

    @field_validator("type", mode="before")
    @classmethod
    def _normalize_type(cls, value: object) -> object:
        if isinstance(value, str) and value.strip().lower() == "animated":
            return "dynamic"
        return value

    @field_validator("created_at")
    @classmethod
    def _validate_created_at(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = value.replace("Z", "+00:00")
        try:
            datetime.fromisoformat(normalized)
        except ValueError as exc:
            raise ValueError("created_at must be an ISO-8601 timestamp") from exc
        return value

    @model_validator(mode="after")
    def _validate_scene_type_fields(self) -> "Scene":
        if self.type == "static":
            if self.duration_ms is not None:
                self.duration_ms = None
            if self.playback_mode is not None:
                self.playback_mode = None
            if self.animated_frames is not None:
                self.animated_frames = None
            return self

        if self.duration_ms is None or self.duration_ms < 1:
            raise ValueError("Dynamic scenes require duration_ms >= 1")
        if self.playback_mode is None:
            self.playback_mode = "loop"
        if self.animated_frames is None or len(self.animated_frames) == 0:
            raise ValueError("Dynamic scenes require animated_frames")

        frame_universe_sets = {
            tuple(sorted(frame.universes.keys())) for frame in self.animated_frames
        }
        if len(frame_universe_sets) > 1:
            raise ValueError("All dynamic frames must use the same universe layout")
        if not self.universes and self.animated_frames:
            self.universes = dict(self.animated_frames[0].universes)
        if set(self.universes.keys()) != set(self.animated_frames[0].universes.keys()):
            raise ValueError("Dynamic scene universes must match dynamic frame universes")
        return self


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


def _clone_universes(universes: Dict[int, List[int]]) -> Dict[int, List[int]]:
    return {int(universe): list(values) for universe, values in universes.items()}


def _compress_animated_frames(frames: List[dict]) -> dict:
    if not frames:
        raise ValueError("animated_frames cannot be empty")

    first_universes = _clone_universes(frames[0]["universes"])
    universe_ids = sorted(first_universes.keys())
    previous = _clone_universes(first_universes)
    packed_frames: List[dict] = []

    for frame in frames:
        timestamp_ms = int(frame["timestamp_ms"])
        current = _clone_universes(frame["universes"])
        changes: dict[str, list[list[int]]] = {}

        for universe in universe_ids:
            prev_values = previous[universe]
            curr_values = current[universe]
            diff_pairs: list[list[int]] = []
            for index, value in enumerate(curr_values):
                if value != prev_values[index]:
                    diff_pairs.append([index, value])
            if diff_pairs:
                changes[str(universe)] = diff_pairs

        packed: dict[str, Any] = {"timestamp_ms": timestamp_ms}
        if changes:
            packed["changes"] = changes
        packed_frames.append(packed)
        previous = current

    return {
        "encoding": ANIMATED_ENCODING_DELTA_V1,
        "initial": {str(universe): values for universe, values in first_universes.items()},
        "frames": packed_frames,
    }


def _decompress_animated_frames(payload: dict) -> List[dict]:
    if payload.get("encoding") != ANIMATED_ENCODING_DELTA_V1:
        raise ValueError("Unsupported animated frame encoding")

    initial_raw = payload.get("initial")
    frames_raw = payload.get("frames")
    if not isinstance(initial_raw, dict) or not isinstance(frames_raw, list):
        raise ValueError("Invalid compact animated frame payload")

    current: Dict[int, List[int]] = {}
    for universe_key, values in initial_raw.items():
        universe = int(universe_key)
        if isinstance(universe, bool):
            raise ValueError("Invalid universe key in compact payload")
        if not isinstance(values, list):
            raise ValueError("Invalid universe values in compact payload")
        current[universe] = [int(value) for value in values]
    _validate_universes(current)

    expanded: List[dict] = []
    for frame in frames_raw:
        if not isinstance(frame, dict):
            raise ValueError("Invalid compact frame entry")
        timestamp_ms = int(frame.get("timestamp_ms", 0))
        changes = frame.get("changes")
        if changes is not None:
            if not isinstance(changes, dict):
                raise ValueError("Invalid compact frame changes")
            for universe_key, pairs in changes.items():
                universe = int(universe_key)
                if universe not in current:
                    raise ValueError("Compact frame references unknown universe")
                if not isinstance(pairs, list):
                    raise ValueError("Invalid compact channel changes")
                universe_values = current[universe]
                for pair in pairs:
                    if (
                        not isinstance(pair, list)
                        or len(pair) != 2
                        or isinstance(pair[0], bool)
                        or isinstance(pair[1], bool)
                    ):
                        raise ValueError("Invalid compact channel/value pair")
                    channel_index = int(pair[0])
                    value = int(pair[1])
                    if channel_index < 0 or channel_index >= DMX_CHANNELS:
                        raise ValueError("Compact channel index out of range")
                    if value < DMX_MIN or value > DMX_MAX:
                        raise ValueError("Compact channel value out of range")
                    universe_values[channel_index] = value
        expanded.append(
            {
                "timestamp_ms": timestamp_ms,
                "universes": _clone_universes(current),
            }
        )
    return expanded


def _inflate_scene_payload(raw: dict) -> dict:
    data = dict(raw)
    scene_type = data.get("type")
    if isinstance(scene_type, str) and scene_type.strip().lower() == "animated":
        data["type"] = "dynamic"
        scene_type = "dynamic"
    if scene_type != "dynamic":
        return data

    compact = data.get("animated_frames_compact")
    frames = data.get("animated_frames")
    if frames is None and isinstance(compact, dict):
        data["animated_frames"] = _decompress_animated_frames(compact)
    return data


def _deflate_scene_payload(scene: Scene) -> dict:
    payload = scene.model_dump()
    if scene.type != "dynamic" or not scene.animated_frames:
        return payload

    payload["animated_frames_compact"] = _compress_animated_frames(
        [frame.model_dump() for frame in scene.animated_frames]
    )
    payload.pop("animated_frames", None)
    return payload


def list_scenes() -> List[Scene]:
    scenes_dir = _ensure_scenes_dir()
    scenes_by_id: Dict[str, Scene] = {}

    for path in sorted(scenes_dir.glob("*.json")):
        if path.name == ORDER_FILE:
            continue
        try:
            with path.open("r", encoding="utf-8") as f:
                data = _inflate_scene_payload(json.load(f))
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
            data = _inflate_scene_payload(json.load(f))
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
        json.dump(_deflate_scene_payload(scene), f, separators=(",", ":"))

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
