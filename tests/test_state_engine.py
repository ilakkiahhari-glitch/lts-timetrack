from datetime import datetime, timedelta, timezone

from app.services.state_engine import Action, PersonState, Rules, decide

NOW = datetime(2026, 10, 7, 13, 0, 0, tzinfo=timezone.utc)
RULES = Rules()  # 30 s window


def test_first_scan_is_entry():
    assert decide(PersonState(False, None), NOW, RULES) is Action.ENTRY


def test_scan_with_open_session_is_exit():
    last = NOW - timedelta(hours=3)
    assert decide(PersonState(True, last), NOW, RULES) is Action.EXIT


def test_scan_after_exit_starts_new_entry():
    last = NOW - timedelta(hours=1)
    assert decide(PersonState(False, last), NOW, RULES) is Action.ENTRY


def test_duplicate_at_29_seconds():
    last = NOW - timedelta(seconds=29)
    assert decide(PersonState(True, last), NOW, RULES) is Action.DUPLICATE


def test_not_duplicate_at_31_seconds():
    last = NOW - timedelta(seconds=31)
    assert decide(PersonState(True, last), NOW, RULES) is Action.EXIT


def test_window_is_configurable_per_type():
    student_rules = Rules(duplicate_window=timedelta(seconds=120))
    last = NOW - timedelta(seconds=90)
    assert decide(PersonState(False, last), NOW, student_rules) is Action.DUPLICATE
    assert decide(PersonState(False, last), NOW, RULES) is Action.ENTRY
