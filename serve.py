#!/usr/bin/env python3
# Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
"""Open Overwatch helper.

Serves this folder at http://127.0.0.1:8787/ and relays requests to a short list of data sources
that refuse browser (CORS) requests. The page comes from this same origin, so the relayed answers need no CORS
header, and only this helper's own pages may use the relay. It also carries aisstream.io's WebSocket for the download's
ships (ws://127.0.0.1:8787/aisstream, see Handler.aisstream): the website never opens that socket.
Standard library only. Run:  python serve.py   (or double-click "Start Open Overwatch.bat")
"""
import http.server, socketserver, urllib.request, urllib.parse, urllib.error, os, sys, webbrowser, threading, gzip, zlib, io, re, socket, ssl, select, time

PORT = int(os.environ.get("OW_PORT", "8787"))
PAGE = "open-overwatch.html"
ALLOWED_HOSTS = {
    "api.adsb.lol", "api.airplanes.live", "opendata.adsb.fi",                     # aircraft
    "opensky-network.org",                                                        # aircraft snapshot
    "www.nhc.noaa.gov",                                                           # hurricane advisories
    "webcams.nyctmc.org",                                                         # NYC cameras
    "api.gdeltproject.org",                                                       # news (now sends CORS itself; kept for old pages)
    "firms.modaps.eosdis.nasa.gov",                                               # fires (key)
    "api.windy.com",                                                              # webcams (key)
    "www.submarinecablemap.com",                                                  # submarine cables (live TeleGeography data)
    "www.drivebc.ca", "traveler.modot.org",                                       # camera lists (British Columbia, Missouri)
    "kamera.atlas.vegvesen.no", "atmsqf.iowadot.gov", "trafficcam.calgary.ca", "images.data.gov.sg",  # camera stills sent without CORS
    "aviationweather.gov",                                                        # METAR and TAF (the globe's airport cards)
    "www.ndbc.noaa.gov",                                                          # NOAA buoys and DART tsunami buoys
    "www.tsunami.gov",                                                            # the NOAA tsunami warning centres' messages
}  # keep in sync with NEEDS_RELAY in src/map/util.js and ALLOWED_HOSTS in serve.js (test/relayhosts.test.mjs checks)
FORWARD_HEADERS = {"x-windy-api-key", "accept"}
UA = "OpenOverwatch/1.0 (local helper; personal use)"
OWN_HOSTS = {"127.0.0.1:%d" % PORT, "localhost:%d" % PORT}


def allowed(url):
    try:
        u = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    return u.scheme == "https" and u.hostname in ALLOWED_HOSTS


class CheckedRedirect(urllib.request.HTTPRedirectHandler):
    """Every redirect hop must stay on the allowlist; the Windy key is not carried to another host."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed(newurl):
            msg = "upstream redirected outside the allowlist: %s" % urllib.parse.urlsplit(newurl).hostname
            raise urllib.error.HTTPError(newurl, 502, msg, {"Content-Type": "text/plain; charset=utf-8"}, io.BytesIO(msg.encode()))
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None and urllib.parse.urlsplit(newurl).hostname != urllib.parse.urlsplit(req.full_url).hostname:
            for k in [k for k in new.headers if k.lower() == "x-windy-api-key"]:
                del new.headers[k]
        return new


OPENER = urllib.request.build_opener(CheckedRedirect)

# aisstream.io for the download's ships: a WebSocket tunnel (keep in step with aisTunnel in serve.js). aisstream.io takes
# no connection from a web page, so the 2D map opens ws://127.0.0.1:8787/aisstream and the bytes go through unchanged to
# wss://stream.aisstream.io/v0/stream, both ways: the visitor's API key (in the first frame) is never read, logged or
# kept here. Only this helper's own pages may open it, a query string is refused, and a few tunnels at most are open.
# OW_AIS_UPSTREAM=ws://127.0.0.1:<port>/<path> points it at a stand-in for test/serve.test.mjs (loopback ws:// only).
AIS_PATH = "/aisstream"
AIS_MAX = 4
AIS_HANDSHAKE_S = 15  # the whole upstream connect + TLS + handshake, like AIS_HANDSHAKE_MS in serve.js
AIS_SEND_S = 60       # a side that takes no bytes for this long ends the tunnel
AIS_BUF = 1 << 20     # bytes held for a slow side before the other side stops being read
AIS_LOCK = threading.Lock()
AIS_OPEN = [0]
WS_KEY = re.compile(r"^[A-Za-z0-9+/]{22}==$")
PRINTABLE = re.compile(r"^[\x20-\x7e]*$")


def ais_upstream():
    o = os.environ.get("OW_AIS_UPSTREAM", "")
    if o:
        try:
            u = urllib.parse.urlsplit(o)
            if u.scheme == "ws" and u.hostname == "127.0.0.1" and u.port:
                return u.hostname, u.port, u.path or "/", False
        except ValueError:
            pass
    return "stream.aisstream.io", 443, "/v0/stream", True


def tunnel(client, rfile, up, secure):
    """Copy bytes both ways until either side closes, then close both. One thread does both directions with
    non-blocking sockets: an SSL socket must not be read on one thread while it is written on another (OpenSSL objects
    are not thread-safe), and a blocked write one way must not stop the other way (the old two-thread pump's reason)."""
    to_up, to_client = bytearray(), bytearray()
    chunk = b""  # an SSL write that wanted to wait is retried with these same bytes
    up_eof = client_eof = False
    try:
        client.setblocking(False)
        up.setblocking(False)
        to_up += rfile.read1(65536) or b""  # bytes the request parser already buffered (b"" when none)
        while True:
            if (client_eof and not to_up and not chunk) or (up_eof and not to_client):
                return
            reads = ([client] if not client_eof and len(to_up) < AIS_BUF else []) + ([up] if not up_eof and len(to_client) < AIS_BUF else [])
            writes = ([up] if to_up or chunk else []) + ([client] if to_client else [])
            if up in reads and secure and up.pending():
                r, w = [up], []  # decrypted bytes inside the SSL object don't make the raw socket readable
            else:
                r, w, _ = select.select(reads, writes, [], AIS_SEND_S if writes else None)
                if not r and not w:
                    return  # a side took no bytes for AIS_SEND_S
            if client in r:
                try:
                    data = client.recv(65536)
                    to_up += data
                    client_eof = not data
                except BlockingIOError:
                    pass
            if up in r:
                try:
                    data = up.recv(65536)
                    to_client += data
                    up_eof = not data
                except (ssl.SSLWantReadError, ssl.SSLWantWriteError, BlockingIOError):
                    pass  # half a TLS record so far
            if up in w:
                if not chunk:
                    chunk, to_up[:] = bytes(to_up[:16384]), to_up[16384:]
                try:
                    chunk = chunk[up.send(chunk):]
                except (ssl.SSLWantReadError, ssl.SSLWantWriteError, BlockingIOError):
                    pass
            if client in w:
                try:
                    del to_client[:client.send(to_client)]
                except BlockingIOError:
                    pass
    except OSError:
        pass
    finally:
        for s in (up, client):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


class Handler(http.server.SimpleHTTPRequestHandler):
    # pinned, so the Windows registry can't change them (a "text/plain" .js entry would blank every page); = MIME in serve.js
    # (test/serve.test.mjs checks)
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
                      '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.py': 'text/plain; charset=utf-8',
                      '.bat': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp4': 'video/mp4',
                      '.wav': 'audio/wav', '.mjs': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
                      '.webm': 'video/webm', '.wasm': 'application/wasm'}
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=os.path.dirname(os.path.abspath(__file__)), **kw)

    def log_message(self, fmt, *args):
        msg = fmt % args
        if "/proxy" in msg:
            msg = msg.split("url=")[0] + "url=…" if "url=" in msg else msg
        if AIS_PATH in msg:  # never a query string from the tunnel's address in the log
            msg = re.sub(r"(/aisstream)\?\S*", r"\1?…", msg)
        sys.stdout.write("%s %s\n" % (self.log_date_time_string(), msg)); sys.stdout.flush()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):  # no CORS preflight approval: same-origin pages never need one
        self.send_response(204)
        self.end_headers()

    def own_request(self):
        """Only this helper's own pages: a foreign Host means DNS rebinding, a cross-site fetch carries Sec-Fetch-Site / Origin."""
        site = self.headers.get("Sec-Fetch-Site"); origin = self.headers.get("Origin")
        if site and site not in ("same-origin", "none"):
            return False
        return not origin or origin.replace("http://", "", 1) in OWN_HOSTS

    def do_HEAD(self):
        if self.headers.get("Host") not in OWN_HOSTS:
            return self.reply(421, "wrong host")
        if "\0" in urllib.parse.unquote(urllib.parse.urlsplit(self.path).path):
            return self.reply(400, "bad path")
        return super().do_HEAD()

    def do_GET(self):
        if self.headers.get("Host") not in OWN_HOSTS:  # DNS rebinding guard
            return self.reply(421, "wrong host")
        parsed = urllib.parse.urlsplit(self.path)
        if "\0" in urllib.parse.unquote(parsed.path):  # the same answer as serve.js (which a NUL byte once crashed)
            return self.reply(400, "bad path")
        if parsed.path == "/proxy":
            if not self.own_request():
                return self.reply(403, "the relay only serves pages from this helper")
            return self.proxy(urllib.parse.parse_qs(parsed.query))
        if parsed.path == AIS_PATH:
            return self.aisstream(parsed)
        if parsed.path == "/":
            self.send_response(302); self.send_header("Location", "/" + PAGE); self.end_headers(); return
        return super().do_GET()

    def reply(self, code, body, ctype="text/plain; charset=utf-8"):
        # no Access-Control-Allow-Origin: the page is served from this same origin, and other sites must not use the relay
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def aisstream(self, parsed):
        """The WebSocket tunnel to aisstream.io (see AIS_PATH above): checks, the upstream handshake, then raw bytes."""
        self.close_connection = True
        h = self.headers
        if not h.get("Upgrade"):
            return self.reply(426, "a WebSocket only")
        if not h.get("Origin") or not self.own_request():  # a browser always sends Origin on a WebSocket
            return self.reply(403, "the aisstream tunnel only serves pages from this helper")
        if parsed.query:
            return self.reply(400, "no query string: the API key goes in the subscription message")
        key = h.get("Sec-WebSocket-Key") or ""
        if (h.get("Upgrade") or "").lower() != "websocket" or h.get("Sec-WebSocket-Version") != "13" or not WS_KEY.match(key):
            return self.reply(400, "a WebSocket only")
        extra = {k: h.get(k) for k in ("Sec-WebSocket-Extensions", "Sec-WebSocket-Protocol") if h.get(k)}
        if any(not PRINTABLE.match(v) for v in extra.values()):
            return self.reply(400, "bad header")
        with AIS_LOCK:
            if AIS_OPEN[0] >= AIS_MAX:
                return self.reply(503, "too many aisstream tunnels open")
            AIS_OPEN[0] += 1
        host, port, path, secure = ais_upstream()
        up = None
        try:
            try:
                deadline = time.monotonic() + AIS_HANDSHAKE_S

                def left():  # one budget for the whole handshake, so an upstream trickling bytes can't hold a slot
                    t = deadline - time.monotonic()
                    if t <= 0:
                        raise socket.timeout("timed out")
                    return t
                up = socket.create_connection((host, port), timeout=AIS_HANDSHAKE_S)
                up.settimeout(left())
                if secure:
                    up = ssl.create_default_context().wrap_socket(up, server_hostname=host)
                up.settimeout(left())
                lines = ["GET %s HTTP/1.1" % path, "Host: %s" % host, "Upgrade: websocket", "Connection: Upgrade",
                         "Sec-WebSocket-Key: %s" % key, "Sec-WebSocket-Version: 13", "User-Agent: %s" % UA]
                lines += ["%s: %s" % kv for kv in extra.items()]
                up.sendall(("\r\n".join(lines) + "\r\n\r\n").encode("latin-1"))  # no Origin, no cookies: a plain client
                buf = b""
                while b"\r\n\r\n" not in buf:
                    up.settimeout(left())
                    chunk = up.recv(4096)
                    if not chunk or len(buf) > 16384:
                        return self.reply(502, "aisstream.io sent no handshake")
                    buf += chunk
            except OSError as e:
                return self.reply(502, "aisstream.io: %s" % e)
            head, rest = buf.split(b"\r\n\r\n", 1)
            status, *rows = head.decode("latin-1").split("\r\n")
            code = (status.split(" ") + ["", ""])[1]
            if code != "101":
                return self.reply(502, "aisstream.io refused the connection (HTTP %s)" % (code or "?"))
            got = {}
            for row in rows:
                k, _, v = row.partition(":")
                got[k.strip().lower()] = v.strip()
            accept = got.get("sec-websocket-accept", "")
            if not accept or not PRINTABLE.match(accept):
                return self.reply(502, "aisstream.io sent a bad handshake")
            out = ["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", "Sec-WebSocket-Accept: %s" % accept]
            for name in ("Sec-WebSocket-Extensions", "Sec-WebSocket-Protocol"):
                v = got.get(name.lower())
                if v and PRINTABLE.match(v):
                    out.append("%s: %s" % (name, v))
            self.connection.sendall(("\r\n".join(out) + "\r\n\r\n").encode("latin-1") + rest)
            sys.stdout.write("%s aisstream open\n" % self.log_date_time_string()); sys.stdout.flush()
            tunnel(self.connection, self.rfile, up, secure)  # the frames themselves, untouched
            sys.stdout.write("%s aisstream closed\n" % self.log_date_time_string()); sys.stdout.flush()
        finally:
            if up is not None:
                try:
                    up.close()
                except OSError:
                    pass
            with AIS_LOCK:
                AIS_OPEN[0] -= 1

    def proxy(self, q):
        if "ping" in q:
            return self.reply(200, "ok")
        url = (q.get("url") or [""])[0]
        try:
            target = urllib.parse.urlsplit(url)
        except ValueError:
            return self.reply(400, "bad url")
        if not allowed(url):
            return self.reply(403, "host not in the helper's allowlist: %s" % target.hostname)
        headers = {"User-Agent": UA, "Accept-Encoding": "gzip, deflate"}
        for k, v in self.headers.items():
            if k.lower() in FORWARD_HEADERS:
                headers[k] = v
        req = urllib.request.Request(url, headers=headers)
        try:
            with OPENER.open(req, timeout=60) as r:
                data = r.read(); code = r.status; ctype = r.headers.get("Content-Type", "application/octet-stream"); enc = (r.headers.get("Content-Encoding") or "").lower()
        except urllib.error.HTTPError as e:
            data = e.read(); code = e.code; ctype = e.headers.get("Content-Type", "text/plain"); enc = (e.headers.get("Content-Encoding") or "").lower()
        except Exception as e:  # DNS, timeout, TLS …
            return self.reply(502, "upstream error: %s" % e)
        try:
            if enc == "gzip":
                data = gzip.decompress(data)
            elif enc == "deflate":
                data = zlib.decompress(data, -zlib.MAX_WBITS) if data[:1] != b"\x78" else zlib.decompress(data)
        except Exception:
            pass
        return self.reply(code, data, ctype)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = sys.platform != "win32"  # on Windows SO_REUSEADDR binds over a running helper (no "port busy")
    daemon_threads = True


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    if not os.path.exists(PAGE):
        print("Put serve.py in the same folder as %s" % PAGE); sys.exit(1)
    url = "http://127.0.0.1:%d/%s" % (PORT, PAGE)
    try:
        httpd = Server(("127.0.0.1", PORT), Handler)
    except OSError as e:
        print("Port %d is busy (%s). Is the helper already running? Open %s" % (PORT, e, url)); sys.exit(1)
    print("Open Overwatch helper on %s  (Ctrl+C to stop)" % url)
    print("Relaying: " + ", ".join(sorted(ALLOWED_HOSTS)))
    if not os.environ.get("OW_NO_OPEN"):  # OW_NO_OPEN=1: tests and CI, no browser window
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
