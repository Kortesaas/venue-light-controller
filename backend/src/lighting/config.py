from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # IP des PCs im Lichtnetz
    local_ip: str = "2.0.0.30"
    # IP deines Art-Net-Nodes
    node_ip: str = "2.0.0.10"

    dmx_fps: float = 30.0
    poll_interval: float = 5.0
    universe_count: int = 1

    # Ordner für Szenen (kannst du später nutzen)
    scenes_path: str = "./scenes"

    # Pydantic v2: Konfiguration über model_config statt innerer Config-Klasse
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
    )


settings = Settings()
