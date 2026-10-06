#!/usr/bin/env python3
"""
FastReport Docker Stream - Bridge Server
-----------------------------------------
Lightweight HTTP and Server-Sent Events (SSE) server running inside the container.
Responsibilities:
1. Receives intercepted URLs from `url-redirector.sh` via POST /api/open-url
2. Broadcasts intercepted URLs in real-time to the user's browser via GET /events (SSE)
3. Exposes health check and workspace report status endpoints
4. Allows triggering test URLs for validation
Zero external dependencies (uses standard library http.server and threading).
"""

import sys
import os
import json
import time
import queue
import threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("BRIDGE_PORT", 8080))
WORKSPACE_DIR = os.environ.get("WORKSPACE_DIR", "/workspace")
REPORT_FILE = os.path.join(WORKSPACE_DIR, "report.frx")

# Set of active client queues for SSE streaming
_clients_lock = threading.Lock()
_active_clients = set()


def broadcast_event(event_type: str, data: dict):
    """Broadcasts a payload to all connected SSE browser clients."""
    with _clients_lock:
        targets = list(_active_clients)
    
    payload = {
        "event": event_type,
        "data": data,
        "timestamp": time.time()
    }
    
    print(f"[BRIDGE] Broadcasting event '{event_type}' to {len(targets)} client(s): {data}", flush=True)
    for q in targets:
        try:
            q.put_nowait(payload)
        except Exception:
            pass


class BridgeHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):
        # Concise logging to stdout
        sys.stdout.write(f"[BRIDGE HTTP] {self.address_string()} - {format % args}\n")
        sys.stdout.flush()

    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/events":
            self.handle_sse()
        elif path == "/api/status" or path == "/api/health":
            self.handle_status()
        elif path == "/api/report":
            self.handle_get_report()
        elif path == "/api/report/status":
            self.handle_report_status()
        else:
            self.send_response(404)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Not Found"}).encode("utf-8"))

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/open-url":
            self.handle_open_url()
        elif path == "/api/test-url":
            self.handle_test_url()
        else:
            self.send_response(404)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Not Found"}).encode("utf-8"))

    def handle_status(self):
        report_exists = os.path.exists(REPORT_FILE)
        report_size = os.path.getsize(REPORT_FILE) if report_exists else 0
        report_mtime = os.path.getmtime(REPORT_FILE) if report_exists else 0

        with _clients_lock:
            client_count = len(_active_clients)

        payload = {
            "status": "healthy",
            "uptime": time.time() - SERVER_START_TIME,
            "connected_sse_clients": client_count,
            "workspace": {
                "dir": WORKSPACE_DIR,
                "report_file": REPORT_FILE,
                "exists": report_exists,
                "size_bytes": report_size,
                "modified_at": report_mtime
            }
        }
        data = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_report_status(self):
        report_exists = os.path.exists(REPORT_FILE)
        report_size = os.path.getsize(REPORT_FILE) if report_exists else 0
        report_mtime = os.path.getmtime(REPORT_FILE) if report_exists else 0

        payload = {
            "exists": report_exists,
            "size": report_size,
            "mtime": report_mtime,
            "readable_time": time.ctime(report_mtime) if report_exists else None
        }
        data = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_get_report(self):
        if not os.path.exists(REPORT_FILE):
            self.send_response(404)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Report file not found"}).encode("utf-8"))
            return

        with open(REPORT_FILE, "rb") as f:
            content = f.read()

        self.send_response(200)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/xml; charset=utf-8")
        self.send_header("Content-Disposition", 'attachment; filename="report.frx"')
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def handle_open_url(self):
        """Called by url-redirector.sh when Wine intercepts a URL."""
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b"{}"

        try:
            payload = json.loads(body.decode("utf-8"))
        except Exception:
            payload = {}

        url = payload.get("url", "").strip()
        source = payload.get("source", "wine")

        if not url:
            self.send_response(400)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Missing 'url' parameter"}).encode("utf-8"))
            return

        print(f"[BRIDGE] Intercepted URL received: {url} (source: {source})", flush=True)

        # Broadcast SSE event to connected browsers
        broadcast_event("open_url", {
            "url": url,
            "source": source,
            "timestamp": time.time()
        })

        resp = json.dumps({"status": "intercepted", "url": url}).encode("utf-8")
        self.send_response(200)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(resp)))
        self.end_headers()
        self.wfile.write(resp)

    def handle_test_url(self):
        """Allows testing URL interception directly from web UI."""
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            payload = json.loads(body.decode("utf-8"))
        except Exception:
            payload = {}

        url = payload.get("url", "https://fast-report.com/en/").strip()
        broadcast_event("open_url", {
            "url": url,
            "source": "manual_test",
            "timestamp": time.time()
        })

        resp = json.dumps({"status": "test_broadcasted", "url": url}).encode("utf-8")
        self.send_response(200)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(resp)))
        self.end_headers()
        self.wfile.write(resp)

    def handle_sse(self):
        """Server-Sent Events streaming handler for browser clients."""
        self.send_response(200)
        self._send_cors_headers()
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        client_queue = queue.Queue()
        with _clients_lock:
            _active_clients.add(client_queue)
        print(f"[BRIDGE SSE] New browser client connected. Total clients: {len(_active_clients)}", flush=True)

        # Send welcome event
        welcome_msg = f"event: connected\ndata: {json.dumps({'message': 'SSE Connected to FastReport Bridge', 'time': time.time()})}\n\n"
        try:
            self.wfile.write(welcome_msg.encode("utf-8"))
            self.wfile.flush()
        except Exception as e:
            with _clients_lock:
                _active_clients.discard(client_queue)
            return

        try:
            while True:
                try:
                    # Wait for next event or 15-second ping timeout
                    msg = client_queue.get(timeout=15)
                    event_type = msg.get("event", "message")
                    data_str = json.dumps(msg.get("data", {}))
                    chunk = f"event: {event_type}\ndata: {data_str}\n\n"
                    self.wfile.write(chunk.encode("utf-8"))
                    self.wfile.flush()
                except queue.Empty:
                    # Keep-alive heartbeat
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception as e:
            print(f"[BRIDGE SSE] Client stream error: {e}", flush=True)
        finally:
            with _clients_lock:
                _active_clients.discard(client_queue)
            print(f"[BRIDGE SSE] Browser client disconnected. Remaining: {len(_active_clients)}", flush=True)


SERVER_START_TIME = time.time()

if __name__ == "__main__":
    server_address = ("0.0.0.0", PORT)
    httpd = ThreadingHTTPServer(server_address, BridgeHandler)
    print(f"[BRIDGE SERVER] Running on http://0.0.0.0:{PORT} (Workspace: {WORKSPACE_DIR})", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("[BRIDGE SERVER] Stopping server...", flush=True)
        httpd.server_close()
