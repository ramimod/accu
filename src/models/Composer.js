const mongoose = require('mongoose');

const composerSchema = new mongoose.Schema({
  originalId: { type: String, index: true, unique: true, sparse: true },
  display: String,
  value: String,
  cat: String,
  created_by: String,
  approved_by: String,
  job: String,
  oldid: Number
}, { 
  timestamps: true,
  collection: 'composers'
});

module.exports = mongoose.model('Composer', composerSchema);
