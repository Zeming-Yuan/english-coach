"""Disposable TLS gateway for browser tests against real test backends."""

import argparse
import json
import socket
from pathlib import Path

import uvicorn

from app.gateway import create_gateway, password_hash

parser = argparse.ArgumentParser()
for option in ("directory", "static", "owner", "friend"):
    parser.add_argument("--" + option, required=True)
args = parser.parse_args()
root = Path(args.directory)
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
config = root / "gateway.json"
config.write_text(
    json.dumps(
        {
            "origin": f"https://127.0.0.1:{port}",
            "accounts": {
                "owner": {
                    "password_hash": password_hash("trial-password"),
                    "backend_url": args.owner,
                },
                "friend1": {
                    "password_hash": password_hash("friend-password"),
                    "backend_url": args.friend,
                },
            },
        }
    )
)
app = create_gateway(
    config_path=config, static_dir=Path(args.static), session_db=root / "sessions.db"
)
print(json.dumps({"port": port}), flush=True)
uvicorn.run(
    app,
    host="127.0.0.1",
    port=port,
    ssl_certfile=str(root / "cert.pem"),
    ssl_keyfile=str(root / "key.pem"),
    log_level="error",
    access_log=False,
)
