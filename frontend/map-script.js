// ==========================================================================
// STREET SAFETY SYSTEM (SSS) — LIVE MAP & WAYFINDING SCRIPT
// ==========================================================================

// Initialize map with default view on Mysuru, Karnataka, India
const map = L.map('map', {
    zoomControl: false // We'll add zoom control at bottom-right for clean Swiss layout
}).setView([12.3052, 76.6552], 13);

// Position zoom control cleanly at bottom right
L.control.zoom({ position: 'bottomright' }).addTo(map);

// Add high-clarity OpenStreetMap tile layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> // SSS Public Wayfinding',
    maxZoom: 19
}).addTo(map);

// Telemetry cursor tracking on top command bar
map.on('mousemove', (e) => {
    const coordsEl = document.getElementById('cursorCoordsReadout');
    if (coordsEl && e.latlng) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        const latDir = lat >= 0 ? 'N' : 'S';
        const lngDir = lng >= 0 ? 'E' : 'W';
        coordsEl.textContent = `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
    }
});

let allCrimes = []; // Global variable to store all crimes
let currentMarkerMode = 'severity'; // Global marker mode variable ('severity' | 'hazard')
let currentHazardMarkers = []; // Array of active hazard Leaflet marker objects for fast re-rendering
let currentUser = localStorage.getItem('authUserEmail') || null; // Stores authenticated email or null
let lastProximityLat = null;
let lastProximityLon = null;

// Helper to provide authentication headers with Bearer token if present
function getAuthHeaders(additional = {}) {
    const headers = { ...additional };
    const token = localStorage.getItem('authToken');
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

// Reusable Hazard Type to Emoji Mapping
const HAZARD_EMOJI_MAP = {
    "Road Accident": "🚗",
    "Pothole": "🕳️",
    "Broken Streetlight": "💡",
    "Poor Lighting": "🌑",
    "Stray Dogs": "🐕",
    "Stray Dog Activity": "🐕",
    "Road Construction": "🚧",
    "Fallen Tree": "🌳",
    "Waterlogging": "🌊",
    "Flooded Road": "🌊",
    "Oil Spill": "🌊",
    "Traffic Signal Failure": "🚦",
    "Signal Malfunction": "🚦",
    "Unsafe Crossing": "🚶",
    "Unsafe Road Crossing": "🚶",
    "Open Manhole": "🕳️",
    "Broken Footpath": "🕳️",
    "General Hazard": "⚠️",
    "Medical Emergency": "🚑",
    "Fire Hazard": "🔥",
    "Pollution": "🌫️",
    "Crime Alert": "🚨",
    "Unknown Hazard": "📍"
};

/**
 * Returns the corresponding emoji for a given hazard type with keyword fallback.
 */
function getHazardEmoji(hazardType) {
    if (!hazardType) return '⚠️';
    if (HAZARD_EMOJI_MAP[hazardType]) {
        return HAZARD_EMOJI_MAP[hazardType];
    }
    const ht = String(hazardType).trim().toLowerCase();

    if (ht.includes('accident') || ht.includes('crash') || ht.includes('collision')) return '🚗';
    if (ht.includes('pothole') || ht.includes('crater')) return '🕳️';
    if (ht.includes('streetlight') || ht.includes('street light')) return '💡';
    if (ht.includes('lighting') || ht.includes('dark')) return '🌑';
    if (ht.includes('dog') || ht.includes('canine')) return '🐕';
    if (ht.includes('construction') || ht.includes('maintenance')) return '🚧';
    if (ht.includes('tree') || ht.includes('branch')) return '🌳';
    if (ht.includes('waterlog') || ht.includes('flood') || ht.includes('spill')) return '🌊';
    if (ht.includes('signal') || ht.includes('traffic light') || ht.includes('malfunction')) return '🚦';
    if (ht.includes('crossing') || ht.includes('pedestrian')) return '🚶';
    if (ht.includes('manhole') || ht.includes('footpath') || ht.includes('drain')) return '🕳️';
    if (ht.includes('medical')) return '🚑';
    if (ht.includes('fire')) return '🔥';
    if (ht.includes('pollution') || ht.includes('smog')) return '🌫️';
    if (ht.includes('crime') || ht.includes('robbery') || ht.includes('theft') || ht.includes('assault') || ht.includes('murder') || ht.includes('rape') || ht.includes('drug')) return '🚨';
    if (ht.includes('unknown')) return '📍';

    return '⚠️';
}

/**
 * Reusable helper to construct Swiss-styled popup HTML content
 */
function getMarkerPopupHtml(crime) {
    const hazardName = crime.hazardType || crime.type || 'Hazard';
    const locationText = crime.description || crime.address || crime.location || 'Municipal road point';
    const verCount = crime.verificationCount !== undefined ? crime.verificationCount : (crime.upvotes || 0);
    const dateReported = crime.timestamp 
        ? new Date(crime.timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) 
        : (crime.createdAt ? new Date(crime.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Verified Archive');
    
    const sev = Number(crime.severity) || 5;
    let badgeBg = '#fffbeb';
    let badgeColor = '#d97706';
    let badgeLabel = 'MODERATE';
    let badgeBorder = 'rgba(217, 119, 6, 0.3)';

    if (sev >= 8) {
        badgeBg = '#fef2f2';
        badgeColor = '#dc2626';
        badgeLabel = 'CRITICAL DANGER';
        badgeBorder = 'rgba(220, 38, 38, 0.3)';
    } else if (sev >= 6) {
        badgeBg = '#fff7ed';
        badgeColor = '#ea580c';
        badgeLabel = 'HIGH HAZARD';
        badgeBorder = 'rgba(234, 88, 12, 0.3)';
    } else if (sev <= 2) {
        badgeBg = '#f0fdf4';
        badgeColor = '#16a34a';
        badgeLabel = 'LOW RISK';
        badgeBorder = 'rgba(22, 163, 74, 0.3)';
    }

    const crimeId = crime._id || crime.id;
    let voteControls = '';
    if (currentUser) {
        voteControls = `
            <div style="display: flex; gap: 6px; margin-top: 8px;">
                <button style="flex: 1; padding: 5px 8px; background: #0f172a; color: white; border: none; font-size: 0.72rem; font-weight: 700; border-radius: 2px; cursor: pointer; text-transform: uppercase;" onclick="voteCrime('${crimeId}', 'upvote')">▲ Verify</button>
                <button style="padding: 5px 8px; background: #f1f5f9; color: #0f172a; border: 1px solid #cbd5e1; font-size: 0.72rem; font-weight: 700; border-radius: 2px; cursor: pointer;" onclick="voteCrime('${crimeId}', 'downvote')">▼ Dismiss</button>
            </div>
        `;
    } else {
        voteControls = `
            <a href="login.html" class="auth-vote-prompt-pill">🔒 Log in to report or vote</a>
        `;
    }

    return `
        <div style="padding: 4px 2px; min-width: 210px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; font-family: var(--font-mono); font-size: 0.68rem; font-weight: 700; padding: 2px 6px; border-radius: 2px; text-transform: uppercase;">${badgeLabel} // ${sev}/10</span>
                <span style="font-family: var(--font-mono); font-size: 0.65rem; color: #64748b;">RAD: ${crime.hazardRadius || 100}m</span>
            </div>
            <div class="popup-title">${hazardName}</div>
            <div class="popup-location">${locationText}</div>
            <div class="popup-metrics-grid">
                <div class="popup-metric-item">
                    <span class="lbl">Consensus</span>
                    <span class="val">${verCount} Verified</span>
                </div>
                <div class="popup-metric-item">
                    <span class="lbl">Status</span>
                    <span class="val">${crime.status || 'Verified'}</span>
                </div>
            </div>
            <div class="popup-footer-time">DATE: ${dateReported}</div>
            ${voteControls}
        </div>
    `;
}

/**
 * Creates a severity-based colored geometric triangle marker (Mode 1 - Severity View)
 */
function createSeverityMarker(crime) {
    let markerColor = '#d97706'; // default amber
    const sev = Number(crime.severity);

    if (!isNaN(sev)) {
        if (sev >= 8) markerColor = '#dc2626'; // Red for critical/severe
        else if (sev >= 6) markerColor = '#ea580c'; // Orange for high
        else if (sev >= 3) markerColor = '#d97706'; // Yellow/Amber for moderate
        else markerColor = '#16a34a'; // Green for low
    } else if (crime.severity === 'red') {
        markerColor = '#dc2626';
    } else if (crime.severity === 'yellow') {
        markerColor = '#d97706';
    }

    const customIcon = L.divIcon({
        className: 'custom-div-icon triangle',
        html: `<div style="width: 0; height: 0; border-left: 9px solid transparent; border-right: 9px solid transparent; border-bottom: 18px solid ${markerColor}; filter: drop-shadow(0 1px 3px rgba(15,23,42,0.45));"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 18]
    });

    const marker = L.marker([crime.latitude, crime.longitude], { icon: customIcon });
    marker.bindPopup(getMarkerPopupHtml(crime));
    return marker;
}

/**
 * Creates a hazard-type emoji badge marker (Mode 2 - Hazard View)
 */
function createHazardMarker(crime) {
    const hazardType = crime.hazardType || crime.type || 'Hazard';
    const emoji = getHazardEmoji(hazardType);
    const sev = Number(crime.severity) || 5;

    let borderColor = '#d97706';
    if (sev >= 8) borderColor = '#dc2626';
    else if (sev >= 6) borderColor = '#ea580c';
    else if (sev <= 2) borderColor = '#16a34a';

    const customIcon = L.divIcon({
        className: 'custom-div-icon emoji-marker',
        html: `<div style="width: 28px; height: 28px; background: #ffffff; border: 2px solid ${borderColor}; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 16px; line-height: 1; box-shadow: 0 2px 6px rgba(15,23,42,0.2); cursor: pointer;" title="${hazardType}">${emoji}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
    });

    const marker = L.marker([crime.latitude, crime.longitude], { icon: customIcon });
    marker.bindPopup(getMarkerPopupHtml(crime));
    return marker;
}

/**
 * Main marker renderer based on requested mode ("severity" | "hazard")
 */
function renderMarkers(mode = currentMarkerMode) {
    currentMarkerMode = mode;

    // Instantly remove existing hazard markers
    currentHazardMarkers.forEach(m => map.removeLayer(m));
    currentHazardMarkers = [];

    if (!allCrimes || allCrimes.length === 0) return;

    allCrimes.forEach(crime => {
        let marker;
        if (mode === 'hazard') {
            marker = createHazardMarker(crime);
        } else {
            marker = createSeverityMarker(crime);
        }

        marker.addTo(map);
        currentHazardMarkers.push(marker);
    });
}

// Create Leaflet Control widget for "Marker Style" (Top Right)
const markerStyleControl = L.control({ position: 'topright' });

markerStyleControl.onAdd = function (map) {
    const div = L.DomUtil.create('div', 'marker-style-panel leaflet-bar');
    div.innerHTML = `
        <div class="marker-style-header">SIGNAL MODE</div>
        <div class="marker-style-options">
            <label class="marker-style-option">
                <input type="radio" name="markerStyleRadio" value="severity" ${currentMarkerMode === 'severity' ? 'checked' : ''}>
                <span>Severity Signal</span>
            </label>
            <label class="marker-style-option">
                <input type="radio" name="markerStyleRadio" value="hazard" ${currentMarkerMode === 'hazard' ? 'checked' : ''}>
                <span>Hazard Category</span>
            </label>
        </div>
    `;

    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);

    return div;
};

markerStyleControl.addTo(map);

// Change event listener for real-time marker mode switching
document.addEventListener('change', function (e) {
    if (e.target && e.target.name === 'markerStyleRadio') {
        renderMarkers(e.target.value);
    }
});

// Create a div for crime details display / Proximity Alert HUD (Bottom Left)
const crimeDetailsDiv = L.control({ position: 'bottomleft' });

crimeDetailsDiv.onAdd = function (map) {
    this._div = L.DomUtil.create('div', 'crime-details-display');
    this._div.innerHTML = '<h4>PROXIMITY RADAR</h4><p>Navigate map or enable GPS to calculate nearest hazard telemetry.</p>';
    return this._div;
};

crimeDetailsDiv.addTo(map);

// Function to calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of Earth in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    return distance;
}

// Function to check if user is near any crime locations
function checkProximityToCrimes(userLat, userLng) {
    lastProximityLat = userLat;
    lastProximityLon = userLng;

    let nearbyCrimes = [];
    allCrimes.forEach(crime => {
        const distance = calculateDistance(userLat, userLng, crime.latitude, crime.longitude);
        nearbyCrimes.push({
            ...crime,
            distance: distance
        });
    });

    nearbyCrimes.sort((a, b) => {
        if (a.distance !== b.distance) {
            return a.distance - b.distance;
        } else {
            return b.upvotes - a.upvotes;
        }
    });

    if (nearbyCrimes.length === 0) return;

    const selectedCrime = nearbyCrimes[0];
    const selectedCrimeId = selectedCrime._id || selectedCrime.id;

    let buttonsHtml = '';
    if (currentUser) {
        buttonsHtml = `
            <div style="display: flex; gap: 6px; margin-top: 6px;">
                <button style="flex: 1; padding: 5px 8px; background: #0f172a; color: white; border: none; font-size: 0.72rem; font-weight: 700; border-radius: 2px; cursor: pointer; text-transform: uppercase;" onclick="voteCrime('${selectedCrimeId}', 'upvote')">Verify Consensus</button>
                <button style="padding: 5px 8px; background: #f1f5f9; color: #0f172a; border: 1px solid #cbd5e1; font-size: 0.72rem; font-weight: 700; border-radius: 2px; cursor: pointer;" onclick="voteCrime('${selectedCrimeId}', 'downvote')">Dismiss</button>
            </div>
        `;
    } else {
        buttonsHtml = `
            <div style="display: flex; gap: 6px; margin-top: 6px;">
                <button disabled class="btn-vote-disabled" style="flex: 1; padding: 5px 8px; background: #94a3b8; color: white; border: none; font-size: 0.72rem; font-weight: 700; border-radius: 2px; text-transform: uppercase;">Verify</button>
                <button disabled class="btn-vote-disabled" style="padding: 5px 8px; background: #f1f5f9; color: #94a3b8; border: 1px solid #cbd5e1; font-size: 0.72rem; font-weight: 700; border-radius: 2px;">Dismiss</button>
            </div>
            <a href="login.html" class="auth-vote-prompt-pill">🔒 Log in to report or vote</a>
        `;
    }

    let detailsHtml = '<h4>⚠️ NEAREST HAZARD RADAR</h4>';
    detailsHtml += `
        <div style="margin-top: 4px;">
            <div style="font-weight: 700; color: #0f172a; text-transform: uppercase; font-size: 0.85rem;">${selectedCrime.type || selectedCrime.hazardType}</div>
            <div style="color: #475569; font-size: 0.75rem; margin: 2px 0 4px;">${selectedCrime.address || selectedCrime.location || 'Local zone'}</div>
            <div style="font-family: var(--font-mono); font-size: 0.72rem; color: #2563eb; margin-bottom: 6px;">PROXIMITY: ~${selectedCrime.distance.toFixed(2)} km // SEV ${selectedCrime.severity}/10</div>
            ${buttonsHtml}
        </div>
    `;
    crimeDetailsDiv._div.innerHTML = detailsHtml;
}

async function voteCrime(crimeId, voteType) {
    if (!currentUser) {
        currentUser = localStorage.getItem('authUserEmail');
    }

    if (!currentUser) {
        window.location.href = 'login.html?message=' + encodeURIComponent('Please log in to vote on hazards');
        return;
    }

    try {
        const response = await fetch(`/api/crimes/${crimeId}/${voteType}`, {
            method: 'POST',
            credentials: 'include',
            headers: getAuthHeaders({
                'Content-Type': 'application/json'
            })
        });

        if (response.status === 401) {
            window.location.href = 'login.html?message=' + encodeURIComponent('Please log in to vote on hazards');
            return;
        }

        const updatedCrime = await response.json();
        if (response.ok) {
            fetchAndDisplayCrimes();
        } else {
            console.error(`Error ${voteType}ing crime:`, updatedCrime.message || updatedCrime.error);
        }
    } catch (error) {
        console.error(`Error ${voteType}ing crime:`, error);
    }
}

function fetchAndDisplayCrimes() {
    fetch('/api/crimes', { credentials: 'include', headers: getAuthHeaders() })
        .then(response => response.json())
        .then(crimes => {
            allCrimes = crimes;
            renderMarkers(currentMarkerMode);

            // Update top bar telemetry
            const countVal = document.getElementById('activeHazardsCountVal');
            const countBlock = document.getElementById('activeHazardsCountBlock');
            if (countVal && countBlock) {
                countVal.textContent = `${crimes.length} VERIFIED`;
                countBlock.style.display = 'flex';
            }
        })
        .catch(error => console.error('Error fetching crimes:', error));
}

// Authentication status manager
async function checkAuthStatus() {
    const storedEmail = localStorage.getItem('authUserEmail');
    if (storedEmail) {
        currentUser = storedEmail;
        updateAuthUI(true, storedEmail);
    }

    try {
        const response = await fetch('/api/me', {
            method: 'GET',
            credentials: 'include',
            headers: getAuthHeaders()
        });

        if (response.ok) {
            const data = await response.json();
            currentUser = data.email;
            localStorage.setItem('authUserEmail', data.email);
            updateAuthUI(true, data.email);
        } else {
            // Only clear state if server explicitly says unauthorized and no local token was found
            const token = localStorage.getItem('authToken');
            if (!token && response.status === 401) {
                currentUser = null;
                localStorage.removeItem('authUserEmail');
                updateAuthUI(false);
            }
        }
    } catch (err) {
        console.warn('Network issue during auth verification:', err);
        if (storedEmail) {
            currentUser = storedEmail;
            updateAuthUI(true, storedEmail);
        }
    }
}

function updateAuthUI(isLoggedIn, email) {
    const reportBtn = document.getElementById('reportCrimeBtn');
    const authNotice = document.getElementById('authNotice');
    const authLoginLink = document.getElementById('authLoginLink');
    const authUserBadge = document.getElementById('authUserBadge');
    const userEmailSpan = document.getElementById('userEmailSpan');
    const authLogoutBtn = document.getElementById('authLogoutBtn');

    if (isLoggedIn && email) {
        if (reportBtn) {
            reportBtn.disabled = false;
            reportBtn.title = 'Report Hazard';
        }
        if (authNotice) authNotice.style.display = 'none';
        if (authLoginLink) authLoginLink.style.display = 'none';
        if (authUserBadge) {
            authUserBadge.style.display = 'inline-flex';
            if (userEmailSpan) userEmailSpan.textContent = email;
        }
        if (authLogoutBtn) authLogoutBtn.style.display = 'inline-flex';
    } else {
        if (reportBtn) {
            reportBtn.disabled = true;
            reportBtn.title = 'Log in to report or vote';
        }
        if (authNotice) authNotice.style.display = 'inline-flex';
        if (authLoginLink) authLoginLink.style.display = 'inline-flex';
        if (authUserBadge) authUserBadge.style.display = 'none';
        if (authLogoutBtn) authLogoutBtn.style.display = 'none';
    }

    // Refresh proximity radar if active
    if (lastProximityLat !== null && lastProximityLon !== null) {
        checkProximityToCrimes(lastProximityLat, lastProximityLon);
    }
}

// Wire logout button
const authLogoutBtn = document.getElementById('authLogoutBtn');
if (authLogoutBtn) {
    authLogoutBtn.addEventListener('click', async () => {
        try {
            await fetch('/api/logout', {
                method: 'POST',
                credentials: 'include',
                headers: getAuthHeaders()
            });
        } catch (e) {
            console.error('Logout error:', e);
        }
        localStorage.removeItem('authToken');
        localStorage.removeItem('authUserEmail');
        currentUser = null;
        updateAuthUI(false);
        fetchAndDisplayCrimes();
    });
}

let userLocationMarker = null;

// Function to handle user location updates
function handleUserLocation(position) {
    const lat = position.coords.latitude;
    const lon = position.coords.longitude;
    
    localStorage.setItem('locationPermissionGranted', 'true');
    localStorage.setItem('lastLat', lat.toString());
    localStorage.setItem('lastLon', lon.toString());

    if (!userLocationMarker) {
        const userIcon = L.divIcon({
            className: 'user-location-marker',
            html: '<div style="background-color: #2563eb; width: 18px; height: 18px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 0 2px #2563eb, 0 2px 6px rgba(0,0,0,0.3);"></div>',
            iconSize: [18, 18],
            iconAnchor: [9, 9]
        });
        userLocationMarker = L.marker([lat, lon], { icon: userIcon }).addTo(map);
        userLocationMarker.bindPopup("<b>Your Current Location (GPS)</b>").openPopup();
        map.setView([lat, lon], 13);
    } else {
        userLocationMarker.setLatLng([lat, lon]);
    }

    checkProximityToCrimes(lat, lon);
    fetchAndDisplayCrimes();
}

function handleLocationError(error) {
    console.warn("Geolocation fallback active: ", error);
    localStorage.setItem('locationPermissionGranted', 'false');
    fetchAndDisplayCrimes();
}

const locationPermissionGranted = localStorage.getItem('locationPermissionGranted');

if (navigator.geolocation) {
    if (locationPermissionGranted === 'true') {
        const lastLat = parseFloat(localStorage.getItem('lastLat'));
        const lastLon = parseFloat(localStorage.getItem('lastLon'));
        
        if (!isNaN(lastLat) && !isNaN(lastLon)) {
            handleUserLocation({ coords: { latitude: lastLat, longitude: lastLon } });
            navigator.geolocation.watchPosition(handleUserLocation, handleLocationError);
        } else {
            navigator.geolocation.getCurrentPosition(handleUserLocation, handleLocationError);
        }
    } else {
        navigator.geolocation.getCurrentPosition(handleUserLocation, handleLocationError);
    }
} else {
    fetchAndDisplayCrimes();
}

// Hazard Report Form & Map Picker Logic
const reportCrimeBtn = document.getElementById('reportCrimeBtn');
const crimeReportForm = document.getElementById('crimeReportForm');
const modalBackdrop = document.getElementById('modalBackdrop');
const crimeForm = document.getElementById('crimeForm');
const cancelCrimeReportBtn = document.getElementById('cancelCrimeReport');
const locationInput = document.getElementById('location');
const addressInput = document.getElementById('address');
const pickReportLocationBtn = document.getElementById('pickReportLocationBtn');

let reportCoords = null; // Stores { lat, lng } for reported hazard
let reportMarker = null; // Draggable Leaflet marker for reporting location

/**
 * Sets or updates the draggable report hazard location pin on the map
 */
function setReportLocation(lat, lon, label) {
    reportCoords = { lat, lng: lon };
    if (locationInput) {
        locationInput.value = label || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }

    if (reportMarker) {
        map.removeLayer(reportMarker);
    }

    const reportPinIcon = L.divIcon({
        className: 'report-location-pin',
        html: `<div style="background-color: #dc2626; color: white; border-radius: 4px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-size: 18px; border: 2px solid white; box-shadow: 0 4px 10px rgba(15,23,42,0.4); cursor: move;" title="Drag pin to fine-tune hazard location">⚠️</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
    });

    reportMarker = L.marker([lat, lon], { icon: reportPinIcon, draggable: true }).addTo(map);
    reportMarker.bindPopup(`<b>Incident Coordinates Assigned</b><br>Lat: ${lat.toFixed(5)}, Lon: ${lon.toFixed(5)}<br><small style="color: #64748b;">Drag pin to adjust exact point</small>`).openPopup();

    reportMarker.on('dragend', function (event) {
        const marker = event.target;
        const position = marker.getLatLng();
        setReportLocation(position.lat, position.lng, `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`);
    });
}

function openReportModal() {
    if (!currentUser) {
        currentUser = localStorage.getItem('authUserEmail');
    }

    if (!currentUser) {
        window.location.href = 'login.html?message=' + encodeURIComponent('Please log in to report a hazard');
        return;
    }

    if (crimeReportForm) crimeReportForm.style.display = 'block';
    if (modalBackdrop) modalBackdrop.style.display = 'block';
    mapPickingMode = 'report';

    const center = map.getCenter();
    setReportLocation(center.lat, center.lng, `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`);
}

function closeReportModal() {
    if (crimeReportForm) crimeReportForm.style.display = 'none';
    if (modalBackdrop) modalBackdrop.style.display = 'none';
    if (reportMarker) {
        map.removeLayer(reportMarker);
        reportMarker = null;
    }
    reportCoords = null;
    if (mapPickingMode === 'report') mapPickingMode = null;
}

if (reportCrimeBtn) {
    reportCrimeBtn.addEventListener('click', openReportModal);
}

if (pickReportLocationBtn) {
    pickReportLocationBtn.addEventListener('click', () => {
        mapPickingMode = 'report';
        if (modalBackdrop) modalBackdrop.style.display = 'none';
    });
}

if (cancelCrimeReportBtn) {
    cancelCrimeReportBtn.addEventListener('click', closeReportModal);
}

if (modalBackdrop) {
    modalBackdrop.addEventListener('click', closeReportModal);
}

// Form submit handler for reporting a hazard
if (crimeForm) {
    crimeForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        if (!currentUser) {
            currentUser = localStorage.getItem('authUserEmail');
        }

        if (!currentUser) {
            window.location.href = 'login.html?message=' + encodeURIComponent('Please log in to report a hazard');
            return;
        }

        const typeElement = document.getElementById('crime-type');
        const detailsElement = document.getElementById('crime-details');
        const severityElement = document.getElementById('hazard-severity');

        if (!typeElement || !locationInput) {
            alert("Error: One or more form fields could not be found.");
            return;
        }

        const type = typeElement.value;
        const locationStr = locationInput.value;
        const details = detailsElement ? detailsElement.value : '';
        const address = addressInput ? addressInput.value : '';
        const severity = severityElement ? Number(severityElement.value) : 6;

        let latitude = null;
        let longitude = null;

        if (reportCoords && reportCoords.lat && reportCoords.lng) {
            latitude = reportCoords.lat;
            longitude = reportCoords.lng;
        } else {
            const matches = locationStr.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
            if (matches) {
                latitude = parseFloat(matches[1]);
                longitude = parseFloat(matches[2]);
            }
        }

        if (latitude === null || longitude === null) {
            try {
                const coords = await getCoordinates(`${locationStr}, ${address}`);
                latitude = coords.lat;
                longitude = coords.lon;
            } catch (e) {
                const center = map.getCenter();
                latitude = center.lat;
                longitude = center.lng;
            }
        }

        const submitBtn = document.getElementById('submitCrimeBtn') || crimeForm.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Submitting...';
        }

        try {
            const response = await fetch('/api/crimes', {
                method: 'POST',
                credentials: 'include',
                headers: getAuthHeaders({
                    'Content-Type': 'application/json'
                }),
                body: JSON.stringify({
                    type,
                    hazardType: type,
                    location: address || locationStr || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
                    details,
                    latitude,
                    longitude,
                    address,
                    severity
                })
            });

            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Submit Report';
            }

            if (response.status === 401) {
                window.location.href = 'login.html?message=' + encodeURIComponent('Please log in to report a hazard');
                return;
            }

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to report hazard');
            }

            const result = await response.json();
            console.log('Hazard reported:', result);

            const successMessageDiv = document.getElementById('successMessage');
            if (successMessageDiv) {
                successMessageDiv.textContent = 'Hazard reported and ingested successfully!';
                successMessageDiv.style.display = 'block';
            }

            if (reportMarker) {
                map.removeLayer(reportMarker);
                reportMarker = null;
            }
            reportCoords = null;

            fetchAndDisplayCrimes();

            setTimeout(() => {
                if (successMessageDiv) successMessageDiv.style.display = 'none';
                crimeForm.reset();
                const severityVal = document.getElementById('severityVal');
                if (severityVal) severityVal.textContent = '6';
                closeReportModal();
            }, 1400);

        } catch (error) {
            console.error('Error reporting hazard:', error);
            alert(`An error occurred while reporting the hazard: ${error.message}`);
        }
    });
}

async function getCoordinates(query) {
    const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`
    );
    const data = await response.json();
    if (data.length > 0) {
        return {
            lat: parseFloat(data[0].lat),
            lon: parseFloat(data[0].lon),
        };
    } else {
        throw new Error("Location not found");
    }
}

fetchAndDisplayCrimes();
checkAuthStatus();

/* ==========================================================================
   SAFETY-AWARE ROUTING & NAVIGATION FEATURE
   ========================================================================== */

let sourceCoords = null;
let destCoords = null;
let sourceMarker = null;
let destMarker = null;

let mapPickingMode = null; // 'source' or 'destination'

let routeLayers = {
    fastest: [],
    safest: [],
    optimal: []
};

// UI Elements
const sourceInput = document.getElementById('sourceInput');
const destInput = document.getElementById('destInput');
const useMyLocationBtn = document.getElementById('useMyLocationBtn');
const pickSourceBtn = document.getElementById('pickSourceBtn');
const pickDestBtn = document.getElementById('pickDestBtn');
const generateRoutesBtn = document.getElementById('generateRoutesBtn');
const clearRoutesBtn = document.getElementById('clearRoutesBtn');
const routeLoadingSpinner = document.getElementById('routeLoadingSpinner');
const routeCardsContainer = document.getElementById('routeCardsContainer');
const togglePanelBtn = document.getElementById('togglePanelBtn');
const panelContent = document.getElementById('panelContent');

// Toggle Panel Collapse/Expand
if (togglePanelBtn && panelContent) {
    togglePanelBtn.addEventListener('click', () => {
        if (panelContent.style.display === 'none') {
            panelContent.style.display = 'block';
            togglePanelBtn.innerHTML = '&minus;';
        } else {
            panelContent.style.display = 'none';
            togglePanelBtn.innerHTML = '&#43;';
        }
    });
}

// "Use My Location" Button
if (useMyLocationBtn) {
    useMyLocationBtn.addEventListener('click', () => {
        if (userLocationMarker) {
            const latLng = userLocationMarker.getLatLng();
            setSourceLocation(latLng.lat, latLng.lng, "Current GPS Location");
        } else if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    setSourceLocation(pos.coords.latitude, pos.coords.longitude, "Current GPS Location");
                },
                (err) => alert("Could not determine location: " + err.message)
            );
        } else {
            alert("Geolocation is not supported by your browser.");
        }
    });
}

// Pick Source on Map Button
if (pickSourceBtn) {
    pickSourceBtn.addEventListener('click', () => {
        mapPickingMode = 'source';
    });
}

// Pick Destination on Map Button
if (pickDestBtn) {
    pickDestBtn.addEventListener('click', () => {
        mapPickingMode = 'destination';
    });
}

// Map Click Handler for Pickers
map.on('click', async (e) => {
    if (mapPickingMode === 'report' || (crimeReportForm && crimeReportForm.style.display === 'block')) {
        const { lat, lng } = e.latlng;
        setReportLocation(lat, lng, `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
        if (crimeReportForm) crimeReportForm.style.display = 'block';
    } else if (mapPickingMode === 'source') {
        const { lat, lng } = e.latlng;
        setSourceLocation(lat, lng, `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        mapPickingMode = null;
    } else if (mapPickingMode === 'destination') {
        const { lat, lng } = e.latlng;
        setDestinationLocation(lat, lng, `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        mapPickingMode = null;
    }
});

function setSourceLocation(lat, lon, label) {
    sourceCoords = { lat, lon };
    if (sourceInput) sourceInput.value = label || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

    if (sourceMarker) map.removeLayer(sourceMarker);

    const greenIcon = L.divIcon({
        className: 'source-marker',
        html: '<div style="background-color: #16a34a; color: white; border-radius: 4px; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-family: var(--font-mono); font-size: 0.82rem; border: 2px solid white; box-shadow: 0 2px 6px rgba(15,23,42,0.35);">S</div>',
        iconSize: [26, 26],
        iconAnchor: [13, 13]
    });

    sourceMarker = L.marker([lat, lon], { icon: greenIcon }).addTo(map);
    sourceMarker.bindPopup(`<b>Origin Station [Source]</b><br>${label}`).openPopup();
}

function setDestinationLocation(lat, lon, label) {
    destCoords = { lat, lon };
    if (destInput) destInput.value = label || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

    if (destMarker) map.removeLayer(destMarker);

    const redIcon = L.divIcon({
        className: 'dest-marker',
        html: '<div style="background-color: #dc2626; color: white; border-radius: 4px; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-family: var(--font-mono); font-size: 0.82rem; border: 2px solid white; box-shadow: 0 2px 6px rgba(15,23,42,0.35);">D</div>',
        iconSize: [26, 26],
        iconAnchor: [13, 13]
    });

    destMarker = L.marker([lat, lon], { icon: redIcon }).addTo(map);
    destMarker.bindPopup(`<b>Target Destination</b><br>${label}`).openPopup();
}

// Generate Routes Button
if (generateRoutesBtn) {
    generateRoutesBtn.addEventListener('click', async () => {
        try {
            if (!sourceCoords && sourceInput && sourceInput.value.trim() !== '') {
                const coords = await getCoordinates(sourceInput.value.trim());
                setSourceLocation(coords.lat, coords.lon, sourceInput.value.trim());
            }

            if (!destCoords && destInput && destInput.value.trim() !== '') {
                const coords = await getCoordinates(destInput.value.trim());
                setDestinationLocation(coords.lat, coords.lon, destInput.value.trim());
            }

            if (!sourceCoords || !destCoords) {
                alert("Please select or enter both Origin and Destination points.");
                return;
            }

            routeLoadingSpinner.style.display = 'block';

            const response = await fetch('/api/routes', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source: sourceCoords,
                    destination: destCoords
                })
            });

            routeLoadingSpinner.style.display = 'none';

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.message || 'Failed to calculate routes');
            }

            const data = await response.json();
            displayRoutesOnMap(data);

        } catch (err) {
            if (routeLoadingSpinner) routeLoadingSpinner.style.display = 'none';
            console.error('Routing error:', err);
            alert('Error generating routes: ' + err.message);
        }
    });
}

// Clear Routes Button
if (clearRoutesBtn) {
    clearRoutesBtn.addEventListener('click', () => {
        clearAllRoutesFromMap();
        if (sourceMarker) { map.removeLayer(sourceMarker); sourceMarker = null; }
        if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
        sourceCoords = null;
        destCoords = null;
        if (sourceInput) sourceInput.value = '';
        if (destInput) destInput.value = '';
        if (routeCardsContainer) routeCardsContainer.style.display = 'none';
    });
}

function clearAllRoutesFromMap() {
    ['fastest', 'safest', 'optimal'].forEach(type => {
        routeLayers[type].forEach(layer => map.removeLayer(layer));
        routeLayers[type] = [];
    });
}

function displayRoutesOnMap(data) {
    clearAllRoutesFromMap();

    const { fastestRoute, safestRoute, optimalRoute } = data;

    const routeTypes = [
        { key: 'fastest', data: fastestRoute, cardId: 'fastestRouteCard', distId: 'fastestDistance', hazId: 'fastestHazard', safId: 'fastestSafety', checkId: 'toggleFastestRoute' },
        { key: 'safest', data: safestRoute, cardId: 'safestRouteCard', distId: 'safestDistance', hazId: 'safestHazard', safId: 'safestSafety', checkId: 'toggleSafestRoute' },
        { key: 'optimal', data: optimalRoute, cardId: 'optimalRouteCard', distId: 'optimalDistance', hazId: 'optimalHazard', safId: 'optimalSafety', checkId: 'toggleOptimalRoute' }
    ];

    const allRouteBounds = [];

    routeTypes.forEach(rt => {
        const routeData = rt.data;
        if (!routeData) return;

        if (routeData.segments && routeData.segments.length > 0) {
            routeData.segments.forEach(seg => {
                const segmentPolyline = L.polyline([seg.start, seg.end], {
                    color: seg.color || routeData.color,
                    weight: rt.key === 'safest' ? 6 : (rt.key === 'optimal' ? 5 : 4),
                    opacity: 0.88
                }).addTo(map);

                segmentPolyline.bindPopup(
                    `<b>${routeData.name}</b><br>Segment Distance: ${seg.distanceKm.toFixed(2)} km<br>Segment Safety: <span style="color:${seg.color}; font-weight:bold;">${seg.safetyLevel}</span> (Hazard Score: ${seg.hazardScore})`
                );

                routeLayers[rt.key].push(segmentPolyline);
            });
        } else if (routeData.coordinates && routeData.coordinates.length > 0) {
            const fallbackPolyline = L.polyline(routeData.coordinates, {
                color: routeData.color,
                weight: 5,
                opacity: 0.85
            }).addTo(map);
            routeLayers[rt.key].push(fallbackPolyline);
        }

        if (routeData.coordinates) {
            routeData.coordinates.forEach(c => allRouteBounds.push(c));
        }

        const distEl = document.getElementById(rt.distId);
        const hazEl = document.getElementById(rt.hazId);
        const safEl = document.getElementById(rt.safId);
        const checkEl = document.getElementById(rt.checkId);

        if (distEl) distEl.textContent = `${routeData.distanceKm} km`;
        if (hazEl) hazEl.textContent = `${routeData.hazardScore}`;
        if (safEl) {
            safEl.textContent = routeData.safetyLevel;
            safEl.style.backgroundColor = routeData.safetyColor || '#64748b';
        }

        if (checkEl) {
            checkEl.checked = true;
            checkEl.onchange = (e) => {
                const show = e.target.checked;
                routeLayers[rt.key].forEach(layer => {
                    if (show) map.addLayer(layer);
                    else map.removeLayer(layer);
                });
            };
        }
    });

    if (routeCardsContainer) routeCardsContainer.style.display = 'flex';

    if (allRouteBounds.length > 0) {
        map.fitBounds(allRouteBounds, { padding: [60, 60] });
    }
}
