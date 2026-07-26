"""
explorar_dpradar.py
--------------------
Exploracion paso a paso de la API DPRadar de Meteo-France
(https://public-api.meteofrance.fr/public/DPRadar/v1)

Objetivo: descubrir que observaciones ofrece cada radar individual
(en especial Opoul, id_station=57) - reflectividad, PAG, PAM - y en
que formato vienen, para saber si alguna nos sirve para detectar
rotacion (velocidad Doppler / VRADH) sobre Catalunya.

IMPORTANTE SOBRE LA API KEY:
No pongas la API key directamente en este fichero. Usa una variable
de entorno para no exponerla por accidente (por ejemplo en git):

    set METEOFRANCE_API_KEY=tu_clave_aqui        (Windows cmd)
    $env:METEOFRANCE_API_KEY="tu_clave_aqui"     (PowerShell)

y el script la leera sola con os.environ.
"""

import requests
import os
import json
import csv
import io
from pathlib import Path

BASE = "https://public-api.meteofrance.fr/public/DPRadar/v1"

API_KEY = ""
if not API_KEY:
    print("AVISO: no se encontro METEOFRANCE_API_KEY como variable de entorno.")
    print("       Define la variable de entorno o edita esta linea temporalmente")
    print("       (pero NO subas el fichero a git si pones la key aqui).")

HEADERS = {"apikey": API_KEY, "accept": "application/json"}

OPOUL_ID = "57"  # confirmado via liste-stations: 57;RADAR OPOUL


# ---------------------------------------------------------------------------
# PASO 1: lista de estaciones (ya lo probamos manualmente, aqui en codigo)
# ---------------------------------------------------------------------------

def listar_estaciones():
    """
    Descarga el CSV de todas las estaciones y lo parsea. Devuelve una
    lista de dicts. Util para buscar el id_station de cualquier radar
    por nombre, no solo Opoul.
    """
    url = f"{BASE}/liste-stations"
    r = requests.get(url, headers=HEADERS, timeout=20)
    print(f"GET {url}")
    print(f"status: {r.status_code}")
    r.raise_for_status()

    # El CSV usa ';' como separador (visto en el ejemplo)
    texto = r.content.decode("utf-8-sig")  # utf-8-sig por si trae BOM
    reader = csv.DictReader(io.StringIO(texto), delimiter=";")
    estaciones = list(reader)
    print(f"Nº de estaciones: {len(estaciones)}")
    return estaciones


def buscar_estacion(nombre_parcial, estaciones=None):
    """Busca estaciones cuyo nombre contenga el texto dado (case-insensitive)."""
    if estaciones is None:
        estaciones = listar_estaciones()
    encontradas = [e for e in estaciones if nombre_parcial.upper() in e.get("Nom station", "").upper()]
    for e in encontradas:
        print(f"  {e}")
    return encontradas


# ---------------------------------------------------------------------------
# PASO 2: observaciones disponibles para una estacion concreta
# ---------------------------------------------------------------------------

def listar_observaciones(id_station=OPOUL_ID):
    """
    GET /stations/{id_station}/observations
    Lista las observaciones (productos) disponibles para esa estacion.
    Esto es clave: nos dira si Opoul publica algo tipo velocidad
    Doppler / rotacion, y con que nombre exacto de 'observation'.
    """
    url = f"{BASE}/stations/{id_station}/observations"
    r = requests.get(url, headers=HEADERS, timeout=20)
    print(f"GET {url}")
    print(f"status: {r.status_code}")
    print(f"content-type: {r.headers.get('content-type')}")
    if r.status_code != 200:
        print(f"raw: {r.text[:500]}")
        return None
    try:
        data = r.json()
        print(json.dumps(data, indent=2, ensure_ascii=False))
        return data
    except Exception:
        # puede que tambien sea CSV o texto plano
        print("(no es JSON, mostrando texto crudo)")
        print(r.text[:1000])
        return r.text


# ---------------------------------------------------------------------------
# PASO 3: descripcion de una observacion concreta
# ---------------------------------------------------------------------------

def describir_observacion(observation, id_station=OPOUL_ID):
    """
    GET /stations/{id_station}/observations/{observation}
    Da detalle de una observacion concreta (formato, resolucion, etc.)
    antes de descargar el producto real.
    """
    url = f"{BASE}/stations/{id_station}/observations/{observation}"
    r = requests.get(url, headers=HEADERS, timeout=20)
    print(f"GET {url}")
    print(f"status: {r.status_code}")
    print(f"content-type: {r.headers.get('content-type')}")
    if r.status_code != 200:
        print(f"raw: {r.text[:500]}")
        return None
    try:
        data = r.json()
        print(json.dumps(data, indent=2, ensure_ascii=False))
        return data
    except Exception:
        print(r.text[:1000])
        return r.text


# ---------------------------------------------------------------------------
# PASO 4: descargar el producto real (fichero de datos)
# ---------------------------------------------------------------------------

def inspeccionar_bufr(ruta_bufr):
    """
    Parsea un fichero BUFR (ya descomprimido) usando pybufrkit y
    muestra su estructura: subsets, descriptores y valores. Sirve
    para descubrir que variables trae realmente PAG/PAM (reflectividad,
    velocidad radial, sigma...) y en que orden/formato.

    Requiere: pip install pybufrkit
    """
    try:
        from pybufrkit.decoder import Decoder
        from pybufrkit.renderer import FlatTextRenderer
    except ImportError:
        print("Falta pybufrkit. Instala con: pip install pybufrkit")
        return None

    decoder = Decoder()
    with open(ruta_bufr, "rb") as f:
        contenido = f.read()

    bufr_message = decoder.process(contenido)

    print(f"Nº de subsets: {bufr_message.n_subsets.value}")
    print(f"Fecha: {bufr_message.year.value}-{bufr_message.month.value}-{bufr_message.day.value} "
          f"{bufr_message.hour.value}:{bufr_message.minute.value}")

    # Volcado plano de todos los descriptores y valores (puede ser
    # MUY largo para datos de radar con miles de bins - se trunca).
    texto = FlatTextRenderer().render(bufr_message)
    print("\n--- Primeras 100 lineas del volcado BUFR ---")
    for linea in texto.splitlines()[:100]:
        print(linea)

    print(f"\n(Volcado completo tiene {len(texto.splitlines())} lineas; "
          f"guardado completo en {ruta_bufr}.txt)")
    with open(f"{ruta_bufr}.txt", "w", encoding="utf-8") as f:
        f.write(texto)

    return bufr_message



    """
    GET /stations/{id_station}/observations/{observation}/produit
    Descarga el fichero real de datos. Segun lo confirmado:
      - PAG y PAM necesitan el parametro 'tour_antenne' (A-H)
      - REFLECTIVITE no lo necesita
      - El content-type es 'application/octet-stream+gzip', asi que
        hay que descomprimir con gzip antes de ver que hay dentro.
    Guarda tanto el .gz crudo como el contenido descomprimido (si
    aplica), para poder inspeccionar ambos.
    """
    import gzip

    url = f"{BASE}/stations/{id_station}/observations/{observation}/produit"
    params = {}
    if tour_antenne:
        params["tour_antenne"] = tour_antenne

    r = requests.get(url, headers=HEADERS, params=params, timeout=30)
    print(f"GET {r.url}")
    print(f"status: {r.status_code}")
    print(f"content-length: {len(r.content)} bytes")
    print(f"content-type: {r.headers.get('content-type')}")
    print(f"content-disposition: {r.headers.get('content-disposition')}")
    print(f"primeros 20 bytes (hex): {r.content[:20].hex()}")

    if r.status_code != 200:
        print(f"raw error: {r.text[:500]}")
        return r

    if guardar_en:
        Path(guardar_en).parent.mkdir(parents=True, exist_ok=True)
        with open(guardar_en, "wb") as f:
            f.write(r.content)
        print(f"Guardado (crudo, tal cual llego): {guardar_en}")

    if descomprimir:
        try:
            contenido = gzip.decompress(r.content)
            print(f"\nDescomprimido OK: {len(contenido)} bytes")
            print(f"primeros 20 bytes descomprimidos (hex): {contenido[:20].hex()}")
            # firma HDF5 = \x89HDF\r\n\x1a\n
            if contenido[:8] == b"\x89HDF\r\n\x1a\n":
                print("-> Parece ser un fichero HDF5 valido!")
            else:
                print("-> No es HDF5 (firma distinta); primeros bytes como texto:",
                      repr(contenido[:200]))
            if guardar_en:
                ruta_descomprimida = str(guardar_en) + ".decompressed"
                with open(ruta_descomprimida, "wb") as f:
                    f.write(contenido)
                print(f"Guardado (descomprimido): {ruta_descomprimida}")
        except Exception as e:
            print(f"\nNo se pudo descomprimir con gzip: {e}")
            print("Puede que el contenido no sea realmente gzip pese al content-type,")
            print("o que ya venga descomprimido. Primeros 100 bytes crudos:")
            print(repr(r.content[:100]))

    return r


# ---------------------------------------------------------------------------
# MAIN - exploracion guiada por argumentos
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Uso:")
        print("  python explorar_dpradar.py estaciones")
        print("  python explorar_dpradar.py buscar <nombre_parcial>")
        print("  python explorar_dpradar.py observaciones [id_station]")
        print("  python explorar_dpradar.py describir <observation> [id_station]")
        print("  python explorar_dpradar.py descargar <observation> [id_station] [tour_antenne] [ruta_salida]")
        print("  python explorar_dpradar.py bufr <ruta_al_fichero_decompressed>")
        sys.exit(0)

    modo = sys.argv[1]

    if modo == "estaciones":
        listar_estaciones()

    elif modo == "buscar":
        nombre = sys.argv[2] if len(sys.argv) > 2 else "OPOUL"
        buscar_estacion(nombre)

    elif modo == "observaciones":
        id_st = sys.argv[2] if len(sys.argv) > 2 else OPOUL_ID
        listar_observaciones(id_station=id_st)

    elif modo == "describir":
        obs = sys.argv[2]
        id_st = sys.argv[3] if len(sys.argv) > 3 else OPOUL_ID
        describir_observacion(obs, id_station=id_st)

    elif modo == "descargar":
        obs = sys.argv[2]
        id_st = sys.argv[3] if len(sys.argv) > 3 else OPOUL_ID
        tour = sys.argv[4] if len(sys.argv) > 4 else ("A" if obs in ("PAG", "PAM") else None)
        ruta = sys.argv[5] if len(sys.argv) > 5 else f"descargas/{obs}_{id_st}_{tour or 'na'}.bin"
        descargar_producto(obs, id_station=id_st, tour_antenne=tour, guardar_en=ruta)

    elif modo == "bufr":
        ruta = sys.argv[2]
        inspeccionar_bufr(ruta)

    else:
        print(f"Modo desconocido: {modo}")