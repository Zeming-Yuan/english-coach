"""Stage or activate the session gateway on the existing three-instance server.

Run as root after uploading a verified release. ``stage`` starts only a
loopback service; ``activate`` retains the old Caddy config for rollback.
Existing learning services, databases, passwords and AI files are not rewritten.
"""

from __future__ import annotations

import argparse
import json
import os
import pwd
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


def private_file(path, content, group):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content)
    temporary.chmod(0o640)
    shutil.chown(temporary, user="root", group=group)
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("stage", "activate", "rollback"))
    parser.add_argument("--release", required=True, type=Path)
    parser.add_argument("--origin", required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError("Root is required to install systemd units")
    os.umask(0o077)
    config = Path("/etc/english-coach")
    rollback = config / "Caddyfile.pre-session-login"
    caddy = Path("/usr/local/bin/english-coach-caddy")
    if args.action == "rollback":
        if not rollback.is_file():
            raise RuntimeError("No saved proxy configuration")
        shutil.copy2(rollback, config / "Caddyfile")
        run("systemctl", "restart", "english-coach-proxy")
        return
    release = args.release.resolve(strict=True)
    if (
        not (release / "app/gateway.py").is_file()
        or not (release / "app/static/index.html").is_file()
    ):
        raise RuntimeError("Release missing gateway or built frontend")
    sys.path.insert(0, str(release))
    from app.gateway import create_gateway, password_hash

    origin = urlsplit(args.origin)
    if (
        origin.scheme != "https"
        or not origin.netloc
        or origin.path
        or origin.query
        or origin.fragment
        or origin.username
        or origin.password
    ):
        raise ValueError("Supply the exact HTTPS origin with no trailing slash")
    if args.action == "stage":
        name = "ec-gateway"
        home = Path("/var/lib/english-coach/gateway")
        try:
            pwd.getpwnam(name)
        except KeyError:
            run(
                "useradd",
                "--system",
                "--home-dir",
                home,
                "--shell",
                "/usr/sbin/nologin",
                name,
            )
        home.mkdir(mode=0o700, parents=True, exist_ok=True)
        shutil.chown(home, user=name, group=name)
        home.chmod(0o700)
        passwords = json.loads(
            Path("/root/english-coach-trial-access.json").read_text()
        )
        ports = {"owner": 8001, "friend1": 8002, "friend2": 8003}
        if set(passwords) != set(ports):
            raise ValueError("Existing accounts do not match the deployed backend map")
        settings = {
            "origin": args.origin,
            "accounts": {
                user: {
                    "password_hash": password_hash(passwords[user]),
                    "backend_url": f"http://127.0.0.1:{port}",
                }
                for user, port in ports.items()
            },
        }
        private_file(
            config / "gateway.json", json.dumps(settings, indent=2) + "\n", name
        )
        # Validate the complete settings before installing an active unit.
        create_gateway(
            config_path=config / "gateway.json",
            static_dir=release / "app/static",
            session_db=home / "sessions.db",
        )
        shutil.chown(home / "sessions.db", user=name, group=name)
        private_file(
            config / "gateway.env",
            f"PYTHONPATH={release}\nEC_GATEWAY_CONFIG={config}/gateway.json\n"
            f"EC_GATEWAY_SESSIONS={home}/sessions.db\nEC_GATEWAY_STATIC={release}/app/static\n",
            name,
        )
        unit = """[Unit]
Description=EnglishCoach session login and isolated account gateway
After=network-online.target
[Service]
User=ec-gateway
Group=ec-gateway
WorkingDirectory=/var/lib/english-coach/gateway
EnvironmentFile=/etc/english-coach/gateway.env
ExecStart=/opt/english-coach/venv/bin/python -m uvicorn app.gateway:gateway_from_env --factory --host 127.0.0.1 --port 8085 --proxy-headers --forwarded-allow-ips 127.0.0.1 --no-access-log
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/english-coach/gateway
MemoryMax=256M
[Install]
WantedBy=multi-user.target
"""
        Path("/etc/systemd/system/english-coach-gateway.service").write_text(unit)
        Path("/etc/systemd/system/english-coach-gateway.service").chmod(0o644)
        run(
            "systemd-analyze",
            "verify",
            "/etc/systemd/system/english-coach-gateway.service",
        )
        run("systemctl", "daemon-reload")
        run("systemctl", "enable", "english-coach-gateway")
        run("systemctl", "restart", "english-coach-gateway")
        for _ in range(60):
            try:
                with urllib.request.urlopen(
                    "http://127.0.0.1:8085/auth/session", timeout=2
                ) as response:
                    if json.load(response) == {"enabled": True, "username": None}:
                        break
            except OSError:
                time.sleep(0.5)
        else:
            raise RuntimeError("Gateway did not become ready")
        # Same certificate storage and ACME renewal as the existing proxy.
        proxy = f"""{{
    admin off
    default_sni {origin.hostname}
}}
{args.origin} {{
    tls {{
        issuer acme https://acme-v02.api.letsencrypt.org/directory {{
            profile shortlived
        }}
    }}
    encode zstd gzip
    reverse_proxy 127.0.0.1:8085
}}
"""
        private_file(config / "Caddyfile.session-pending", proxy, "ec-proxy")
        run(
            caddy,
            "validate",
            "--config",
            config / "Caddyfile.session-pending",
            "--adapter",
            "caddyfile",
        )
        print(
            "SESSION_GATEWAY_STAGED: public proxy unchanged; existing learning data and AI keys untouched"
        )
        return
    if not (config / "Caddyfile.session-pending").is_file():
        raise RuntimeError("Stage the gateway before activation")
    run("systemctl", "is-active", "--quiet", "english-coach-gateway")
    run("systemctl", "start", "english-coach-backup.service")
    if not rollback.exists():
        shutil.copy2(config / "Caddyfile", rollback)
    shutil.copy2(config / "Caddyfile.session-pending", config / "Caddyfile")
    run("systemctl", "restart", "english-coach-proxy")
    print(
        "SESSION_GATEWAY_ACTIVATED: existing users/passwords preserved; rollback config saved"
    )


if __name__ == "__main__":
    main()
