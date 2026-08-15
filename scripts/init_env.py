import os
from pathlib import Path
import secrets


root = Path("/opt/puedoayudar.co")
target = root / ".env"
if target.exists():
    raise SystemExit(".env already exists; leaving it unchanged")

coordinator_code = os.environ.get("COORDINATOR_CODE", "").strip()
if len(coordinator_code) < 8:
    raise SystemExit("COORDINATOR_CODE must contain at least 8 characters")

public_origin = os.environ.get(
    "PUBLIC_ORIGIN",
    "https://red-apoyo-colombia.pagosautomaticosgopa.chatgpt.site",
).strip().rstrip("/")

content = "\n".join(
    [
        "MYSQL_DATABASE=puedoayudar",
        "MYSQL_USER=puedoayudar",
        f"MYSQL_PASSWORD={secrets.token_hex(32)}",
        f"MYSQL_ROOT_PASSWORD={secrets.token_hex(32)}",
        f"COORDINATOR_CODE={coordinator_code}",
        f"CORS_ORIGINS={public_origin}",
        "",
    ]
)
target.write_text(content, encoding="utf-8")
target.chmod(0o600)
print("Environment created securely")
