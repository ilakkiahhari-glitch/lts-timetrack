from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://postgres:dev@localhost:5432/lts_timetrack"
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 7
    school_tz: str = "UTC"
    allowed_origins: list[str] = ["http://localhost:3000"]
    rate_limit_per_minute: int = 30  # /kiosk/scan (per device or IP) and /auth/login (per IP)
    qr_image_ttl_seconds: int = 600  # how long a freshly issued QR image stays downloadable

    # Used only by scripts/seed.py
    admin_email: str = "admin@example.com"
    admin_password: str = "ChangeMe123!"
    admin_name: str = "First Admin"

    @property
    def sync_database_url(self) -> str:
        """Alembic runs migrations with the sync psycopg driver."""
        return self.database_url.replace("+asyncpg", "+psycopg")


settings = Settings()
