#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════════════
#  actualizar_estacion_manual.py
#  Consulta l'API de meteofelix.com i genera dades_estacions_manuals.js,
#  un fitxer estatic (window.dadesEstacionsManuals = {...}) que despres
#  llegeix estacions_manuals.js des del navegador SENSE fer cap peticio
#  externa (aixi evitem el CORS de meteofelix.com del tot, igual que fa
#  radar.js amb les dades servides des del bucket R2).
#
#  Pensat per executar-se periodicament (cron / GitHub Actions), igual
#  que el workflow que ja actualitza el radar cada 10 min. Recomanat:
#  cada 5 min, en linia amb REFRESH_MS del costat del navegador.
#
#  US:
#    python3 actualizar_estacion_manual.py
#    (per defecte escriu a ./dades_estacions_manuals.js al directori
#    actual; ajusta OUTPUT_PATH si el vols en una altra ubicacio, p.ex.
#    dins la carpeta que despres es puja al bucket R2)
# ═══════════════════════════════════════════════════════════════════════

import json
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
import os

METEOFELIX_URL = "https://meteofelix.com/cgi-bin/JSON.pl?accion=ultimalectura"
# Ruta completa cap al teu fitxer dins del projecte
OUTPUT_PATH = r"C:\Users\simob\Desktop\tempestaprova\mapbox-gl-js\tempestes.cat\tempestescatshowlter\tempestescatshowlter\tempestescatshowlter\radar\public\js\dades_estacions_manuals.js"
TIMEOUT_S = 15

# Cada estacio "manual" necessita una ubicacio fixa (el JSON de
# meteofelix no en porta). Si en el futur afegeixes mes estacions
# manuals, pots ampliar aquesta llista i el diccionari ESTACIONS.
ESTACIONS = [
    {
        "id": "meteofelix",
        "nombre": "Arbúcies (Meteofelix)",
        "lat": 41.8144,
        "lon": 2.5158,
        "url": METEOFELIX_URL,
    },
    # Per afegir una altra estacio manual en un futur, nomes cal afegir
    # un altre diccionari aqui amb el seu propi "url" (si es una font
    # diferent) i actualitzar normalitzar_resposta() si el format JSON
    # es diferent.
]


def normalitzar_resposta(json_data):
    """Converteix el JSON cru de meteofelix al format pla que espera
    estacions_manuals.js (mateixos noms de camp que fa servir
    estaciones.js per a les estacions AEMET, per reutilitzar l'estil)."""

    outdoor = json_data.get("outdoor", {}) or {}
    pressure = json_data.get("pressure", {}) or {}
    wind = json_data.get("wind", {}) or {}
    solar = json_data.get("solar_and_uvi", {}) or {}
    rainfall = json_data.get("rainfall", {}) or {}

    def valor(d, clau):
        v = d.get(clau)
        if isinstance(v, dict):
            return v.get("value")
        return v

    return {
        "fecha": json_data.get("fecha"),
        "ta": valor(outdoor, "temperature"),
        "hr": valor(outdoor, "humidity"),
        "tpr": valor(outdoor, "dew_point"),
        "pres": valor(pressure, "value") if "value" in pressure else pressure.get("value"),
        "vv_kmh": valor(wind, "wind_speed"),
        "racha_kmh": valor(wind, "wind_gust"),
        "dv": valor(wind, "wind_direction"),
        "solar": valor(solar, "solar"),
        "uvi": valor(solar, "uvi"),
        "rain_daily": valor(rainfall, "rain_daily"),
        "rain_rate": valor(rainfall, "rain_rate"),
    }


def obtenir_dades_estacio(estacio):
    try:
        req = urllib.request.Request(
            estacio["url"],
            headers={"User-Agent": "radar-tempestes-bot/1.0"},
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            raw = resp.read().decode("utf-8")
        json_data = json.loads(raw)
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        print(f"[ERROR] {estacio['id']}: no s'ha pogut connectar -> {e}", file=sys.stderr)
        return None
    except json.JSONDecodeError as e:
        print(f"[ERROR] {estacio['id']}: resposta no es JSON valid -> {e}", file=sys.stderr)
        return None

    dades = normalitzar_resposta(json_data)
    dades["id"] = estacio["id"]
    dades["nombre"] = estacio["nombre"]
    dades["lat"] = estacio["lat"]
    dades["lon"] = estacio["lon"]
    return dades


def main():
    # Assegura que el directori de sortida existeix
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    
    estacions_out = []
    for estacio in ESTACIONS:
        dades = obtenir_dades_estacio(estacio)
        if dades is not None:
            estacions_out.append(dades)
            print(f"[OK] {estacio['id']}: Ta={dades.get('ta')}°C · fecha={dades.get('fecha')}")
        else:
            print(f"[SKIP] {estacio['id']}: sense dades noves, es manté el fitxer anterior si existeix")

    if not estacions_out:
        # No sobreescrivim el fitxer si no hem aconseguit cap dada nova:
        # es millor mantenir l'ultima lectura valida que deixar el
        # navegador sense res.
        print("[AVIS] Cap estacio ha respost correctament. No es toca el fitxer de sortida.", file=sys.stderr)
        sys.exit(1)

    payload = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "estaciones": estacions_out,
    }

    contingut = "window.dadesEstacionsManuals = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n"

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write(contingut)

    print(f"[FET] Escrit {OUTPUT_PATH} amb {len(estacions_out)} estacio(ns).")


if __name__ == "__main__":
    main()