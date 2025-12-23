const mongoose = require('mongoose');

const albumSchema = new mongoose.Schema({
  originalId: { type: String, index: true, unique: true, sparse: true },
  asin: { type: String, index: true },
  title: { type: String, required: true },
  label: String,
  year: String,
  cdcover: String,
  localImage: String,
  buyalbum: String,
  itunes: String,
  itunes_id: Number,
  created_by: String,
  approved_by: String,
  pending_id: String,
  job: String
}, { 
  timestamps: true,
  collection: 'albums'
});

module.exports = mongoose.model('Album', albumSchema);
