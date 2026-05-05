import logging
import os
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


def _map_local_to_artnet_universe(local_universe: int) -> int:
    mapping = settings.artnet_universe_map
    if isinstance(mapping, list) and 0 <= local_universe < len(mapping):
        target = mapping[local_universe]
        if isinstance(target, int) and target >= 0:
            return target
    return local_universe


def _artnet_bind_candidates() -> List[str]:
    candidates: List[str] = []
    preferred_ip = str(settings.local_ip).strip()
    if preferred_ip:
        candidates.append(preferred_ip)
    candidates.append("")
    deduplicated: List[str] = []
    for candidate in candidates:
        if candidate not in deduplicated:
            deduplicated.append(candidate)
    return deduplicated


def create_artnet_listener_socket(timeout_seconds: float = 1.0) -> socket.socket:
    bind_errors: List[str] = []
    for bind_ip in _artnet_bind_candidates():
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.bind((bind_ip, ARTNET_PORT))
            sock.settimeout(timeout_seconds)
            bound_host = bind_ip if bind_ip else "0.0.0.0"
            _log.info("Art-Net listener bound on %s:%s", bound_host, ARTNET_PORT)
            return sock
        except OSError as exc:
            bind_errors.append(f"{bind_ip or '0.0.0.0'}:{ARTNET_PORT} -> {exc}")
            try:
                sock.close()
            except OSError:
                pass
    raise OSError("Could not bind Art-Net listener socket. Attempts: " + " | ".join(bind_errors))

def _extract_udp_payload_from_ipv4_packet(
    packet: bytes,
) -> Optional[Tuple[bytes, str, str, int, int]]:
    if len(packet) < 20:
        return None
    version = packet[0] >> 4
    if version != 4:
        return None
    ihl = (packet[0] & 0x0F) * 4
    if ihl < 20 or len(packet) < ihl + 8:
        return None
    protocol = packet[9]
    if protocol != 17:  # UDP
        return None
    src_port = struct.unpack("!H", packet[ihl : ihl + 2])[0]
    dst_port = struct.unpack("!H", packet[ihl + 2 : ihl + 4])[0]
    if src_port != ARTNET_PORT and dst_port != ARTNET_PORT:
        return None
    udp_length = struct.unpack("!H", packet[ihl + 4 : ihl + 6])[0]
    if udp_length < 8:
        return None
    payload_start = ihl + 8
    payload_end = payload_start + (udp_length - 8)
    if payload_end > len(packet):
        payload_end = len(packet)
    if payload_end <= payload_start:
        return None
    payload = packet[payload_start:payload_end]
    src_ip = socket.inet_ntoa(packet[12:16])
    dst_ip = socket.inet_ntoa(packet[16:20])
    return payload, src_ip, dst_ip, src_port, dst_port


def _build_capture_universe_aliases(target_universes: List[int]) -> Dict[int, List[int]]:
    aliases: Dict[int, List[int]] = {}
    for local_universe in target_universes:
        mapped_artnet_universe = _map_local_to_artnet_universe(local_universe)
        aliases.setdefault(mapped_artnet_universe, [])
        if local_universe not in aliases[mapped_artnet_universe]:
            aliases[mapped_artnet_universe].append(local_universe)
        # Be permissive: some sources may still transmit local universe IDs directly.
        aliases.setdefault(local_universe, [])
        if local_universe not in aliases[local_universe]:
            aliases[local_universe].append(local_universe)
    return aliases


def _build_capture_stats(target_universes: List[int]) -> dict:
    return {
        "packets_seen": 0,
        "artdmx_packets": 0,
        "applied_frames": 0,
        "ignored_universe_packets": 0,
        "seen_artnet_universes": {},
        "applied_by_local_universe": {universe: 0 for universe in target_universes},
        "packet_sources": {},
    }


def _bump_bucket(counter_map: dict, key: str) -> None:
    counter_map[key] = int(counter_map.get(key, 0)) + 1


def _apply_artnet_frame_to_buffers(
    packet: bytes,
    buffers: Dict[int, List[int]],
    universe_aliases: Dict[int, List[int]],
    stats: dict,
    source_label: str,
) -> bool:
    stats["packets_seen"] = int(stats.get("packets_seen", 0)) + 1
    _bump_bucket(stats["packet_sources"], source_label)

    parsed = _parse_artdmx(packet)
    if not parsed:
        return False

    stats["artdmx_packets"] = int(stats.get("artdmx_packets", 0)) + 1
    incoming_artnet_universe, dmx = parsed
    _bump_bucket(stats["seen_artnet_universes"], str(incoming_artnet_universe))

    target_local_universes = universe_aliases.get(incoming_artnet_universe, [])
    if not target_local_universes:
        stats["ignored_universe_packets"] = int(stats.get("ignored_universe_packets", 0)) + 1
        return False

    for local_universe in target_local_universes:
        if local_universe not in buffers:
            continue
        buffer = buffers[local_universe]
        for i in range(min(len(dmx), DMX_CHANNELS)):
            buffer[i] = dmx[i]
        stats["applied_frames"] = int(stats.get("applied_frames", 0)) + 1
        stats["applied_by_local_universe"][local_universe] = (
            int(stats["applied_by_local_universe"].get(local_universe, 0)) + 1
        )

    return True


def _capture_summary_text(
    mode: str,
    duration: float,
    target_universes: List[int],
    universe_aliases: Dict[int, List[int]],
    stats: dict,
) -> str:
    alias_text = ", ".join(
        f"ArtNet U{artnet_u} -> local {locals_}"
        for artnet_u, locals_ in sorted(universe_aliases.items(), key=lambda item: item[0])
    )
    source_items = sorted(
        stats["packet_sources"].items(),
        key=lambda item: int(item[1]),
        reverse=True,
    )[:5]
    source_text = ", ".join(f"{source} ({count})" for source, count in source_items) or "-"
    universe_items = sorted(
        stats["seen_artnet_universes"].items(),
        key=lambda item: int(item[1]),
        reverse=True,
    )[:8]
    universe_text = ", ".join(f"U{universe} ({count})" for universe, count in universe_items) or "-"
    applied_text = ", ".join(
        f"local U{universe}: {count}"
        for universe, count in sorted(stats["applied_by_local_universe"].items(), key=lambda item: item[0])
    )
    return (
        f"Art-Net capture summary [{mode}] duration={duration:.2f}s | "
        f"targets={target_universes} | alias={alias_text} | "
        f"packets_seen={stats['packets_seen']} artdmx={stats['artdmx_packets']} "
        f"applied={stats['applied_frames']} ignored_universe={stats['ignored_universe_packets']} | "
        f"seen_artnet={universe_text} | applied_local={applied_text} | sources={source_text}"
    )


def _capture_via_udp_listener(
    sock: socket.socket,
    buffers: Dict[int, List[int]],
    universe_aliases: Dict[int, List[int]],
    stats: dict,
    duration: float,
) -> int:
    updates = 0
    start = time.monotonic()
    while time.monotonic() - start < duration:
        try:
            data, addr = sock.recvfrom(4096)
        except socket.timeout:
            continue
        except OSError:
            break
        source_label = f"udp:{addr[0]}:{addr[1]}"
        if _apply_artnet_frame_to_buffers(data, buffers, universe_aliases, stats, source_label):
            updates += 1
    return updates


def _capture_via_raw_sniffer(
    local_ip: str,
    buffers: Dict[int, List[int]],
    universe_aliases: Dict[int, List[int]],
    stats: dict,
    duration: float,
) -> int:
    if os.name != "nt":
        raise OSError("Raw Art-Net sniff fallback is only implemented on Windows.")

    if not local_ip:
        raise OSError("No local adapter IP configured for raw Art-Net sniff fallback.")

    raw_sock = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_IP)
    raw_sock.bind((local_ip, 0))
    raw_sock.setsockopt(socket.IPPROTO_IP, socket.IP_HDRINCL, 1)
    raw_sock.ioctl(socket.SIO_RCVALL, socket.RCVALL_ON)
    raw_sock.settimeout(0.1)
    updates = 0

    try:
        start = time.monotonic()
        while time.monotonic() - start < duration:
            try:
                packet = raw_sock.recv(65535)
            except socket.timeout:
                continue
            except OSError:
                break
            extracted = _extract_udp_payload_from_ipv4_packet(packet)
            if extracted is None:
                continue
            payload, src_ip, dst_ip, src_port, dst_port = extracted
            source_label = f"raw:{src_ip}:{src_port}->{dst_ip}:{dst_port}"
            if _apply_artnet_frame_to_buffers(
                payload, buffers, universe_aliases, stats, source_label
            ):
                updates += 1
    finally:
        try:
            raw_sock.ioctl(socket.SIO_RCVALL, socket.RCVALL_OFF)
        except OSError:
            pass
        try:
            raw_sock.close()
        except OSError:
            pass

    return updates



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
        self._data_lock = threading.Lock()

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
        with self._data_lock:
            universe_keys = sorted(self.universe_to_dmx.keys())
        _log.info(
            "Starting ArtNet stream (local_ip=%s, node_ip=%s, fps=%.2f, poll=%.2fs, universes=%s)",
            self.local_ip,
            self.node_ip,
            self.fps,
            self.poll_interval,
            universe_keys,
        )
        self._dmx_thread.start()
        self._poll_thread.start()

    def set_universe_to_dmx(self, universe_to_dmx: Dict[int, bytes]) -> None:
        sanitized = {
            universe: bytes(dmx[:DMX_CHANNELS]).ljust(DMX_CHANNELS, b"\x00")
            for universe, dmx in universe_to_dmx.items()
        }
        with self._data_lock:
            self.universe_to_dmx = sanitized

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
        node_addr = (self.node_ip, ARTNET_PORT)

        next_frame = time.monotonic()
        while not self._stop.is_set():
            now = time.monotonic()
            if frame_time > 0 and now < next_frame:
                time.sleep(next_frame - now)

            frame_start = time.monotonic()
            with self._data_lock:
                current_items = list(self.universe_to_dmx.items())

            for universe, dmx in current_items:
                target_universe = _map_local_to_artnet_universe(universe)
                packet = _build_artdmx(target_universe, dmx, sequence)
                sequence = (sequence + 1) % 256
                try:
                    self.dmx_sock.sendto(packet, node_addr)
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
    return record_snapshots([universe], duration)


def record_snapshots(universes: List[int], duration: float) -> dict[int, list[int]]:
    """
    Nimmt fuer `duration` Sekunden ArtNet-Daten auf mehreren Universes auf und
    gibt ein Mapping {universe: [512 DMX-Werte]} zurueck.
    """
    target_universes = sorted(set(universes))
    if not target_universes:
        return {}

    buffers: Dict[int, List[int]] = {
        universe: [0] * DMX_CHANNELS for universe in target_universes
    }
    universe_aliases = _build_capture_universe_aliases(target_universes)
    listener_stats = _build_capture_stats(target_universes)
    fallback_stats = _build_capture_stats(target_universes)

    try:
        sock = create_artnet_listener_socket(timeout_seconds=0.25)
    except OSError as bind_exc:
        if os.name != "nt":
            raise
        _log.warning("UDP Art-Net listener bind failed, trying raw sniff fallback: %s", bind_exc)
        try:
            fallback_updates = _capture_via_raw_sniffer(
                settings.local_ip,
                buffers,
                universe_aliases,
                fallback_stats,
                max(duration, 1.0),
            )
            _log.info(
                _capture_summary_text(
                    "raw-fallback-after-bind-failure",
                    max(duration, 1.0),
                    target_universes,
                    universe_aliases,
                    fallback_stats,
                )
            )
            _log.info("Raw Art-Net sniff fallback captured %d matching ArtDMX packets.", fallback_updates)
            return buffers
        except OSError as sniff_exc:
            raise OSError(
                f"{bind_exc}; raw sniff fallback failed: {sniff_exc}. "
                "Raw sniff on Windows requires elevated rights and the correct adapter IP."
            ) from sniff_exc

    try:
        listener_updates = _capture_via_udp_listener(
            sock,
            buffers,
            universe_aliases,
            listener_stats,
            duration,
        )
    finally:
        try:
            sock.close()
        except OSError:
            pass

    _log.info(
        _capture_summary_text(
            "udp-listener",
            duration,
            target_universes,
            universe_aliases,
            listener_stats,
        )
    )

    if listener_updates > 0:
        return buffers

    if os.name == "nt":
        _log.info(
            "No ArtDMX packets captured via UDP listener in %.2fs; trying raw sniff fallback on %s.",
            duration,
            settings.local_ip,
        )
        try:
            fallback_updates = _capture_via_raw_sniffer(
                settings.local_ip,
                buffers,
                universe_aliases,
                fallback_stats,
                max(duration, 1.0),
            )
            _log.info(
                _capture_summary_text(
                    "raw-fallback-after-empty-listener",
                    max(duration, 1.0),
                    target_universes,
                    universe_aliases,
                    fallback_stats,
                )
            )
            _log.info("Raw Art-Net sniff fallback captured %d matching ArtDMX packets.", fallback_updates)
        except OSError as exc:
            _log.warning(
                "Raw Art-Net sniff fallback failed. Run backend elevated and verify adapter selection. Error: %s",
                exc,
            )

    return buffers

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


def update_stream(universe_to_dmx: dict[int, bytes]) -> None:
    """
    Aktualisiert den laufenden Stream mit neuen DMX-Werten, ohne Threads/Sockets neu zu starten.
    Falls kein Stream laeuft, wird nichts geaendert.
    """
    with _controller_lock:
        if _controller is None:
            _log.warning("update_stream called while no stream is running")
            return
        _controller.set_universe_to_dmx(universe_to_dmx)


def send_frame_once(universe_to_dmx: dict[int, bytes]) -> None:
    """
    Send a single Art-Net DMX frame per universe without starting the background stream.
    """
    if not universe_to_dmx:
        return

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.bind((settings.local_ip, 0))
        node_addr = (settings.node_ip, ARTNET_PORT)
        sequence = 0
        for universe in sorted(universe_to_dmx.keys()):
            dmx = universe_to_dmx[universe]
            packet = _build_artdmx(int(universe), bytes(dmx), sequence)
            sequence = (sequence + 1) % 256
            sock.sendto(packet, node_addr)
    finally:
        try:
            sock.close()
        except OSError:
            pass


def is_stream_running() -> bool:
    with _controller_lock:
        return _controller is not None
