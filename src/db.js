const mongoose = require('mongoose');
const config = require('./config');

async function connect() {
  try {
    await mongoose.connect(config.MONGODB_URI);
    console.log('✓ Connected to MongoDB');
    return mongoose.connection;
  } catch (error) {
    console.error('✗ MongoDB connection error:', error.message);
    throw error;
  }
}

async function disconnect() {
  await mongoose.disconnect();
  console.log('✓ Disconnected from MongoDB');
}

module.exports = {
  connect,
  disconnect
};
