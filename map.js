// Sevilla center
const map = L.map('map').setView([37.389, -5.984], 13);

const canvasRenderer = L.canvas({ padding: 0.5 });

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const loadingProgress = document.getElementById('loading-progress');
const performanceIndicator = document.getElementById('performance-indicator');
const fpsElement = performanceIndicator ? performanceIndicator.querySelector('.fps') : null;

// Mapping of age-phase short codes (field `ae`) to user-friendly labels.
// Codes are defined by the Ayuntamiento de Sevilla tree inventory.
const AGE_PHASE_LABELS = {
    'M': 'Maduro',
    'J': 'Joven',
    'N': 'Nuevo',
    'V': 'Veterano',
    'P': 'Plantón',
    'D': 'Decrépito',
    '0': 'Sin determinar'
};

/**
 * Display an error message to the user.
 */
function showError(message) {
    loadingOverlay.classList.add('hidden');
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.innerHTML = `<strong>Error:</strong><br>${message}`;
    document.body.appendChild(errorDiv);
    setTimeout(() => errorDiv.remove(), 5000);
}

/**
 * Hide the loading overlay with a short delay for smooth transition.
 */
function hideLoading() {
    setTimeout(() => {
        loadingOverlay.classList.add('hidden');
    }, 500);
}

/**
 * Marker cluster group configuration for tree markers.
 * Optimized for performance with chunked loading and dynamic cluster radius.
 */
const markers = L.markerClusterGroup({
    chunkedLoading: true,
    chunkInterval: 100,
    chunkDelay: 10,
    maxClusterRadius: function(zoom) {
        return zoom < 13 ? 120 : zoom < 15 ? 80 : 50;
    },
    spiderfyOnMaxZoom: false,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    disableClusteringAtZoom: 19,
    removeOutsideVisibleBounds: true,
    animate: false,
    animateAddingMarkers: false,
    spiderfyDistanceMultiplier: 1,
    iconCreateFunction: function(cluster) {
        const count = cluster.getChildCount();
        let sizeClass = 'small';

        if (count > 5000) sizeClass = 'large';
        else if (count > 1000) sizeClass = 'large';
        else if (count > 100) sizeClass = 'medium';

        return L.divIcon({
            html: '<div><span>' + (count > 9999 ? (count/1000).toFixed(1) + 'k' : count) + '</span></div>',
            className: 'marker-cluster marker-cluster-' + sizeClass,
            iconSize: L.point(40, 40)
        });
    }
});

const districtState = {
    index: null,
    loadedDistricts: new Set(),
    districtLayers: {},
    isLoading: false
};

async function loadDistrictIndex() {
    try {
        const response = await fetch('./data/districts/districts_index.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        districtState.index = await response.json();
        console.log(`📋 Índice cargado: ${districtState.index.total_districts} distritos, ${districtState.index.total_trees.toLocaleString()} árboles`);
        return true;
    } catch (error) {
        console.error('Error al cargar el índice:', error);
        showError('No se pudo cargar el índice de distritos');
        return false;
    }
}

function yieldToMain() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Calculate marker radius based on tree size.
 *
 * Sevilla's dataset contains trunk **perimeter** (in cm, field `p`) rather
 * than diameter. To reuse the size-scaling tuning from the Madrid blueprint
 * we convert perimeter to an equivalent diameter (perimeter / π) and combine
 * it with the height in metres (field `h`).
 */
function calculateMarkerRadius(props) {
    const perimeter = props.p;
    const height = props.h;

    // perimeter (cm) ≈ π × diameter, so approximate diameter ≈ perimeter/π
    const diameterEquivalent = perimeter && perimeter > 0 ? perimeter / Math.PI : 0;

    let size = 0;
    let hasData = false;
    let isExtremelyTall = false;

    if (diameterEquivalent > 0) {
        size += diameterEquivalent * 0.4;
        hasData = true;
    }

    if (height && height > 0) {
        size += height * 10 * 0.6;
        hasData = true;

        if (height >= 20) {
            isExtremelyTall = true;
        }
    }

    if (!hasData || size <= 0) {
        return 4;
    }

    let radius;
    if (size < 20) {
        radius = 4 + size * 0.1;
    } else if (size < 50) {
        radius = 6 + (size - 20) * 0.133333;
    } else if (size < 100) {
        radius = 10 + (size - 50) * 0.12;
    } else {
        const excess = size - 100;
        if (excess > 200) {
            radius = 26;
        } else {
            radius = 16 + Math.sqrt(excess * 0.005) * 10;
        }
    }

    if (isExtremelyTall) {
        radius += 2;
        if (radius > 28) radius = 28;
    }

    return radius;
}

/**
 * Load tree data for a specific district and add markers to the map.
 *
 * Popup includes scientific name, code, height, trunk perimeter, age phase,
 * typology, district, neighborhood, management location, and links to Google
 * Street View and image search.
 */
async function loadDistrict(districtInfo) {
    const districtCode = districtInfo.code;

    if (districtState.loadedDistricts.has(districtCode)) {
        return;
    }

    console.log(`📥 Cargando distrito ${districtCode} - ${districtInfo.name}...`);

    try {
        const response = await fetch(`./data/districts/${districtInfo.filename}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // District name is stored once at the FeatureCollection level to avoid
        // repeating it on every feature.
        const districtName = (data.properties && data.properties.district_name)
            || districtInfo.name
            || '';

        const districtMarkers = [];
        const chunkSize = 500;

        for (let i = 0; i < data.features.length; i++) {
            const feature = data.features[i];

            if (feature.geometry && feature.geometry.coordinates) {
                const [lng, lat] = feature.geometry.coordinates;
                const props = feature.properties || {};

                const markerRadius = calculateMarkerRadius(props);

                // Color based on height (m). Sevilla trees average ~7m, so we
                // use slightly lower thresholds than the Madrid blueprint.
                const height = props.h;
                let fillColor, borderColor;
                if (height && height >= 18) {
                    fillColor = '#2D4A3A';   // dark green for very tall
                    borderColor = '#1B3A2A';
                } else if (height && height >= 12) {
                    fillColor = '#2E7D32';   // stronger green for tall
                    borderColor = '#1B5E20';
                } else {
                    fillColor = '#4CAF50';   // regular green
                    borderColor = '#2E7D32';
                }

                const marker = L.circleMarker([lat, lng], {
                    renderer: canvasRenderer,
                    radius: markerRadius,
                    fillColor: fillColor,
                    color: borderColor,
                    weight: 1,
                    opacity: 0.8,
                    fillOpacity: 0.6
                });

                marker.on('click', function() {
                    const species    = props.sn || 'Especie desconocida';
                    const code       = props.cn || '';
                    const heightTxt  = (props.h !== undefined && props.h !== null) ? `${props.h} m` : 'N/A';
                    const perimTxt   = (props.p !== undefined && props.p !== null) ? `${props.p} cm` : 'N/A';
                    const ageCode    = props.ae || '';
                    const ageLabel   = AGE_PHASE_LABELS[ageCode] || '';
                    const typology   = props.tp || '';
                    const neighborhood = props.nb || '';
                    const location   = props.g || '';

                    if (typeof gtag === 'function') {
                        gtag('event', 'tree_marker_click', {
                            'tree_species': species,
                            'tree_code': code,
                            'tree_height': props.h || null,
                            'tree_perimeter': props.p || null,
                            'tree_district': districtName,
                            'tree_neighborhood': neighborhood
                        });
                    }

                    const streetViewUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
                    const imagesSearchUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(species)}`;

                    let popupContent = `<div class="tree-info">`;
                    popupContent += `<span class="tree-species">🌳 ${species}</span>`;
                    if (code) {
                        popupContent += `<span class="tree-common-name">Código: ${code}</span>`;
                    }

                    popupContent += `<div class="tree-details">`;
                    popupContent += `<div class="tree-details-item"><strong>Altura:</strong> ${heightTxt}</div>`;
                    popupContent += `<div class="tree-details-item"><strong>Perímetro:</strong> ${perimTxt}</div>`;
                    if (ageLabel) {
                        popupContent += `<div class="tree-details-item"><strong>Fase de edad:</strong> ${ageLabel}</div>`;
                    }
                    if (typology) {
                        popupContent += `<div class="tree-details-item"><strong>Tipología:</strong> ${typology}</div>`;
                    }
                    popupContent += `</div>`;

                    if (districtName || neighborhood || location) {
                        popupContent += `<div class="tree-location">`;
                        if (districtName) {
                            popupContent += `<div class="tree-location-item"><strong>Distrito:</strong> ${districtName}</div>`;
                        }
                        if (neighborhood) {
                            popupContent += `<div class="tree-location-item"><strong>Barrio:</strong> ${neighborhood}</div>`;
                        }
                        if (location) {
                            popupContent += `<div class="tree-location-item"><strong>Ubicación:</strong> ${location}</div>`;
                        }
                        popupContent += `</div>`;
                    }

                    popupContent += `<div class="tree-buttons">`;
                    popupContent += `<a href="${streetViewUrl}" target="_blank" rel="noopener noreferrer" class="street-view-button">🗺️</br> Street View</a>`;
                    popupContent += `<a href="${imagesSearchUrl}" target="_blank" rel="noopener noreferrer" class="images-button">🖼️</br> Imágenes</a>`;
                    popupContent += `</div>`;
                    popupContent += `</div>`;

                    marker.bindPopup(popupContent).openPopup();
                });

                districtMarkers.push(marker);
            }

            if (i > 0 && i % chunkSize === 0) {
                const currentChunk = districtMarkers.splice(0);
                markers.addLayers(currentChunk);
                await yieldToMain();
            }
        }

        if (districtMarkers.length > 0) {
            markers.addLayers(districtMarkers);
        }

        districtState.districtLayers[districtCode] = true;
        districtState.loadedDistricts.add(districtCode);

        console.log(`✅ Distrito ${districtCode} cargado: ${data.features.length.toLocaleString()} árboles`);

    } catch (error) {
        console.error(`Error al cargar distrito ${districtCode}:`, error);
    }
}

function getVisibleDistricts() {
    if (!districtState.index) return [];
    return districtState.index.districts;
}

async function loadVisibleDistricts() {
    if (districtState.isLoading) return;

    districtState.isLoading = true;
    const visibleDistricts = getVisibleDistricts();

    for (let i = 0; i < visibleDistricts.length; i++) {
        const district = visibleDistricts[i];

        if (!districtState.loadedDistricts.has(district.code)) {
            await loadDistrict(district);

            const loaded = districtState.loadedDistricts.size;
            const total = districtState.index.districts.length;
            const percentage = Math.round((loaded / total) * 100);
            loadingProgress.textContent = `Distritos: ${loaded} / ${total} (${percentage}%)`;

            await yieldToMain();
        }
    }

    districtState.isLoading = false;
}

function setupPerformanceMonitoring() {
    if (!performanceIndicator) return;

    let hideTimeout;

    function updatePerformanceIndicator() {
        const visibleMarkers = markers.getVisibleParent ?
            Object.keys(markers._featureGroup._layers).length : 0;

        if (fpsElement) {
            fpsElement.textContent = visibleMarkers.toLocaleString();
        }

        performanceIndicator.classList.add('show');
        clearTimeout(hideTimeout);
        hideTimeout = setTimeout(() => {
            performanceIndicator.classList.remove('show');
        }, 2000);
    }

    map.on('moveend zoomend', updatePerformanceIndicator);
    setTimeout(updatePerformanceIndicator, 1000);
}

async function initialize() {
    map.addLayer(markers);

    loadingText.textContent = 'Cargando árboles...';
    loadingProgress.textContent = 'Preparando datos...';

    const success = await loadDistrictIndex();
    if (!success) {
        showError('No se pudo inicializar el mapa');
        hideLoading();
        return;
    }

    loadVisibleDistricts().then(() => {
        hideLoading();
        console.log(`✅ Carga inicial completa`);
        console.log(`📊 ${districtState.loadedDistricts.size} distritos cargados`);
    });

    map.on('moveend zoomend', () => {
        loadVisibleDistricts();
    });

    setupPerformanceMonitoring();

    console.log(`✅ Mapa inicializado y listo para interacción`);
}

// Info button toggle
const infoButton = document.getElementById('info-button');
const infoPopup = document.getElementById('info-popup');

if (infoButton && infoPopup) {
    infoButton.addEventListener('click', (e) => {
        e.stopPropagation();
        infoPopup.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
        if (!infoButton.contains(e.target) && !infoPopup.contains(e.target)) {
            infoPopup.classList.remove('show');
        }
    });
}

// Location button functionality
const locationButton = document.getElementById('location-button');
let userLocationMarker = null;
let isTracking = false;
let firstLocation = true;

if (locationButton) {
    map.on('locationfound', function(e) {
        if (userLocationMarker) {
            userLocationMarker.setLatLng(e.latlng);
        } else {
            userLocationMarker = L.circleMarker(e.latlng, {
                radius: 8,
                fillColor: '#2196F3',
                color: 'white',
                weight: 3,
                opacity: 1,
                fillOpacity: 1,
                className: 'user-location-marker'
            }).addTo(map);
        }

        if (firstLocation) {
            map.setView(e.latlng, 19, {
                animate: true,
                duration: 1
            });
            firstLocation = false;
        }
    });

    map.on('locationerror', function(e) {
        console.error('Location error:', e.message);
        alert('No se pudo obtener tu ubicación. Por favor, verifica los permisos de ubicación de tu navegador.');
        isTracking = false;
        firstLocation = true;
    });

    locationButton.addEventListener('click', function() {
        if (!isTracking) {
            firstLocation = true;
            map.locate({
                setView: false,
                maxZoom: 19,
                enableHighAccuracy: true,
                watch: true,
                maximumAge: 10000,
                timeout: 30000
            });
            isTracking = true;
            locationButton.style.backgroundColor = '#e3f2fd';
            console.log('📍 Location tracking started');
        } else {
            map.stopLocate();
            isTracking = false;
            firstLocation = true;
            locationButton.style.backgroundColor = 'white';

            if (userLocationMarker) {
                map.removeLayer(userLocationMarker);
                userLocationMarker = null;
            }
            console.log('❌ Location tracking stopped');
        }
    });
}

initialize();
