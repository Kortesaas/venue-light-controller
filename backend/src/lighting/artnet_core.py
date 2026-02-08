from .config import settings

# Hier wirst du später deinen funktionierenden Art-Net-Code einfügen.
# Wichtig: mach daraus Funktionen, die die API & Szenen-Logik benutzen können.


def record_snapshot(universe: int, duration: float) -> dict[int, list[int]]:
    """
    Nimmt einen Snapshot von einem Universe auf und liefert
    ein Mapping: {universe: [512 dmx values]} zurück.

    Platzhalter: Implementierung kommt später (mit deinem vorhandenen Code).
    """
    raise NotImplementedError("record_snapshot ist noch nicht implementiert")


def start_stream(universe_to_dmx: dict[int, bytes]) -> None:
    """
    Startet einen dauerhaften Art-Net-Stream mit Polling.
    'universe_to_dmx' ist ein Mapping Universe -> DMX-Bytes.

    Platzhalter: Implementierung kommt später.
    """
    raise NotImplementedError("start_stream ist noch nicht implementiert")


def stop_stream() -> None:
    """
    Stoppt den Art-Net-Stream.

    Platzhalter: Implementierung kommt später.
    """
    raise NotImplementedError("stop_stream ist noch nicht implementiert")
