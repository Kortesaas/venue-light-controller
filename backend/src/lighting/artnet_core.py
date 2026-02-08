import logging
import socket
import struct
import threading
import time
from typing import Dict, List, Optional, Tuple

from .config import settings

ARTNET_PORT = 6454
OP_DMX = 0x5000
OP_POLL = 0x2000
PROT_VER = 14
DMX_CHANNELS = 512

_log = logging.getLogger(__name__)

_controller_lock = threading.Lock()
_controller: Optional["_ArtNetController"] = None


def _build_artdmx(universe: int, dmx: bytes, sequence: int) -> bytes:
    dmx = dmx[:DMX_CHANNELS].ljust(DMX_CHANNELS, b"\x00")

    packet = b""
    packet += b"Art-Net\x00"
    packet += struct.pack("<H", OP_DMX)
    packet += struct.pack(">H", PROT_VER)
    packet += struct.pack("B", sequence & 0xFF)
    packet += struct.pack("B", 0)
    packet += struct.pack("<H", universe)
    packet += struct.pack(">H", DMX_CHANNELS)
    packet += dmx
    return packet


def _build_artpoll() -> bytes:
    packet = b""
    packet += b"Art-Net\x00"
    packet += struct.pack("<H", OP_POLL)
    packet += struct.pack(">H", PROT_VER)
    packet += struct.pack("B", 0b00000010)
    packet += struct.pack("B", 0)
    return packet


def _parse_artdmx(data: bytes) -> Optional[Tuple[int, bytes]]:
    if len(data) < 18:
        return None
    if data[0:8] != b"Art-Net\x00":
        return None

    opcode = struct.unpack("<H", data[8:10])[0]
    if opcode != OP_DMX:
        return None

    universe = struct.unpack("<H", data[14:16])[0]
    length = struct.unpack(">H", data[16:18])[0]
    if len(data) < 18 + length:
        return None

    dmx = data[18 : 18 + length]
    return universe, dmx


def _broadcast_from_local(local_ip: str) -> str:
    parts = local_ip.split(".")
    if len(parts) == 4 and all(p.isdigit() for p in parts):
        return f"{parts[0]}.255.255.255"
    return "255.255.255.255"


class _ArtNetController:
    def __init__(
        self,
        local_ip: str,
        node_ip: str,
        universe_to_dmx: Dict[int, bytes],
        fps: float,
        poll_interval: float,
    ):
        self.local_ip = local_ip
        self.node_ip = node_ip
        self.fps = fps
        self.poll_interval = poll_interval
        self.universe_to_dmx = {
            universe: bytes(dmx[:DMX_CHANNELS]).ljust(DMX_CHANNELS, b"\x00")
            for universe, dmx in universe_to_dmx.items()
        }

        self._stop = threading.Event()
        self._stopped = False

        self.dmx_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.dmx_sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        self.dmx_sock.bind((self.local_ip, 0))

        self.poll_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.poll_sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        self.poll_sock.bind((self.local_ip, 0))

        self._dmx_thread = threading.Thread(target=self._dmx_loop, daemon=True)
        self._poll_thread = threading.Thread(target=self._poll_loop, daemon=True)

    def start(self) -> None:
        _log.info(
            "Starting ArtNet stream (local_ip=%s, node_ip=%s, fps=%.2f, poll=%.2fs, universes=%s)",
            self.local_ip,
            self.node_ip,
            self.fps,
            self.poll_interval,
            sorted(self.universe_to_dmx.keys()),
        )
        self._dmx_thread.start()
        self._poll_thread.start()

    def stop(self) -> None:
        if self._stopped:
            return
        self._stopped = True
        _log.info("Stopping ArtNet stream")
        self._stop.set()
        self._dmx_thread.join(timeout=2.0)
        self._poll_thread.join(timeout=2.0)
        try:
            self.dmx_sock.close()
        except OSError:
            pass
        try:
            self.poll_sock.close()
        except OSError:
            pass
        _log.info("ArtNet stream stopped")

    def _dmx_loop(self) -> None:
        if self.fps <= 0:
            _log.warning("dmx_fps <= 0, DMX loop will run without throttling")
        frame_time = 1.0 / self.fps if self.fps > 0 else 0.0
        sequence = 0
        broadcast_addr = (_broadcast_from_local(self.local_ip), ARTNET_PORT)

        next_frame = time.monotonic()
        while not self._stop.is_set():
            now = time.monotonic()
            if frame_time > 0 and now < next_frame:
                time.sleep(next_frame - now)

            frame_start = time.monotonic()
            for universe, dmx in self.universe_to_dmx.items():
                packet = _build_artdmx(universe, dmx, sequence)
                sequence = (sequence + 1) % 256
                try:
                    self.dmx_sock.sendto(packet, broadcast_addr)
                except OSError as exc:
                    _log.warning("DMX send error: %s", exc)

            if frame_time > 0:
                next_frame = frame_start + frame_time

    def _poll_loop(self) -> None:
        packet = _build_artpoll()
        broadcast_addr = (_broadcast_from_local(self.local_ip), ARTNET_PORT)

        while not self._stop.is_set():
            try:
                self.poll_sock.sendto(packet, broadcast_addr)
            except OSError as exc:
                _log.warning("Poll broadcast error: %s", exc)

            try:
                self.poll_sock.sendto(packet, (self.node_ip, ARTNET_PORT))
            except OSError as exc:
                _log.warning("Poll unicast error: %s", exc)

            self._stop.wait(self.poll_interval)


def record_snapshot(universe: int, duration: float) -> dict[int, list[int]]:
    """
    Nimmt fuer `duration` Sekunden ArtNet-Daten auf dem angegebenen Universe auf
    und gibt ein Mapping {universe: [512 DMX-Werte]} zurueck.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("", ARTNET_PORT))
    sock.settimeout(1.0)

    buffer: List[int] = [0] * DMX_CHANNELS
    start = time.monotonic()

    try:
        while time.monotonic() - start < duration:
            try:
                data, _addr = sock.recvfrom(2048)
            except socket.timeout:
                continue

            parsed = _parse_artdmx(data)
            if not parsed:
                continue

            u, dmx = parsed
            if u != universe:
                continue

            for i in range(min(len(dmx), DMX_CHANNELS)):
                buffer[i] = dmx[i]
    finally:
        sock.close()

    return {universe: buffer}


def start_stream(universe_to_dmx: dict[int, bytes]) -> None:
    """
    Startet einen stabilen ArtNet-DMX-Stream mit Polling (FPS aus settings.dmx_fps).
    `universe_to_dmx` ist ein Mapping: Universe -> DMX-Bytes (512 Kanaele).
    Die Funktion nutzt Hintergrund-Threads und blockiert nicht.
    """
    if not universe_to_dmx:
        _log.warning("start_stream called with empty universe_to_dmx")
        return

    with _controller_lock:
        global _controller
        if _controller is not None:
            _controller.stop()
            _controller = None

        _controller = _ArtNetController(
            local_ip=settings.local_ip,
            node_ip=settings.node_ip,
            universe_to_dmx=universe_to_dmx,
            fps=settings.dmx_fps,
            poll_interval=settings.poll_interval,
        )
        _controller.start()


def stop_stream() -> None:
    """
    Stoppt den laufenden DMX-Stream sauber (Threads beenden, Sockets schliessen).
    Mehrfacher Aufruf ist erlaubt.
    """
    with _controller_lock:
        global _controller
        if _controller is None:
            return
        _controller.stop()
        _controller = None
