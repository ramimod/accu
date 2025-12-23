const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { Album, Artist, Composer, Track, Ad } = require('../models');

// Directory for downloaded images
const IMGS_DIR = path.join(__dirname, '..', 'imgs');

// Ensure imgs directory exists
if (!fs.existsSync(IMGS_DIR)) {
  fs.mkdirSync(IMGS_DIR, { recursive: true });
}

// Background image download queue
let imageQueue = [];
let isProcessingImages = false;

/**
 * Get the local filename for a cdcover path
 */
function getLocalFilename(cdcover) {
  if (!cdcover) return null;
  return cdcover.replace('/covers/', '').replace(/\//g, '_');
}

/**
 * Get the full local path for a cdcover
 */
function getLocalPath(cdcover) {
  const filename = getLocalFilename(cdcover);
  return filename ? path.join(IMGS_DIR, filename) : null;
}

/**
 * Queue an image for background download
 */
function queueImageDownload(cdcover, albumId) {
  if (!cdcover) return;
  
  const localPath = getLocalPath(cdcover);
  
  // Check if already downloaded
  if (fs.existsSync(localPath)) {
    return;
  }
  
  // Check if already in queue
  if (imageQueue.some(item => item.cdcover === cdcover)) {
    return;
  }
  
  imageQueue.push({ cdcover, albumId, localPath });
  console.log(`    📷 Queued image for download: ${getLocalFilename(cdcover)}`);
  
  // Start processing if not already running
  if (!isProcessingImages) {
    processImageQueue();
  }
}

/**
 * Process the image download queue in the background
 */
async function processImageQueue() {
  if (isProcessingImages || imageQueue.length === 0) return;
  
  isProcessingImages = true;
  console.log(`\n🖼️  Starting background image download (${imageQueue.length} images queued)...`);
  
  while (imageQueue.length > 0) {
    const item = imageQueue.shift();
    await downloadImageNow(item.cdcover, item.albumId, item.localPath);
    
    // Small delay between downloads to be nice to the server
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  isProcessingImages = false;
  console.log(`🖼️  Background image download complete.\n`);
}

/**
 * Download an image immediately
 */
async function downloadImageNow(cdcover, albumId, localPath) {
  if (!cdcover) return null;
  
  // Build URL - cdcover is like /covers/g-m/album.jpg
  // Actual URL is https://www.accuradio.com/static/images/covers300/covers/g-m/album.jpg
  const coverPath = cdcover.startsWith('/') ? cdcover.substring(1) : cdcover;
  const imageUrl = `https://www.accuradio.com/static/images/covers300/${coverPath}`;
  const filename = getLocalFilename(cdcover);
  
  // Check if already downloaded
  if (fs.existsSync(localPath)) {
    return localPath;
  }
  
  console.log(`    📥 Downloading: ${imageUrl}`);
  
  try {
    const response = await axios({
      method: 'GET',
      url: imageUrl,
      responseType: 'arraybuffer',
      headers: {
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': 'https://www.accuradio.com/',
        'Origin': 'https://www.accuradio.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'same-origin'
      },
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 300
    });
    
    // Check if we got actual image data
    if (!response.data || response.data.length === 0) {
      console.log(`    ✗ Empty response for: ${filename}`);
      return null;
    }
    
    // Write the file
    fs.writeFileSync(localPath, response.data);
    
    console.log(`    ✓ Downloaded: ${filename} (${response.data.length} bytes)`);
    
    // Update album with local image path
    if (albumId) {
      await Album.findByIdAndUpdate(albumId, { localImage: localPath });
    }
    
    return localPath;
  } catch (error) {
    console.log(`    ✗ Failed: ${filename} - ${error.response?.status || error.message}`);
    return null;
  }
}

/**
 * Get image queue status
 */
function getImageQueueStatus() {
  return {
    pending: imageQueue.length,
    isProcessing: isProcessingImages
  };
}

/**
 * Extract MongoDB ObjectId string from various formats
 */
function extractId(idObj) {
  if (!idObj) return null;
  if (typeof idObj === 'string') return idObj;
  if (idObj.$oid) return idObj.$oid;
  return null;
}

/**
 * Fetch data from URL
 */
async function fetchFromUrl(url) {
  try {
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error('Error fetching URL:', error.message);
    throw error;
  }
}

/**
 * Check if an item is an ad/sweeper
 */
function isAd(item) {
  return item.track_artist === 'runspot' && item.title === 'sweeper';
}

/**
 * Process and save an album
 */
async function processAlbum(albumData) {
  if (!albumData) return null;
  
  const originalId = extractId(albumData._id);
  if (!originalId) return null;
  
  // Skip if no title (required field)
  if (!albumData.title) {
    console.log(`  ⚠ Skipping album without title (id: ${originalId})`);
    return null;
  }
  
  // Check if album already exists
  let album = await Album.findOne({ originalId });
  if (album) {
    // Queue image download if not already done
    if (albumData.cdcover && !album.localImage) {
      queueImageDownload(albumData.cdcover, album._id);
    }
    return album;
  }
  
  // Create new album (don't wait for image download)
  album = new Album({
    originalId,
    asin: albumData.asin,
    title: albumData.title,
    label: albumData.label,
    year: albumData.year,
    cdcover: albumData.cdcover,
    localImage: null, // Will be set by background download
    buyalbum: albumData.buyalbum,
    itunes: albumData.itunes,
    itunes_id: albumData.itunes_id,
    created_by: albumData.created_by,
    approved_by: albumData.approved_by,
    pending_id: albumData.pending_id,
    job: extractId(albumData.job)
  });
  
  await album.save();
  console.log(`  ✓ Created album: ${album.title}`);
  
  // Queue image for background download
  if (albumData.cdcover) {
    queueImageDownload(albumData.cdcover, album._id);
  }
  
  return album;
}

/**
 * Process and save an artist
 */
async function processArtist(artistData) {
  if (!artistData) return null;
  
  const originalId = extractId(artistData._id);
  if (!originalId) return null;
  
  // Check if artist already exists
  let artist = await Artist.findOne({ originalId });
  if (artist) return artist;
  
  // Create new artist
  artist = new Artist({
    originalId,
    artistdisplay: artistData.artistdisplay,
    artistcat: artistData.artistcat,
    created_by: artistData.created_by,
    approved_by: artistData.approved_by,
    job: extractId(artistData.job),
    oldid: artistData.oldid
  });
  
  await artist.save();
  console.log(`  ✓ Created artist: ${artist.artistdisplay}`);
  return artist;
}

/**
 * Process and save a composer
 */
async function processComposer(composerData) {
  if (!composerData) return null;
  
  const originalId = extractId(composerData._id);
  if (!originalId) return null;
  
  // Check if composer already exists
  let composer = await Composer.findOne({ originalId });
  if (composer) return composer;
  
  // Create new composer
  composer = new Composer({
    originalId,
    display: composerData.display,
    value: composerData.value,
    cat: composerData.cat,
    created_by: composerData.created_by,
    approved_by: composerData.approved_by,
    job: extractId(composerData.job),
    oldid: composerData.oldid
  });
  
  await composer.save();
  console.log(`  ✓ Created composer: ${composer.display || composer.value}`);
  return composer;
}

/**
 * Process and save a track
 */
async function processTrack(trackData, album, artist, composer) {
  const originalId = extractId(trackData._id) || extractId(trackData.id);
  
  // Check if track already exists by originalId
  if (originalId) {
    const existingTrack = await Track.findOne({ originalId });
    if (existingTrack) {
      console.log(`  → Track already exists: ${trackData.title}`);
      return { track: existingTrack, isNew: false };
    }
  }
  
  // Also check by track_artist + title + fn combination
  const existingByContent = await Track.findOne({
    track_artist: trackData.track_artist,
    title: trackData.title,
    fn: trackData.fn
  });
  
  if (existingByContent) {
    console.log(`  → Track already exists (by content): ${trackData.title}`);
    return { track: existingByContent, isNew: false };
  }
  
  // Create new track
  const track = new Track({
    originalId,
    track_artist: trackData.track_artist,
    title: trackData.title,
    fn: trackData.fn,
    primary: trackData.primary,
    secondary: trackData.secondary,
    holiday: trackData.holiday,
    duration: trackData.duration,
    unedited_duration: trackData.unedited_duration,
    calculatedWeight: trackData.calculatedWeight,
    listfrom: trackData.listfrom,
    created_by: trackData.created_by,
    approved_by: trackData.approved_by,
    job: extractId(trackData.job),
    oldid: trackData.oldid,
    album: album?._id,
    artist: artist?._id,
    composer: composer?._id
  });
  
  await track.save();
  console.log(`  ✓ Created track: ${track.track_artist} - ${track.title}`);
  return { track, isNew: true };
}

/**
 * Process and save an ad
 */
async function processAd(adData) {
  const ad = new Ad({
    track_artist: adData.track_artist,
    title: adData.title,
    ad_type: adData.ad_type,
    ad_source: adData.ad_source,
    fn: adData.fn,
    fn_as: adData.fn_as,
    fn_ar: adData.fn_ar
  });
  
  await ad.save();
  return ad;
}

/**
 * Parse and store all data from URL
 */
async function parseAndStore(url) {
  console.log(`\nFetching data from: ${url}\n`);
  
  const data = await fetchFromUrl(url);
  
  if (!Array.isArray(data)) {
    throw new Error('Expected array of items from URL');
  }
  
  console.log(`Found ${data.length} items to process\n`);
  
  const stats = {
    tracks: { new: 0, existing: 0 },
    albums: { new: 0, existing: 0 },
    artists: { new: 0, existing: 0 },
    composers: { new: 0, existing: 0 },
    ads: 0
  };
  
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    console.log(`Processing item ${i + 1}/${data.length}...`);
    
    if (isAd(item)) {
      await processAd(item);
      stats.ads++;
      console.log(`  ✓ Saved ad (${item.ad_type})`);
      continue;
    }
    
    // Process related entities
    const album = await processAlbum(item.album);
    const artist = await processArtist(item.artist);
    const composer = await processComposer(item.composer);
    
    // Process track
    const { track, isNew } = await processTrack(item, album, artist, composer);
    
    if (isNew) {
      stats.tracks.new++;
    } else {
      stats.tracks.existing++;
    }
  }
  
  console.log('\n=== Import Summary ===');
  console.log(`Tracks: ${stats.tracks.new} new, ${stats.tracks.existing} existing`);
  console.log(`Ads processed: ${stats.ads}`);
  console.log('======================\n');
  
  return stats;
}

/**
 * Parse and store from JSON data directly
 */
async function parseAndStoreFromData(data) {
  if (!Array.isArray(data)) {
    throw new Error('Expected array of items');
  }
  
  console.log(`Processing ${data.length} items\n`);
  
  const stats = {
    tracks: { new: 0, existing: 0 },
    ads: 0
  };
  
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    console.log(`Processing item ${i + 1}/${data.length}...`);
    
    if (isAd(item)) {
      await processAd(item);
      stats.ads++;
      console.log(`  ✓ Saved ad (${item.ad_type})`);
      continue;
    }
    
    // Process related entities
    const album = await processAlbum(item.album);
    const artist = await processArtist(item.artist);
    const composer = await processComposer(item.composer);
    
    // Process track
    const { isNew } = await processTrack(item, album, artist, composer);
    
    if (isNew) {
      stats.tracks.new++;
    } else {
      stats.tracks.existing++;
    }
  }
  
  console.log('\n=== Import Summary ===');
  console.log(`Tracks: ${stats.tracks.new} new, ${stats.tracks.existing} existing`);
  console.log(`Ads processed: ${stats.ads}`);
  console.log('======================\n');
  
  return stats;
}

module.exports = {
  fetchFromUrl,
  parseAndStore,
  parseAndStoreFromData,
  getImageQueueStatus,
  queueImageDownload
};
