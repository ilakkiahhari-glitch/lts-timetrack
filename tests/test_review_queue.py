"""Sessions that need an admin's attention: left open past the cutoff, or voided as a missed exit (OI-1).
They must not count as "on site", and must show up in the review queue until an admin has corrected them."""

from datetime import datetime, time, timezone

from app.services.session_flags import review_state

API = "/api/v1"
FIX = {"entry_time": "2026-03-02T08:00:00Z", "exit_time": "2026-03-02T16:00:00Z", "reason": "Forgot to scan out"}


def scan(client, kiosk, person):
    return client.post(f"{API}/kiosk/scan", json={"qr_token": person["qr_token"]}, headers=kiosk).json()["result"]


def sessions(client, admin, person, **params):
    return client.get(f"{API}/attendance/sessions", params={"person_id": person["id"], **params}, headers=admin).json()


def on_site_names(client, kiosk):
    return {e["person"] for e in client.get(f"{API}/kiosk/status", headers=kiosk).json()}


def make_stale(client, admin, kiosk, pg, person):
    """The person scans in, then the session is moved back to yesterday: they forgot to scan out."""
    assert scan(client, kiosk, person) == "ENTRY"
    session = sessions(client, admin, person)[0]
    pg.execute("UPDATE attendance_sessions SET work_date = current_date - 1, "
               "entry_time = entry_time - interval '1 day' WHERE id = %s", (session["id"],))
    return session


def test_review_state_rules():
    entry = datetime(2026, 3, 2, 9, 0, tzinfo=timezone.utc)  # SCHOOL_TZ defaults to UTC
    day = entry.date()
    before_cutoff, after_cutoff = datetime(2026, 3, 2, 16, 59, tzinfo=timezone.utc), datetime(2026, 3, 2, 17, 0, tzinfo=timezone.utc)
    assert review_state("OPEN", None, entry, day, time(17, 0), before_cutoff) is None
    assert review_state("OPEN", None, entry, day, time(17, 0), after_cutoff) == "LEFT_OPEN"
    assert review_state("CLOSED", None, entry, day, time(17, 0), after_cutoff) is None
    assert review_state("VOIDED", "[MISSED EXIT] no exit", entry, day, None, after_cutoff) == "MISSED_EXIT"
    assert review_state("VOIDED", "[MISSED EXIT] no exit [CORRECTED]", entry, day, None, after_cutoff) is None
    assert review_state("VOIDED", "replaced by a correction", entry, day, None, after_cutoff) is None


def test_stale_open_session_is_not_on_site_and_is_queued_for_review(client, admin, kiosk, make_person, instant_type, pg):
    person = make_person(person_type=instant_type, first_name="Stale", last_name=f"Sess{instant_type}")
    fresh = make_person(person_type=instant_type, first_name="Fresh", last_name=f"Sess{instant_type}")
    make_stale(client, admin, kiosk, pg, person)
    assert scan(client, kiosk, fresh) == "ENTRY"

    names = on_site_names(client, kiosk)
    assert f"F. Sess{instant_type}" in names and f"S. Sess{instant_type}" not in names  # only the fresh one is on site

    stale_row = sessions(client, admin, person)[0]
    assert stale_row["status"] == "OPEN" and stale_row["review"] == "LEFT_OPEN"
    assert sessions(client, admin, fresh)[0]["review"] is None

    queue = client.get(f"{API}/attendance/sessions", params={"needs_review": True, "type": instant_type}, headers=admin).json()
    assert [s["person_id"] for s in queue] == [person["id"]]  # the fresh session is not in the queue
    detail = client.get(f"{API}/attendance/sessions/{stale_row['id']}", headers=admin).json()
    assert detail["review"] == "LEFT_OPEN"


def test_correcting_a_left_open_session_clears_it_from_the_queue(client, admin, kiosk, make_person, instant_type, pg):
    person = make_person(person_type=instant_type)
    stale = make_stale(client, admin, kiosk, pg, person)
    queue = lambda: client.get(f"{API}/attendance/sessions", params={"needs_review": True, "person_id": person["id"]}, headers=admin).json()  # noqa: E731
    assert len(queue()) == 1

    assert client.post(f"{API}/attendance/sessions/{stale['id']}/correct", json=FIX, headers=admin).status_code == 201
    assert queue() == []  # the old one is voided, the replacement is closed: nothing left to review


def test_missed_exit_stays_in_the_queue_until_it_is_rebuilt(client, admin, kiosk, make_person, instant_type, pg):
    person = make_person(person_type=instant_type)
    stale = make_stale(client, admin, kiosk, pg, person)
    assert scan(client, kiosk, person) == "ENTRY"  # scanning again voids the stale session as a missed exit

    queue = lambda: client.get(f"{API}/attendance/sessions", params={"needs_review": True, "person_id": person["id"]}, headers=admin).json()  # noqa: E731
    rows = queue()
    assert [(r["id"], r["status"], r["review"]) for r in rows] == [(stale["id"], "VOIDED", "MISSED_EXIT")]
    assert sessions(client, admin, person, status="OPEN")[0]["review"] is None  # the new session is a normal one

    assert client.post(f"{API}/attendance/sessions/{stale['id']}/correct", json=FIX, headers=admin).status_code == 201
    assert queue() == []


def test_review_queue_filters_and_paging(client, admin, kiosk, make_person, instant_type, pg):
    people = [make_person(person_type=instant_type, last_name=f"Q{i}") for i in range(3)]
    for person in people:
        make_stale(client, admin, kiosk, pg, person)

    base = {"needs_review": True, "type": instant_type}
    everything = client.get(f"{API}/attendance/sessions", params=base, headers=admin).json()
    assert len(everything) == 3
    page1 = client.get(f"{API}/attendance/sessions", params={**base, "limit": 2}, headers=admin).json()
    page2 = client.get(f"{API}/attendance/sessions", params={**base, "limit": 2, "offset": 2}, headers=admin).json()
    assert [len(page1), len(page2)] == [2, 1]
    assert {s["id"] for s in page1 + page2} == {s["id"] for s in everything}

    assert client.get(f"{API}/attendance/sessions", params={**base, "status": "CLOSED"}, headers=admin).json() == []
    assert len(client.get(f"{API}/attendance/sessions", params={**base, "status": "OPEN"}, headers=admin).json()) == 3
    far = {**base, "date_from": "2000-01-01", "date_to": "2000-01-02"}
    assert client.get(f"{API}/attendance/sessions", params=far, headers=admin).json() == []


def test_a_type_with_a_cutoff_uses_it(client, admin, kiosk, make_person, instant_type, pg):
    # cutoff 00:00 on the work date is already past by entry time, so the cutoff falls on the next day:
    # a session that began today is not stale yet
    client.put(f"{API}/attendance-rules/{instant_type}", headers=admin,
               json={"duplicate_window_seconds": 0, "auto_close_time": "23:59:00"})
    person = make_person(person_type=instant_type)
    assert scan(client, kiosk, person) == "ENTRY"
    assert sessions(client, admin, person)[0]["review"] is None
    pg.execute("UPDATE attendance_sessions SET work_date = current_date - 2, entry_time = entry_time - interval '2 days' "
               "WHERE person_id = %s", (person["id"],))
    assert sessions(client, admin, person)[0]["review"] == "LEFT_OPEN"
