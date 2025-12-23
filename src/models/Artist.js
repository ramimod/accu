const mongoose = require('mongoose');

const artistSchema = new mongoose.Schema({
  originalId: { type: String, index: true, unique: true, sparse: true },
  artistdisplay: { type: String, required: true },
  artistcat: String,
  created_by: String,
  approved_by: String,
  job: String,
  oldid: Number
}, { 
  timestamps: true,
  collection: 'artists'
});

module.exports = mongoose.model('Artist', artistSchema);
