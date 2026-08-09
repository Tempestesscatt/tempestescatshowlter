#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════════════
#  generar_estaciones.py
#  Descarga la observación convencional de TODAS las estaciones de AEMET
#  y genera un fichero JS (window.estacionesData = {...}) con solo lo
#  necesario: idema, nombre, lat, lon, temperatura (ta) y punto de rocío
#  (tpr). Pensado para subir a R2 igual que radar_metadata.js, y que el
#  frontend lo lea sin necesidad de api_key por usuario.
#
#  Uso:
#    export AEMET_API_KEY="tu_api_key"
#    python3 generar_estaciones.py
#
#  Salida:
#    estaciones.json      (crudo, por si lo quieres depurar)
#    estaciones_meta.js   (listo para servir, formato window.X = {...})
# ═══════════════════════════════════════════════════════════════════════

import os
import sys
import json
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

API_KEY = os.environ.get("AEMET_API_KEY")
if not API_KEY:
    print("[ERROR] Falta la variable de entorno AEMET_API_KEY", file=sys.stderr)
    sys.exit(1)

BASE_URL = "https://opendata.aemet.es/opendata"
ENDPOINT = "/api/observacion/convencional/todas"

OUT_JSON = os.path.join("public", "radar", "estaciones.json")
OUT_JS = os.path.join("public", "radar", "estaciones_meta.js")

MAX_REINTENTOS = 3
ESPERA_ENTRE_REINTENTOS = 5  # segundos


def decodificar_bytes(raw):
    """Prueba encodings en cascada: AEMET no siempre es consistente."""
    for enc in ("utf-8", "iso-8859-15", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    # Último recurso: no perder el dato entero por un byte suelto
    return raw.decode("utf-8", errors="replace")


def peticion_json(url, api_key=None):
    """Hace un GET y devuelve el JSON parseado. Reintenta ante fallo de red.

    AEMET sirve algunos endpoints (sobre todo la URL de datos reales,
    la de "sh/xxxx") en ISO-8859-15 aunque el Content-Type diga JSON,
    así que probamos varios encodings en cascada en vez de asumir UTF-8.
    """
    headers = {}
    if api_key:
        headers["api_key"] = api_key

    ultimo_error = None
    for intento in range(1, MAX_REINTENTOS + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read()
                texto = decodificar_bytes(raw)
                return json.loads(texto)
        except urllib.error.HTTPError as e:
            # 429 = límite de peticiones, merece la pena esperar y reintentar
            ultimo_error = e
            print(f"[WARN] Intento {intento}/{MAX_REINTENTOS} HTTPError {e.code}: {url}", file=sys.stderr)
        except Exception as e:
            ultimo_error = e
            print(f"[WARN] Intento {intento}/{MAX_REINTENTOS} error: {e}", file=sys.stderr)

        if intento < MAX_REINTENTOS:
            time.sleep(ESPERA_ENTRE_REINTENTOS)

    raise RuntimeError(f"No se pudo completar la petición a {url}: {ultimo_error}")


def descargar_observaciones():
    """
    AEMET OpenData funciona en dos pasos:
    1. Pides el endpoint -> te devuelve {"datos": "<url_temporal>", ...}
    2. Haces GET a esa url_temporal -> ahí está el JSON real con los datos.
    """
    url_peticion = BASE_URL + ENDPOINT
    print(f"[INFO] Pidiendo metadatos a {url_peticion}")
    respuesta = peticion_json(url_peticion, api_key=API_KEY)

    if respuesta.get("estado") != 200:
        raise RuntimeError(f"AEMET devolvió estado {respuesta.get('estado')}: {respuesta.get('descripcion')}")

    url_datos = respuesta["datos"]
    print(f"[INFO] Descargando datos reales desde {url_datos}")
    # Esta segunda URL ya lleva su propia autenticación embebida, no hace falta api_key
    datos = peticion_json(url_datos, api_key=None)

    if not isinstance(datos, list):
        raise RuntimeError("Formato inesperado: se esperaba una lista de estaciones")

    return datos


def redondear(valor, decimales=1):
    if valor is None:
        return None
    try:
        return round(float(valor), decimales)
    except (TypeError, ValueError):
        return None


def transformar(datos_crudos):
    """
    Reduce cada registro al mínimo necesario para el mapa:
    idema, nombre, lat, lon, temperatura, punto de rocío, hora del dato.

    Si AEMET manda dos lecturas de la misma estación (a veces pasa con
    algún reenvío), nos quedamos con la más reciente por 'fint'.
    """
    por_estacion = {}

    for reg in datos_crudos:
        idema = reg.get("idema")
        lat = reg.get("lat")
        lon = reg.get("lon")
        if idema is None or lat is None or lon is None:
            continue  # registro inservible para el mapa

        fint = reg.get("fint", "")
        existente = por_estacion.get(idema)
        if existente and existente["fint"] >= fint:
            continue  # ya tenemos un dato igual o más nuevo de esta estación

        por_estacion[idema] = {
            "idema": idema,
            "nombre": reg.get("ubi", idema),
            "lat": redondear(lat, 5),
            "lon": redondear(lon, 5),
            "alt": redondear(reg.get("alt"), 0),
            "ta": redondear(reg.get("ta")),     # temperatura del aire (°C)
            "tpr": redondear(reg.get("tpr")),   # punto de rocío (°C)
            "hr": redondear(reg.get("hr"), 0),  # humedad relativa (%) - útil como contexto
            "fint": fint,
        }

    # Solo nos quedamos con estaciones que al menos tengan temperatura
    # o rocío; si no, el marcador saldría vacío en el mapa.
    estaciones = [
        e for e in por_estacion.values()
        if e["ta"] is not None or e["tpr"] is not None
    ]

    return estaciones


def guardar(estaciones):
    ahora_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    payload = {
        "updated": ahora_utc,
        "total": len(estaciones),
        "estaciones": estaciones,
    }

    # Nos aseguramos de que public/radar exista, es la misma carpeta
    # donde ya viven radar_metadata.js y los frames del radar.
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)

    # JSON crudo, por si quieres inspeccionarlo o usarlo desde otro sitio
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"[OK] Escrito {OUT_JSON} ({len(estaciones)} estaciones)")

    # Fichero JS listo para servir tal cual, igual que radar_metadata.js,
    # que el frontend carga con fetch() y parsea por regex.
    with open(OUT_JS, "w", encoding="utf-8") as f:
        f.write("window.estacionesData = ")
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"[OK] Escrito {OUT_JS}")


def main():
    datos_crudos = descargar_observaciones()
    print(f"[INFO] Registros crudos recibidos: {len(datos_crudos)}")

    estaciones = transformar(datos_crudos)
    print(f"[INFO] Estaciones válidas tras filtrar: {len(estaciones)}")

    if not estaciones:
        raise RuntimeError("No se ha obtenido ninguna estación válida, no se sobreescribe la salida")

    guardar(estaciones)


if __name__ == "__main__":
    main()