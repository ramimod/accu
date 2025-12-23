const mongoose = require('mongoose');

const adSchema = new mongoose.Schema({
  track_artist: { type: String, default: 'runspot' },
  title: { type: String, default: 'sweeper' },
  ad_type: { type: String, enum: ['paid', 'unpaid'] },
  ad_source: String,
  fn: String,
  fn_as: String,
  fn_ar: String
}, { 
  timestamps: true,
  collection: 'ads'
});

module.exports = mongoose.model('Ad', adSchema);
