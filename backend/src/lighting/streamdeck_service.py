from __future__ import annotations

import logging
import threading
import traceback
from dataclasses import dataclass
from typing import Callable, Dict, List, Literal, Optional, Tuple

try:
    from PIL import ImageDraw, ImageFont
    from StreamDeck.DeviceManager import DeviceManager
    from StreamDeck.ImageHelpers import PILHelper
    from StreamDeck.ProductIDs import USBVendorIDs, USBProductIDs
    from StreamDeck.Devices.StreamDeckOriginal import StreamDeckOriginal
    from StreamDeck.Devices.StreamDeckOriginalV2 import StreamDeckOriginalV2
    from StreamDeck.Devices.StreamDeckMini import StreamDeckMini
    from StreamDeck.Devices.StreamDeckNeo import StreamDeckNeo
    from StreamDeck.Devices.StreamDeckXL import StreamDeckXL
    from StreamDeck.Devices.StreamDeckPedal import StreamDeckPedal
    from StreamDeck.Devices.StreamDeckPlus import StreamDeckPlus
except ImportError:  # pragma: no cover - optional dependency
    DeviceManager = None
    PILHelper = None
    ImageDraw = None
    ImageFont = None
    USBVendorIDs = None
    USBProductIDs = None
    StreamDeckOriginal = None
    StreamDeckOriginalV2 = None
    StreamDeckMini = None
    StreamDeckNeo = None
    StreamDeckXL = None
    StreamDeckPedal = None
    StreamDeckPlus = None

try:
    import hid  # type: ignore
except ImportError:  # pragma: no cover - optional dependency
    hid = None


_log = logging.getLogger(__name__)

PageName = Literal["scenes", "levels"]
Action = Tuple[str, Optional[str]]

SCENE_SLOTS_PER_PAGE = 24
GROUP_COLUMNS_PER_PAGE = 7


class _HidModuleDevice:
    def __init__(self, device_info: dict):
        self._device_info = device_info
        self._handle = None
        self._lock = threading.Lock()

    def open(self) -> None:
        if hid is None:
            raise RuntimeError("hid module unavailable")
        with self._lock:
            if self._handle is not None:
                return
            handle = hid.device()
            handle.open_path(self._path_bytes())
            handle.set_nonblocking(True)
            self._handle = handle

    def close(self) -> None:
        with self._lock:
            if self._handle is None:
                return
            self._handle.close()
            self._handle = None

    def is_open(self) -> bool:
        with self._lock:
            return self._handle is not None

    def connected(self) -> bool:
        if hid is None:
            return False
        path = self._path_bytes()
        vid = int(self._device_info.get("vendor_id", 0))
        pid = int(self._device_info.get("product_id", 0))
        for info in hid.enumerate(vid, pid):
            candidate = info.get("path")
            if isinstance(candidate, str):
                candidate = candidate.encode("utf-8", errors="ignore")
            if candidate == path:
                return True
        return False

    def vendor_id(self) -> int:
        return int(self._device_info.get("vendor_id", 0))

    def product_id(self) -> int:
        return int(self._device_info.get("product_id", 0))

    def path(self) -> str:
        path = self._device_info.get("path")
        if isinstance(path, bytes):
            return path.decode("utf-8", errors="replace")
        return str(path)

    def write_feature(self, payload: bytes) -> int:
        with self._lock:
            if self._handle is None:
                raise RuntimeError("HID device is not open")
            return int(self._handle.send_feature_report(bytes(payload)))

    def read_feature(self, report_id: int, length: int) -> bytes:
        with self._lock:
            if self._handle is None:
                raise RuntimeError("HID device is not open")
            result = self._handle.get_feature_report(report_id, length)
        if isinstance(result, bytes):
            return result
        return bytes(result)

    def write(self, payload: bytes) -> int:
        with self._lock:
            if self._handle is None:
                raise RuntimeError("HID device is not open")
            return int(self._handle.write(bytes(payload)))

    def read(self, length: int):
        with self._lock:
            if self._handle is None:
                raise RuntimeError("HID device is not open")
            result = self._handle.read(length)
        if not result:
            return None
        if isinstance(result, bytes):
            return result
        return bytes(result)

    def _path_bytes(self) -> bytes:
        path = self._device_info.get("path")
        if isinstance(path, bytes):
            return path
        return str(path).encode("utf-8", errors="ignore")


@dataclass(frozen=True)
class StreamDeckScene:
    id: str
    name: str
    scene_type: str


@dataclass(frozen=True)
class StreamDeckGroupDimmer:
    key: str
    name: str
    value_percent: int
    muted: bool
    fixture_count: int
    channel_count: int


@dataclass(frozen=True)
class StreamDeckSnapshot:
    control_mode: str
    active_scene_id: Optional[str]
    master_dimmer_percent: int
    scenes: List[StreamDeckScene]
    group_dimmer_available: bool
    group_dimmers: List[StreamDeckGroupDimmer]


class StreamDeckService:
    def __init__(
        self,
        *,
        get_snapshot: Callable[[], StreamDeckSnapshot],
        play_scene: Callable[[str], None],
        stop: Callable[[], None],
        blackout: Callable[[], None],
        set_master_dimmer: Callable[[int], None],
        set_group_dimmer: Callable[[str, int], None],
        toggle_group_mute: Callable[[str], None],
    ) -> None:
        self._get_snapshot = get_snapshot
        self._play_scene = play_scene
        self._stop = stop
        self._blackout = blackout
        self._set_master_dimmer = set_master_dimmer
        self._set_group_dimmer = set_group_dimmer
        self._toggle_group_mute = toggle_group_mute

        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._wake_event = threading.Event()
        self._lock = threading.Lock()

        self._deck = None
        self._deck_serial: Optional[str] = None
        self._page: PageName = "scenes"
        self._scene_page = 0
        self._group_page = 0
        self._action_map: Dict[int, Action] = {}
        self._render_cache: Dict[int, tuple] = {}
        self._last_snapshot: Optional[StreamDeckSnapshot] = None
        self._font = None
        self._reported_probe_error = False

    @property
    def available(self) -> bool:
        return DeviceManager is not None and PILHelper is not None and ImageDraw is not None and ImageFont is not None

    def start(self) -> None:
        if not self.available:
            _log.info("Stream Deck support disabled (optional dependency not installed).")
            return
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop_event.clear()
            self._wake_event.clear()
            self._thread = threading.Thread(target=self._run, name="streamdeck-service", daemon=True)
            self._thread.start()
        _log.info("Stream Deck service started.")

    def stop(self) -> None:
        with self._lock:
            thread = self._thread
            self._thread = None
        self._stop_event.set()
        self._wake_event.set()
        if thread is not None and thread.is_alive():
            thread.join(timeout=2.0)
        self._close_deck()
        _log.info("Stream Deck service stopped.")

    def notify_state_changed(self) -> None:
        self._wake_event.set()

    def _run(self) -> None:
        while not self._stop_event.is_set():
            if self._deck is None:
                self._open_first_compatible_deck()
                if self._deck is None:
                    self._stop_event.wait(2.0)
                    continue
                self._wake_event.set()

            self._wake_event.wait(timeout=0.2)
            self._wake_event.clear()
            if self._stop_event.is_set():
                break

            try:
                self._render_current_state()
            except Exception as exc:  # pragma: no cover - hardware dependent
                _log.warning("Stream Deck render loop error: %s", exc)
                self._close_deck()

    def _open_first_compatible_deck(self) -> None:
        if DeviceManager is None:
            return

        try:
            streamdecks = DeviceManager().enumerate()
        except Exception as exc:  # pragma: no cover - host/backend dependent
            self._report_probe_error(exc)
            streamdecks = self._enumerate_streamdecks_via_hid_module()
        if not streamdecks:
            self._reported_probe_error = False
            return

        selected = None
        for candidate in streamdecks:
            try:
                if candidate.key_count() == 32:
                    selected = candidate
                    break
            except Exception:
                continue
        if selected is None:
            selected = streamdecks[0]

        try:
            selected.open()
            selected.reset()
            selected.set_brightness(35)
            selected.set_key_callback(self._on_key_change)
            self._deck = selected
            self._deck_serial = selected.get_serial_number()
            self._render_cache = {}
            self._reported_probe_error = False
            _log.info(
                "Connected Stream Deck '%s' (serial=%s, keys=%s).",
                selected.deck_type(),
                self._deck_serial,
                selected.key_count(),
            )
        except Exception as exc:  # pragma: no cover - hardware dependent
            _log.warning("Failed to open Stream Deck: %s", exc)
            try:
                selected.close()
            except Exception:
                pass
            self._deck = None
            self._deck_serial = None

    def _enumerate_streamdecks_via_hid_module(self):
        if hid is None or USBVendorIDs is None or USBProductIDs is None:
            return []

        products = [
            (USBVendorIDs.USB_VID_ELGATO, USBProductIDs.USB_PID_STREAMDECK_ORIGINAL, StreamDeckOriginal),
            (USBVendorIDs.USB_VID_ELGATO, USBProductIDs.USB_PID_STREAMDECK_ORIGINAL_V2, StreamDeckOriginalV2),
            (USBVendorIDs.USB_VID_ELGATO, USBProductIDs.USB_PID_STREAMDECK_MK2_SCISSOR, StreamDeckOriginalV2),
            (USBVendorIDs.USB_VID_ELGATO, USBProductIDs.USB_PID_STREAMDECK_MK2_MODULE, StreamDeckOriginalV2),
            (USBVendorIDs.USB_VID_ELGATO, USBProductIDs.USB_PID_STREAMDECK_MINI, StreamDeckMini),
            (USBVendorIDs.USB_VID_ELGATO, USBProductIDs.USB_PID_STREAMDECK_NEO, StreamDeckNeo),
            (USBVendorIDs.USB_VID_ELGATO, USBProductIDs.USB_PID_STREAMDECK_XL, StreamDeckXL),
            (USBVendorIDs.USB_VID_ELGATO, USBProductIDs.USB_PID_STREAMDECK_MK2, StreamDeckOriginalV2),
            (USBVendorIDs.USB_VID_ELGATO, USBProductIDs.USB_PID_STREAMDECK_MK2_V2, StreamDeckOriginalV2),
            (USBVendorIDs.USB_VID_ELGATO, USBProductIDs.USB_PID_STREAMDECK_PEDAL, StreamDeckPedal),
            (USBVendorIDs.USB_VID_ELGATO, USBProductIDs.USB_PID_STREAMDECK_MINI_MK2, StreamDeckMini),
            (USBVendorIDs.USB_VID_ELGATO, USBProductIDs.USB_PID_STREAMDECK_MINI_MK2_MODULE, StreamDeckMini),
            (USBVendorIDs.USB_VID_ELGATO, USBProductIDs.USB_PID_STREAMDECK_XL_V2, StreamDeckXL),
            (USBVendorIDs.USB_VID_ELGATO, USBProductIDs.USB_PID_STREAMDECK_XL_V2_MODULE, StreamDeckXL),
            (USBVendorIDs.USB_VID_ELGATO, USBProductIDs.USB_PID_STREAMDECK_PLUS, StreamDeckPlus),
        ]

        discovered = []
        for vid, pid, class_type in products:
            if class_type is None:
                continue
            try:
                infos = hid.enumerate(int(vid), int(pid))
            except Exception:
                continue
            for info in infos:
                try:
                    discovered.append(class_type(_HidModuleDevice(info)))
                except Exception:
                    continue

        if discovered:
            _log.info("Using HID module fallback transport for Stream Deck discovery.")
        return discovered

    def _report_probe_error(self, exc: Exception) -> None:
        if self._reported_probe_error:
            return
        self._reported_probe_error = True
        _log.warning(
            "Stream Deck probe failed. A HID backend is missing/unavailable. "
            "Falling back to the Python 'hid' module if available. "
            "Detail: %s",
            exc,
        )
        _log.debug("Stream Deck probe traceback:\n%s", traceback.format_exc())

    def _close_deck(self) -> None:
        deck = self._deck
        self._deck = None
        self._deck_serial = None
        self._action_map = {}
        self._render_cache = {}
        if deck is None:
            return
        try:
            deck.set_key_callback(None)
            deck.reset()
            deck.close()
        except Exception:  # pragma: no cover - hardware dependent
            pass

    def _render_current_state(self) -> None:
        if self._deck is None:
            return
        snapshot = self._get_snapshot()
        self._last_snapshot = snapshot

        key_count = self._deck.key_count()
        action_map: Dict[int, Action] = {}
        visuals: Dict[int, tuple] = {}

        if self._page == "scenes":
            self._build_scenes_layout(snapshot, action_map, visuals)
        else:
            self._build_levels_layout(snapshot, action_map, visuals)

        for key in range(key_count):
            if key not in visuals:
                visuals[key] = ("", "", "", (15, 15, 15), (140, 140, 140))

        with self._deck:
            for key in range(key_count):
                visual = visuals[key]
                if self._render_cache.get(key) == visual:
                    continue
                image = self._render_key_image(*visual)
                self._deck.set_key_image(key, image)
                self._render_cache[key] = visual

        self._action_map = action_map

    def _build_scenes_layout(
        self,
        snapshot: StreamDeckSnapshot,
        action_map: Dict[int, Action],
        visuals: Dict[int, tuple],
    ) -> None:
        scenes = snapshot.scenes
        max_scene_pages = max(1, (len(scenes) + SCENE_SLOTS_PER_PAGE - 1) // SCENE_SLOTS_PER_PAGE)
        self._scene_page = max(0, min(self._scene_page, max_scene_pages - 1))
        scene_start = self._scene_page * SCENE_SLOTS_PER_PAGE
        page_scenes = scenes[scene_start : scene_start + SCENE_SLOTS_PER_PAGE]

        mode_text = "PANEL" if snapshot.control_mode == "panel" else "EXTERNAL"
        mode_color = (35, 130, 70) if snapshot.control_mode == "panel" else (140, 80, 20)

        visuals[0] = ("SCENES", f"Page {self._scene_page + 1}/{max_scene_pages}", "", (32, 32, 46), (220, 220, 220))
        visuals[1] = ("LEVELS", "Intensity", "", (45, 40, 95), (225, 225, 255))
        action_map[1] = ("switch_page", "levels")
        visuals[2] = ("PREV", "Scenes", "", (40, 40, 45), (220, 220, 220))
        if self._scene_page > 0:
            action_map[2] = ("prev_scene_page", None)
        visuals[3] = ("NEXT", "Scenes", "", (40, 40, 45), (220, 220, 220))
        if self._scene_page < max_scene_pages - 1:
            action_map[3] = ("next_scene_page", None)
        visuals[4] = ("STOP", "", "", (80, 30, 30), (255, 230, 230))
        action_map[4] = ("stop", None)
        visuals[5] = ("BLACKOUT", "", "", (110, 22, 22), (255, 235, 235))
        action_map[5] = ("blackout", None)
        visuals[6] = ("MODE", mode_text, "", mode_color, (245, 245, 245))
        visuals[7] = ("ACTIVE", snapshot.active_scene_id or "-", "", (40, 48, 62), (220, 225, 230))

        for slot, scene in enumerate(page_scenes):
            key = 8 + slot
            is_active = scene.id == snapshot.active_scene_id
            is_dynamic = scene.scene_type == "dynamic"
            bg = (25, 95, 40) if is_active else ((34, 44, 90) if is_dynamic else (38, 38, 52))
            subtitle = "DYNAMIC" if is_dynamic else "STATIC"
            footer = scene.id
            if snapshot.control_mode == "external":
                subtitle = "LOCKED"
            visuals[key] = (scene.name, subtitle, footer, bg, (240, 240, 240))
            if snapshot.control_mode == "panel":
                action_map[key] = ("play_scene", scene.id)

    def _build_levels_layout(
        self,
        snapshot: StreamDeckSnapshot,
        action_map: Dict[int, Action],
        visuals: Dict[int, tuple],
    ) -> None:
        groups = snapshot.group_dimmers if snapshot.group_dimmer_available else []
        max_group_pages = max(1, (len(groups) + GROUP_COLUMNS_PER_PAGE - 1) // GROUP_COLUMNS_PER_PAGE)
        self._group_page = max(0, min(self._group_page, max_group_pages - 1))
        group_start = self._group_page * GROUP_COLUMNS_PER_PAGE
        page_groups = groups[group_start : group_start + GROUP_COLUMNS_PER_PAGE]

        mode_text = "PANEL" if snapshot.control_mode == "panel" else "EXTERNAL"
        mode_color = (35, 130, 70) if snapshot.control_mode == "panel" else (140, 80, 20)
        locked = snapshot.control_mode != "panel"

        # Master column (col 0)
        visuals[0] = ("SCENES", "Back", "", (45, 40, 95), (225, 225, 255))
        action_map[0] = ("switch_page", "scenes")
        visuals[8] = ("MASTER", f"{snapshot.master_dimmer_percent}%", "", (42, 64, 90), (240, 240, 240))
        visuals[16] = ("MASTER", "BRIGHTER", "+10%", (36, 72, 44), (235, 250, 235))
        visuals[24] = ("MASTER", "DIMMER", "-10%", (70, 58, 34), (250, 245, 225))
        if not locked:
            action_map[16] = ("master_step", "10")
            action_map[24] = ("master_step", "-10")

        # Top-row global nav/status keys.
        visuals[1] = ("LEVELS", f"Page {self._group_page + 1}/{max_group_pages}", "", (32, 32, 46), (220, 220, 220))
        visuals[2] = ("PREV", "Groups", "", (40, 40, 45), (220, 220, 220))
        if self._group_page > 0:
            action_map[2] = ("prev_group_page", None)
        visuals[3] = ("NEXT", "Groups", "", (40, 40, 45), (220, 220, 220))
        if self._group_page < max_group_pages - 1:
            action_map[3] = ("next_group_page", None)
        visuals[4] = ("FULL", "MASTER 100%", "", (35, 95, 58), (230, 255, 236))
        if not locked:
            action_map[4] = ("master_set", "100")
        visuals[5] = ("STOP", "", "", (80, 30, 30), (255, 230, 230))
        action_map[5] = ("stop", None)
        visuals[6] = ("BLACKOUT", "", "", (110, 22, 22), (255, 235, 235))
        action_map[6] = ("blackout", None)
        visuals[7] = ("MODE", mode_text, "", mode_color, (245, 245, 245))

        for col in range(1, 8):
            group_index = col - 1
            top_key = col
            brighter_key = 8 + col
            dimmer_key = 16 + col
            full_key = 24 + col

            if group_index >= len(page_groups):
                visuals[top_key] = ("-", "No Group", "", (26, 26, 30), (150, 150, 150))
                visuals[brighter_key] = ("+", "", "", (22, 35, 25), (130, 160, 130))
                visuals[dimmer_key] = ("-", "", "", (40, 34, 20), (165, 155, 120))
                visuals[full_key] = ("FULL", "", "", (24, 42, 30), (130, 160, 130))
                continue

            group = page_groups[group_index]
            muted_text = "MUTED" if group.muted else f"{group.value_percent}%"
            top_bg = (95, 38, 38) if group.muted else (44, 52, 70)
            visuals[top_key] = (group.name, muted_text, f"{group.fixture_count} fx", top_bg, (240, 240, 240))
            visuals[brighter_key] = ("BRIGHTER", "+10%", "", (36, 72, 44), (235, 250, 235))
            visuals[dimmer_key] = ("DIMMER", "-10%", "", (70, 58, 34), (250, 245, 225))
            visuals[full_key] = ("FULL", "100%", "", (35, 95, 58), (230, 255, 236))

            if locked:
                continue
            action_map[top_key] = ("group_toggle_mute", group.key)
            action_map[brighter_key] = ("group_step", f"{group.key}|10")
            action_map[dimmer_key] = ("group_step", f"{group.key}|-10")
            action_map[full_key] = ("group_set", f"{group.key}|100")

    def _render_key_image(
        self,
        title: str,
        subtitle: str,
        footer: str,
        bg_rgb: tuple[int, int, int],
        fg_rgb: tuple[int, int, int],
    ):
        if self._deck is None or PILHelper is None or ImageDraw is None or ImageFont is None:
            return None
        image = PILHelper.create_image(self._deck, background=bg_rgb)
        draw = ImageDraw.Draw(image)
        font = self._get_font()

        width, height = image.size
        title = self._limit_text(title, 18)
        subtitle = self._limit_text(subtitle, 18)
        footer = self._limit_text(footer, 18)

        if title:
            draw.text((width // 2, 14), title, font=font, fill=fg_rgb, anchor="ma")
        if subtitle:
            draw.text((width // 2, height // 2), subtitle, font=font, fill=fg_rgb, anchor="mm")
        if footer:
            draw.text((width // 2, height - 12), footer, font=font, fill=fg_rgb, anchor="ms")

        return PILHelper.to_native_format(self._deck, image)

    def _get_font(self):
        if self._font is None and ImageFont is not None:
            self._font = ImageFont.load_default()
        return self._font

    @staticmethod
    def _limit_text(value: str, max_len: int) -> str:
        cleaned = " ".join(value.split())
        if len(cleaned) <= max_len:
            return cleaned
        return f"{cleaned[: max_len - 3]}..."

    def _on_key_change(self, _deck, key: int, state: bool) -> None:
        if not state:
            return
        action = self._action_map.get(key)
        if action is None:
            return
        self._execute_action(action)

    def _execute_action(self, action: Action) -> None:
        action_name, payload = action
        try:
            if action_name == "switch_page":
                if payload == "levels":
                    self._page = "levels"
                else:
                    self._page = "scenes"
            elif action_name == "prev_scene_page":
                self._scene_page = max(0, self._scene_page - 1)
            elif action_name == "next_scene_page":
                self._scene_page += 1
            elif action_name == "prev_group_page":
                self._group_page = max(0, self._group_page - 1)
            elif action_name == "next_group_page":
                self._group_page += 1
            elif action_name == "play_scene" and payload:
                self._play_scene(payload)
            elif action_name == "stop":
                self._stop()
            elif action_name == "blackout":
                self._blackout()
            elif action_name == "master_step" and payload:
                snapshot = self._last_snapshot or self._get_snapshot()
                target = max(0, min(100, snapshot.master_dimmer_percent + int(payload)))
                self._set_master_dimmer(target)
            elif action_name == "master_set" and payload:
                self._set_master_dimmer(int(payload))
            elif action_name == "group_toggle_mute" and payload:
                self._toggle_group_mute(payload)
            elif action_name == "group_step" and payload:
                group_key, delta_raw = payload.split("|", 1)
                delta = int(delta_raw)
                snapshot = self._last_snapshot or self._get_snapshot()
                current = next(
                    (
                        group.value_percent
                        for group in snapshot.group_dimmers
                        if group.key == group_key
                    ),
                    100,
                )
                target = max(0, min(100, current + delta))
                self._set_group_dimmer(group_key, target)
            elif action_name == "group_set" and payload:
                group_key, value_raw = payload.split("|", 1)
                self._set_group_dimmer(group_key, int(value_raw))
        except Exception as exc:  # pragma: no cover - hardware/user interaction
            _log.warning("Stream Deck action '%s' failed: %s", action_name, exc)
        finally:
            self.notify_state_changed()
