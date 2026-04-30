import socket
import subprocess
import sys
import re
from typing import List, Optional, TypedDict

try:
    import psutil
except ImportError:  # pragma: no cover
    psutil = None


class NetworkAdapterInfo(TypedDict):
    id: str
    name: str
    local_ip: str


def _is_candidate_ipv4(address: str) -> bool:
    if not address:
        return False
    if address == "0.0.0.0":
        return False
    if address.startswith("127."):
        return False
    parts = address.split(".")
    if len(parts) != 4:
        return False
    return all(part.isdigit() and 0 <= int(part) <= 255 for part in parts)


def _select_preferred_ipv4(ip_addresses: List[str]) -> Optional[str]:
    if not ip_addresses:
        return None

    # Prefer non-link-local addresses; fallback to link-local if needed.
    def _score(ip: str) -> tuple[int, str]:
        is_link_local = ip.startswith("169.254.")
        return (0 if is_link_local else 1, ip)

    return max(ip_addresses, key=_score)


def _list_windows_adapter_names() -> List[str]:
    if not sys.platform.startswith("win"):
        return []
    try:
        result = subprocess.run(
            ["netsh", "interface", "show", "interface"],
            capture_output=True,
            text=True,
            check=False,
            encoding="utf-8",
            errors="ignore",
        )
    except OSError:
        return []

    if result.returncode != 0:
        return []

    names: List[str] = []
    in_table = False
    for raw_line in result.stdout.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            continue
        if line.startswith("---"):
            in_table = True
            continue
        if not in_table:
            continue

        parts = [part.strip() for part in line.split("  ") if part.strip()]
        if len(parts) < 4:
            continue
        names.append(parts[-1])
    return names


def _collect_interface_ipv4_by_name() -> dict[str, str]:
    by_name: dict[str, str] = {}
    if psutil is not None:
        interface_addrs = psutil.net_if_addrs()
        for name, addresses in interface_addrs.items():
            ipv4_candidates: List[str] = []
            for addr in addresses:
                if addr.family != socket.AF_INET:
                    continue
                ip = addr.address.strip()
                if not _is_candidate_ipv4(ip):
                    continue
                ipv4_candidates.append(ip)
            selected_ip = _select_preferred_ipv4(ipv4_candidates)
            if selected_ip is not None:
                by_name[name] = selected_ip

    # Fallback / supplement on Windows: parse IPs from netsh.
    if sys.platform.startswith("win"):
        for name, ip in _collect_windows_ipv4_from_netsh().items():
            # Keep psutil result if present; otherwise use netsh value.
            by_name.setdefault(name, ip)
    return by_name


def _collect_windows_ipv4_from_netsh() -> dict[str, str]:
    try:
        result = subprocess.run(
            ["netsh", "interface", "ipv4", "show", "addresses"],
            capture_output=True,
            text=True,
            check=False,
            encoding="utf-8",
            errors="ignore",
        )
    except OSError:
        return {}

    if result.returncode != 0:
        return {}

    current_name: Optional[str] = None
    current_candidates: List[str] = []
    by_name_candidates: dict[str, List[str]] = {}
    ipv4_pattern = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")

    def _flush_current() -> None:
        nonlocal current_name, current_candidates
        if current_name and current_candidates:
            by_name_candidates.setdefault(current_name, []).extend(current_candidates)
        current_name = None
        current_candidates = []

    for raw_line in result.stdout.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        # Handles lines like: Configuration for interface "Wi-Fi"
        if '"' in line:
            quoted = re.findall(r'"([^"]+)"', line)
            if quoted:
                _flush_current()
                current_name = quoted[-1].strip()
                continue

        if current_name is None:
            continue

        lower = line.lower()
        if "gateway" in lower or "subnet" in lower:
            continue

        for match in ipv4_pattern.findall(line):
            if _is_candidate_ipv4(match):
                current_candidates.append(match)

    _flush_current()

    by_name: dict[str, str] = {}
    for name, candidates in by_name_candidates.items():
        selected_ip = _select_preferred_ipv4(candidates)
        if selected_ip is not None:
            by_name[name] = selected_ip
    return by_name


def list_network_adapters() -> List[NetworkAdapterInfo]:
    if psutil is None and not sys.platform.startswith("win"):
        return _fallback_adapters()

    interface_ipv4_by_name = _collect_interface_ipv4_by_name()
    names: set[str] = set(interface_ipv4_by_name.keys())
    names.update(_list_windows_adapter_names())

    adapters: List[NetworkAdapterInfo] = [
        {
            "id": name,
            "name": name,
            "local_ip": interface_ipv4_by_name.get(name, ""),
        }
        for name in names
    ]

    if not adapters:
        for name, ip in interface_ipv4_by_name.items():
            adapters.append(
                {
                    "id": name,
                    "name": name,
                    "local_ip": ip,
                }
            )

    if not adapters:
        adapters = _fallback_adapters()

    adapters.sort(key=lambda item: (item["name"].casefold(), item["local_ip"]))
    return adapters


def _has_usable_ipv4(adapter: NetworkAdapterInfo) -> bool:
    return bool(adapter.get("local_ip", "").strip())


def resolve_adapter(adapter_id: Optional[str]) -> tuple[Optional[NetworkAdapterInfo], List[NetworkAdapterInfo]]:
    adapters = list_network_adapters()
    if not adapters:
        return None, []

    if adapter_id:
        wanted = adapter_id.strip()
        for adapter in adapters:
            if adapter["id"] == wanted:
                if _has_usable_ipv4(adapter):
                    return adapter, adapters
                # Adapter exists but has no usable IPv4.
                return None, adapters

    for adapter in adapters:
        if _has_usable_ipv4(adapter):
            return adapter, adapters

    return None, adapters


def _fallback_adapters() -> List[NetworkAdapterInfo]:
    try:
        host_ips = socket.gethostbyname_ex(socket.gethostname())[2]
    except OSError:
        host_ips = []

    for ip in host_ips:
        if _is_candidate_ipv4(ip):
            return [{"id": "auto", "name": "Auto", "local_ip": ip}]
    return []
