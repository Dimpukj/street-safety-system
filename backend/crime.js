const mongoose = require('mongoose');

const crimeSchema = new mongoose.Schema({
    type: {
        type: String,
        required: true
    },
    location: {
        type: String,
        required: true
    },
    latitude: {
        type: Number,
        required: true
    },
    longitude: {
        type: Number,
        required: true
    },
    severity: {
        type: Number,
        min: 1,
        max: 10,
        required: true
    },
    address: { // Add this new field
        type: String,
        required: true
    },
    details: {
        type: String
    },
    upvotes: {
        type: Number,
        default: 0
    },
    downvotes: {
        type: Number,
        default: 0
    },
    upvotedBy: { // New field to store user emails who upvoted
        type: [String],
        default: []
    },
    downvotedBy: { // New field to store user emails who downvoted
        type: [String],
        default: []
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Crime', crimeSchema, 'crime'); // Explicitly set collection name