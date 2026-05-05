import json
import hashlib
import logging
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from .networking import resolve_adapter

_log = logging.getLogger(__name__)


def hash_pin(pin: str) -> str:
    return hashlib.sha256(pin.encode("utf-8")).hexdigest()


def normalize_universe_map(raw: object) -> list[int]:
    defaults = [0, 1, 2, 3, 4, 5, 6, 7]
    if not isinstance(raw, list):
        return defaults

    normalized: list[int] = []
    for index in range(8):
        fallback = defaults[index]
        if index >= len(raw):
            normalized.append(fallback)
            continue
        value = raw[index]
        if isinstance(value, bool):
            normalized.append(fallback)
            continue
        if isinstance(value, int) and value >= 0:
            normalized.append(value)
            continue
        if isinstance(value, float) and value.is_integer() and value >= 0:
            normalized.append(int(value))
            continue
        normalized.append(fallback)
    return normalized


class Settings(BaseSettings):
    # IP des PCs im Lichtnetz
    local_ip: str = "2.0.0.30"
    local_adapter: str = ""
    web_local_ip: str = "2.0.0.30"
    web_local_adapter: str = ""
    # IP deines Art-Net-Nodes
    node_ip: str = "2.0.0.10"

    dmx_fps: float = 30.0
    poll_interval: float = 5.0
    universe_count: int = 1
    artnet_universe_map: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4, 5, 6, 7])
    lock_on_startup: bool = True
    operator_pin_hash: str = hash_pin("0815")
    runtime_settings_path: str = "./settings.runtime.json"
    fixture_plan_path: str = "./fixture_plan.active.json"
    fog_flash_universe: int = 1
    fog_flash_channel: int = 0
    blinder_flash_targets: list[str] = Field(default_factory=list)
    haze_universe: int = 1
    haze_channel: int = 0
    show_scene_created_at_on_operator: bool = True
    streamdeck_screensaver_seconds: int = 300

    # Ordner für Szenen (kannst du später nutzen)
    scenes_path: str = "./scenes"

    # Pydantic v2: Konfiguration über model_config statt innerer Config-Klasse
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
    )

settings = Settings()


def load_runtime_settings() -> None:
    path = Path(settings.runtime_settings_path)
    if not path.exists():
        _sync_local_ips_from_adapters()
        return

    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        _log.warning("Failed to load runtime settings from %s: %s", path, exc)
        _sync_local_ips_from_adapters()
        return

    if not isinstance(data, dict):
        _log.warning("Runtime settings file %s is not an object, ignoring", path)
        _sync_local_ips_from_adapters()
        return

    for key in (
        "local_adapter",
        "web_local_adapter",
        "node_ip",
        "dmx_fps",
        "poll_interval",
        "universe_count",
        "artnet_universe_map",
        "lock_on_startup",
        "operator_pin_hash",
        "fog_flash_universe",
        "fog_flash_channel",
        "blinder_flash_targets",
        "haze_universe",
        "haze_channel",
        "show_scene_created_at_on_operator",
        "streamdeck_screensaver_seconds",
    ):
        if key in data:
            setattr(settings, key, data[key])

    settings.artnet_universe_map = normalize_universe_map(settings.artnet_universe_map)
    if not isinstance(settings.blinder_flash_targets, list):
        settings.blinder_flash_targets = []
    else:
        settings.blinder_flash_targets = [str(entry).strip() for entry in settings.blinder_flash_targets if str(entry).strip()]
    try:
        settings.streamdeck_screensaver_seconds = max(0, int(settings.streamdeck_screensaver_seconds))
    except (TypeError, ValueError):
        settings.streamdeck_screensaver_seconds = 300
    _sync_local_ips_from_adapters()


def persist_runtime_settings() -> None:
    path = Path(settings.runtime_settings_path)
    payload = {
        "local_adapter": settings.local_adapter,
        "web_local_adapter": settings.web_local_adapter,
        "node_ip": settings.node_ip,
        "dmx_fps": settings.dmx_fps,
        "poll_interval": settings.poll_interval,
        "universe_count": settings.universe_count,
        "artnet_universe_map": normalize_universe_map(settings.artnet_universe_map),
        "lock_on_startup": settings.lock_on_startup,
        "operator_pin_hash": settings.operator_pin_hash,
        "fog_flash_universe": settings.fog_flash_universe,
        "fog_flash_channel": settings.fog_flash_channel,
        "blinder_flash_targets": settings.blinder_flash_targets,
        "haze_universe": settings.haze_universe,
        "haze_channel": settings.haze_channel,
        "show_scene_created_at_on_operator": settings.show_scene_created_at_on_operator,
        "streamdeck_screensaver_seconds": settings.streamdeck_screensaver_seconds,
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
    except OSError as exc:
        _log.warning("Failed to persist runtime settings to %s: %s", path, exc)


def _sync_local_ips_from_adapters() -> None:
    selected_adapter, _adapters = resolve_adapter(settings.local_adapter or None)
    if selected_adapter is None and settings.local_adapter:
        selected_adapter, _adapters = resolve_adapter(None)
    if selected_adapter is not None:
        settings.local_adapter = selected_adapter["id"]
        settings.local_ip = selected_adapter["local_ip"]

    selected_web_adapter, _web_adapters = resolve_adapter(settings.web_local_adapter or None)
    if selected_web_adapter is None and settings.web_local_adapter:
        selected_web_adapter, _web_adapters = resolve_adapter(settings.local_adapter or None)
    if selected_web_adapter is None:
        selected_web_adapter = selected_adapter
    if selected_web_adapter is not None:
        settings.web_local_adapter = selected_web_adapter["id"]
        settings.web_local_ip = selected_web_adapter["local_ip"]


load_runtime_settings()
