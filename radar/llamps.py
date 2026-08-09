#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════════════
#  generar_rayos.py
#  Job PUNTUAL (no daemon): se conecta al WebSocket de Blitzortung,
#  escucha rayos en directo durante VENTANA_S segundos, escribe el
#  resultado a disco, y termina. Pensado para correr desde GitHub
#  Actions cada pocos minutos, igual que radar.py: el propio workflow
#  se encarga de hacer commit/push del resultado al repo.
#
#  Uso:
#    python3 generar_rayos.py
#    (el proceso termina solo tras VENTANA_S segundos)
#
#  Salida:
#    public/radar/rayos.json         (crudo)
#    public/radar/rayos_metadata.js  (listo para servir, window.rayosData)
# ═══════════════════════════════════════════════════════════════════════

import os
import sys
import json
import time
import threading
import websocket
from datetime import datetime, timezone

# ═══ CONFIG ═══
DEBUG = os.environ.get("RAYOS_DEBUG", "0") == "1"  # RAYOS_DEBUG=1 para ver cada rayo recibido (mundial)
WS_URL = "wss://ws1.blitzortung.org/"
VENTANA_S = 1 * 60           # escucha durante 1 min y luego termina
RECONNECT_BASE_S = 2
RECONNECT_MAX_S = 15

# Misma región que estaciones/radar: NE España ampliado
BOUNDS = {"lat_min": 38.5, "lat_max": 45.0, "lon_min": -2.0, "lon_max": 5.0}

OUT_JSON = os.path.join("public", "radar", "rayos.json")
OUT_JS = os.path.join("public", "radar", "rayos_metadata.js")

# Lista de rayos capturados durante la ventana (solo un hilo escribe,
# pero usamos lock igualmente por claridad y por si se amplía luego)
buffer_lock = threading.Lock()
rayos_capturados = []

parar = threading.Event()


# ═══════════════════════════════════════════════════════════════════════
#  DECODIFICACIÓN LZW (mismo formato que usa Blitzortung, portado del JS)
# ═══════════════════════════════════════════════════════════════════════
def decode(raw):
    dict_ = {}
    data = list(raw)
    curr_char = data[0]
    old_phrase = curr_char
    out = [curr_char]
    code = 256
    for i in range(1, len(data)):
        curr_code = ord(data[i])
        if curr_code < 256:
            phrase = data[i]
        else:
            phrase = dict_.get(curr_code, old_phrase + curr_char)
        out.append(phrase)
        curr_char = phrase[0]
        dict_[code] = old_phrase + curr_char
        code += 1
        old_phrase = phrase
    return "".join(out)


def dins_bounds(lat, lon):
    return (BOUNDS["lat_min"] <= lat <= BOUNDS["lat_max"] and
            BOUNDS["lon_min"] <= lon <= BOUNDS["lon_max"])


# ═══════════════════════════════════════════════════════════════════════
#  WEBSOCKET — conexión con reconexión automática, viva solo durante
#  la ventana de captura. ws.close() desde el hilo principal la corta.
# ═══════════════════════════════════════════════════════════════════════
def on_open(ws):
    print(f"[WS] Conectado a {WS_URL}")
    ws.send(json.dumps({"a": 111}))


def on_message(ws, message):
    if parar.is_set():
        return
    try:
        decoded = decode(message)
        obj = json.loads(decoded)
        lat = obj.get("lat")
        lon = obj.get("lon")
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            return
        if DEBUG:
            print(f"[DEBUG] Rayo recibido: lat={lat} lon={lon} (dentro_bounds={dins_bounds(lat, lon)})")
        if not dins_bounds(lat, lon):
            return

        # 'time' de Blitzortung viene en nanosegundos desde epoch
        t_ns = obj.get("time")
        ts_ms = int(t_ns / 1_000_000) if t_ns else int(time.time() * 1000)

        with buffer_lock:
            rayos_capturados.append({"lat": round(lat, 5), "lon": round(lon, 5), "ts": ts_ms})
    except Exception:
        pass  # descartamos mensajes que no se puedan decodificar/parsear


def on_error(ws, error):
    print(f"[WS] Error: {error}", file=sys.stderr)


def on_close(ws, close_status_code, close_msg):
    print("[WS] Conexión cerrada")


def bucle_websocket():
    """Reconecta con backoff mientras dure la ventana de captura.
    Se detiene en cuanto 'parar' se activa (fin de la ventana)."""
    delay = RECONNECT_BASE_S
    while not parar.is_set():
        ws = websocket.WebSocketApp(
            WS_URL,
            on_open=on_open,
            on_message=on_message,
            on_error=on_error,
            on_close=on_close,
        )
        ws.run_forever(ping_interval=20, ping_timeout=8)

        if parar.is_set():
            break

        print(f"[WS] Reconectando en {delay}s...")
        time.sleep(delay)
        delay = min(delay * 1.5, RECONNECT_MAX_S)

    try:
        ws.close()
    except Exception:
        pass


def bucle_progres(inici_ts):
    """Mostra en directe l'estat de la captura cada pocs segons, perquè
    es vegi que està agafant dades i quant li queda de finestra."""
    while not parar.is_set():
        time.sleep(5)
        if parar.is_set():
            break
        transcorregut = time.time() - inici_ts
        restant = max(0, VENTANA_S - transcorregut)
        with buffer_lock:
            n = len(rayos_capturados)
        print(f"[CAPTURANT] {n} rayos capturados · {int(transcorregut)}s transcurridos "
              f"· quedan {int(restant)}s")


# ═══════════════════════════════════════════════════════════════════════
#  ESCRITURA
# ═══════════════════════════════════════════════════════════════════════
def guardar():
    with buffer_lock:
        rayos = list(rayos_capturados)

    ahora_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = {
        "updated": ahora_utc,
        "ventana_min": VENTANA_S // 60,
        "total": len(rayos),
        "rayos": rayos,
    }

    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"[OK] Escrito {OUT_JSON} ({len(rayos)} rayos)")

    with open(OUT_JS, "w", encoding="utf-8") as f:
        f.write("window.rayosData = ")
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"[OK] Escrito {OUT_JS}")


# ═══════════════════════════════════════════════════════════════════════
#  MAIN — captura durante VENTANA_S segundos y termina
# ═══════════════════════════════════════════════════════════════════════
def main():
    print("[INFO] Iniciando captura puntual de rayos (Blitzortung)")
    print(f"[INFO] Región: lat [{BOUNDS['lat_min']}, {BOUNDS['lat_max']}] · "
          f"lon [{BOUNDS['lon_min']}, {BOUNDS['lon_max']}]")
    print(f"[INFO] Ventana de captura: {VENTANA_S // 60} min")

    inici_ts = time.time()

    hilo_ws = threading.Thread(target=bucle_websocket, daemon=True)
    hilo_ws.start()

    hilo_progres = threading.Thread(target=bucle_progres, args=(inici_ts,), daemon=True)
    hilo_progres.start()

    print(f"[CAPTURANT] Escoltant en directe durant {VENTANA_S // 60} min...")

    try:
        # Bloqueante: esperamos exactamente la ventana de captura.
        # (a diferencia del daemon, aquí NO hay bucle infinito)
        time.sleep(VENTANA_S)
    except KeyboardInterrupt:
        print("\n[INFO] Interrumpido antes de tiempo, guardando lo capturado...")

    print("[INFO] Ventana de captura completada, cerrando conexión...")
    parar.set()
    hilo_ws.join(timeout=5)  # damos margen a que cierre limpio

    guardar()

    with buffer_lock:
        total = len(rayos_capturados)
    print(f"[FIN] Captura completada: {total} rayos en {VENTANA_S // 60} min")
    sys.exit(0)


if __name__ == "__main__":
    main()