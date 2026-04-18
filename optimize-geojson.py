#!/usr/bin/env python3
"""
Script para optimizar el archivo GeoJSON de árboles de Sevilla.
Reduce el tamaño eliminando campos innecesarios y opcionalmente reduciendo el número de árboles.
"""

import json
import sys
import os
from pathlib import Path

def optimize_geojson(input_file, output_file, keep_ratio=1.0, keep_fields=None):
    """
    Optimiza un archivo GeoJSON.

    Args:
        input_file: Ruta al archivo GeoJSON original
        output_file: Ruta al archivo GeoJSON optimizado
        keep_ratio: Ratio de árboles a mantener (1.0 = todos, 0.25 = 25%)
        keep_fields: Lista de campos a mantener en properties (None = campos esenciales)
    """
    print(f"Leyendo {input_file}...")

    if not os.path.exists(input_file):
        print(f"Error: No se encuentra el archivo {input_file}")
        return False

    original_size = os.path.getsize(input_file) / (1024 * 1024)
    print(f"Tamano original: {original_size:.2f} MB")

    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"Error al leer el archivo: {e}")
        return False

    if 'features' not in data or not isinstance(data['features'], list):
        print("Error: Formato de GeoJSON invalido")
        return False

    original_count = len(data['features'])
    print(f"Total de arboles: {original_count:,}")

    # Campos esenciales por defecto para el dataset de Sevilla
    if keep_fields is None:
        keep_fields = [
            'ESPECIE',      # Nombre cientifico
            'CODIGO',       # Codigo corto de la especie
            'DISTRITO',     # Distrito
            'BARRIO',       # Barrio
            'ALTURA',       # Altura en metros
            'PERIMETRO',    # Perimetro del tronco en cm
            'FASE_EDAD',    # Fase de edad (M/J/N/V/P/D/0)
            'TIPOLOGIA',    # Tipologia (Arbolado Viario, Parque Urbano, ...)
            'GESTION',      # Ubicacion de gestion (p.ej. calle)
        ]

    optimized_features = []

    for i, feature in enumerate(data['features']):
        if keep_ratio < 1.0:
            if i % int(1 / keep_ratio) != 0:
                continue

        optimized_feature = {
            'type': feature['type'],
            'geometry': feature['geometry']
        }

        if 'properties' in feature:
            optimized_props = {}
            for field in keep_fields:
                if field in feature['properties']:
                    value = feature['properties'][field]
                    # Saltar valores vacios o espacios en blanco
                    if value is None:
                        continue
                    if isinstance(value, str) and value.strip() == '':
                        continue
                    optimized_props[field] = value
            optimized_feature['properties'] = optimized_props

        optimized_features.append(optimized_feature)

    optimized_data = {
        'type': 'FeatureCollection',
        'features': optimized_features
    }

    print(f"Arboles despues de optimizacion: {len(optimized_features):,}")
    print(f"Escribiendo {output_file}...")

    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(optimized_data, f, ensure_ascii=False, separators=(',', ':'))
    except Exception as e:
        print(f"Error al escribir el archivo: {e}")
        return False

    optimized_size = os.path.getsize(output_file) / (1024 * 1024)
    reduction = ((original_size - optimized_size) / original_size) * 100

    print(f"\nOptimizacion completada.")
    print(f"Tamano nuevo: {optimized_size:.2f} MB")
    print(f"Reduccion: {reduction:.1f}%")
    print(f"Arboles: {len(optimized_features):,} ({(len(optimized_features)/original_count)*100:.1f}% del original)")

    if optimized_size > 100:
        print(f"\nADVERTENCIA: El archivo aun es muy grande para GitHub ({optimized_size:.2f} MB > 100 MB)")
        print(f"Considera reducir el numero de arboles con: --keep-ratio 0.25")
    elif optimized_size > 50:
        print(f"\nEl archivo ({optimized_size:.2f} MB) funcionara pero la carga sera lenta.")
        print(f"Para mejor rendimiento, considera --keep-ratio 0.5")

    return True

def main():
    input_file = 'trees_data.geojson'
    output_file = 'trees-data.geojson'
    keep_ratio = 1.0

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == '--input' and i + 1 < len(args):
            input_file = args[i + 1]
            i += 2
        elif args[i] == '--output' and i + 1 < len(args):
            output_file = args[i + 1]
            i += 2
        elif args[i] == '--keep-ratio' and i + 1 < len(args):
            try:
                keep_ratio = float(args[i + 1])
                if not 0 < keep_ratio <= 1.0:
                    print("Error: --keep-ratio debe estar entre 0 y 1.0")
                    return
            except ValueError:
                print("Error: --keep-ratio debe ser un numero")
                return
            i += 2
        elif args[i] in ['--help', '-h']:
            print_help()
            return
        else:
            print(f"Argumento desconocido: {args[i]}")
            print_help()
            return

    optimize_geojson(input_file, output_file, keep_ratio)

def print_help():
    print("""
Optimizador de GeoJSON para Sevillatrees

Uso:
    python optimize-geojson.py [opciones]

Opciones:
    --input <archivo>       Archivo GeoJSON de entrada (default: trees_data.geojson)
    --output <archivo>      Archivo GeoJSON de salida (default: trees-data.geojson)
    --keep-ratio <ratio>    Ratio de arboles a mantener (default: 1.0)
    --help, -h              Mostrar esta ayuda
    """)

if __name__ == '__main__':
    main()
