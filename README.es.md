# Sevillatrees - Mapa Interactivo de los Árboles de Sevilla

Mapa web para explorar visualmente los 223.987 árboles de titularidad
pública de Sevilla. Este proyecto se basa en el blueprint
[madtrees.github.io](https://github.com/madtrees/madtrees.github.io) y se
adapta al conjunto de datos abierto del Ayuntamiento de Sevilla.

## ¿Qué necesitas?

- Un archivo `trees_data.geojson` con las ubicaciones de árboles de tu ciudad
  (campos usados: `ESPECIE`, `CODIGO`, `DISTRITO`, `BARRIO`, `ALTURA`,
  `PERIMETRO`, `FASE_EDAD`, `TIPOLOGIA`, `GESTION`).
- Python 3.8+ para ejecutar los scripts de preparación de datos.
- Git e instalación estándar de Python.

## Pasos para la puesta en marcha

1. Clona el repositorio y coloca el archivo `trees_data.geojson` en la raíz.
2. Ejecuta los scripts en orden:
   ```
   python optimize-geojson.py
   python split-by-district.py
   python compress-districts.py
   ```
3. Sirve la carpeta con un servidor estático:
   ```
   python -m http.server 8000
   ```
4. Abre `http://localhost:8000/` en tu navegador.

## Tutorial / Pasos automatizados

Este proyecto se puede regenerar para otra ciudad usando el skill
`init-trees-city` incluido con Warp, que realiza automáticamente:

1. Preparación del conjunto de datos (`optimize`, `split`, `compress`).
2. Ajuste de la visualización en `map.js` según los campos disponibles.
3. Renombrado de "Madrid" → nueva ciudad y `madtrees` → `<ciudad>trees`.
4. Lanzamiento de la aplicación para prueba local.

## Licencia

GNU General Public License v3. Ver `LICENSE`.
