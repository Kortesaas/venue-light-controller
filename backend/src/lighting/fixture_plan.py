import json
import logging
import re
import threading
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from pydantic import BaseModel

from .config import settings

_log = logging.getLogger(__name__)


class FixtureParameter(BaseModel):
    universe: int
    channel: int
    name: str
    fixture: str
    role: str
    ma3_universe: int


class FixtureDefinition(BaseModel):
    fixture: str
    parameters: List[FixtureParameter]


class FixturePlan(BaseModel):
    version: int = 1
    imported_at: str
    source_filename: Optional[str] = None
    fixture_count: int
    parameter_count: int
    universes: List[int]
    fixtures: List[FixtureDefinition]
    address_map: Dict[str, FixtureParameter]


class FixturePlanSummary(BaseModel):
    active: bool
    source_filename: Optional[str] = None
    imported_at: Optional[str] = None
    fixture_count: int = 0
    parameter_count: int = 0
    universes: List[int] = []
    example_parameters: List[FixtureParameter] = []


class FixturePlanDetails(BaseModel):
    active: bool
    source_filename: Optional[str] = None
    imported_at: Optional[str] = None
    fixture_count: int = 0
    parameter_count: int = 0
    universes: List[int] = []
    fixtures: List[FixtureDefinition] = []


_state_lock = threading.Lock()
_active_plan: Optional[FixturePlan] = None


def _plan_path() -> Path:
    return Path(settings.fixture_plan_path)


def _address_key(universe: int, channel: int) -> str:
    return f"{universe}:{channel}"


def _infer_role(parameter_name: str) -> str:
    value = parameter_name.strip().upper()
    if any(token in value for token in ("DIMMER", "INTENSITY", "MASTERDIM")):
        return "intensity"
    if any(
        token in value
        for token in (
            "COLOR",
            "COLOUR",
            "RGB",
            "CMY",
            "CTO",
            "CTB",
            "WHITE",
            "UV",
            "AMBER",
            "LIME",
        )
    ):
        return "color"
    if any(token in value for token in ("PAN", "TILT", "POSITION", "POS", "ZOOM", "FOCUS", "IRIS")):
        return "position"
    if any(token in value for token in ("SHUTTER", "STROBE", "GOBO", "PRISM", "FROST", "BEAM")):
        return "beam"
    if any(token in value for token in ("MACRO", "PROGRAM", "MODE", "RATE", "SPEED", "CONTROL", "RESET")):
        return "control"
    return "other"


def _validate_fixture_name(value: str) -> str:
    name = value.strip()
    if not name:
        raise ValueError("Fixture name must not be empty")
    return name


def _validate_parameter_name(value: str) -> str:
    name = value.strip()
    if not name:
        raise ValueError("Parameter name must not be empty")
    return name


def _parse_int_attr(element: ET.Element, attr_name: str) -> int:
    raw = element.attrib.get(attr_name, "").strip()
    if not raw:
        raise ValueError(f"Missing attribute '{attr_name}'")
    if not re.fullmatch(r"-?\d+", raw):
        raise ValueError(f"Invalid integer for '{attr_name}': {raw!r}")
    return int(raw)


def _build_summary(plan: FixturePlan, active: bool) -> FixturePlanSummary:
    preferred_examples = [
        parameter
        for fixture in plan.fixtures
        for parameter in fixture.parameters
        if parameter.role in {"intensity", "color"}
    ]
    fallback_examples = [parameter for fixture in plan.fixtures for parameter in fixture.parameters]
    examples = (preferred_examples or fallback_examples)[:8]

    return FixturePlanSummary(
        active=active,
        source_filename=plan.source_filename,
        imported_at=plan.imported_at,
        fixture_count=plan.fixture_count,
        parameter_count=plan.parameter_count,
        universes=[universe + 1 for universe in plan.universes],
        example_parameters=examples,
    )


def parse_fixture_plan_xml(xml_content: str, source_filename: Optional[str] = None) -> FixturePlan:
    if not xml_content.strip():
        raise ValueError("XML content is empty")

    try:
        root = ET.fromstring(xml_content)
    except ET.ParseError as exc:
        raise ValueError(f"Invalid XML: {exc}") from exc

    if root.tag != "ParameterListExport":
        raise ValueError("Root tag must be 'ParameterListExport'")

    parameters_raw = root.findall("Parameter")
    if not parameters_raw:
        raise ValueError("No <Parameter> entries found")

    fixture_to_parameters: Dict[str, List[FixtureParameter]] = {}
    address_map: Dict[str, FixtureParameter] = {}
    universes: set[int] = set()

    for element in parameters_raw:
        ma3_universe = _parse_int_attr(element, "universe")
        channel = _parse_int_attr(element, "number")
        if ma3_universe < 1:
            raise ValueError(f"Universe must be >= 1, got {ma3_universe}")
        if channel < 1 or channel > 512:
            raise ValueError(f"Channel must be 1..512, got {channel}")

        fixture_name = _validate_fixture_name(element.attrib.get("fixture", ""))
        parameter_name = _validate_parameter_name(element.attrib.get("name", ""))
        universe = ma3_universe - 1

        parameter = FixtureParameter(
            universe=universe,
            channel=channel,
            name=parameter_name,
            fixture=fixture_name,
            role=_infer_role(parameter_name),
            ma3_universe=ma3_universe,
        )

        key = _address_key(universe, channel)
        if key in address_map:
            existing = address_map[key]
            raise ValueError(
                "Duplicate DMX address mapping for "
                f"Universe {ma3_universe}, Channel {channel}: "
                f"{existing.fixture}/{existing.name} and {fixture_name}/{parameter_name}"
            )

        address_map[key] = parameter
        universes.add(universe)
        fixture_to_parameters.setdefault(fixture_name, []).append(parameter)

    fixtures: List[FixtureDefinition] = []
    for fixture_name in sorted(fixture_to_parameters.keys()):
        params = sorted(
            fixture_to_parameters[fixture_name],
            key=lambda item: (item.universe, item.channel, item.name),
        )
        fixtures.append(FixtureDefinition(fixture=fixture_name, parameters=params))

    return FixturePlan(
        imported_at=datetime.now(timezone.utc).isoformat(),
        source_filename=source_filename.strip() if source_filename else None,
        fixture_count=len(fixtures),
        parameter_count=len(address_map),
        universes=sorted(universes),
        fixtures=fixtures,
        address_map=address_map,
    )


def preview_fixture_plan(xml_content: str, source_filename: Optional[str] = None) -> FixturePlanSummary:
    plan = parse_fixture_plan_xml(xml_content, source_filename=source_filename)
    return _build_summary(plan, active=False)


def activate_fixture_plan(xml_content: str, source_filename: Optional[str] = None) -> FixturePlanSummary:
    plan = parse_fixture_plan_xml(xml_content, source_filename=source_filename)
    path = _plan_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as file:
            json.dump(plan.model_dump(), file, indent=2)
    except OSError as exc:
        raise ValueError(f"Failed to persist fixture plan: {exc}") from exc

    with _state_lock:
        global _active_plan
        _active_plan = plan
    return _build_summary(plan, active=True)


def clear_fixture_plan() -> None:
    path = _plan_path()
    try:
        path.unlink()
    except FileNotFoundError:
        pass
    except OSError as exc:
        raise ValueError(f"Failed to remove fixture plan: {exc}") from exc

    with _state_lock:
        global _active_plan
        _active_plan = None


def get_fixture_plan_summary() -> FixturePlanSummary:
    with _state_lock:
        plan = _active_plan
    if plan is None:
        return FixturePlanSummary(active=False)
    return _build_summary(plan, active=True)


def get_fixture_plan_details() -> FixturePlanDetails:
    with _state_lock:
        plan = _active_plan
    if plan is None:
        return FixturePlanDetails(active=False)
    return FixturePlanDetails(
        active=True,
        source_filename=plan.source_filename,
        imported_at=plan.imported_at,
        fixture_count=plan.fixture_count,
        parameter_count=plan.parameter_count,
        universes=[universe + 1 for universe in plan.universes],
        fixtures=plan.fixtures,
    )


def lookup_fixture_parameter(universe: int, channel: int) -> Optional[FixtureParameter]:
    key = _address_key(universe, channel)
    with _state_lock:
        plan = _active_plan
    if plan is None:
        return None
    return plan.address_map.get(key)


def get_intensity_addresses() -> Optional[set[tuple[int, int]]]:
    """
    Gibt alle als Intensitaet erkannten Adressen als (universe, channel) zurueck.
    `None` bedeutet: kein aktiver Plan (raw mode).
    """
    with _state_lock:
        plan = _active_plan
    if plan is None:
        return None

    addresses: set[tuple[int, int]] = set()
    for parameter in plan.address_map.values():
        if parameter.role == "intensity":
            addresses.add((parameter.universe, parameter.channel))
    return addresses


def _load_fixture_plan_on_startup() -> None:
    path = _plan_path()
    if not path.exists():
        return
    try:
        with path.open("r", encoding="utf-8") as file:
            data = json.load(file)
        plan = FixturePlan.model_validate(data)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        _log.warning("Failed to load fixture plan from %s: %s", path, exc)
        return

    with _state_lock:
        global _active_plan
        _active_plan = plan


_load_fixture_plan_on_startup()
