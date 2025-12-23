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
  try {
    await db.connect();
    
    // Show current stats
    await showStats();
    
    if (config.PARSE_URL === 'YOUR_URL_HERE') {
      console.log('⚠ Please set PARSE_URL in src/config.js or environment variable');
      console.log('  Example: PARSE_URL=https://example.com/api/tracks node src/index.js\n');
    } else {
      // Parse and store data from URL
      await parseAndStore(config.PARSE_URL);
      
      // Show updated stats
      await showStats();
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await db.disconnect();
  }
}

main();
