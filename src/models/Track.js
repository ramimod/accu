const mongoose = require('mongoose');

const trackSchema = new mongoose.Schema({
  originalId: { type: String, index: true, unique: true, sparse: true },
  track_artist: { type: String, required: true },
  title: { type: String, required: true },
  fn: String,
  primary: String,
  secondary: String,
  holiday: Boolean,
  duration: Number,
  unedited_duration: Number,
  calculatedWeight: Number,
  listfrom: String,
  created_by: String,
  approved_by: String,
  job: String,
  oldid: Number,
  
  // References to related documents
  album: { type: mongoose.Schema.Types.ObjectId, ref: 'Album' },
  artist: { type: mongoose.Schema.Types.ObjectId, ref: 'Artist' },
  composer: { type: mongoose.Schema.Types.ObjectId, ref: 'Composer' }
}, { 
  timestamps: true,
  collection: 'tracks'
});

// Compound index for finding duplicates
trackSchema.index({ track_artist: 1, title: 1, fn: 1 });

module.exports = mongoose.model('Track', trackSchema);
