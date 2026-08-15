COORDINATOR_HEADERS = {"x-coordinator-code": "test-code-123456"}


def create_center(client):
    response = client.post(
        "/v1/centers",
        headers=COORDINATOR_HEADERS,
        json={
            "name": "Centro Principal",
            "city": "Bogotá",
            "address": "Carrera 1 # 2-3",
            "latitude": 4.61,
            "longitude": -74.08,
            "contact": "3001234567",
            "hours": "24 horas",
        },
    )
    assert response.status_code == 201
    return response.json()["center"]


def test_health_and_empty_network(client):
    assert client.get("/health").json()["database"] == "mysql"
    assert client.get("/v1/network").json() == {
        "centers": [],
        "needs": [],
        "volunteerRequests": [],
        "reports": [],
    }


def test_coordination_is_open(client):
    """Coordination is intentionally unauthenticated: it is a request desk, not an admin."""
    assert client.get("/v1/coordination").status_code == 200


def test_needs_batch_creates_updates_and_blocks(client):
    center = create_center(client)

    first = client.post(
        "/v1/coordination",
        json={
            "action": "needs-batch",
            "centerId": center["id"],
            "products": [
                {"name": "Agua embotellada", "unit": "garrafones", "status": "urgent", "target": 400},
                {"name": "Pañales", "unit": "paquetes", "status": "normal", "target": 120},
                {"name": "Ropa usada", "unit": "bolsas", "status": "blocked", "target": 1},
            ],
        },
    )
    assert first.status_code == 201
    # The blocked line is skipped because that need was never published.
    assert first.json() == {"ok": True, "created": 2, "updated": 0}

    network = client.get("/v1/network").json()
    assert [need["name"] for need in network["needs"]] == ["Agua embotellada", "Pañales"]
    assert network["needs"][0]["priority"] == "critical"

    second = client.post(
        "/v1/coordination",
        json={
            "action": "needs-batch",
            "centerId": center["id"],
            "products": [
                {"name": "Agua embotellada", "unit": "garrafones", "status": "blocked", "target": 400},
            ],
        },
    )
    assert second.json() == {"ok": True, "created": 0, "updated": 1}

    # Blocked needs disappear for donors.
    assert [need["name"] for need in client.get("/v1/network").json()["needs"] if need["status"] != "blocked"] == ["Pañales"]


def test_needs_batch_keeps_goal_above_promised(client):
    center = create_center(client)
    client.post(
        "/v1/coordination",
        json={
            "action": "needs-batch",
            "centerId": center["id"],
            "products": [{"name": "Agua", "unit": "botellas", "status": "urgent", "target": 100}],
        },
    )
    need_id = client.get("/v1/network").json()["needs"][0]["id"]
    assert client.post("/v1/network", json={"action": "pledge", "needId": need_id, "quantity": 40}).status_code == 201

    client.post(
        "/v1/coordination",
        json={
            "action": "needs-batch",
            "centerId": center["id"],
            "products": [{"name": "Agua", "unit": "botellas", "status": "urgent", "target": 10}],
        },
    )
    need = client.get("/v1/network").json()["needs"][0]
    assert need["target"] == 40
    assert need["committed"] == 40


def test_saturated_center_can_come_back(client):
    """Marcar saturado no puede ser un camino sin retorno: el terreno debe poder revertirlo."""
    center = create_center(client)
    assert client.patch("/v1/centers", json={"id": center["id"], "status": "saturated"}).status_code == 200
    assert client.get("/v1/network").json()["centers"][0]["status"] == "saturated"

    # Sin clave, porque revertir no es destructivo.
    back = client.patch("/v1/centers", json={"id": center["id"], "status": "active"})
    assert back.status_code == 200
    assert back.json()["center"]["status"] == "active"


def test_closing_a_center_requires_the_coordinator_code(client):
    center = create_center(client)

    denied = client.patch("/v1/centers", json={"id": center["id"], "status": "closed"})
    assert denied.status_code == 401
    assert client.get("/v1/network").json()["centers"][0]["status"] == "active"

    allowed = client.patch(
        "/v1/centers",
        headers=COORDINATOR_HEADERS,
        json={"id": center["id"], "status": "closed"},
    )
    assert allowed.status_code == 200
    assert client.get("/v1/network").json()["centers"] == []

    # Y reabrirlo también, para que nadie resucite un centro cerrado desde la app.
    assert client.patch("/v1/centers", json={"id": center["id"], "status": "saturated"}).status_code == 401


def test_reopening_a_filled_volunteer_request_makes_it_visible_again(client):
    center = create_center(client)
    client.post(
        "/v1/coordination",
        json={"action": "volunteer-request", "centerId": center["id"], "kind": "Cocina y reparto", "quantity": 2},
    )
    request_id = client.get("/v1/network").json()["volunteerRequests"][0]["id"]

    for _ in range(2):
        client.post("/v1/network", json={"action": "volunteer", "requestId": request_id, "quantity": 1})
    filled = client.get("/v1/network").json()["volunteerRequests"][0]
    assert filled["status"] == "filled"
    assert filled["accepted"] == 2

    client.patch("/v1/coordination", json={"action": "volunteer-request", "id": request_id, "status": "open"})
    reopened = client.get("/v1/network").json()["volunteerRequests"][0]
    assert reopened["status"] == "open"
    # Sin resetear accepted la solicitud queda abierta pero invisible para los voluntarios.
    assert reopened["accepted"] == 0
    assert client.post(
        "/v1/network", json={"action": "volunteer", "requestId": request_id, "quantity": 1}
    ).status_code == 201


def test_rejected_reports_are_not_served_in_the_open(client):
    client.post(
        "/v1/network",
        json={
            "action": "report",
            "category": "saturation",
            "city": "Bogotá",
            "location": "Barrio Centro",
            "details": "Punto saturado: demasiadas personas en el sitio.",
        },
    )
    report_id = client.get("/v1/coordination").json()["reports"][0]["id"]

    assert client.patch(
        "/v1/coordination", json={"action": "report", "id": report_id, "status": "rejected"}
    ).status_code == 401

    assert client.patch(
        "/v1/coordination",
        headers=COORDINATOR_HEADERS,
        json={"action": "report", "id": report_id, "status": "rejected"},
    ).status_code == 200

    assert client.get("/v1/coordination").json()["reports"] == []
    assert len(client.get("/v1/coordination", headers=COORDINATOR_HEADERS).json()["reports"]) == 1
    assert client.get("/v1/network").json()["reports"] == []


def test_center_volunteer_saturation_toggle(client):
    center = create_center(client)
    assert center["volunteersSaturated"] is False

    updated = client.patch("/v1/centers", json={"id": center["id"], "volunteersSaturated": True})
    assert updated.status_code == 200
    assert updated.json()["center"]["volunteersSaturated"] is True
    # Toggling volunteers must not close the centre for donations.
    assert updated.json()["center"]["status"] == "active"

    assert client.patch("/v1/centers", json={"id": center["id"]}).status_code == 400


def test_full_operational_flow(client):
    center = create_center(client)

    need_response = client.post(
        "/v1/coordination",
        headers=COORDINATOR_HEADERS,
        json={
            "action": "need",
            "centerId": center["id"],
            "name": "Agua potable",
            "detail": "Botellas selladas",
            "priority": "critical",
            "target": 100,
            "covered": 10,
            "unit": "botellas",
        },
    )
    assert need_response.status_code == 201

    volunteer_response = client.post(
        "/v1/coordination",
        headers=COORDINATOR_HEADERS,
        json={
            "action": "volunteer-request",
            "centerId": center["id"],
            "kind": "Clasificación y carga",
            "detail": "Turno de dos horas",
            "quantity": 3,
        },
    )
    assert volunteer_response.status_code == 201

    network = client.get("/v1/network").json()
    assert len(network["centers"]) == 1
    assert len(network["needs"]) == 1
    assert len(network["volunteerRequests"]) == 1

    pledge = client.post(
        "/v1/network",
        json={"action": "pledge", "needId": network["needs"][0]["id"], "quantity": 5},
    )
    assert pledge.status_code == 201
    assert len(pledge.json()["reference"]) == 8

    volunteer = client.post(
        "/v1/network",
        json={"action": "volunteer", "requestId": network["volunteerRequests"][0]["id"], "quantity": 1},
    )
    assert volunteer.status_code == 201
    assert volunteer.json()["accepted"] == 1

    report = client.post(
        "/v1/network",
        json={
            "action": "report",
            "category": "products",
            "city": "Bogotá",
            "location": "Barrio Centro",
            "details": "Se necesita agua potable con urgencia.",
        },
    )
    assert report.status_code == 201
    assert report.json()["published"] is True

    public_network = client.get("/v1/network").json()
    assert public_network["reports"][0]["status"] == "verified"

    coordination = client.get("/v1/coordination", headers=COORDINATOR_HEADERS).json()
    assert coordination["needs"][0]["committed"] == 5
    assert coordination["reports"][0]["status"] == "verified"


def publish_need(client, center, target=100, unit="botellas"):
    client.post(
        "/v1/coordination",
        json={
            "action": "needs-batch",
            "centerId": center["id"],
            "products": [{"name": "Agua", "unit": unit, "status": "urgent", "target": target}],
        },
    )
    return client.get("/v1/network").json()["needs"][0]


def test_receiving_a_delivery_moves_promised_into_delivered(client):
    """Sin esto el circuito no cierra: se promete, vence, y nada consta como entregado."""
    center = create_center(client)
    need = publish_need(client, center)
    assert client.post(
        "/v1/network", json={"action": "pledge", "needId": need["id"], "quantity": 40}
    ).status_code == 201

    response = client.post(
        "/v1/coordination",
        json={"action": "needs-received", "centerId": center["id"], "received": [{"name": "Agua", "quantity": 40}]},
    )
    assert response.status_code == 201

    updated = client.get("/v1/network").json()["needs"][0]
    assert updated["covered"] == 40
    # La promesa se consumió: si siguiera contando, la misma caja valdría por dos.
    assert updated["committed"] == 0


def test_a_delivered_promise_is_not_released_again_when_it_expires(client):
    """`committed` debe ser siempre la suma de las promesas vivas.

    Restar el contador sin consumir la promesa dejaba la fila en pie: al vencer volvía a
    descontar y liberaba un cupo que ya se había entregado, dejando pedir de más.
    """
    from datetime import timedelta

    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import Pledge, utcnow

    center = create_center(client)
    need = publish_need(client, center)
    client.post("/v1/network", json={"action": "pledge", "needId": need["id"], "quantity": 40})
    client.post("/v1/network", json={"action": "pledge", "needId": need["id"], "quantity": 30})

    client.post(
        "/v1/coordination",
        json={"action": "needs-received", "centerId": center["id"], "received": [{"name": "Agua", "quantity": 40}]},
    )

    after = client.get("/v1/network").json()["needs"][0]
    assert after["covered"] == 40
    assert after["committed"] == 30
    with SessionLocal() as db:
        outstanding = sum(row.quantity for row in db.scalars(select(Pledge)))
    assert outstanding == after["committed"]

    with SessionLocal() as db:
        for pledge in db.scalars(select(Pledge)):
            pledge.expires_at = utcnow() - timedelta(hours=1)
        db.commit()

    released = client.get("/v1/network").json()["needs"][0]
    assert released["committed"] == 0
    assert released["covered"] == 40


def test_a_need_stops_asking_once_it_is_covered(client):
    center = create_center(client)
    publish_need(client, center, target=10)
    client.post(
        "/v1/coordination",
        json={"action": "needs-received", "centerId": center["id"], "received": [{"name": "Agua", "quantity": 10}]},
    )
    need = client.get("/v1/network").json()["needs"][0]
    assert need["status"] == "blocked"
    assert need["covered"] == 10


def test_receiving_something_never_published_is_rejected(client):
    center = create_center(client)
    response = client.post(
        "/v1/coordination",
        json={"action": "needs-received", "centerId": center["id"], "received": [{"name": "Fantasma", "quantity": 5}]},
    )
    assert response.status_code == 400
