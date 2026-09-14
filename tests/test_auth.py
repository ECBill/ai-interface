from fastapi.testclient import TestClient

from app.main import app


def test_register_login_me_logout() -> None:
    client = TestClient(app)
    credentials = {"email": "first@example.com", "password": "valid-password1", "rememberMe": True}

    register = client.post("/api/v3/auth/register", json=credentials)
    assert register.status_code == 201
    assert register.json()["email"] == credentials["email"]
    assert "ai_session" in client.cookies

    save_provider = client.put(
        "/api/v3/providers/openai/credentials",
        json={"apiKey": "sk-test-secret-value", "baseUrl": "https://api.openai.com/v1"},
    )
    assert save_provider.status_code == 200
    assert save_provider.json()["configured"] is True
    assert "sk-test-secret-value" not in save_provider.text

    providers = client.get("/api/v3/providers")
    assert providers.status_code == 200
    assert providers.json()["items"][1]["id"] == "openai"

    me = client.get("/api/v3/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == credentials["email"]
    assert "expiresAt" in me.json()

    logout = client.post("/api/v3/auth/logout")
    assert logout.status_code == 204

    after_logout = client.get("/api/v3/auth/me")
    assert after_logout.status_code == 401


def test_preferences_auto_create() -> None:
    """Test that preferences are auto-created on first GET."""
    client = TestClient(app)
    client.post("/api/v3/auth/register", json={"email": "pref@example.com", "password": "valid-password1"})

    prefs = client.get("/api/v3/preferences")
    assert prefs.status_code == 200
    assert prefs.json()["streamByDefault"] is True

    # Test partial update
    update = client.put("/api/v3/preferences", json={"showThinking": "expanded"})
    assert update.status_code == 200
    assert update.json()["showThinking"] == "expanded"
    # Other fields should be preserved
    assert update.json()["streamByDefault"] is True


def test_conversation_crud() -> None:
    """Test basic conversation CRUD operations."""
    client = TestClient(app)
    client.post("/api/v3/auth/register", json={"email": "conv@example.com", "password": "valid-password1"})

    # Create conversation
    create = client.post("/api/v3/conversations", json={"title": "Test Chat"})
    assert create.status_code == 201
    conv_id = create.json()["id"]
    assert create.json()["title"] == "Test Chat"

    # Get conversation
    detail = client.get(f"/api/v3/conversations/{conv_id}")
    assert detail.status_code == 200
    assert detail.json()["id"] == conv_id

    # List conversations
    listing = client.get("/api/v3/conversations")
    assert listing.status_code == 200
    assert len(listing.json()["items"]) >= 1

    # Update conversation
    patch = client.patch(f"/api/v3/conversations/{conv_id}", json={"title": "Renamed"})
    assert patch.status_code == 200
    assert patch.json()["title"] == "Renamed"

    # Delete conversation
    delete = client.delete(f"/api/v3/conversations/{conv_id}")
    assert delete.status_code == 204

    # Verify deleted
    listing2 = client.get("/api/v3/conversations")
    assert len(listing2.json()["items"]) == 0


def test_conversation_not_found() -> None:
    """Test 404 for non-existent conversation."""
    client = TestClient(app)
    client.post("/api/v3/auth/register", json={"email": "nf@example.com", "password": "valid-password1"})

    resp = client.get("/api/v3/conversations/nonexistent-id-1234567890123456")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "CONVERSATION_NOT_FOUND"
