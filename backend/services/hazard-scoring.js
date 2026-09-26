const { 
  getHazardWeight, 
  getHazardRadius, 
  getSafetyLevelInfo 
} = require('../config/hazard-config');

const EARTH_RADIUS_METERS = 6371000;

/**
 * Calculate Haversine distance in kilometers between two points
 */
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (EARTH_RADIUS_METERS / 1000) * c;
}

/**
 * Calculate distance in meters between a hazard point and a line segment
 */
function pointToSegmentDistanceMeters(pointLat, pointLon, segLat1, segLon1, segLat2, segLon2) {
  const avgLatRad = ((pointLat + segLat1 + segLat2) / 3) * (Math.PI / 180);
  const cosLat = Math.cos(avgLatRad);

  const px = pointLon * (Math.PI / 180) * EARTH_RADIUS_METERS * cosLat;
  const py = pointLat * (Math.PI / 180) * EARTH_RADIUS_METERS;

  const ax = segLon1 * (Math.PI / 180) * EARTH_RADIUS_METERS * cosLat;
  const ay = segLat1 * (Math.PI / 180) * EARTH_RADIUS_METERS;

  const bx = segLon2 * (Math.PI / 180) * EARTH_RADIUS_METERS * cosLat;
  const by = segLat2 * (Math.PI / 180) * EARTH_RADIUS_METERS;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    const distSq = (px - ax) * (px - ax) + (py - ay) * (py - ay);
    return Math.sqrt(distSq);
  }

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = ax + t * dx;
  const projY = ay + t * dy;

  const distSq = (px - projX) * (px - projX) + (py - projY) * (py - projY);
  return Math.sqrt(distSq);
}

/**
 * Calculate hazard score for a single road segment
 */
function calculateSegmentHazardScore(segLat1, segLon1, segLat2, segLon2, hazards = []) {
  let totalScore = 0;
  const segmentLengthKm = calculateDistanceKm(segLat1, segLon1, segLat2, segLon2);

  for (const hazard of hazards) {
    const hLat = hazard.latitude || hazard.lat;
    const hLon = hazard.longitude || hazard.lon || hazard.lng;

    if (hLat === undefined || hLon === undefined) continue;

    const hazardType = hazard.hazardType || hazard.type || 'default';
    const weight = getHazardWeight(hazardType);
    const radiusMeters = getHazardRadius(hazardType);

    const distanceMeters = pointToSegmentDistanceMeters(
      hLat, hLon, 
      segLat1, segLon1, 
      segLat2, segLon2
    );

    if (distanceMeters <= radiusMeters) {
      // Linear distance decay factor
      const proximityFactor = 1 - (distanceMeters / radiusMeters);
      
      // Vote multiplier: upvotes validate hazard, downvotes reduce confidence
      const upvotes = hazard.upvotes || 0;
      const downvotes = hazard.downvotes || 0;
      const voteMultiplier = Math.max(0.5, 1 + 0.1 * (upvotes - downvotes));

      const hazardImpact = weight * proximityFactor * voteMultiplier;
      totalScore += hazardImpact;
    }
  }

  return {
    score: Math.round(totalScore * 100) / 100,
    lengthKm: segmentLengthKm
  };
}

/**
 * Evaluates path safety and breaks path into colored segments
 */
function evaluatePathSafety(coordinates, hazards = []) {
  if (!coordinates || coordinates.length < 2) {
    return {
      totalDistanceKm: 0,
      totalHazardScore: 0,
      safetyLevelInfo: getSafetyLevelInfo(0),
      segments: []
    };
  }

  let totalDistanceKm = 0;
  let totalHazardScore = 0;
  const segments = [];

  for (let i = 0; i < coordinates.length - 1; i++) {
    const p1 = coordinates[i];
    const p2 = coordinates[i + 1];

    const segLat1 = Array.isArray(p1) ? p1[0] : p1.lat;
    const segLon1 = Array.isArray(p1) ? p1[1] : (p1.lon || p1.lng);
    const segLat2 = Array.isArray(p2) ? p2[0] : p2.lat;
    const segLon2 = Array.isArray(p2) ? p2[1] : (p2.lon || p2.lng);

    const segResult = calculateSegmentHazardScore(segLat1, segLon1, segLat2, segLon2, hazards);
    totalDistanceKm += segResult.lengthKm;
    totalHazardScore += segResult.score;

    const segSafetyInfo = getSafetyLevelInfo(segResult.score);

    segments.push({
      start: [segLat1, segLon1],
      end: [segLat2, segLon2],
      distanceKm: segResult.lengthKm,
      hazardScore: segResult.score,
      safetyLevel: segSafetyInfo.level,
      color: segSafetyInfo.color
    });
  }

  const roundedDistance = Math.round(totalDistanceKm * 100) / 100;
  const roundedHazardScore = Math.round(totalHazardScore * 100) / 100;
  
  // Normalized density for overall route rating
  const normalizedScore = totalDistanceKm > 0 ? (totalHazardScore / totalDistanceKm) : totalHazardScore;
  const overallSafetyInfo = getSafetyLevelInfo(normalizedScore);

  return {
    totalDistanceKm: roundedDistance,
    totalHazardScore: roundedHazardScore,
    safetyLevelInfo: overallSafetyInfo,
    segments
  };
}

module.exports = {
  calculateDistanceKm,
  pointToSegmentDistanceMeters,
  calculateSegmentHazardScore,
  evaluatePathSafety
};
