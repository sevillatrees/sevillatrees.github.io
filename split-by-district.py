#!/usr/bin/env python3
"""
Script para dividir el archivo GeoJSON de arboles por distritos de Sevilla.
Crea un archivo separado por cada distrito para carga dinamica.

Como el dataset de Sevilla no tiene un codigo numerico de distrito, se
genera un codigo secuencial a partir de la lista ordenada alfabeticamente
de nombres de distrito (`DISTRITO`). Este codigo es estable mientras el
conjunto de distritos no cambie.
"""

import json
import os
import re
import sys
import unicodedata
from collections import defaultdict

# Campo del GeoJSON que contiene el nombre del distrito
DISTRICT_FIELD = 'DISTRITO'


def slugify(name):
    """Convierte un nombre a una forma segura para usar en filenames."""
    normalized = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode('ascii')
    normalized = normalized.upper()
    normalized = re.sub(r'[^A-Z0-9]+', '_', normalized).strip('_')
    return normalized or 'SIN_NOMBRE'


def split_by_district(input_file, output_dir='data/districts'):
    """
    Divide el GeoJSON por distritos.

    Args:
        input_file: Ruta al archivo GeoJSON original
        output_dir: Directorio donde guardar los archivos por distrito
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

    total_trees = len(data['features'])
    print(f"Total de arboles: {total_trees:,}")

    # Primer paso: descubrir todos los distritos presentes y asignar codigos
    # estables a partir del orden alfabetico.
    unique_names = set()
    for feature in data['features']:
        props = feature.get('properties', {})
        name = (props.get(DISTRICT_FIELD) or '').strip()
        if name:
            unique_names.add(name)

    sorted_names = sorted(unique_names)
    name_to_code = {name: f"{idx + 1:02d}" for idx, name in enumerate(sorted_names)}

    print(f"Distritos detectados: {len(sorted_names)}")
    for name in sorted_names:
        print(f"  {name_to_code[name]} - {name}")

    # Segundo paso: agrupar features por codigo de distrito
    print("\nAgrupando arboles por distrito...")
    districts = defaultdict(list)
    no_district = []

    for feature in data['features']:
        props = feature.get('properties', {})
        name = (props.get(DISTRICT_FIELD) or '').strip()
        if name:
            districts[name_to_code[name]].append(feature)
        else:
            no_district.append(feature)

    # Crear directorio de salida
    os.makedirs(output_dir, exist_ok=True)
    print(f"Creando archivos en: {output_dir}/")

    district_info = []
    total_saved = 0

    for name, code in sorted(name_to_code.items(), key=lambda kv: kv[1]):
        features = districts.get(code, [])
        safe_name = slugify(name)

        district_geojson = {
            'type': 'FeatureCollection',
            'properties': {
                'district_code': code,
                'district_name': name,
                'tree_count': len(features)
            },
            'features': features
        }

        filename = f"district_{code}_{safe_name}.geojson"
        filepath = os.path.join(output_dir, filename)

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(district_geojson, f, ensure_ascii=False, separators=(',', ':'))

        file_size = os.path.getsize(filepath) / (1024 * 1024)
        total_saved += len(features)

        district_info.append({
            'code': code,
            'name': name,
            'filename': filename,
            'tree_count': len(features),
            'size_mb': file_size
        })

        print(f"  {code} - {name}: {len(features):,} arboles ({file_size:.2f} MB)")

    # Guardar arboles sin distrito (si hay)
    if no_district:
        code = '00'
        safe_name = 'SIN_DISTRITO'
        district_geojson = {
            'type': 'FeatureCollection',
            'properties': {
                'district_code': code,
                'district_name': 'Sin distrito',
                'tree_count': len(no_district)
            },
            'features': no_district
        }

        filename = f"district_{code}_{safe_name}.geojson"
        filepath = os.path.join(output_dir, filename)
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(district_geojson, f, ensure_ascii=False, separators=(',', ':'))

        file_size = os.path.getsize(filepath) / (1024 * 1024)
        total_saved += len(no_district)

        district_info.append({
            'code': code,
            'name': 'Sin distrito',
            'filename': filename,
            'tree_count': len(no_district),
            'size_mb': file_size
        })

        print(f"  {code} - Sin distrito: {len(no_district):,} arboles ({file_size:.2f} MB)")

    # Crear archivo de indice con metadatos
    index_file = os.path.join(output_dir, 'districts_index.json')
    index_data = {
        'total_trees': total_trees,
        'total_districts': len(districts),
        'districts': district_info
    }

    with open(index_file, 'w', encoding='utf-8') as f:
        json.dump(index_data, f, ensure_ascii=False, indent=2)

    print(f"\nDivision completada.")
    print(f"Archivos creados: {len(district_info)}")
    print(f"Arboles guardados: {total_saved:,} de {total_trees:,}")
    print(f"Indice creado: {index_file}")

    total_size = sum(info['size_mb'] for info in district_info)
    if district_info:
        print(f"Tamano total de archivos: {total_size:.2f} MB")
        print(f"Tamano promedio por distrito: {total_size/len(district_info):.2f} MB")

    if district_info:
        max_district = max(district_info, key=lambda x: x['tree_count'])
        min_district = min(district_info, key=lambda x: x['tree_count'])
        print("\nEstadisticas:")
        print(f"  Distrito con mas arboles: {max_district['name']} ({max_district['tree_count']:,})")
        print(f"  Distrito con menos arboles: {min_district['name']} ({min_district['tree_count']:,})")

    return True


def main():
    input_file = 'trees-data.geojson'
    output_dir = 'data/districts'

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == '--input' and i + 1 < len(args):
            input_file = args[i + 1]
            i += 2
        elif args[i] == '--output' and i + 1 < len(args):
            output_dir = args[i + 1]
            i += 2
        elif args[i] in ['--help', '-h']:
            print_help()
            return
        else:
            print(f"Argumento desconocido: {args[i]}")
            print_help()
            return

    split_by_district(input_file, output_dir)


def print_help():
    print("""
Divisor de GeoJSON por Distritos - Sevillatrees

Uso:
    python split-by-district.py [opciones]

Opciones:
    --input <archivo>     Archivo GeoJSON de entrada (default: trees-data.geojson)
    --output <directorio> Directorio de salida (default: data/districts)
    --help, -h            Mostrar esta ayuda

Resultado:
    - Crea un archivo .geojson por cada distrito presente en el campo DISTRITO
    - Asigna un codigo secuencial (01, 02, ...) ordenado alfabeticamente
    - Crea districts_index.json con metadatos
    """)


if __name__ == '__main__':
    main()
