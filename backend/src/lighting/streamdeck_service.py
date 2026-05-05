from __future__ import annotations

import logging
import threading
import time
import traceback
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Callable, Dict, List, Literal, Optional, Tuple

try:
    from PIL import Image, ImageDraw, ImageFont
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
    Image = None
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
GROUP_COLUMNS_PER_PAGE = 4
HAZE_STEP_PERCENT = 10
DEFAULT_SCREENSAVER_IDLE_SECONDS = 300.0
SCREENSAVER_SNAKE_SPEED_CELLS_PER_SEC = 7.0
SCREENSAVER_SNAKE_LENGTH = 8


PALETTE = {
    "base_bg": (0, 0, 0),
    "muted_bg": (10, 10, 10),
    "text": (255, 255, 255),
    "text_muted": (176, 176, 176),
    "scene_static": (0, 140, 255),
    "scene_dynamic": (196, 48, 255),
    "scene_active": (0, 245, 166),
    "action": (0, 188, 255),
    "danger": (255, 54, 86),
    "warning": (255, 176, 38),
    "success": (24, 226, 121),
    "master": (0, 210, 255),
    "group": (38, 132, 255),
    "group_muted": (245, 82, 138),
    "disabled": (7, 7, 7),
}

LEFT_RAIL_BG = (14, 14, 14)
LEFT_RAIL_ACTIVE_BG = (28, 28, 28)
LEFT_RAIL_ACCENT = (255, 255, 255)
LEFT_RAIL_INACTIVE_ACCENT = (160, 160, 160)

SCENE_STYLE_COLORS: dict[str, tuple[int, int, int]] = {
    "cyan": (0, 188, 212),
    "blue": (66, 165, 245),
    "teal": (38, 198, 218),
    "green": (102, 187, 106),
    "violet": (126, 87, 194),
    "amber": (255, 179, 0),
    "rose": (240, 98, 146),
    "red": (239, 83, 80),
    "rainbow": (240, 98, 146),
}

FADER_BANK_GRAYS: list[tuple[int, int, int]] = [
    (10, 10, 10),
    (44, 44, 44),
]

LEVELS_BANK_LIGHT_GRAY = 46
LEVELS_BANK_DARK_GRAY = 10

GROUP_DISPLAY_ORDER_HINTS: list[tuple[int, tuple[str, ...]]] = [
    (0, ("front",)),
    (1, ("mh", "moving head")),
    (2, ("wash",)),
    (3, ("spots", "spot")),
    (4, ("theater", "theatre")),
    (5, ("flood",)),
    (6, ("disco led", "disco", "led")),
    (7, ("par",)),
    (8, ("strobe",)),
]


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
    style_icon: Optional[str] = None
    style_color: Optional[str] = None


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
    panel_locked: bool
    active_scene_id: Optional[str]
    master_dimmer_percent: int
    scenes: List[StreamDeckScene]
    group_dimmer_available: bool
    group_dimmers: List[StreamDeckGroupDimmer]
    haze_percent: int
    haze_configured: bool
    fog_flash_active: bool
    fog_flash_configured: bool
    blinder_flash_active: bool
    blinder_flash_configured: bool


@dataclass(frozen=True)
class KeyVisual:
    title: str
    subtitle: str = ""
    footer: str = ""
    icon: str = "none"
    bg_rgb: tuple[int, int, int] = PALETTE["muted_bg"]
    fg_rgb: tuple[int, int, int] = PALETTE["text"]
    accent_rgb: tuple[int, int, int] = PALETTE["action"]
    disabled: bool = False
    muted: bool = False
    text_y_offset: int = 0
    icon_below_text: bool = False
    title_near_top: bool = False
    icon_y_offset: int = 0
    subtitle_y_offset: int = 0

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
        set_group_flash_active: Callable[[str, bool], None],
        set_haze: Callable[[int], None],
        set_fog_flash_active: Callable[[bool], None],
        set_blinder_flash_active: Callable[[bool], None],
        set_panel_lock: Callable[[bool], None],
        unlock_panel: Callable[[str], bool],
    ) -> None:
        self._get_snapshot = get_snapshot
        self._play_scene = play_scene
        self._stop = stop
        self._blackout = blackout
        self._set_master_dimmer = set_master_dimmer
        self._set_group_dimmer = set_group_dimmer
        self._toggle_group_mute = toggle_group_mute
        self._set_group_flash_active = set_group_flash_active
        self._set_haze = set_haze
        self._set_fog_flash_active = set_fog_flash_active
        self._set_blinder_flash_active = set_blinder_flash_active
        self._set_panel_lock = set_panel_lock
        self._unlock_panel = unlock_panel

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
        self._render_cache: Dict[int, KeyVisual] = {}
        self._last_snapshot: Optional[StreamDeckSnapshot] = None
        self._font_cache: Dict[str, object] = {}
        self._reported_probe_error = False
        self._icon_cache: Dict[tuple[str, int], Optional[Image.Image]] = {}
        self._icons_dir = Path(__file__).resolve().parents[2] / "assets" / "streamdeck" / "icons"
        self._press_state_lock = threading.Lock()
        self._pressed_keys: set[int] = set()
        self._pressed_until: Dict[int, float] = {}
        self._press_timer_lock = threading.Lock()
        self._press_timers: list[threading.Timer] = []
        self._master_unmute_percent = 100
        self._group_flash_restore: Dict[str, int] = {}
        self._screensaver_lock = threading.Lock()
        self._screensaver_active = False
        self._last_user_activity_monotonic = time.monotonic()
        self._screensaver_head_index = 0
        self._screensaver_next_step_monotonic = 0.0
        self._screensaver_idle_seconds = float(DEFAULT_SCREENSAVER_IDLE_SECONDS)
        self._wake_consumed_releases: set[int] = set()
        self._unlock_pin_buffer = ""
        self._unlock_error_until = 0.0

    @property
    def available(self) -> bool:
        return (
            DeviceManager is not None
            and PILHelper is not None
            and Image is not None
            and ImageDraw is not None
            and ImageFont is not None
        )

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

    def set_screensaver_idle_seconds(self, seconds: float) -> None:
        value = float(seconds)
        if value < 0:
            value = 0.0
        with self._screensaver_lock:
            self._screensaver_idle_seconds = value
            if value <= 0:
                self._screensaver_active = False
                self._screensaver_head_index = 0
                self._screensaver_next_step_monotonic = 0.0
                self._last_user_activity_monotonic = time.monotonic()
        self.notify_state_changed()

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
            with self._screensaver_lock:
                self._screensaver_active = False
                self._last_user_activity_monotonic = time.monotonic()
                self._screensaver_head_index = 0
                self._screensaver_next_step_monotonic = 0.0
            self._wake_consumed_releases.clear()
            self._unlock_pin_buffer = ""
            self._unlock_error_until = 0.0
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
            "Stream Deck probe failed (one-time warning). Common causes: "
            "no Stream Deck connected, USB not accessible, or HID backend/dependencies missing "
            "(for example hidapi/hidapi.dll). Falling back to the Python 'hid' module if available "
            "while continuing periodic auto-detection. "
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
        self._group_flash_restore = {}
        with self._screensaver_lock:
            self._screensaver_active = False
            self._last_user_activity_monotonic = time.monotonic()
            self._screensaver_head_index = 0
            self._screensaver_next_step_monotonic = 0.0
        self._wake_consumed_releases.clear()
        self._unlock_pin_buffer = ""
        self._unlock_error_until = 0.0
        with self._press_state_lock:
            self._pressed_keys.clear()
            self._pressed_until.clear()
        with self._press_timer_lock:
            timers = list(self._press_timers)
            self._press_timers.clear()
        for timer in timers:
            try:
                timer.cancel()
            except Exception:
                pass
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
        key_count = self._deck.key_count()
        action_map: Dict[int, Action] = {}
        visuals: Dict[int, KeyVisual] = {}
        sleeping = self._screensaver_is_active(now=time.monotonic())

        if sleeping:
            self._build_screensaver_layout(key_count=key_count, visuals=visuals)
        else:
            snapshot = self._get_snapshot()
            self._last_snapshot = snapshot
            if not snapshot.panel_locked and (self._unlock_pin_buffer or self._unlock_error_until > 0):
                self._unlock_pin_buffer = ""
                self._unlock_error_until = 0.0

            if snapshot.panel_locked:
                self._build_panel_locked_layout(snapshot, action_map, visuals)
            elif self._page == "scenes":
                self._build_scenes_layout(snapshot, action_map, visuals)
            else:
                self._build_levels_layout(snapshot, action_map, visuals)

            for key in range(key_count):
                if key not in visuals:
                    visuals[key] = KeyVisual(
                        title="",
                        icon="none",
                        bg_rgb=PALETTE["base_bg"],
                        fg_rgb=PALETTE["text_muted"],
                        accent_rgb=PALETTE["muted_bg"],
                        disabled=True,
                    )

            pressed_visual_keys = self._current_pressed_visual_keys()
            for key in pressed_visual_keys:
                visual = visuals.get(key)
                if visual is None or visual.disabled:
                    continue
                visuals[key] = replace(
                    visual,
                    bg_rgb=self._mix_rgb(visual.bg_rgb, (255, 255, 255), 0.20),
                    accent_rgb=(255, 255, 255),
                )

        with self._deck:
            for key in range(key_count):
                visual = visuals[key]
                if self._render_cache.get(key) == visual:
                    continue
                image = self._render_key_image(visual)
                self._deck.set_key_image(key, image)
                self._render_cache[key] = visual

        self._action_map = action_map

    def _build_screensaver_layout(
        self,
        *,
        key_count: int,
        visuals: Dict[int, KeyVisual],
    ) -> None:
        for key in range(key_count):
            visuals[key] = KeyVisual(
                title="",
                icon="none",
                bg_rgb=PALETTE["base_bg"],
                fg_rgb=PALETTE["text_muted"],
                accent_rgb=PALETTE["muted_bg"],
                disabled=True,
            )

        path = self._screensaver_path(key_count)
        if not path:
            return

        now = time.monotonic()
        head = self._screensaver_head(path_len=len(path), now=now)
        snake_len = max(1, min(SCREENSAVER_SNAKE_LENGTH, len(path)))

        for offset in range(snake_len):
            key = path[(head - offset) % len(path)]
            age = offset / max(1, snake_len - 1)
            if offset == 0:
                base = (255, 255, 255)
                accent = (255, 255, 255)
                mix = 0.86
            else:
                gray = int(round(240 - (age * 140)))
                gray = max(96, min(240, gray))
                base = (gray, gray, gray)
                accent = self._mix_rgb(base, (255, 255, 255), 0.22)
                mix = 0.74 - (age * 0.50)

            visuals[key] = KeyVisual(
                title="",
                icon="none",
                bg_rgb=self._mix_rgb(PALETTE["base_bg"], base, max(0.18, mix)),
                fg_rgb=(255, 255, 255),
                accent_rgb=accent,
                disabled=False,
            )

    def _screensaver_head(self, *, path_len: int, now: float) -> int:
        if path_len <= 0:
            return 0
        step_interval = 1.0 / max(0.5, float(SCREENSAVER_SNAKE_SPEED_CELLS_PER_SEC))
        with self._screensaver_lock:
            if self._screensaver_next_step_monotonic <= 0.0:
                self._screensaver_next_step_monotonic = now + step_interval
                return self._screensaver_head_index % path_len
            if now >= self._screensaver_next_step_monotonic:
                # Advance by exactly one cell per render tick to avoid visual jumps.
                self._screensaver_head_index = (self._screensaver_head_index + 1) % path_len
                self._screensaver_next_step_monotonic = now + step_interval
            return self._screensaver_head_index % path_len

    @staticmethod
    def _screensaver_path(key_count: int) -> list[int]:
        if key_count == 32:
            path: list[int] = []
            cols = 8
            rows = 4
            for row in range(rows):
                row_keys = [row * cols + col for col in range(cols)]
                if row % 2 == 1:
                    row_keys.reverse()
                path.extend(row_keys)
            # Smooth return leg on the left side before looping:
            # from bottom-left (24) -> 16 -> 8 -> (wrap to start 0).
            path.extend([16, 8])
            return path
        return list(range(key_count))

    def _screensaver_is_active(self, *, now: float) -> bool:
        with self._screensaver_lock:
            if self._screensaver_active:
                return True
            idle_seconds = float(self._screensaver_idle_seconds)
            if idle_seconds <= 0:
                return False
            if (now - self._last_user_activity_monotonic) < idle_seconds:
                return False
            self._screensaver_active = True
            self._screensaver_head_index = 0
            self._screensaver_next_step_monotonic = 0.0
            return True

    def _record_user_activity(self, *, now: Optional[float] = None) -> None:
        ts = time.monotonic() if now is None else float(now)
        with self._screensaver_lock:
            self._last_user_activity_monotonic = ts

    def _wake_from_screensaver_and_lock(self, key: int) -> bool:
        with self._screensaver_lock:
            if not self._screensaver_active:
                return False
            self._screensaver_active = False
            self._last_user_activity_monotonic = time.monotonic()
            self._screensaver_head_index = 0
            self._screensaver_next_step_monotonic = 0.0
        self._wake_consumed_releases.add(int(key))
        try:
            self._set_panel_lock(True)
        except Exception as exc:  # pragma: no cover - hardware/user interaction
            _log.warning("Failed to lock panel while waking Stream Deck: %s", exc)
        self.notify_state_changed()
        return True

    def _current_pressed_visual_keys(self) -> set[int]:
        now = time.monotonic()
        with self._press_state_lock:
            active = set(self._pressed_keys)
            active.update(
                key for key, deadline in self._pressed_until.items()
                if deadline > now
            )
            expired = [key for key, deadline in self._pressed_until.items() if deadline <= now]
            for key in expired:
                self._pressed_until.pop(key, None)
            return active

    def _set_pressed_state(self, key: int, is_down: bool) -> None:
        now = time.monotonic()
        with self._press_state_lock:
            if is_down:
                self._pressed_keys.add(key)
                self._pressed_until[key] = now + 0.14
            else:
                self._pressed_keys.discard(key)
                self._pressed_until[key] = now + 0.04
        self._schedule_press_visual_wake(0.16)

    def _schedule_press_visual_wake(self, delay_seconds: float) -> None:
        def wake() -> None:
            with self._press_timer_lock:
                self._press_timers = [t for t in self._press_timers if t is not timer]
            if self._stop_event.is_set():
                return
            self.notify_state_changed()

        timer = threading.Timer(max(0.01, float(delay_seconds)), wake)
        timer.daemon = True
        with self._press_timer_lock:
            self._press_timers.append(timer)
        timer.start()

    def _build_scenes_layout(
        self,
        snapshot: StreamDeckSnapshot,
        action_map: Dict[int, Action],
        visuals: Dict[int, KeyVisual],
    ) -> None:
        panel_mode = snapshot.control_mode == "panel"
        locked = (not panel_mode) or snapshot.panel_locked
        master_col = 7
        # Scenes area: columns 3+4 (zero-based 2+3), filled top->bottom per column.
        scene_columns = [2, 3]
        rows_per_column = 4
        scene_keys = [
            (row * 8) + col
            for col in scene_columns
            for row in range(rows_per_column)
        ]

        scenes = snapshot.scenes
        slots_per_page = len(scene_keys)
        # Prev/Next shift by one full scene column, but stop once the last
        # real scene column is visible (no paging into fully empty columns).
        total_scene_columns = max(1, (len(scenes) + rows_per_column - 1) // rows_per_column)
        visible_scene_columns = len(scene_columns)
        max_scene_pages = max(1, total_scene_columns - visible_scene_columns + 1)
        self._scene_page = max(0, min(self._scene_page, max_scene_pages - 1))
        scene_start = self._scene_page * rows_per_column
        page_scenes = scenes[scene_start : scene_start + slots_per_page]

        lock_disabled = not panel_mode
        lock_title = "Lock"
        lock_bg = (56, 14, 18)
        lock_accent = (255, 84, 84)
        visuals[0] = KeyVisual(
            title=lock_title,
            icon="lock",
            bg_rgb=lock_bg,
            accent_rgb=lock_accent,
            disabled=lock_disabled,
            text_y_offset=-6,
        )
        if panel_mode and not snapshot.panel_locked:
            action_map[0] = ("panel_lock", "true")

        visuals[8] = KeyVisual(
            title="Levels",
            icon="mode",
            bg_rgb=LEFT_RAIL_BG,
            accent_rgb=LEFT_RAIL_INACTIVE_ACCENT,
            disabled=locked,
            text_y_offset=-6,
        )
        if not locked:
            action_map[8] = ("toggle_page", None)
        visuals[16] = KeyVisual(
            title="Prev",
            icon="prev",
            bg_rgb=LEFT_RAIL_BG,
            accent_rgb=LEFT_RAIL_INACTIVE_ACCENT,
            disabled=self._scene_page == 0,
            text_y_offset=-6,
        )
        if self._scene_page > 0:
            action_map[16] = ("prev_scene_page", None)
        visuals[24] = KeyVisual(
            title="Next",
            icon="next",
            bg_rgb=LEFT_RAIL_BG,
            accent_rgb=LEFT_RAIL_INACTIVE_ACCENT,
            disabled=self._scene_page >= max_scene_pages - 1,
            text_y_offset=-6,
        )
        if self._scene_page < max_scene_pages - 1:
            action_map[24] = ("next_scene_page", None)

        fog_bg = (30, 8, 8) if snapshot.fog_flash_active else (12, 12, 12)
        visuals[5] = KeyVisual(
            title="Fog Flash",
            icon="fog",
            bg_rgb=fog_bg,
            accent_rgb=PALETTE["danger"],
            disabled=locked or (not snapshot.fog_flash_configured),
            text_y_offset=-6,
        )
        if not locked and snapshot.fog_flash_configured:
            action_map[5] = ("fog_flash_hold", None)
        visuals[13] = KeyVisual(
            title="Haze +",
            subtitle=f"{snapshot.haze_percent}%",
            icon="haze",
            bg_rgb=(12, 12, 12),
            accent_rgb=PALETTE["action"],
            disabled=locked or (not snapshot.haze_configured),
        )
        if not locked and snapshot.haze_configured:
            action_map[13] = ("haze_step", str(HAZE_STEP_PERCENT))
        visuals[21] = KeyVisual(
            title="Haze -",
            subtitle=f"{snapshot.haze_percent}%",
            icon="haze",
            bg_rgb=(12, 12, 12),
            accent_rgb=PALETTE["action"],
            disabled=locked or (not snapshot.haze_configured),
        )
        if not locked and snapshot.haze_configured:
            action_map[21] = ("haze_step", str(-HAZE_STEP_PERCENT))
        blind_bg = (38, 16, 16) if snapshot.blinder_flash_active else (12, 12, 12)
        visuals[29] = KeyVisual(
            title="Blind Flash",
            icon="full",
            bg_rgb=blind_bg,
            accent_rgb=PALETTE["warning"],
            disabled=locked or (not snapshot.blinder_flash_configured),
            text_y_offset=-6,
        )
        if not locked and snapshot.blinder_flash_configured:
            action_map[29] = ("blinder_flash_hold", None)

        # Right column = master fader controls (same position philosophy as levels page)
        master_col_bg = (14, 28, 36)
        master_icon = "mute" if snapshot.master_dimmer_percent <= 0 else "master"
        visuals[master_col] = KeyVisual(
            title="Master",
            subtitle=f"{snapshot.master_dimmer_percent}%",
            icon=master_icon,
            bg_rgb=master_col_bg,
            accent_rgb=(255, 255, 255),
            disabled=locked,
        )
        visuals[8 + master_col] = KeyVisual(
            title="10%",
            icon="up",
            bg_rgb=master_col_bg,
            accent_rgb=(255, 255, 255),
            disabled=locked,
            text_y_offset=-18,
        )
        visuals[16 + master_col] = KeyVisual(
            title="10%",
            icon="down",
            bg_rgb=master_col_bg,
            accent_rgb=(255, 255, 255),
            disabled=locked,
            title_near_top=True,
            text_y_offset=11,
            icon_below_text=True,
            icon_y_offset=5,
        )
        visuals[24 + master_col] = KeyVisual(
            title="Blackout",
            icon="blackout",
            bg_rgb=(109, 28, 35),
            accent_rgb=(180, 64, 74),
            text_y_offset=-6,
        )
        if not locked:
            action_map[master_col] = ("master_toggle_mute", None)
            action_map[8 + master_col] = ("master_step", "10")
            action_map[16 + master_col] = ("master_step", "-10")
        action_map[24 + master_col] = ("blackout", None)

        for slot, scene in enumerate(page_scenes):
            key = scene_keys[slot]
            is_active = scene.id == snapshot.active_scene_id
            is_dynamic = scene.scene_type == "dynamic"
            style_color_key = (scene.style_color or "").lower()
            style_bg = SCENE_STYLE_COLORS.get(style_color_key) if style_color_key != "default" else None
            scene_color = (
                style_bg
                if style_bg is not None
                else (PALETTE["scene_dynamic"] if is_dynamic else PALETTE["scene_static"])
            )
            bg_strength = 0.80 if is_active else 0.16
            bg = self._mix_rgb((0, 0, 0), scene_color, bg_strength)
            icon_name = (
                scene.style_icon
                if scene.style_icon and scene.style_icon != "none"
                else ("scene_dynamic" if is_dynamic else "scene_static")
            )
            visuals[key] = KeyVisual(
                title=self._limit_text(scene.name, 26),
                icon=icon_name,
                bg_rgb=bg,
                accent_rgb=(255, 255, 255) if is_active else self._mix_rgb(scene_color, (0, 0, 0), 0.40),
                text_y_offset=-6,
            )
            if not locked:
                action_map[key] = ("play_scene", scene.id)

    def _build_levels_layout(
        self,
        snapshot: StreamDeckSnapshot,
        action_map: Dict[int, Action],
        visuals: Dict[int, KeyVisual],
    ) -> None:
        group_columns = [2, 3, 4, 5]
        visible_group_count = len(group_columns)
        groups = sorted(
            snapshot.group_dimmers if snapshot.group_dimmer_available else [],
            key=self._group_sort_key,
        )
        groups = [group for group in groups if not self._is_blind_group(group)]
        # Sliding window: Prev/Next shifts by one group, not by a full page.
        max_group_pages = max(1, len(groups) - visible_group_count + 1)
        self._group_page = max(0, min(self._group_page, max_group_pages - 1))
        group_start = self._group_page
        page_groups = groups[group_start : group_start + visible_group_count]

        panel_mode = snapshot.control_mode == "panel"
        locked = (not panel_mode) or snapshot.panel_locked

        # Left rail: lock (top), page toggle (2nd row), pagination (3rd/4th rows)
        lock_disabled = not panel_mode
        lock_title = "Lock"
        lock_bg = (56, 14, 18)
        lock_accent = (255, 84, 84)
        visuals[0] = KeyVisual(
            title=lock_title,
            icon="lock",
            bg_rgb=lock_bg,
            accent_rgb=lock_accent,
            disabled=lock_disabled,
            text_y_offset=-6,
        )
        if panel_mode and not snapshot.panel_locked:
            action_map[0] = ("panel_lock", "true")
        visuals[8] = KeyVisual(
            title="Scenes",
            icon="mode",
            bg_rgb=LEFT_RAIL_BG,
            accent_rgb=LEFT_RAIL_INACTIVE_ACCENT,
            disabled=locked,
            text_y_offset=-6,
        )
        if not locked:
            action_map[8] = ("toggle_page", None)
        # Keep group pagination on the lower-left keys.
        visuals[16] = KeyVisual(
            title="Prev",
            icon="prev",
            bg_rgb=LEFT_RAIL_BG,
            accent_rgb=LEFT_RAIL_INACTIVE_ACCENT,
            disabled=self._group_page == 0,
            text_y_offset=-6,
        )
        if self._group_page > 0:
            action_map[16] = ("prev_group_page", None)
        visuals[24] = KeyVisual(
            title="Next",
            icon="next",
            bg_rgb=LEFT_RAIL_BG,
            accent_rgb=LEFT_RAIL_INACTIVE_ACCENT,
            disabled=self._group_page >= max_group_pages - 1,
            text_y_offset=-6,
        )
        if self._group_page < max_group_pages - 1:
            action_map[24] = ("next_group_page", None)

        # Right column = highlighted master fader column (col 6 kept as spacer)
        master_col = 7
        master_col_bg = (14, 28, 36)
        master_icon = "mute" if snapshot.master_dimmer_percent <= 0 else "master"
        visuals[master_col] = KeyVisual(
            title="Master",
            subtitle=f"{snapshot.master_dimmer_percent}%",
            icon=master_icon,
            bg_rgb=master_col_bg,
            accent_rgb=(255, 255, 255),
            disabled=locked,
        )
        visuals[8 + master_col] = KeyVisual(
            title="10%",
            icon="up",
            bg_rgb=master_col_bg,
            accent_rgb=(255, 255, 255),
            disabled=locked,
            text_y_offset=-18,
        )
        visuals[16 + master_col] = KeyVisual(
            title="10%",
            icon="down",
            bg_rgb=master_col_bg,
            accent_rgb=(255, 255, 255),
            disabled=locked,
            title_near_top=True,
            text_y_offset=11,
            icon_below_text=True,
            icon_y_offset=5,
        )
        visuals[24 + master_col] = KeyVisual(
            title="Blackout",
            icon="blackout",
            bg_rgb=(109, 28, 35),
            accent_rgb=(180, 64, 74),
            text_y_offset=-6,
        )
        if not locked:
            action_map[master_col] = ("master_toggle_mute", None)
            action_map[8 + master_col] = ("master_step", "10")
            action_map[16 + master_col] = ("master_step", "-10")
        action_map[24 + master_col] = ("blackout", None)

        # Group columns 2..5 (column 1 is kept as spacer)
        for group_index, col in enumerate(group_columns):
            top_key = col
            brighter_key = 8 + col
            dimmer_key = 16 + col
            full_key = 24 + col

            if group_index >= len(page_groups):
                continue

            group = page_groups[group_index]
            absolute_group_index = group_start + group_index
            bank_bg = self._levels_bank_gradient_gray(absolute_group_index, len(groups))
            bank_accent = (255, 255, 255)
            muted_text = "MUTED" if group.muted else f"{group.value_percent}%"
            visuals[top_key] = KeyVisual(
                title=self._limit_text(group.name, 15),
                subtitle=muted_text,
                icon="mute" if group.muted else "group",
                bg_rgb=bank_bg,
                accent_rgb=PALETTE["group_muted"] if group.muted else bank_accent,
                disabled=locked,
                muted=group.muted,
            )
            visuals[brighter_key] = KeyVisual(
                title="10%",
                icon="up",
                bg_rgb=bank_bg,
                accent_rgb=bank_accent,
                disabled=locked,
                text_y_offset=-18,
            )
            visuals[dimmer_key] = KeyVisual(
                title="10%",
                icon="down",
                bg_rgb=bank_bg,
                accent_rgb=bank_accent,
                disabled=locked,
                title_near_top=True,
                text_y_offset=11,
                icon_below_text=True,
                icon_y_offset=5,
            )
            visuals[full_key] = KeyVisual(
                title="Flash",
                icon="full",
                bg_rgb=bank_bg,
                accent_rgb=bank_accent,
                disabled=locked,
                text_y_offset=-6,
            )

            if locked:
                continue
            action_map[top_key] = ("group_toggle_mute", group.key)
            action_map[brighter_key] = ("group_step", f"{group.key}|10")
            action_map[dimmer_key] = ("group_step", f"{group.key}|-10")
            action_map[full_key] = ("group_flash_hold", group.key)

    def _build_panel_locked_layout(
        self,
        snapshot: StreamDeckSnapshot,
        action_map: Dict[int, Action],
        visuals: Dict[int, KeyVisual],
    ) -> None:
        del snapshot
        now = time.monotonic()
        masked = "*" * min(4, len(self._unlock_pin_buffer))
        status_subtitle = masked if masked else "----"
        error_active = now < self._unlock_error_until

        # Lockscreen content is constrained to columns 3..6 (zero-based cols 2..5).
        locked_bg = (56, 14, 18)
        neutral_bg = (18, 18, 18)
        keypad_bg = (22, 22, 22)
        accent_dim = (190, 190, 190)

        # Left-most lockscreen column (inside col 3) for context/status.
        # Keep only two status tiles and move them one row down.
        visuals[10] = KeyVisual(
            title="Locked",
            icon="lock",
            bg_rgb=locked_bg,
            accent_rgb=(255, 84, 84),
            text_y_offset=-6,
        )
        visuals[18] = KeyVisual(
            title="PIN",
            subtitle="Wrong PIN" if error_active else status_subtitle,
            icon="none",
            bg_rgb=(40, 10, 14) if error_active else neutral_bg,
            accent_rgb=(255, 90, 100) if error_active else (255, 255, 255),
            text_y_offset=-10,
            subtitle_y_offset=-10,
        )

        # Match the PC lockscreen keypad layout exactly:
        # 1 2 3
        # 4 5 6
        # 7 8 9
        # Clear 0 OK
        digit_keys = {
            3: "1", 4: "2", 5: "3",
            11: "4", 12: "5", 13: "6",
            19: "7", 20: "8", 21: "9",
            28: "0",
        }
        for key, digit in digit_keys.items():
            visuals[key] = KeyVisual(
                title=digit,
                icon="none",
                bg_rgb=keypad_bg,
                accent_rgb=(255, 255, 255),
            )
            action_map[key] = ("pin_digit", digit)

        visuals[27] = KeyVisual(
            title="Clear",
            icon="none",
            bg_rgb=(24, 16, 16),
            accent_rgb=(220, 220, 220),
        )
        action_map[27] = ("pin_clear", None)

        visuals[29] = KeyVisual(
            title="OK",
            icon="none",
            bg_rgb=(20, 74, 30),
            accent_rgb=(120, 255, 140),
        )
        action_map[29] = ("pin_submit", None)

    @staticmethod
    def _group_sort_key(group: StreamDeckGroupDimmer) -> tuple[int, str]:
        name = (group.name or "").strip().lower()
        for rank, aliases in GROUP_DISPLAY_ORDER_HINTS:
            for alias in aliases:
                if alias in name:
                    return (rank, name)
        return (999, name)

    @staticmethod
    def _is_blind_group(group: StreamDeckGroupDimmer) -> bool:
        return "blind" in (group.name or "").strip().lower()

    @staticmethod
    def _levels_bank_gradient_gray(bank_index: int, total_banks: int) -> tuple[int, int, int]:
        # One continuous gradient over the full bank range: dark -> light -> dark.
        if total_banks <= 1:
            v = LEVELS_BANK_DARK_GRAY
            return (v, v, v)

        clamped_index = max(0, min(int(bank_index), total_banks - 1))
        t = clamped_index / float(total_banks - 1)  # 0..1
        edge_weight = abs(t - 0.5) * 2.0            # 1 at edges, 0 at center
        gray = int(round(
            LEVELS_BANK_DARK_GRAY
            + (LEVELS_BANK_LIGHT_GRAY - LEVELS_BANK_DARK_GRAY) * (1.0 - edge_weight)
        ))
        gray = max(0, min(255, gray))
        return (gray, gray, gray)

    def _render_key_image(self, visual: KeyVisual):
        if self._deck is None or PILHelper is None or Image is None or ImageDraw is None or ImageFont is None:
            return None
        image = PILHelper.create_image(self._deck, background=PALETTE["base_bg"])
        draw = ImageDraw.Draw(image)
        font_title = self._get_font("title")
        font_subtitle = self._get_font("subtitle")
        font_footer = self._get_font("footer")

        width, height = image.size
        is_separator_gap = (
            visual.disabled
            and not visual.title
            and not visual.subtitle
            and not visual.footer
            and visual.icon in {"", "none"}
        )
        if is_separator_gap:
            draw.rectangle((0, 0, width, height), fill=PALETTE["base_bg"])
            return PILHelper.to_native_format(self._deck, image)

        card = (3, 3, width - 4, height - 4)
        border_color = self._mix_rgb(visual.accent_rgb, (255, 255, 255), 0.45)
        fill_color = visual.bg_rgb if not visual.disabled else self._mix_rgb(visual.bg_rgb, PALETTE["base_bg"], 0.52)
        draw.rounded_rectangle(card, radius=12, fill=fill_color)

        draw.rounded_rectangle(card, radius=12, outline=border_color, width=2)
        inner_border = (
            self._mix_rgb(visual.accent_rgb, (255, 255, 255), 0.18)
            if not visual.disabled
            else self._mix_rgb(PALETTE["disabled"], PALETTE["text_muted"], 0.25)
        )
        draw.rounded_rectangle((5, 5, width - 6, height - 6), radius=10, outline=inner_border, width=1)
        if visual.muted and not visual.disabled:
            mute_red = (255, 36, 68)
            # Heavy red border + big strike-through for immediate mute visibility.
            draw.rounded_rectangle((4, 4, width - 5, height - 5), radius=11, outline=mute_red, width=4)
            draw.line((8, 10, width - 9, height - 11), fill=mute_red, width=8)
            draw.line((6, 8, width - 11, height - 13), fill=(255, 140, 156), width=3)

        icon_y_offset = int(visual.icon_y_offset)
        if visual.icon_below_text:
            icon_box = (width // 2 - 20, 36 + icon_y_offset, width // 2 + 20, 76 + icon_y_offset)
        else:
            icon_box = (width // 2 - 20, 16 + icon_y_offset, width // 2 + 20, 56 + icon_y_offset)
        icon_color = (
            (255, 255, 255)
            if not visual.disabled
            else self._mix_rgb(PALETTE["text_muted"], PALETTE["disabled"], 0.45)
        )

        title = self._limit_text(visual.title, 18)
        subtitle = self._limit_text(visual.subtitle, 18)
        footer = self._limit_text(visual.footer, 18)
        fg_rgb = visual.fg_rgb if not visual.disabled else self._mix_rgb(visual.fg_rgb, PALETTE["disabled"], 0.58)
        title_fg = (255, 255, 255)
        shadow = (5, 8, 18)
        title_y_offset = int(visual.text_y_offset)
        subtitle_y_offset = int(visual.subtitle_y_offset)

        title_only = bool(title) and not subtitle and not footer and visual.icon in {"", "none"}
        icon_title_only = bool(title) and not subtitle and not footer and visual.icon not in {"", "none"}
        is_keypad_digit = (
            bool(title_only)
            and len(title.strip()) == 1
            and title.strip().isdigit()
        )
        if is_keypad_digit:
            font_digit = self._get_font("keypad_digit")
            self._draw_text_centered(
                draw,
                width // 2,
                (height // 2) + title_y_offset,
                title.strip(),
                font_digit,
                title_fg,
                shadow,
            )
        elif title_only:
            font_scene = self._get_font("scene_title")
            title_lines = self._split_lines(title, max_chars=10, max_lines=3)
            y_positions = [53 + title_y_offset, 64 + title_y_offset, 75 + title_y_offset]
            start = max(0, (len(y_positions) - len(title_lines)) // 2)
            for idx, line in enumerate(title_lines):
                self._draw_text_centered(
                    draw,
                    width // 2,
                    y_positions[start + idx],
                    line.upper(),
                    font_scene,
                    title_fg,
                    shadow,
                )
        else:
            if visual.icon not in {"", "none"}:
                self._draw_icon(draw, image, visual.icon, icon_box, icon_color)
            title_lines = self._split_lines(title, max_chars=11, max_lines=2)
            if title_lines:
                if icon_title_only and len(title_lines) == 1 and visual.title_near_top:
                    self._draw_text_centered(draw, width // 2, 24 + title_y_offset, title_lines[0], font_title, title_fg, shadow)
                elif icon_title_only and len(title_lines) == 1:
                    self._draw_text_centered(draw, width // 2, 79 + title_y_offset, title_lines[0], font_title, title_fg, shadow)
                elif icon_title_only and len(title_lines) > 1:
                    self._draw_text_centered(draw, width // 2, 72 + title_y_offset, title_lines[0], font_title, title_fg, shadow)
                    self._draw_text_centered(draw, width // 2, 86 + title_y_offset, title_lines[1], font_title, title_fg, shadow)
                elif len(title_lines) == 1:
                    self._draw_text_centered(draw, width // 2, 56 + title_y_offset, title_lines[0], font_title, title_fg, shadow)
                else:
                    self._draw_text_centered(draw, width // 2, 51 + title_y_offset, title_lines[0], font_title, title_fg, shadow)
                    self._draw_text_centered(draw, width // 2, 63 + title_y_offset, title_lines[1], font_title, title_fg, shadow)

            if subtitle:
                self._draw_text_centered(
                    draw,
                    width // 2,
                    76 + subtitle_y_offset,
                    subtitle.upper(),
                    font_subtitle,
                    self._mix_rgb(fg_rgb, (255, 255, 255), 0.08),
                    shadow,
                )
            if footer:
                self._draw_text_centered(
                    draw,
                    width // 2,
                    92,
                    footer,
                    font_footer,
                    self._mix_rgb(PALETTE["text_muted"], fg_rgb, 0.42),
                    shadow,
                )

        return PILHelper.to_native_format(self._deck, image)

    def _get_font(self, role: str):
        cached = self._font_cache.get(role)
        if cached is not None:
            return cached

        if ImageFont is None:
            return None

        size_map = {
            "title": 15,
            "scene_title": 17,
            "keypad_digit": 30,
            "subtitle": 11,
            "footer": 10,
        }
        size = size_map.get(role, 11)
        candidates = [
            Path("C:/Windows/Fonts/segoeuib.ttf"),  # Segoe UI Bold
            Path("C:/Windows/Fonts/arialbd.ttf"),
            Path("C:/Windows/Fonts/segoeui.ttf"),
            Path("C:/Windows/Fonts/arial.ttf"),
        ]
        for font_path in candidates:
            if not font_path.exists():
                continue
            try:
                font = ImageFont.truetype(str(font_path), size=size)
                self._font_cache[role] = font
                return font
            except Exception:
                continue

        fallback = ImageFont.load_default()
        self._font_cache[role] = fallback
        return fallback

    @staticmethod
    def _limit_text(value: str, max_len: int) -> str:
        cleaned = " ".join(value.split())
        if len(cleaned) <= max_len:
            return cleaned
        return f"{cleaned[: max_len - 3]}..."

    @staticmethod
    def _mix_rgb(a: tuple[int, int, int], b: tuple[int, int, int], ratio: float) -> tuple[int, int, int]:
        clamped = max(0.0, min(1.0, float(ratio)))
        return (
            int(round(a[0] * (1.0 - clamped) + b[0] * clamped)),
            int(round(a[1] * (1.0 - clamped) + b[1] * clamped)),
            int(round(a[2] * (1.0 - clamped) + b[2] * clamped)),
        )

    @staticmethod
    def _draw_text_centered(draw, x: int, y: int, text: str, font, fill: tuple[int, int, int], shadow: tuple[int, int, int]) -> None:
        draw.text((x + 1, y + 1), text, font=font, fill=shadow, anchor="mm")
        draw.text((x, y), text, font=font, fill=fill, anchor="mm")

    @staticmethod
    def _split_lines(text: str, max_chars: int, max_lines: int) -> list[str]:
        if not text:
            return []
        words = text.split()
        if not words:
            return [text]

        lines: list[str] = []
        current = words[0]
        for word in words[1:]:
            candidate = f"{current} {word}"
            if len(candidate) <= max_chars:
                current = candidate
                continue
            lines.append(current)
            current = word
            if len(lines) >= max_lines - 1:
                break
        if len(lines) < max_lines:
            lines.append(current)

        result = lines[:max_lines]
        if len(result) == max_lines and " ".join(words) != " ".join(result):
            result[-1] = StreamDeckService._limit_text(result[-1], max_chars)
        return result

    def _draw_icon(
        self,
        draw,
        image,
        icon_name: str,
        box: tuple[int, int, int, int],
        color: tuple[int, int, int],
    ) -> None:
        if not icon_name or icon_name == "none":
            return

        icon_image = self._load_icon_image(icon_name, box[2] - box[0])
        if icon_image is not None:
            image.paste(icon_image, box[:2], icon_image)
            return

        # Placeholder vector-like icon set. Replace by dropping PNG files into:
        # backend/assets/streamdeck/icons/<icon_name>.png
        x0, y0, x1, y1 = box
        cx = (x0 + x1) // 2
        cy = (y0 + y1) // 2
        w = x1 - x0
        h = y1 - y0

        if icon_name in {"prev", "back"}:
            draw.polygon([(x0 + 6, cy), (x1 - 6, y0 + 6), (x1 - 6, y1 - 6)], fill=color)
        elif icon_name == "next":
            draw.polygon([(x1 - 6, cy), (x0 + 6, y0 + 6), (x0 + 6, y1 - 6)], fill=color)
        elif icon_name in {"up", "brighter"}:
            draw.polygon([(cx, y0 + 4), (x1 - 6, y1 - 6), (x0 + 6, y1 - 6)], fill=color)
        elif icon_name in {"down", "dimmer"}:
            draw.polygon([(x0 + 6, y0 + 6), (x1 - 6, y0 + 6), (cx, y1 - 4)], fill=color)
        elif icon_name == "stop":
            draw.rectangle((x0 + 7, y0 + 7, x1 - 7, y1 - 7), fill=color)
        elif icon_name == "blackout":
            draw.ellipse((x0 + 5, y0 + 5, x1 - 5, y1 - 5), outline=color, width=3)
            draw.line((x0 + 8, y0 + 8, x1 - 8, y1 - 8), fill=color, width=3)
            draw.line((x1 - 8, y0 + 8, x0 + 8, y1 - 8), fill=color, width=3)
        elif icon_name in {"full", "scene_static"}:
            draw.rectangle((x0 + 6, y0 + 6, x1 - 6, y1 - 6), outline=color, width=3)
            draw.rectangle((x0 + 11, y0 + 11, x1 - 11, y1 - 11), fill=color)
        elif icon_name == "scene_dynamic":
            draw.arc((x0 + 4, y0 + 4, x1 - 4, y1 - 4), start=30, end=320, fill=color, width=3)
            draw.polygon([(x1 - 8, cy), (x1 - 15, cy - 6), (x1 - 15, cy + 6)], fill=color)
        elif icon_name in {"group", "groups"}:
            draw.ellipse((x0 + 6, y0 + 8, x0 + 18, y0 + 20), fill=color)
            draw.ellipse((x1 - 18, y0 + 8, x1 - 6, y0 + 20), fill=color)
            draw.rectangle((x0 + 8, y1 - 16, x1 - 8, y1 - 8), fill=color)
        elif icon_name == "mute":
            draw.rectangle((x0 + 6, y0 + 10, x0 + 16, y1 - 10), fill=color)
            draw.polygon([(x0 + 16, cy - 8), (x1 - 6, y0 + 8), (x1 - 6, y1 - 8), (x0 + 16, cy + 8)], fill=color)
            draw.line((x0 + 5, y0 + 5, x1 - 5, y1 - 5), fill=(255, 120, 120), width=4)
        elif icon_name == "lock":
            draw.rounded_rectangle((x0 + 9, y0 + 16, x1 - 9, y1 - 8), radius=5, outline=color, width=3)
            draw.arc((x0 + 12, y0 + 4, x1 - 12, y0 + 24), start=180, end=360, fill=color, width=3)
        elif icon_name == "master":
            draw.rectangle((x0 + 8, y0 + 6, x1 - 8, y1 - 12), outline=color, width=3)
            draw.rectangle((x0 + 14, y1 - 12, x1 - 14, y1 - 6), fill=color)
        elif icon_name == "levels":
            bar_w = max(4, w // 7)
            draw.rectangle((x0 + 4, y1 - 10, x0 + 4 + bar_w, y1 - 4), fill=color)
            draw.rectangle((cx - bar_w // 2, y1 - 16, cx + bar_w // 2, y1 - 4), fill=color)
            draw.rectangle((x1 - 4 - bar_w, y1 - 24, x1 - 4, y1 - 4), fill=color)
        elif icon_name == "mode":
            draw.ellipse((x0 + 5, y0 + 5, x1 - 5, y1 - 5), outline=color, width=3)
            draw.ellipse((x0 + 14, y0 + 14, x1 - 14, y1 - 14), fill=color)
        elif icon_name == "active":
            draw.ellipse((x0 + 8, y0 + 8, x1 - 8, y1 - 8), outline=color, width=3)
            draw.ellipse((cx - 4, cy - 4, cx + 4, cy + 4), fill=color)
        elif icon_name == "scenes":
            cell = max(6, w // 4)
            for r in range(2):
                for c in range(2):
                    left = x0 + 6 + c * (cell + 4)
                    top = y0 + 6 + r * (cell + 4)
                    draw.rectangle((left, top, left + cell, top + cell), outline=color, width=2)
        elif icon_name == "status":
            draw.ellipse((x0 + 10, y0 + 10, x1 - 10, y1 - 10), fill=color)
        elif icon_name == "speaker":
            draw.ellipse((cx - 4, y0 + 7, cx + 4, y0 + 15), fill=color)
            draw.rectangle((cx - 3, y0 + 15, cx + 3, y1 - 10), fill=color)
            draw.line((cx - 8, y1 - 9, cx + 8, y1 - 9), fill=color, width=2)
        elif icon_name == "party":
            draw.line((cx, y0 + 6, cx, y1 - 6), fill=color, width=2)
            draw.line((x0 + 6, cy, x1 - 6, cy), fill=color, width=2)
            draw.line((x0 + 10, y0 + 10, x1 - 10, y1 - 10), fill=color, width=2)
            draw.line((x1 - 10, y0 + 10, x0 + 10, y1 - 10), fill=color, width=2)
        elif icon_name == "chill":
            draw.ellipse((x0 + 10, y0 + 7, x1 - 8, y1 - 9), fill=color)
            draw.ellipse((x0 + 15, y0 + 7, x1 - 3, y1 - 9), fill=(0, 0, 0))
        elif icon_name == "dinner":
            points = [
                (cx, y0 + 5),
                (cx + 4, cy - 2),
                (x1 - 6, cy - 2),
                (cx + 6, cy + 3),
                (cx + 10, y1 - 7),
                (cx, cy + 7),
                (cx - 10, y1 - 7),
                (cx - 6, cy + 3),
                (x0 + 6, cy - 2),
                (cx - 4, cy - 2),
            ]
            draw.polygon(points, fill=color)
        elif icon_name == "ceremony":
            draw.polygon([(cx, y1 - 8), (x0 + 7, cy - 1), (x0 + 10, y0 + 10), (cx, y0 + 16)], fill=color)
            draw.polygon([(cx, y1 - 8), (x1 - 7, cy - 1), (x1 - 10, y0 + 10), (cx, y0 + 16)], fill=color)
        elif icon_name == "show":
            draw.rounded_rectangle((x0 + 7, y0 + 10, x1 - 7, y1 - 10), radius=5, outline=color, width=2)
            draw.ellipse((x0 + 12, cy - 2, x0 + 16, cy + 2), fill=color)
            draw.ellipse((x1 - 16, cy - 2, x1 - 12, cy + 2), fill=color)
            draw.arc((cx - 8, cy - 2, cx + 8, cy + 8), start=200, end=340, fill=color, width=2)
        elif icon_name == "technical":
            draw.rectangle((cx - 2, y0 + 6, cx + 2, y1 - 10), fill=color)
            draw.polygon([(cx - 8, y0 + 9), (cx - 2, y0 + 5), (cx + 2, y0 + 5), (cx + 8, y0 + 9), (cx + 3, y0 + 13), (cx - 3, y0 + 13)], fill=color)
            draw.rectangle((cx - 1, y1 - 10, cx + 1, y1 - 5), fill=color)
        elif icon_name == "placeholder":
            draw.rounded_rectangle((x0 + 7, y0 + 7, x1 - 7, y1 - 7), radius=6, outline=color, width=2)
            draw.line((x0 + 10, y0 + 10, x1 - 10, y1 - 10), fill=color, width=2)
            draw.line((x1 - 10, y0 + 10, x0 + 10, y1 - 10), fill=color, width=2)
        elif icon_name == "fog":
            draw.ellipse((x0 + 10, y0 + 14, x0 + 22, y0 + 26), fill=color)
            draw.ellipse((x0 + 16, y0 + 8, x0 + 30, y0 + 22), fill=color)
            draw.ellipse((x0 + 24, y0 + 12, x1 - 8, y0 + 24), fill=color)
            draw.line((x0 + 8, y1 - 10, x1 - 8, y1 - 10), fill=color, width=2)
        elif icon_name == "haze":
            draw.arc((x0 + 6, y0 + 8, x1 - 6, y0 + 24), start=180, end=360, fill=color, width=3)
            draw.arc((x0 + 8, y0 + 16, x1 - 8, y1 - 6), start=180, end=360, fill=color, width=3)
            draw.line((cx, y0 + 5, cx, y1 - 6), fill=color, width=2)
        else:
            draw.rectangle((x0 + 8, y0 + 8, x1 - 8, y1 - 8), outline=color, width=2)

    def _load_icon_image(self, icon_name: str, target_size: int):
        if Image is None:
            return None
        key = (icon_name, target_size)
        if key in self._icon_cache:
            return self._icon_cache[key]

        icon_path = self._icons_dir / f"{icon_name}.png"
        if not icon_path.exists():
            self._icon_cache[key] = None
            return None

        try:
            icon = Image.open(icon_path).convert("RGBA")
            icon.thumbnail((target_size, target_size))
            if icon.size != (target_size, target_size):
                canvas = Image.new("RGBA", (target_size, target_size), (0, 0, 0, 0))
                x = (target_size - icon.size[0]) // 2
                y = (target_size - icon.size[1]) // 2
                canvas.paste(icon, (x, y), icon)
                icon = canvas
            self._icon_cache[key] = icon
            return icon
        except Exception as exc:
            _log.warning("Failed to load Stream Deck icon '%s': %s", icon_name, exc)
            self._icon_cache[key] = None
            return None

    def _on_key_change(self, _deck, key: int, state: bool) -> None:
        if not state and key in self._wake_consumed_releases:
            self._wake_consumed_releases.discard(key)
            self.notify_state_changed()
            return
        if state and self._wake_from_screensaver_and_lock(key):
            return
        self._record_user_activity()
        # Track press/release for all keys so visual press feedback does not get stuck
        # when action maps change mid-press (e.g. page switch on key-down).
        self._set_pressed_state(key, state)
        action = self._action_map.get(key)
        if action is None:
            self.notify_state_changed()
            return
        action_name, _payload = action
        if action_name in {"fog_flash_hold", "group_flash_hold", "blinder_flash_hold"}:
            self._execute_action(action, key_down=state)
            return
        if not state:
            self.notify_state_changed()
            return
        self._execute_action(action, key_down=True)

    def _execute_action(self, action: Action, *, key_down: bool = True) -> None:
        action_name, payload = action
        try:
            if action_name == "switch_page":
                if payload == "levels":
                    self._page = "levels"
                else:
                    self._page = "scenes"
            elif action_name == "toggle_page":
                self._page = "levels" if self._page == "scenes" else "scenes"
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
            elif action_name == "panel_lock":
                target = str(payload).strip().lower() in {"1", "true", "yes", "on"}
                self._set_panel_lock(target)
            elif action_name == "pin_digit" and payload:
                if len(self._unlock_pin_buffer) < 4:
                    self._unlock_pin_buffer += str(payload)[:1]
            elif action_name == "pin_clear":
                self._unlock_pin_buffer = ""
            elif action_name == "pin_submit":
                if len(self._unlock_pin_buffer) != 4:
                    self._unlock_error_until = time.monotonic() + 1.1
                else:
                    success = bool(self._unlock_panel(self._unlock_pin_buffer))
                    self._unlock_pin_buffer = ""
                    if not success:
                        self._unlock_error_until = time.monotonic() + 1.5
            elif action_name == "master_step" and payload:
                snapshot = self._last_snapshot or self._get_snapshot()
                target = max(0, min(100, snapshot.master_dimmer_percent + int(payload)))
                if target > 0:
                    self._master_unmute_percent = target
                self._set_master_dimmer(target)
            elif action_name == "master_set" and payload:
                target = max(0, min(100, int(payload)))
                if target > 0:
                    self._master_unmute_percent = target
                self._set_master_dimmer(target)
            elif action_name == "master_toggle_mute":
                snapshot = self._last_snapshot or self._get_snapshot()
                current = max(0, min(100, int(snapshot.master_dimmer_percent)))
                if current > 0:
                    self._master_unmute_percent = current
                    self._set_master_dimmer(0)
                else:
                    target = max(1, min(100, int(self._master_unmute_percent or 100)))
                    self._set_master_dimmer(target)
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
            elif action_name == "group_flash_hold" and payload:
                self._set_group_flash_active(payload, bool(key_down))
            elif action_name == "haze_step" and payload:
                snapshot = self._last_snapshot or self._get_snapshot()
                target = max(0, min(100, snapshot.haze_percent + int(payload)))
                self._set_haze(target)
            elif action_name == "fog_flash_hold":
                self._set_fog_flash_active(bool(key_down))
            elif action_name == "blinder_flash_hold":
                self._set_blinder_flash_active(bool(key_down))
        except Exception as exc:  # pragma: no cover - hardware/user interaction
            _log.warning("Stream Deck action '%s' failed: %s", action_name, exc)
        finally:
            self.notify_state_changed()

