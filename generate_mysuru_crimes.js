const fs = require('fs');
const path = require('path');

const localities = [
  { name: "Mysore Palace Area", lat: 12.3052, lon: 76.6552, radiusKm: 0.8 },
  { name: "Devaraja Market", lat: 12.3089, lon: 76.6528, radiusKm: 0.6 },
  { name: "Mysuru Railway Station", lat: 12.3168, lon: 76.6453, radiusKm: 0.7 },
  { name: "Kuvempu Nagar", lat: 12.2872, lon: 76.6267, radiusKm: 1.2 },
  { name: "Vijayanagar", lat: 12.3385, lon: 76.6120, radiusKm: 1.5 },
  { name: "Jayalakshmipuram", lat: 12.3182, lon: 76.6278, radiusKm: 0.9 },
  { name: "Saraswathipuram", lat: 12.3015, lon: 76.6342, radiusKm: 1.0 },
  { name: "Hebbal Industrial Area", lat: 12.3598, lon: 76.6085, radiusKm: 1.8 },
  { name: "Bogadi", lat: 12.3040, lon: 76.6015, radiusKm: 1.4 },
  { name: "Bannimantap", lat: 12.3360, lon: 76.6520, radiusKm: 1.1 },
  { name: "Nazarbad", lat: 12.3115, lon: 76.6670, radiusKm: 0.9 },
  { name: "NIE Mysuru Area", lat: 12.2835, lon: 76.6410, radiusKm: 0.8 },
  { name: "University of Mysore (Manasagangotri)", lat: 12.3110, lon: 76.6200, radiusKm: 1.1 },
  { name: "Chamundi Hill Road", lat: 12.2820, lon: 76.6680, radiusKm: 1.8 },
  { name: "Outer Ring Road (North-West)", lat: 12.3480, lon: 76.6250, radiusKm: 2.2 },
  { name: "Outer Ring Road (South)", lat: 12.2680, lon: 76.6450, radiusKm: 2.5 }
];

const hazardTypes = [
  { type: "Road Accident", defaultSeverity: 9, defaultRadius: 75, templates: ["Minor collision near intersection.", "Two-wheeler skid due to loose gravel.", "Vehicle crash causing traffic bottleneck.", "Truck breakdown blocking left lane."] },
  { type: "Pothole", defaultSeverity: 4, defaultRadius: 50, templates: ["Large pothole causing two-wheelers to swerve.", "Deep pothole near water drain.", "Cluster of potholes along inner road.", "Unmarked asphalt crater."] },
  { type: "Waterlogging", defaultSeverity: 8, defaultRadius: 150, templates: ["Waterlogging after heavy rainfall.", "Poor drainage leading to standing water.", "Submerged road section near underpass.", "Stagnant rainwater slowing vehicles."] },
  { type: "Broken Streetlight", defaultSeverity: 5, defaultRadius: 100, templates: ["Broken streetlight reducing visibility during night.", "Dark stretch due to unlit street lamps.", "Multiple malfunctioning streetlights.", "Flickering street lamp near bend."] },
  { type: "Poor Lighting", defaultSeverity: 6, defaultRadius: 200, templates: ["Poor lighting along isolated stretch.", "Dim pathway illumination near park.", "Lack of streetlights causing blind spots.", "Unlit pedestrian crossing."] },
  { type: "Road Construction", defaultSeverity: 7, defaultRadius: 100, templates: ["Road under maintenance causing lane closure.", "Pipeline digging activity with barricades.", "Asphalt resurfacing work in progress.", "Construction material dumped on side."] },
  { type: "Fallen Tree", defaultSeverity: 7, defaultRadius: 80, templates: ["Fallen tree branch obstructing traffic lane.", "Uprooted tree blocking partial road.", "Heavy bough fallen post rainstorm.", "Overhanging dangerous tree branch."] },
  { type: "Stray Dog Activity", defaultSeverity: 4, defaultRadius: 120, templates: ["Frequent stray dog movement during early morning.", "Pack of stray dogs near garbage point.", "Aggressive canine behavior reported at night.", "Dogs chasing two-wheelers on curve."] },
  { type: "Traffic Congestion", defaultSeverity: 6, defaultRadius: 150, templates: ["Severe bottleneck during peak hours.", "Slow moving traffic near commercial zone.", "Unorganized parking causing congestion.", "Junction delay due to heavy bus movement."] },
  { type: "Unsafe Road Crossing", defaultSeverity: 7, defaultRadius: 90, templates: ["Lack of pedestrian crossing signal.", "High-speed traffic near school zone.", "Blind curve crossing with no speed breaker.", "Pedestrians forced to cross multi-lane road."] },
  { type: "Signal Malfunction", defaultSeverity: 8, defaultRadius: 100, templates: ["Traffic light stuck on blinking yellow.", "Signal power failure causing confusion.", "Non-functional pedestrian countdown timer.", "Desynchronized traffic signals at junction."] },
  { type: "Flooded Road", defaultSeverity: 8, defaultRadius: 180, templates: ["Road flooded up to knee depth.", "Storm drain overflow covering roadway.", "Severe water pooling slowing all traffic.", "Flash flooding on low-lying stretch."] },
  { type: "Oil Spill", defaultSeverity: 8, defaultRadius: 60, templates: ["Diesel leakage making asphalt slippery.", "Slippery oil patch reported near turn.", "Oil spill causing skidding hazard.", "Chemical slick across dual carriageway."] },
  { type: "Open Manhole", defaultSeverity: 9, defaultRadius: 50, templates: ["Uncovered drain grate posing severe danger.", "Open manhole cover missing on footpath.", "Broken chamber lid on main road.", "Submerged open drain edge."] },
  { type: "Broken Footpath", defaultSeverity: 5, defaultRadius: 70, templates: ["Damaged paving slabs forcing pedestrians onto road.", "Broken curb stones near bus stop.", "Uneven pedestrian walkway with exposed rebar.", "Missing footpath slabs above drain."] }
];

const statuses = ["verified", "pending", "expired"];
const nowMs = Date.now();
const sixMonthsMs = 180 * 24 * 60 * 60 * 1000;

function getRandomOffset(radiusKm) {
  // Convert radius in km to degrees approx (1 deg ~ 111km)
  const u = Math.random();
  const v = Math.random();
  const w = (radiusKm / 111) * Math.sqrt(u);
  const t = 2 * Math.PI * v;
  const dLat = w * Math.cos(t);
  const dLon = w * Math.sin(t) / Math.cos(12.3 * Math.PI / 180);
  return { dLat, dLon };
}

const reports = [];

for (let i = 1; i <= 1000; i++) {
  const locality = localities[Math.floor(Math.random() * localities.length)];
  const hType = hazardTypes[Math.floor(Math.random() * hazardTypes.length)];
  const offset = getRandomOffset(locality.radiusKm);

  const lat = Math.round((locality.lat + offset.dLat) * 1000000) / 1000000;
  const lon = Math.round((locality.lon + offset.dLon) * 1000000) / 1000000;

  const template = hType.templates[Math.floor(Math.random() * hType.templates.length)];
  const desc = `[Simulated Demo] ${template} Location: Near ${locality.name}.`;

  const randomTimeMs = nowMs - Math.floor(Math.random() * sixMonthsMs);
  const timestamp = new Date(randomTimeMs).toISOString();

  // Severity variation (+-1 around default bounded 1..10)
  const severityVar = Math.floor(Math.random() * 3) - 1;
  const severity = Math.max(1, Math.min(10, hType.defaultSeverity + severityVar));

  // Verification count
  const verificationCount = Math.floor(Math.random() * 25);

  // Status distribution: ~65% verified, 25% pending, 10% expired
  const randStatus = Math.random();
  const status = randStatus < 0.65 ? "verified" : (randStatus < 0.90 ? "pending" : "expired");

  // Radius variation (+-20%)
  const radiusVar = (Math.random() * 0.4 - 0.2) * hType.defaultRadius;
  const hazardRadius = Math.round(hType.defaultRadius + radiusVar);

  reports.push({
    id: `MYS-HAZ-${String(i).padStart(4, '0')}`,
    hazardType: hType.type,
    description: desc,
    latitude: lat,
    longitude: lon,
    severity: severity,
    timestamp: timestamp,
    verificationCount: verificationCount,
    status: status,
    hazardRadius: hazardRadius
  });
}

// Write to backend/data/crimes.json and frontend/data/crimes.json
const backendPath = path.join(__dirname, 'backend', 'data', 'crimes.json');
const frontendPath = path.join(__dirname, 'frontend', 'data', 'crimes.json');

fs.writeFileSync(backendPath, JSON.stringify(reports, null, 2));
fs.writeFileSync(frontendPath, JSON.stringify(reports, null, 2));

console.log(`Successfully generated 1000 synthetic hazard reports for Mysuru in ${backendPath} and ${frontendPath}`);
