/**
 * Standalone fetch script - run this to fetch and store data
 * Usage: node src/fetch.js <URL>
 * Or set PARSE_URL environment variable
 */

const db = require('./db');
const config = require('./config');
const { parseAndStore } = require('./services/parser');
const { Track, Album, Artist, Ad } = require('./models');

async function showStats() {
  const trackCount = await Track.countDocuments();
  const albumCount = await Album.countDocuments();
  const artistCount = await Artist.countDocuments();
  const adCount = await Ad.countDocuments();
  
  console.log('\n=== Database Statistics ===');
  console.log(`Tracks:  ${trackCount}`);
  console.log(`Albums:  ${albumCount}`);
  console.log(`Artists: ${artistCount}`);
  console.log(`Ads:     ${adCount}`);
  console.log('===========================\n');
}

async function main() {
  const url = process.argv[2] || config.PARSE_URL;
  
  if (!url || url === 'YOUR_URL_HERE') {
    console.log('Usage: node src/fetch.js <URL>');
    console.log('  Or set PARSE_URL in src/config.js or environment variable\n');
    process.exit(1);
  }
  
  try {
    await db.connect();
    
    console.log('Before fetch:');
    await showStats();
    
    // Parse and store data
    await parseAndStore(url);
    
    console.log('After fetch:');
    await showStats();
    
    // Show recent tracks
    console.log('=== Recent Tracks ===');
    const recentTracks = await Track.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('album', 'title')
      .populate('artist', 'artistdisplay');
    
    recentTracks.forEach(track => {
      console.log(`• ${track.track_artist} - "${track.title}"`);
      if (track.album) console.log(`  Album: ${track.album.title}`);
    });
    console.log('=====================\n');
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await db.disconnect();
  }
}

main();
