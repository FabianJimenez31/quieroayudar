import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


database_path = Path("/tmp/puedoayudar-test.db")
os.environ["DATABASE_URL"] = f"sqlite:///{database_path}"
os.environ["COORDINATOR_CODE"] = "test-code-123456"
os.environ["CORS_ORIGINS"] = "http://testserver"
os.environ["ENVIRONMENT"] = "test"

from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as test_client:
        yield test_client
