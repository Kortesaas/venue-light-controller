import socket
from typing import List, Optional, TypedDict

try:
    import psutil
except ImportError:  # pragma: no cover
    psutil = None


class NetworkAdapterInfo(TypedDict):
    id: str
    name: str
    local_ip: str


def _is_usable_ipv4(address: str) -> bool:
    if not address or address == "0.0.0.0":
        return False
    if address.startswith("127."):
        return False
    if address.startswith("169.254."):
        return False
    parts = address.split(".")
    if len(parts) != 4:
        return False
    return all(part.isdigit() and 0 <= int(part) <= 255 for part in parts)


def list_network_adapters() -> List[NetworkAdapterInfo]:
    if psutil is None:
        return _fallback_adapters()

    adapters: List[NetworkAdapterInfo] = []
    interface_stats = psutil.net_if_stats()
    interface_addrs = psutil.net_if_addrs()

    for name, addresses in interface_addrs.items():
        stats = interface_stats.get(name)
        if stats is not None and not stats.isup:
            continue

        for addr in addresses:
            if addr.family != socket.AF_INET:
                continue
            ip = addr.address.strip()
            if not _is_usable_ipv4(ip):
                continue
            adapters.append(
                {
                    "id": name,
                    "name": name,
                    "local_ip": ip,
                }
            )
            break

    adapters.sort(key=lambda item: (item["name"].casefold(), item["local_ip"]))
    return adapters


def resolve_adapter(adapter_id: Optional[str]) -> tuple[Optional[NetworkAdapterInfo], List[NetworkAdapterInfo]]:
    adapters = list_network_adapters()
    if not adapters:
        return None, []

    if adapter_id:
        wanted = adapter_id.strip()
        for adapter in adapters:
            if adapter["id"] == wanted:
                return adapter, adapters

    return adapters[0], adapters


def _fallback_adapters() -> List[NetworkAdapterInfo]:
    try:
        host_ips = socket.gethostbyname_ex(socket.gethostname())[2]
    except OSError:
        host_ips = []

    for ip in host_ips:
        if _is_usable_ipv4(ip):
            return [{"id": "auto", "name": "Auto", "local_ip": ip}]
    return []
