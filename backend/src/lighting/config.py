import json
import logging
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_log = logging.getLogger(__name__)


class Settings(BaseSettings):
    # IP des PCs im Lichtnetz
    local_ip: str = "2.0.0.30"
    # IP deines Art-Net-Nodes
    node_ip: str = "2.0.0.10"

    dmx_fps: float = 30.0
    poll_interval: float = 5.0
    universe_count: int = 1
    runtime_settings_path: str = "./settings.runtime.json"

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
        return

    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        _log.warning("Failed to load runtime settings from %s: %s", path, exc)
        return

    if not isinstance(data, dict):
        _log.warning("Runtime settings file %s is not an object, ignoring", path)
        return

    for key in ("node_ip", "dmx_fps", "poll_interval", "universe_count"):
        if key in data:
            setattr(settings, key, data[key])


def persist_runtime_settings() -> None:
    path = Path(settings.runtime_settings_path)
    payload = {
        "node_ip": settings.node_ip,
        "dmx_fps": settings.dmx_fps,
        "poll_interval": settings.poll_interval,
        "universe_count": settings.universe_count,
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
    except OSError as exc:
        _log.warning("Failed to persist runtime settings to %s: %s", path, exc)


load_runtime_settings()
