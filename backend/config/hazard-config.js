// Configuration for Hazard Scoring & Routing Parameters

const HAZARD_WEIGHTS = {
  'accident': 10,
  'murder': 10,
  'rape': 10,
  'violent assault': 10,
  'violent_assault': 10,
  'drug activity': 9,
  'drug': 9,
  'robbery': 9,
  'flooding': 8,
  'unsafe construction': 7,
  'construction': 7,
  'poor lighting': 6,
  'lighting': 6,
  'pickpocketing': 6,
  'theft': 6,
  'broken road': 5,
  'nuisance': 4,
  'stray dogs': 4,
  'pothole': 3,
  'default': 5
};

const HAZARD_INFLUENCE_RADIUS_METERS = {
  'accident': 75,
  'pickpocketing': 120,
  'poor lighting': 200,
  'lighting': 200,
  'flooding': 150,
  'robbery': 100,
  'drug activity': 100,
  'drug': 100,
  'violent assault': 100,
  'violent_assault': 100,
  'default': 100
};

// Routing formula constants: Weight = ALPHA * Distance(km) + BETA * HazardScore
const ROUTING_CONSTANTS = {
  ALPHA: 1.0,  // Distance weight factor
  BETA: 0.005  // Balanced safety/hazard weight factor (1 hazard point ~ 5m detour)
};

// Safety level definitions and threshold boundaries
const SAFETY_LEVELS = [
  { level: 'Very Safe', maxScore: 0, color: '#1a73e8', labelColor: 'blue' },
  { level: 'Safe', maxScore: 5, color: '#34a853', labelColor: 'green' },
  { level: 'Moderate', maxScore: 15, color: '#fbbc04', labelColor: 'yellow' },
  { level: 'Unsafe', maxScore: 30, color: '#ff6d01', labelColor: 'orange' },
  { level: 'Dangerous', maxScore: Infinity, color: '#ea4335', labelColor: 'red' }
];

function getHazardWeight(type) {
  if (!type) return HAZARD_WEIGHTS.default;
  const key = type.toLowerCase().trim();
  return HAZARD_WEIGHTS[key] !== undefined ? HAZARD_WEIGHTS[key] : HAZARD_WEIGHTS.default;
}

function getHazardRadius(type) {
  if (!type) return HAZARD_INFLUENCE_RADIUS_METERS.default;
  const key = type.toLowerCase().trim();
  return HAZARD_INFLUENCE_RADIUS_METERS[key] !== undefined 
    ? HAZARD_INFLUENCE_RADIUS_METERS[key] 
    : HAZARD_INFLUENCE_RADIUS_METERS.default;
}

function getSafetyLevelInfo(score) {
  if (score <= 0) return SAFETY_LEVELS[0];
  for (let i = 1; i < SAFETY_LEVELS.length; i++) {
    if (score <= SAFETY_LEVELS[i].maxScore) {
      return SAFETY_LEVELS[i];
    }
  }
  return SAFETY_LEVELS[SAFETY_LEVELS.length - 1];
}

module.exports = {
  HAZARD_WEIGHTS,
  HAZARD_INFLUENCE_RADIUS_METERS,
  ROUTING_CONSTANTS,
  SAFETY_LEVELS,
  getHazardWeight,
  getHazardRadius,
  getSafetyLevelInfo
};
