from fastapi.testclient import TestClient

from app.main import app


def test_register_login_me_logout() -> None:
    client = TestClient(app)
    credentials = {"email": "first@example.com", "password": "valid-password1"}

    register = client.post("/api/v1/auth/register", json=credentials)
    assert register.status_code == 201
    assert register.json()["email"] == credentials["email"]
    assert "ai_session" in client.cookies

    save_provider = client.put(
        "/api/v1/providers/openai/credentials",
        json={"apiKey": "sk-test-secret-value", "baseUrl": "https://api.openai.com/v1"},
    )
    assert save_provider.status_code == 200
    assert save_provider.json()["configured"] is True
    assert "sk-test-secret-value" not in save_provider.text

    providers = client.get("/api/v1/providers")
    assert providers.status_code == 200
    assert providers.json()["items"][1]["id"] == "openai"

    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == credentials["email"]

    logout = client.post("/api/v1/auth/logout")
    assert logout.status_code == 204

    after_logout = client.get("/api/v1/auth/me")
    assert after_logout.status_code == 401
