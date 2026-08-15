from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Red de Apoyo API"
    environment: str = "production"
    database_url: str = "sqlite:///./red_apoyo.db"
    # Solo protege operaciones destructivas (cerrar un centro, retirar un reporte).
    # Crear y publicar siguen siendo anónimos a propósito.
    coordinator_code: str = ""
    cors_origins: str = "https://red-apoyo-colombia.pagosautomaticosgopa.chatgpt.site"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip().rstrip("/") for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
