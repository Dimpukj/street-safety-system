const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const User = require('./user');
const Crime = require('./crime');

const { generateRoutes } = require('./services/routing');
const { 
  HAZARD_WEIGHTS, 
  HAZARD_INFLUENCE_RADIUS_METERS, 
  ROUTING_CONSTANTS, 
  SAFETY_LEVELS 
} = require('./config/hazard-config');

const app = express();
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'streetsafety_jwt_secret_dev_key_2026';

app.use(cors({ origin: true, credentials: true, allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(cookieParser());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Helper to sign JWT
function generateToken(email) {
  return jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });
}

// Helper to set secure cookie (SameSite=None, Secure=true for iframe compatibility)
function setAuthCookie(res, token) {
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

// Authentication middleware accepting both Cookie and Authorization: Bearer <token>
function requireAuth(req, res, next) {
  let token = req.cookies && req.cookies.token;

  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    }
  }

  if (!token) {
    return res.status(401).json({ error: 'Please log in to continue' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded || !decoded.email) {
      return res.status(401).json({ error: 'Please log in to continue' });
    }
    req.user = { email: decoded.email };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

// Serve landing page at root and index
app.get(['/', '/index.html', '/landing'], (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/landing.html'));
});

// In-Memory store fallback when MongoDB is unavailable
let isMongoConnected = false;

const usersFilePath = path.join(__dirname, 'data', 'users.json');
let inMemoryUsers = [];

function loadInMemoryUsers() {
  try {
    if (fs.existsSync(usersFilePath)) {
      const raw = fs.readFileSync(usersFilePath, 'utf8');
      inMemoryUsers = JSON.parse(raw);
    }
  } catch (err) {
    console.warn('Could not read users.json:', err.message);
  }
}
loadInMemoryUsers();

function saveInMemoryUsers() {
  try {
    fs.writeFileSync(usersFilePath, JSON.stringify(inMemoryUsers, null, 2), 'utf8');
  } catch (err) {
    console.warn('Could not persist users.json:', err.message);
  }
}

let inMemoryCrimes = [];

try {
  const fs = require('fs');
  const path = require('path');
  const crimesPath = path.join(__dirname, 'data', 'crimes.json');
  if (fs.existsSync(crimesPath)) {
    const rawData = fs.readFileSync(crimesPath, 'utf8');
    const parsed = JSON.parse(rawData);
    inMemoryCrimes = parsed.map((item) => ({
      _id: item.id || item._id,
      id: item.id,
      type: item.hazardType || item.type,
      hazardType: item.hazardType || item.type,
      location: item.description,
      address: item.description,
      details: item.description,
      description: item.description,
      latitude: item.latitude,
      longitude: item.longitude,
      severity: item.severity,
      upvotes: item.verificationCount || 5,
      downvotes: 0,
      upvotedBy: [],
      downvotedBy: [],
      status: item.status,
      timestamp: item.timestamp,
      verificationCount: item.verificationCount,
      hazardRadius: item.hazardRadius,
      createdAt: item.timestamp ? new Date(item.timestamp) : new Date()
    }));
  }
} catch (err) {
  console.warn('Failed to load crimes.json dataset:', err.message);
}

function normalizeCrime(crime) {
  return typeof crime.toObject === 'function' ? crime.toObject() : crime;
}

function combineCrimes(databaseCrimes = []) {
  const seenIds = new Set();
  return [...databaseCrimes.map(normalizeCrime), ...inMemoryCrimes]
    .filter((crime) => {
      const crimeId = String(crime._id || crime.id || '');
      if (!crimeId || seenIds.has(crimeId)) return false;
      seenIds.add(crimeId);
      return true;
    })
    .sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0));
}

// Configure Mongoose to fail fast if DB is offline
mongoose.set('bufferCommands', false);

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/streetSafetyDB', {
  serverSelectionTimeoutMS: 2000
}).then(() => {
  isMongoConnected = true;
  console.log('MongoDB connected');
}).catch(err => {
  isMongoConnected = false;
  console.warn('MongoDB connection unavailable — operating in-memory mode');
});

// Registration endpoint
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = (username || cleanEmail.split('@')[0]).trim();

    if (isMongoConnected) {
      try {
        const user = new User({ username: cleanUsername, email: cleanEmail, password });
        await user.save();
        const token = generateToken(cleanEmail);
        setAuthCookie(res, token);
        return res.status(201).json({
          message: 'User registered successfully',
          token,
          user: { email: cleanEmail, username: cleanUsername }
        });
      } catch (dbErr) {
        if (dbErr.name === 'MongooseError' || dbErr.name === 'MongoNetworkError') {
          isMongoConnected = false;
        } else {
          return res.status(400).json({ error: 'Registration failed: ' + dbErr.message });
        }
      }
    }

    // In-memory fallback with file persistence
    const existing = inMemoryUsers.find(u => u.email.toLowerCase() === cleanEmail);
    if (existing) {
      return res.status(400).json({ error: 'User already exists with that email' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const newUser = {
      _id: 'user_' + Date.now(),
      username: cleanUsername,
      email: cleanEmail,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    };

    inMemoryUsers.push(newUser);
    saveInMemoryUsers();

    const token = generateToken(cleanEmail);
    setAuthCookie(res, token);
    return res.status(201).json({
      message: 'User registered successfully',
      token,
      user: { email: cleanEmail, username: cleanUsername }
    });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed: ' + err.message });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const cleanEmail = email.trim().toLowerCase();

    if (isMongoConnected) {
      try {
        const user = await User.findOne({ email: cleanEmail });
        if (user && (await user.comparePassword(password))) {
          const token = generateToken(user.email);
          setAuthCookie(res, token);
          return res.status(200).json({
            message: 'Login successful',
            token,
            user: { email: user.email, username: user.username }
          });
        } else if (user) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }
      } catch (dbErr) {
        if (dbErr.name === 'MongooseError' || dbErr.name === 'MongoNetworkError') {
          isMongoConnected = false;
        }
      }
    }

    // In-memory fallback
    const memUser = inMemoryUsers.find(u => u.email.toLowerCase() === cleanEmail);
    if (memUser) {
      const match = await bcrypt.compare(password, memUser.password);
      if (match) {
        const token = generateToken(memUser.email);
        setAuthCookie(res, token);
        return res.status(200).json({
          message: 'Login successful',
          token,
          user: { email: memUser.email, username: memUser.username }
        });
      } else {
        return res.status(401).json({ error: 'Invalid credentials. Please verify password.' });
      }
    }

    // Auto-register convenience in in-memory mode so citizens are never locked out
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const newUser = {
      _id: 'user_' + Date.now(),
      username: cleanEmail.split('@')[0],
      email: cleanEmail,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    };
    inMemoryUsers.push(newUser);
    saveInMemoryUsers();

    const token = generateToken(cleanEmail);
    setAuthCookie(res, token);
    return res.status(200).json({
      message: 'Login successful',
      token,
      user: { email: cleanEmail, username: newUser.username }
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed: ' + err.message });
  }
});

// Check current session
app.get('/api/me', requireAuth, (req, res) => {
  res.status(200).json({ email: req.user.email });
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    sameSite: 'none',
    secure: true
  });
  res.status(200).json({ message: 'Logged out successfully' });
});

// Submit hazard/crime report (Authenticated)
app.post('/api/crimes', requireAuth, async (req, res) => {
  try {
    const { type, hazardType, location, details, latitude, longitude, address, severity: reqSeverity } = req.body;

    const actualType = hazardType || type;
    if (!actualType) {
      return res.status(400).json({ message: 'Hazard type is required' });
    }

    let finalSeverity = 5; // default moderate
    if (reqSeverity !== undefined && !isNaN(Number(reqSeverity))) {
      finalSeverity = Math.max(1, Math.min(10, Number(reqSeverity)));
    } else {
      const redSeverityCrimes = ['murder', 'rape', 'robbery', 'violent assault', 'violent_assault', 'road accident', 'flooded road', 'fire hazard'];
      const crimeTypeLower = String(actualType).toLowerCase();
      if (redSeverityCrimes.some(k => crimeTypeLower.includes(k))) {
        finalSeverity = 8;
      } else {
        finalSeverity = 5;
      }
    }

    const lat = Number(latitude) || 0;
    const lon = Number(longitude) || 0;
    const locText = location || address || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

    const crimeData = {
      _id: 'crime_' + Date.now(),
      id: 'crime_' + Date.now(),
      type: actualType,
      hazardType: actualType,
      location: locText,
      address: address || locText,
      details: details || locText,
      description: details || locText,
      latitude: lat,
      longitude: lon,
      severity: finalSeverity,
      upvotes: 1,
      downvotes: 0,
      upvotedBy: [req.user.email],
      downvotedBy: [],
      status: 'verified',
      verificationCount: 1,
      reportedBy: req.user.email,
      createdAt: new Date()
    };

    if (isMongoConnected) {
      try {
        const newCrime = new Crime({
          type: actualType,
          location: locText,
          details: details || locText,
          latitude: lat,
          longitude: lon,
          address: address || locText,
          severity: finalSeverity,
          upvotes: 1,
          downvotes: 0,
          upvotedBy: [req.user.email]
        });
        await newCrime.save();
        inMemoryCrimes.unshift(newCrime.toObject());
        return res.status(201).json({ message: 'Hazard report submitted successfully!', crime: newCrime });
      } catch (dbErr) {
        if (dbErr.name === 'MongooseError' || dbErr.name === 'MongoNetworkError') {
          isMongoConnected = false;
        }
      }
    }

    // In-memory operation
    inMemoryCrimes.unshift(crimeData);
    res.status(201).json({ message: 'Hazard report submitted successfully!', crime: crimeData });
  } catch (error) {
    console.error('Error submitting hazard report:', error);
    res.status(500).json({ message: 'Error submitting hazard report', error: error.message });
  }
});

// Get all crimes, sorted by upvotes (Public)
app.get('/api/crimes', async (req, res) => {
  try {
    if (isMongoConnected) {
      try {
        const crimes = await Crime.find().sort({ upvotes: -1 });
        return res.status(200).json(combineCrimes(crimes));
      } catch (dbErr) {
        if (dbErr.name === 'MongooseError' || dbErr.name === 'MongoNetworkError') {
          isMongoConnected = false;
        }
      }
    }

    // Keep file-backed hazards visible alongside MongoDB records.
    res.status(200).json(combineCrimes());
  } catch (error) {
    console.error('Error fetching crimes:', error);
    res.status(500).json({ message: 'Error fetching crimes', error: error.message });
  }
});

// Upvote a crime (Authenticated)
app.post('/api/crimes/:id/upvote', requireAuth, async (req, res) => {
  try {
    const userEmail = req.user.email;

    if (isMongoConnected) {
      try {
        const crime = await Crime.findById(req.params.id);
        if (crime) {
          if (crime.upvotedBy.includes(userEmail)) {
            return res.status(200).json({ message: 'You have already upvoted this crime', crime });
          }
          if (crime.downvotedBy.includes(userEmail)) {
            crime.downvotes--;
            crime.downvotedBy = crime.downvotedBy.filter(email => email !== userEmail);
          }
          crime.upvotes++;
          crime.upvotedBy.push(userEmail);
          await crime.save();
          return res.status(200).json(crime);
        }
      } catch (dbErr) {
        if (dbErr.name === 'MongooseError' || dbErr.name === 'MongoNetworkError') {
          isMongoConnected = false;
        }
      }
    }

    // In-memory upvote fallback
    const crime = inMemoryCrimes.find(c => String(c._id) === String(req.params.id));
    if (!crime) {
      return res.status(404).json({ message: 'Crime not found' });
    }

    if (crime.upvotedBy.includes(userEmail)) {
      return res.status(200).json({ message: 'You have already upvoted this crime', crime });
    }

    if (crime.downvotedBy.includes(userEmail)) {
      crime.downvotes--;
      crime.downvotedBy = crime.downvotedBy.filter(email => email !== userEmail);
    }

    crime.upvotes++;
    crime.upvotedBy.push(userEmail);
    return res.status(200).json(crime);
  } catch (error) {
    console.error('Error upvoting crime:', error);
    res.status(500).json({ message: 'Error upvoting crime', error: error.message });
  }
});

// Downvote a crime (Authenticated)
app.post('/api/crimes/:id/downvote', requireAuth, async (req, res) => {
  try {
    const userEmail = req.user.email;

    if (isMongoConnected) {
      try {
        const crime = await Crime.findById(req.params.id);
        if (crime) {
          if (crime.downvotedBy.includes(userEmail)) {
            return res.status(200).json({ message: 'You have already downvoted this crime', crime });
          }
          if (crime.upvotedBy.includes(userEmail)) {
            crime.upvotes--;
            crime.upvotedBy = crime.upvotedBy.filter(email => email !== userEmail);
          }
          crime.downvotes++;
          crime.downvotedBy.push(userEmail);
          await crime.save();
          return res.status(200).json(crime);
        }
      } catch (dbErr) {
        if (dbErr.name === 'MongooseError' || dbErr.name === 'MongoNetworkError') {
          isMongoConnected = false;
        }
      }
    }

    // In-memory downvote fallback
    const crime = inMemoryCrimes.find(c => String(c._id) === String(req.params.id));
    if (!crime) {
      return res.status(404).json({ message: 'Crime not found' });
    }

    if (crime.downvotedBy.includes(userEmail)) {
      return res.status(200).json({ message: 'You have already downvoted this crime', crime });
    }

    if (crime.upvotedBy.includes(userEmail)) {
      crime.upvotes--;
      crime.upvotedBy = crime.upvotedBy.filter(email => email !== userEmail);
    }

    crime.downvotes++;
    crime.downvotedBy.push(userEmail);
    return res.status(200).json(crime);
  } catch (error) {
    console.error('Error downvoting crime:', error);
    res.status(500).json({ message: 'Error downvoting crime', error: error.message });
  }
});

// Endpoint to fetch hazard configuration & scoring rules
app.get('/api/hazard-config', (req, res) => {
  res.status(200).json({
    hazardWeights: HAZARD_WEIGHTS,
    hazardRadii: HAZARD_INFLUENCE_RADIUS_METERS,
    routingConstants: ROUTING_CONSTANTS,
    safetyLevels: SAFETY_LEVELS
  });
});

// Navigation & Safety-Aware Route Generation Endpoint
app.post('/api/routes', async (req, res) => {
  try {
    const { source, destination } = req.body;

    if (!source || !destination) {
      return res.status(400).json({ message: 'Source and destination are required' });
    }

    const startLat = parseFloat(source.lat || source.latitude);
    const startLon = parseFloat(source.lon || source.lng || source.longitude);
    const endLat = parseFloat(destination.lat || destination.latitude);
    const endLon = parseFloat(destination.lon || destination.lng || destination.longitude);

    if (isNaN(startLat) || isNaN(startLon) || isNaN(endLat) || isNaN(endLon)) {
      return res.status(400).json({ message: 'Invalid latitude or longitude format' });
    }

    // Fetch active crimes/hazards from DB or in-memory fallback
    let hazards = [];
    if (isMongoConnected) {
      try {
        hazards = combineCrimes(await Crime.find());
      } catch (dbErr) {
        if (dbErr.name === 'MongooseError' || dbErr.name === 'MongoNetworkError') {
          isMongoConnected = false;
          hazards = inMemoryCrimes;
        }
      }
    } else {
      hazards = inMemoryCrimes;
    }

    const routeResults = await generateRoutes(startLat, startLon, endLat, endLon, hazards);

    res.status(200).json({
      ...routeResults,
      source: { lat: startLat, lon: startLon },
      destination: { lat: endLat, lon: endLon }
    });
  } catch (error) {
    console.error('Error generating routes:', error);
    res.status(500).json({ message: 'Error generating routes', error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
