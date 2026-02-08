from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    local_ip: str = "2.0.0.30"
    node_ip: str = "2.0.0.10"

    dmx_fps: float = 30.0
    poll_interval: float = 5.0

    scenes_path: str = "./scenes"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
    )


settings = Settings()
