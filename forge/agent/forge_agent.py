#!/usr/bin/env python3
"""
Forge Agent — endpoint agent for Forge RMM.

Enrolls with the management server, reports inventory/heartbeat,
and executes queued remote jobs.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

AGENT_VERSION = "0.1.0"
DEFAULT_CONFIG = Path.home() / ".forge-agent" / "config.json"


def http_json(method: str, url: str, body: dict | None = None, headers: dict | None = None) -> dict:
    data = None
    hdrs = {"Content-Type": "application/json", "User-Agent": f"forge-agent/{AGENT_VERSION}"}
    if headers:
        hdrs.update(headers)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = Request(url, data=data, headers=hdrs, method=method)
    try:
        with urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {detail}") from e
    except URLError as e:
        raise RuntimeError(f"Connection failed: {e.reason}") from e


def load_config(path: Path) -> dict:
    if path.exists():
        return json.loads(path.read_text())
    return {}


def save_config(path: Path, cfg: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cfg, indent=2))
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def bytes_to_gb(n: float) -> float:
    return round(n / (1024**3), 2)


def collect_system() -> dict[str, Any]:
    system = platform.system().lower()
    if system == "darwin":
        plat = "darwin"
    elif system.startswith("win"):
        plat = "windows"
    else:
        plat = "linux"

    info: dict[str, Any] = {
        "hostname": socket.gethostname(),
        "platform": plat,
        "os_name": platform.system(),
        "os_version": platform.version() if plat == "windows" else platform.release(),
        "agent_version": AGENT_VERSION,
        "logged_in_user": os.environ.get("USER") or os.environ.get("USERNAME") or "",
        "cpu_cores": os.cpu_count() or 0,
        "cpu_model": platform.processor() or "",
        "manufacturer": "",
        "model": "",
        "serial_number": "",
        "ip_address": "",
        "mac_address": "",
        "ram_gb": 0,
        "disk_total_gb": 0,
        "disk_free_gb": 0,
        "uptime_seconds": 0,
        "mem_used_pct": None,
        "cpu_pct": None,
        "metadata": {"uname": " ".join(platform.uname())},
    }

    try:
        info["ip_address"] = socket.gethostbyname(socket.gethostname())
    except OSError:
        pass

    if plat == "linux":
        _collect_linux(info)
    elif plat == "darwin":
        _collect_darwin(info)
    elif plat == "windows":
        _collect_windows(info)

    return info


def _read(path: str) -> str:
    try:
        return Path(path).read_text(errors="ignore").strip()
    except OSError:
        return ""


def _collect_linux(info: dict) -> None:
    meminfo = _read("/proc/meminfo")
    total_kb = avail_kb = 0
    for line in meminfo.splitlines():
        if line.startswith("MemTotal:"):
            total_kb = int(line.split()[1])
        elif line.startswith("MemAvailable:"):
            avail_kb = int(line.split()[1])
    if total_kb:
        info["ram_gb"] = bytes_to_gb(total_kb * 1024)
        used = total_kb - avail_kb
        info["mem_used_pct"] = round((used / total_kb) * 100, 1)

    try:
        usage = os.statvfs("/")
        total = usage.f_blocks * usage.f_frsize
        free = usage.f_bavail * usage.f_frsize
        info["disk_total_gb"] = bytes_to_gb(total)
        info["disk_free_gb"] = bytes_to_gb(free)
    except OSError:
        pass

    uptime = _read("/proc/uptime").split()
    if uptime:
        info["uptime_seconds"] = int(float(uptime[0]))

    # Pretty OS name
    for line in _read("/etc/os-release").splitlines():
        if line.startswith("PRETTY_NAME="):
            info["os_name"] = line.split("=", 1)[1].strip().strip('"')
        elif line.startswith("VERSION_ID="):
            info["os_version"] = line.split("=", 1)[1].strip().strip('"')


def _collect_darwin(info: dict) -> None:
    info["manufacturer"] = "Apple"
    try:
        out = subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True).strip()
        info["ram_gb"] = bytes_to_gb(float(out))
    except (OSError, subprocess.CalledProcessError, ValueError):
        pass
    try:
        out = subprocess.check_output(["sysctl", "-n", "machdep.cpu.brand_string"], text=True).strip()
        info["cpu_model"] = out
    except (OSError, subprocess.CalledProcessError):
        pass
    try:
        usage = os.statvfs("/")
        info["disk_total_gb"] = bytes_to_gb(usage.f_blocks * usage.f_frsize)
        info["disk_free_gb"] = bytes_to_gb(usage.f_bavail * usage.f_frsize)
    except OSError:
        pass
    try:
        prod = subprocess.check_output(["sysctl", "-n", "hw.model"], text=True).strip()
        info["model"] = prod
    except (OSError, subprocess.CalledProcessError):
        pass


def _collect_windows(info: dict) -> None:
    try:
        import ctypes

        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
        info["ram_gb"] = bytes_to_gb(stat.ullTotalPhys)
        info["mem_used_pct"] = float(stat.dwMemoryLoad)
    except Exception:
        pass


def collect_software() -> list[dict]:
    plat = platform.system().lower()
    apps: list[dict] = []
    if plat == "linux":
        for cmd in (
            ["dpkg-query", "-W", "-f=${Package}\\t${Version}\\t${Maintainer}\\n"],
            ["rpm", "-qa", "--qf", "%{NAME}\\t%{VERSION}\\t%{VENDOR}\\n"],
        ):
            try:
                out = subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL)
                for line in out.splitlines()[:500]:
                    parts = line.split("\t")
                    if parts and parts[0]:
                        apps.append({
                            "name": parts[0],
                            "version": parts[1] if len(parts) > 1 else "",
                            "publisher": parts[2] if len(parts) > 2 else "",
                        })
                if apps:
                    break
            except (OSError, subprocess.CalledProcessError):
                continue
    elif plat == "darwin":
        apps_dir = Path("/Applications")
        if apps_dir.exists():
            for p in sorted(apps_dir.glob("*.app"))[:200]:
                apps.append({"name": p.stem, "version": "", "publisher": "Apple/local"})
    return apps


def run_job(job: dict) -> dict:
    payload = job.get("payload") or ""
    shell = (job.get("shell") or "auto").lower()
    timeout = int(job.get("timeout_seconds") or 300)
    system = platform.system().lower()

    if shell == "auto":
        if system.startswith("win"):
            shell = "cmd"
        else:
            shell = "bash"

    try:
        if shell in ("bash", "sh", "zsh"):
            proc = subprocess.run(
                [shell, "-lc", payload],
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        elif shell == "powershell":
            proc = subprocess.run(
                ["powershell", "-NoProfile", "-Command", payload],
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        else:
            proc = subprocess.run(
                payload,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        return {
            "exit_code": proc.returncode,
            "stdout": proc.stdout or "",
            "stderr": proc.stderr or "",
            "status": "succeeded" if proc.returncode == 0 else "failed",
        }
    except subprocess.TimeoutExpired:
        return {
            "exit_code": 124,
            "stdout": "",
            "stderr": f"Job timed out after {timeout}s",
            "status": "failed",
        }
    except Exception as e:
        return {
            "exit_code": 1,
            "stdout": "",
            "stderr": str(e),
            "status": "failed",
        }


def enroll(server: str, enrollment_key: str, config_path: Path) -> dict:
    sysinfo = collect_system()
    result = http_json(
        "POST",
        f"{server.rstrip('/')}/api/v1/agent/enroll",
        {
            "enrollment_key": enrollment_key,
            "hostname": sysinfo["hostname"],
            "platform": sysinfo["platform"],
            "os_name": sysinfo["os_name"],
            "os_version": sysinfo["os_version"],
            "agent_version": AGENT_VERSION,
        },
    )
    cfg = {
        "server_url": server.rstrip("/"),
        "device_id": result["device_id"],
        "device_token": result["device_token"],
        "site_id": result.get("site_id"),
        "poll_interval_seconds": result.get("poll_interval_seconds", 30),
    }
    save_config(config_path, cfg)
    print(f"Enrolled as {cfg['device_id']} ({sysinfo['hostname']})")
    return cfg


def agent_headers(cfg: dict) -> dict:
    return {
        "X-Device-Id": cfg["device_id"],
        "X-Device-Token": cfg["device_token"],
    }


def heartbeat_once(cfg: dict) -> dict:
    sysinfo = collect_system()
    body = {k: v for k, v in sysinfo.items()}
    return http_json(
        "POST",
        f"{cfg['server_url']}/api/v1/agent/heartbeat",
        body,
        agent_headers(cfg),
    )


def push_inventory(cfg: dict) -> None:
    software = collect_software()
    http_json(
        "POST",
        f"{cfg['server_url']}/api/v1/agent/inventory",
        {"software": software},
        agent_headers(cfg),
    )
    print(f"Inventory reported ({len(software)} packages)")


def report_job(cfg: dict, job_id: str, result: dict) -> None:
    http_json(
        "POST",
        f"{cfg['server_url']}/api/v1/agent/jobs/{job_id}/result",
        result,
        agent_headers(cfg),
    )


def run_loop(cfg: dict, inventory_every: int = 10) -> None:
    ticks = 0
    print(f"Forge agent running — device {cfg['device_id']}")
    print(f"Server: {cfg['server_url']}")
    while True:
        try:
            resp = heartbeat_once(cfg)
            jobs = resp.get("jobs") or []
            for job in jobs:
                print(f"Running job {job['id']}: {job.get('title') or job.get('type')}")
                result = run_job(job)
                report_job(cfg, job["id"], result)
                print(f"  → {result['status']} (exit {result['exit_code']})")
            if ticks % inventory_every == 0:
                push_inventory(cfg)
            interval = int(resp.get("poll_interval_seconds") or cfg.get("poll_interval_seconds") or 30)
        except Exception as e:
            print(f"Heartbeat error: {e}", file=sys.stderr)
            interval = 30
        ticks += 1
        time.sleep(interval)


def main() -> int:
    parser = argparse.ArgumentParser(description="Forge RMM endpoint agent")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    sub = parser.add_subparsers(dest="command", required=True)

    p_enroll = sub.add_parser("enroll", help="Enroll this machine with Forge")
    p_enroll.add_argument("--server", required=True, help="Forge server URL, e.g. http://localhost:8787")
    p_enroll.add_argument("--key", required=True, help="Enrollment key")

    sub.add_parser("run", help="Start agent loop")
    sub.add_parser("heartbeat", help="Send a single heartbeat")
    sub.add_parser("inventory", help="Push software inventory once")
    sub.add_parser("info", help="Print local system inventory JSON")

    args = parser.parse_args()

    if args.command == "info":
        print(json.dumps(collect_system(), indent=2))
        return 0

    if args.command == "enroll":
        enroll(args.server, args.key, args.config)
        return 0

    cfg = load_config(args.config)
    if not cfg.get("device_id") or not cfg.get("device_token"):
        print("Agent not enrolled. Run: forge-agent.py enroll --server URL --key KEY", file=sys.stderr)
        return 1

    if args.command == "heartbeat":
        print(json.dumps(heartbeat_once(cfg), indent=2))
        return 0
    if args.command == "inventory":
        push_inventory(cfg)
        return 0
    if args.command == "run":
        run_loop(cfg)
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
