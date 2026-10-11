from concurrent.futures import ThreadPoolExecutor

from tests.conftest import uid

API = "/api/v1"


def scan(client, kiosk, token):
    return client.post(f"{API}/kiosk/scan", json={"qr_token": token}, headers=kiosk)


def test_create_person_and_qr(client, admin, make_person):
    p = make_person(first_name="Anna", last_name="Rivera", email="anna@school.org", group_name="Math",
                    attributes={"room": "B12"})
    assert p["person_type"] == "TEACHER" and p["qr_token"].startswith("tt_")
    assert p["qr_image"].startswith("data:image/png;base64,")
    assert "qr_token_hash" not in p

    png = client.get(f"{API}/people/{p['id']}/qr", headers=admin)
    assert png.status_code == 200 and png.headers["content-type"] == "image/png"
    assert png.content.startswith(b"\x89PNG")

    dup = {"person_type": "teacher", "external_code": p["external_code"], "first_name": "a", "last_name": "b"}
    assert client.post(f"{API}/people", json=dup, headers=admin).status_code == 409
    bad = {"person_type": "ALIEN", "external_code": uid(), "first_name": "a", "last_name": "b"}
    assert client.post(f"{API}/people", json=bad, headers=admin).status_code == 422


def test_people_list_filters_and_update(client, admin, make_person):
    p = make_person(last_name=uid("Zq"), group_name="Grp-" + uid())
    found = client.get(f"{API}/people", params={"q": p["last_name"], "type": "teacher"}, headers=admin).json()
    assert [x["id"] for x in found] == [p["id"]]
    assert client.get(f"{API}/people", params={"group": p["group_name"]}, headers=admin).json()[0]["id"] == p["id"]

    upd = client.patch(f"{API}/people/{p['id']}", json={"group_name": None, "is_active": False}, headers=admin)
    assert upd.json()["group_name"] is None and upd.json()["is_active"] is False
    assert client.get(f"{API}/people", params={"q": p["last_name"], "active": True}, headers=admin).json() == []
    assert client.get(f"{API}/people/{p['id']}", headers=admin).status_code == 200


def test_qr_rotation_revokes_old_token(client, admin, kiosk, make_person):
    p = make_person()
    rotated = client.post(f"{API}/people/{p['id']}/qr/rotate", headers=admin).json()
    assert rotated["qr_version"] == 2 and rotated["qr_token"] != p["qr_token"]
    assert scan(client, kiosk, p["qr_token"]).status_code == 422
    assert scan(client, kiosk, rotated["qr_token"]).json()["result"] == "ENTRY"


def test_qr_image_unavailable_when_not_fresh(client, admin, make_person):
    from app.services import qr_service

    p = make_person()
    qr_service._fresh_tokens.clear()  # simulates expiry / another worker
    r = client.get(f"{API}/people/{p['id']}/qr", headers=admin)
    assert r.status_code == 404
    assert client.get(f"{API}/people/00000000-0000-0000-0000-000000000000/qr", headers=admin).status_code == 404


def test_inactive_person_cannot_scan(client, admin, kiosk, make_person):
    p = make_person()
    client.patch(f"{API}/people/{p['id']}", json={"is_active": False}, headers=admin)
    assert scan(client, kiosk, p["qr_token"]).status_code == 422


def test_scan_entry_duplicate_exit(client, kiosk, make_person, instant_type):
    # default 30 s window: second scan is a DUPLICATE, nothing written
    p = make_person(first_name="Anna", last_name="Rivera")
    first = scan(client, kiosk, p["qr_token"])
    assert first.status_code == 200
    body = first.json()
    assert body["result"] == "ENTRY" and body["person"] == "A. Rivera" and body["time"]
    assert scan(client, kiosk, p["qr_token"]).json()["result"] == "DUPLICATE"

    on_site = client.get(f"{API}/kiosk/status", headers=kiosk).json()
    assert any(e["person"] == "A. Rivera" and e["person_type"] == "TEACHER" for e in on_site)

    # 0 s window type: scans alternate ENTRY / EXIT / ENTRY
    q = make_person(person_type=instant_type)
    results = [scan(client, kiosk, q["qr_token"]).json() for _ in range(3)]
    assert [r["result"] for r in results] == ["ENTRY", "EXIT", "ENTRY"]
    assert results[1]["duration_seconds"] is not None and results[1]["duration_seconds"] >= 0


def test_invalid_qr_writes_nothing(client, kiosk, pg):
    before = pg.execute("SELECT count(*) FROM attendance_events").fetchone()[0]
    assert scan(client, kiosk, "tt_does_not_exist").status_code == 422
    assert pg.execute("SELECT count(*) FROM attendance_events").fetchone()[0] == before


def test_deactivated_device_is_rejected(client, admin, volunteer, make_person):
    dev = client.post(f"{API}/devices", json={"name": uid("kiosk-"), "location": "Gate"}, headers=admin).json()
    headers = {**volunteer, "X-Device-Key": dev["api_key"]}
    p = make_person()
    assert scan(client, headers, p["qr_token"]).status_code == 200
    client.patch(f"{API}/devices/{dev['id']}", json={"is_active": False}, headers=admin)
    assert scan(client, headers, p["qr_token"]).status_code == 401

    rotated = client.patch(f"{API}/devices/{dev['id']}", json={"is_active": True, "rotate_key": True}, headers=admin)
    assert rotated.json()["api_key"] != dev["api_key"]
    assert scan(client, headers, p["qr_token"]).status_code == 401  # old key dead
    assert client.post(f"{API}/devices", json={"name": dev["name"]}, headers=admin).status_code == 409


def test_concurrent_scans_create_one_session(client, kiosk, make_person, pg):
    p = make_person()
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda _: scan(client, kiosk, p["qr_token"]).json()["result"], range(6)))
    assert results.count("ENTRY") == 1 and results.count("DUPLICATE") == 5
    sessions = pg.execute(
        "SELECT count(*) FROM attendance_sessions WHERE person_id = %s", (p["id"],)).fetchone()[0]
    assert sessions == 1
