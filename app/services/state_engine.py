"""Attendance State Engine: pure logic, no I/O."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum


class Action(str, Enum):
    ENTRY = "ENTRY"
    EXIT = "EXIT"
    DUPLICATE = "DUPLICATE"


@dataclass(frozen=True)
class Rules:
    """Loaded from attendance_rules for the person's type."""

    duplicate_window: timedelta = timedelta(seconds=30)


@dataclass(frozen=True)
class PersonState:
    has_open_session: bool
    last_event_time: datetime | None


def decide(state: PersonState, now: datetime, rules: Rules) -> Action:
    if state.last_event_time and now - state.last_event_time < rules.duplicate_window:
        return Action.DUPLICATE
    return Action.EXIT if state.has_open_session else Action.ENTRY
