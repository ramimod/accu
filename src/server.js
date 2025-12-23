/**
 * Simple HTTP server with refresh endpoint
 * Start with: node src/server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const AdmZip = require('adm-zip');
const db = require('./db');
const config = require('./config');
const { parseAndStore, getImageQueueStatus, queueImageDownload } = require('./services/parser');
const { Track, Album, Artist, Ad, Composer } = require('./models');

const PORT = process.env.PORT || 3000;
const IMGS_DIR = path.join(__dirname, 'imgs');

async function getStats() {
  const trackCount = await Track.countDocuments();
  const albumCount = await Album.countDocuments();
  const artistCount = await Artist.countDocuments();
  const adCount = await Ad.countDocuments();
  
  return { tracks: trackCount, albums: albumCount, artists: artistCount, ads: adCount };
}

async function getRecentTracks(limit = 10) {
  return Track.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('album', 'title year cdcover localImage')
    .populate('artist', 'artistdisplay')
    .populate('composer', 'display')
    .lean();
}

async function getAllTracks() {
  return Track.find()
    .sort({ createdAt: -1 })
    .populate('album', 'title year cdcover label localImage')
    .populate('artist', 'artistdisplay artistcat')
    .populate('composer', 'display value')
    .lean();
}

async function getAllArtists() {
  const artists = await Artist.find().sort({ artistdisplay: 1 }).lean();
  
  // Get track count for each artist
  const trackCounts = await Track.aggregate([
    { $group: { _id: '$artist', count: { $sum: 1 } } }
  ]);
  
  const countMap = {};
  trackCounts.forEach(tc => {
    if (tc._id) countMap[tc._id.toString()] = tc.count;
  });
  
  return artists.map(a => ({
    ...a,
    trackCount: countMap[a._id.toString()] || 0
  }));
}

async function getGenres() {
  // Get unique genres with track counts
  const genres = await Track.aggregate([
    { $lookup: { from: 'artists', localField: 'artist', foreignField: '_id', as: 'artistData' } },
    { $unwind: { path: '$artistData', preserveNullAndEmptyArrays: true } },
    { $group: { 
      _id: '$artistData.artistcat',
      count: { $sum: 1 },
      artists: { $addToSet: '$artistData._id' }
    }},
    { $sort: { count: -1 } }
  ]);
  
  return genres.map(g => ({
    name: g._id || 'Unknown',
    trackCount: g.count,
    artistCount: g.artists.filter(a => a).length
  }));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // Serve images from /imgs/*
  if (url.pathname.startsWith('/imgs/') && req.method === 'GET') {
    const filename = decodeURIComponent(url.pathname.replace('/imgs/', ''));
    const imagePath = path.join(IMGS_DIR, filename);
    
    // Security: prevent directory traversal
    if (!imagePath.startsWith(IMGS_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    
    if (fs.existsSync(imagePath)) {
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
      };
      
      res.writeHead(200, { 
        'Content-Type': mimeTypes[ext] || 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000'
      });
      fs.createReadStream(imagePath).pipe(res);
      return;
    } else {
      res.writeHead(404);
      res.end('Image not found');
      return;
    }
  }
  
  try {
    // GET /stats - Get database statistics
    if (url.pathname === '/stats' && req.method === 'GET') {
      const stats = await getStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
      return;
    }
    
    // GET /images/status - Get image download queue status
    if (url.pathname === '/images/status' && req.method === 'GET') {
      const status = getImageQueueStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }
    
    // POST /images/download - Queue image downloads for albums
    if (url.pathname === '/images/download' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { albumIds } = JSON.parse(body);
          if (!albumIds || !Array.isArray(albumIds)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'albumIds array required' }));
            return;
          }
          
          // Find albums that need images
          const albums = await Album.find({ 
            _id: { $in: albumIds },
            cdcover: { $exists: true, $ne: null },
            localImage: { $exists: false }
          }).lean();
          
          // Queue them for download
          albums.forEach(album => {
            if (album.cdcover) {
              queueImageDownload(album.cdcover, album._id);
            }
          });
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ queued: albums.length }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
    
    // GET /tracks - Get all tracks
    if (url.pathname === '/tracks' && req.method === 'GET') {
      const tracks = await getAllTracks();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(tracks));
      return;
    }
    
    // GET /artists - Get all artists with track counts
    if (url.pathname === '/artists' && req.method === 'GET') {
      const artists = await getAllArtists();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(artists));
      return;
    }
    
    // GET /genres - Get all genres with counts
    if (url.pathname === '/genres' && req.method === 'GET') {
      const genres = await getGenres();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(genres));
      return;
    }
    
    // GET /tracks/recent - Get recent tracks
    if (url.pathname === '/tracks/recent' && req.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit')) || 10;
      const tracks = await getRecentTracks(limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(tracks));
      return;
    }
    
    // GET /tracks/:id - Get single track details
    const trackMatch = url.pathname.match(/^\/tracks\/([a-f0-9]{24})$/);
    if (trackMatch && req.method === 'GET') {
      const trackId = trackMatch[1];
      const track = await Track.findById(trackId)
        .populate('album')
        .populate('artist')
        .populate('composer')
        .lean();
      
      if (!track) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Track not found' }));
        return;
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(track));
      return;
    }
    
    // POST /refresh - Refresh data from URL
    if (url.pathname === '/refresh' && req.method === 'POST') {
      const parseUrl = url.searchParams.get('url') || config.PARSE_URL;
      
      if (!parseUrl || parseUrl === 'YOUR_URL_HERE') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No URL configured. Pass ?url=YOUR_URL or set PARSE_URL' }));
        return;
      }
      
      console.log(`\n[${new Date().toISOString()}] Refreshing data from: ${parseUrl}`);
      
      const statsBefore = await getStats();
      const result = await parseAndStore(parseUrl);
      const statsAfter = await getStats();
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        before: statsBefore,
        after: statsAfter,
        newTracks: result.tracks.new,
        existingTracks: result.tracks.existing
      }));
      return;
    }
    
    // GET / - Home page with simple UI
    if (url.pathname === '/' && req.method === 'GET') {
      const stats = await getStats();
      const recentTracks = await getRecentTracks(20);
      
      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AccuRadio Parser</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #eee; padding: 20px; padding-bottom: 100px; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { color: #00d9ff; margin-bottom: 20px; }
    .stats { display: flex; gap: 20px; margin-bottom: 30px; flex-wrap: wrap; }
    .stat-card { background: #16213e; padding: 20px; border-radius: 10px; min-width: 150px; }
    .stat-card h3 { color: #888; font-size: 14px; text-transform: uppercase; }
    .stat-card .value { font-size: 36px; font-weight: bold; color: #00d9ff; }
    .refresh-section { margin-bottom: 30px; }
    .refresh-btn { background: #00d9ff; color: #1a1a2e; border: none; padding: 12px 24px; font-size: 16px; border-radius: 5px; cursor: pointer; font-weight: bold; }
    .refresh-btn:hover { background: #00b8d9; }
    .refresh-btn:disabled { background: #555; cursor: not-allowed; }
    #url-input { padding: 12px; font-size: 14px; border: none; border-radius: 5px; width: 400px; margin-right: 10px; background: #16213e; color: #eee; }
    .tracks-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    .tracks-table th, .tracks-table td { padding: 12px; text-align: left; border-bottom: 1px solid #333; }
    .tracks-table th { color: #888; text-transform: uppercase; font-size: 12px; }
    .tracks-table tr:hover { background: #16213e; }
    .album-cover { width: 40px; height: 40px; border-radius: 4px; background: #333; }
    .status { padding: 10px; margin: 10px 0; border-radius: 5px; display: none; }
    .status.success { background: #1e4d2b; display: block; }
    .status.error { background: #4d1e1e; display: block; }
    .delete-btn { background: #dc3545; color: white; border: none; padding: 12px 24px; font-size: 16px; border-radius: 5px; cursor: pointer; font-weight: bold; margin-left: 10px; }
    .delete-btn:hover { background: #c82333; }
    .delete-btn:disabled { background: #555; cursor: not-allowed; }
    .export-btn { background: #28a745; color: white; border: none; padding: 12px 24px; font-size: 16px; border-radius: 5px; cursor: pointer; font-weight: bold; margin-left: 10px; }
    .export-btn:hover { background: #218838; }
    .import-btn { background: #6f42c1; color: white; border: none; padding: 12px 24px; font-size: 16px; border-radius: 5px; cursor: pointer; font-weight: bold; margin-left: 10px; }
    .import-btn:hover { background: #5a2d9e; }
    #import-file { display: none; }
    .image-status { display: inline-block; padding: 8px 16px; background: #16213e; border-radius: 5px; margin-left: 10px; font-size: 14px; }
    .image-status.downloading { background: #1a4a1a; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
    .tracks-table tbody tr { cursor: pointer; }
    .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: none; justify-content: center; align-items: center; z-index: 1000; }
    .modal-overlay.active { display: flex; }
    .modal { background: #16213e; border-radius: 12px; max-width: 700px; width: 90%; max-height: 90vh; overflow-y: auto; position: relative; }
    .modal-header { display: flex; align-items: center; gap: 20px; padding: 20px; border-bottom: 1px solid #333; }
    .modal-cover { width: 120px; height: 120px; border-radius: 8px; object-fit: cover; background: #333; }
    .modal-title h2 { color: #00d9ff; margin-bottom: 5px; }
    .modal-title p { color: #888; }
    .modal-close { position: absolute; top: 15px; right: 15px; background: none; border: none; color: #888; font-size: 24px; cursor: pointer; }
    .modal-close:hover { color: #fff; }
    .modal-body { padding: 20px; }
    .detail-section { margin-bottom: 20px; }
    .detail-section h3 { color: #00d9ff; font-size: 14px; text-transform: uppercase; margin-bottom: 10px; border-bottom: 1px solid #333; padding-bottom: 5px; }
    .detail-grid { display: grid; grid-template-columns: 140px 1fr; gap: 8px; }
    .detail-label { color: #888; }
    .detail-value { color: #eee; word-break: break-all; }
    .detail-value a { color: #00d9ff; text-decoration: none; }
    .detail-value a:hover { text-decoration: underline; }
    .play-btn { background: #1db954; border: none; color: white; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; }
    .play-btn:hover { background: #1ed760; transform: scale(1.1); }
    .play-btn.playing { background: #dc3545; }
    .search-section { display: flex; gap: 10px; margin-bottom: 20px; align-items: center; }
    #search-input { padding: 12px; font-size: 14px; border: none; border-radius: 5px; width: 300px; background: #16213e; color: #eee; }
    .pagination { display: flex; gap: 10px; align-items: center; margin-top: 20px; justify-content: center; }
    .pagination button { background: #16213e; border: none; color: #eee; padding: 8px 16px; border-radius: 5px; cursor: pointer; }
    .pagination button:hover { background: #1a4a6e; }
    .pagination button:disabled { background: #333; color: #666; cursor: not-allowed; }
    .pagination span { color: #888; }
    .now-playing { position: fixed; bottom: 0; left: 0; right: 0; background: linear-gradient(180deg, #1a2a4e 0%, #16213e 100%); padding: 12px 20px; display: none; align-items: center; gap: 15px; border-top: 2px solid #00d9ff; z-index: 100; box-shadow: 0 -4px 20px rgba(0,0,0,0.5); }
    .now-playing.active { display: flex; }
    .now-playing-cover { width: 56px; height: 56px; border-radius: 6px; object-fit: cover; background: #333; box-shadow: 0 2px 10px rgba(0,0,0,0.3); }
    .now-playing-info { flex: 1; min-width: 0; }
    .now-playing-title { color: #fff; font-weight: 600; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .now-playing-artist { color: #888; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .now-playing-controls { display: flex; gap: 8px; align-items: center; }
    .player-btn { background: none; border: none; color: #888; font-size: 20px; cursor: pointer; padding: 8px; border-radius: 50%; transition: all 0.2s; }
    .player-btn:hover { color: #fff; background: rgba(255,255,255,0.1); }
    .player-btn.main { background: #00d9ff; color: #1a1a2e; width: 44px; height: 44px; font-size: 18px; }
    .player-btn.main:hover { background: #00b8d9; transform: scale(1.05); }
    .now-playing-progress { display: flex; align-items: center; gap: 10px; flex: 1; max-width: 400px; }
    .progress-time { color: #888; font-size: 12px; min-width: 40px; text-align: center; font-variant-numeric: tabular-nums; }
    .progress-bar { flex: 1; height: 4px; background: #333; border-radius: 2px; cursor: pointer; position: relative; }
    .progress-bar:hover { height: 6px; }
    .progress-fill { height: 100%; background: #00d9ff; border-radius: 2px; width: 0%; transition: width 0.1s; }
    .progress-bar:hover .progress-fill { background: #00eeff; }
    .volume-control { display: flex; align-items: center; gap: 6px; }
    .volume-slider { width: 80px; height: 4px; -webkit-appearance: none; background: #333; border-radius: 2px; cursor: pointer; }
    .volume-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; background: #00d9ff; border-radius: 50%; cursor: pointer; }
    .volume-slider::-moz-range-thumb { width: 12px; height: 12px; background: #00d9ff; border-radius: 50%; cursor: pointer; border: none; }
    .now-playing-close { background: none; border: none; color: #666; font-size: 18px; cursor: pointer; padding: 8px; margin-left: 5px; }
    .now-playing-close:hover { color: #dc3545; }
    .nav-tabs { display: flex; gap: 0; margin-bottom: 20px; border-bottom: 2px solid #333; }
    .nav-tab { background: none; border: none; color: #888; padding: 12px 24px; font-size: 16px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all 0.2s; }
    .nav-tab:hover { color: #eee; background: #16213e; }
    .nav-tab.active { color: #00d9ff; border-bottom-color: #00d9ff; }
    .view-panel { display: none; }
    .view-panel.active { display: block; }
    .card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px; margin-top: 20px; }
    .card { background: #16213e; border-radius: 10px; padding: 20px; cursor: pointer; transition: transform 0.2s, background 0.2s; }
    .card:hover { transform: translateY(-2px); background: #1a2a4e; }
    .card h3 { color: #00d9ff; margin-bottom: 8px; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .card p { color: #888; font-size: 14px; }
    .card .count { color: #eee; font-size: 24px; font-weight: bold; margin-top: 10px; }
    .back-btn { background: #16213e; border: none; color: #00d9ff; padding: 8px 16px; border-radius: 5px; cursor: pointer; margin-bottom: 15px; }
    .back-btn:hover { background: #1a4a6e; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎵 Rami's Music Collection</h1>
    
    <div class="stats">
      <div class="stat-card">
        <h3>Tracks</h3>
        <div class="value" id="stat-tracks">${stats.tracks}</div>
      </div>
      <div class="stat-card">
        <h3>Albums</h3>
        <div class="value" id="stat-albums">${stats.albums}</div>
      </div>
      <div class="stat-card">
        <h3>Artists</h3>
        <div class="value" id="stat-artists">${stats.artists}</div>
      </div>
    </div>
    
    <div class="refresh-section" id="admin-section" style="display: none;">
      <input type="text" id="url-input" placeholder="Enter URL to parse (or leave empty for configured URL)">
      <button class="refresh-btn" onclick="refresh()">🔄 Refresh Data</button>
      <button class="delete-btn" onclick="deleteAll()">🗑️ Delete All</button>
      <button class="export-btn" onclick="exportData()">📦 Export</button>
      <button class="import-btn" onclick="document.getElementById('import-file').click()">📥 Import</button>
      <input type="file" id="import-file" accept=".zip" onchange="importData(this)">
      <span id="image-status" class="image-status" style="display:none">🖼️ Images: <span id="image-count">0</span> pending</span>
      <div id="status" class="status"></div>
    </div>
    
    <div class="nav-tabs">
      <button class="nav-tab active" onclick="switchView('tracks')">🎵 Tracks</button>
      <button class="nav-tab" onclick="switchView('artists')">🎤 Artists</button>
    </div>
    
    <!-- Tracks View -->
    <div id="tracks-view" class="view-panel active">
    <div class="search-section">
      <input type="text" id="search-input" placeholder="🔍 Search tracks, artists, albums..." oninput="handleSearch()">
      <span id="results-count" style="color: #888;"></span>
    </div>
    
    <h2 style="margin-bottom: 10px;">Tracks</h2>
    <table class="tracks-table">
      <thead>
        <tr>
          <th style="width: 50px;"></th>
          <th style="width: 50px;"></th>
          <th>Artist</th>
          <th>Title</th>
          <th>Album</th>
          <th>Year</th>
        </tr>
      </thead>
      <tbody id="tracks-body">
      </tbody>
    </table>
    
    <div class="pagination">
      <button id="prev-btn" onclick="prevPage()" disabled>← Previous</button>
      <span id="page-info">Page 1 of 1</span>
      <button id="next-btn" onclick="nextPage()" disabled>Next →</button>
    </div>
    </div>
    
    <!-- Artists View -->
    <div id="artists-view" class="view-panel">
      <div id="artist-list">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h2 style="margin: 0;">🎤 Artists</h2>
          <span id="artist-count" style="color: #888;"></span>
        </div>
        <div style="margin-bottom: 20px;">
          <input type="text" id="artist-search" placeholder="🔍 Search artists by name or genre..." oninput="handleArtistSearch()" style="width: 100%; padding: 14px 20px; font-size: 16px; border: none; border-radius: 8px; background: #16213e; color: #eee; outline: none;">
        </div>
        <div class="card-grid" id="artists-grid"></div>
      </div>
      <div id="artist-detail" style="display: none;">
        <button class="back-btn" onclick="showArtistList()">← Back to Artists</button>
        <h2 id="artist-detail-name" style="color: #00d9ff; margin-bottom: 5px;"></h2>
        <p id="artist-detail-genre" style="color: #888; margin-bottom: 20px;"></p>
        <table class="tracks-table">
          <thead>
            <tr>
              <th style="width: 50px;"></th>
              <th style="width: 50px;"></th>
              <th>Title</th>
              <th>Album</th>
              <th>Year</th>
            </tr>
          </thead>
          <tbody id="artist-tracks-body"></tbody>
        </table>
      </div>
    </div>
  </div>
  
  <!-- Now Playing Bar -->
  <div class="now-playing" id="now-playing">
    <img class="now-playing-cover" id="np-cover" src="" alt="">
    <div class="now-playing-info">
      <div class="now-playing-title" id="np-title"></div>
      <div class="now-playing-artist" id="np-artist"></div>
    </div>
    <div class="now-playing-controls">
      <button class="player-btn" onclick="playPrevious()" title="Previous">⏮</button>
      <button class="player-btn main" id="play-pause-btn" onclick="togglePlayPause()" title="Play/Pause">▶</button>
      <button class="player-btn" onclick="playNext()" title="Next">⏭</button>
    </div>
    <div class="now-playing-progress">
      <span class="progress-time" id="current-time">0:00</span>
      <div class="progress-bar" id="progress-bar" onclick="seekTo(event)">
        <div class="progress-fill" id="progress-fill"></div>
      </div>
      <span class="progress-time" id="duration">0:00</span>
    </div>
    <div class="volume-control">
      <button class="player-btn" id="volume-btn" onclick="toggleMute()" title="Volume">🔊</button>
      <input type="range" class="volume-slider" id="volume-slider" min="0" max="100" value="100" oninput="setVolume(this.value)">
    </div>
    <button class="now-playing-close" onclick="stopPlaying()" title="Close">✕</button>
    <audio id="audio-player" style="display:none;"></audio>
  </div>
  
  <!-- Track Detail Modal -->
  <div class="modal-overlay" id="modal-overlay" onclick="closeModal(event)">
    <div class="modal" onclick="event.stopPropagation()">
      <button class="modal-close" onclick="closeModal()">&times;</button>
      <div class="modal-header">
        <img class="modal-cover" id="modal-cover" src="" alt="">
        <div class="modal-title">
          <h2 id="modal-track-title"></h2>
          <p id="modal-track-artist"></p>
        </div>
      </div>
      <div class="modal-body" id="modal-body">
        Loading...
      </div>
    </div>
  </div>
  
  <script>
    // State
    let allTracks = [];
    let filteredTracks = [];
    let allArtists = [];
    let filteredArtists = [];
    let currentPage = 1;
    const pageSize = 20;
    let currentPlayingId = null;
    let searchTimeout = null;
    let currentView = 'tracks';
    
    // View switching
    function switchView(view) {
      currentView = view;
      document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));
      document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));
      
      document.querySelector('.nav-tab[onclick*=\"' + view + '\"]').classList.add('active');
      document.getElementById(view + '-view').classList.add('active');
      
      if (view === 'artists' && allArtists.length === 0) loadArtists();
    }
    
    // Load all tracks on page load
    async function loadTracks() {
      try {
        const res = await fetch('/tracks');
        allTracks = await res.json();
        filteredTracks = allTracks;
        renderTracks();
        document.getElementById('results-count').textContent = allTracks.length + ' tracks';
      } catch (err) {
        console.error('Failed to load tracks:', err);
      }
    }
    
    function handleSearch() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const query = document.getElementById('search-input').value.toLowerCase().trim();
        if (!query) {
          filteredTracks = allTracks;
        } else {
          filteredTracks = allTracks.filter(track => 
            track.track_artist?.toLowerCase().includes(query) ||
            track.title?.toLowerCase().includes(query) ||
            track.album?.title?.toLowerCase().includes(query) ||
            track.fn?.toLowerCase().includes(query)
          );
        }
        currentPage = 1;
        renderTracks();
        document.getElementById('results-count').textContent = filteredTracks.length + ' tracks';
      }, 300);
    }
    
    function renderTracks() {
      const tbody = document.getElementById('tracks-body');
      const totalPages = Math.ceil(filteredTracks.length / pageSize);
      const start = (currentPage - 1) * pageSize;
      const end = start + pageSize;
      const pageTracks = filteredTracks.slice(start, end);
      
      let html = '';
      const missingImages = [];
      pageTracks.forEach(track => {
        let imgSrc = '';
        if (track.album?.localImage) {
          const filename = track.album.localImage.replace(/^.*[\\\/]/, '');
          imgSrc = '/imgs/' + encodeURIComponent(filename);
        } else if (track.album?.cdcover && track.album?._id) {
          // Queue this album for image download
          missingImages.push(track.album._id);
        }
        const imgHtml = imgSrc ? '<img class="album-cover" src="' + imgSrc + '" alt="" onerror="this.style.display=\\'none\\'">' : '<div class="album-cover"></div>';
        const isPlaying = currentPlayingId === track._id;
        const playBtnClass = isPlaying ? 'play-btn playing' : 'play-btn';
        const playIcon = isPlaying ? '⏹' : '▶';
        
        html += '<tr data-id="' + track._id + '">';
        html += '<td><button class="' + playBtnClass + '" onclick="event.stopPropagation(); togglePlay(\\'' + track._id + '\\')" data-play-id="' + track._id + '">' + playIcon + '</button></td>';
        html += '<td onclick="showTrackDetails(\\'' + track._id + '\\')">' + imgHtml + '</td>';
        html += '<td onclick="showTrackDetails(\\'' + track._id + '\\')">' + (track.track_artist || '-') + '</td>';
        html += '<td onclick="showTrackDetails(\\'' + track._id + '\\')">' + (track.title || '-') + '</td>';
        html += '<td onclick="showTrackDetails(\\'' + track._id + '\\')">' + (track.album?.title || '-') + '</td>';
        html += '<td onclick="showTrackDetails(\\'' + track._id + '\\')">' + (track.album?.year || '-') + '</td>';
        html += '</tr>';
      });
      
      tbody.innerHTML = html;
      
      // Update pagination
      document.getElementById('page-info').textContent = 'Page ' + currentPage + ' of ' + (totalPages || 1);
      document.getElementById('prev-btn').disabled = currentPage <= 1;
      document.getElementById('next-btn').disabled = currentPage >= totalPages;
      
      // Trigger download for missing images
      if (missingImages.length > 0) {
        fetch('/images/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ albumIds: missingImages })
        }).catch(() => {});
      }
    }
    
    function prevPage() {
      if (currentPage > 1) {
        currentPage--;
        renderTracks();
        window.scrollTo(0, 0);
      }
    }
    
    function nextPage() {
      const totalPages = Math.ceil(filteredTracks.length / pageSize);
      if (currentPage < totalPages) {
        currentPage++;
        renderTracks();
        window.scrollTo(0, 0);
      }
    }
    
    function togglePlay(trackId) {
      const audio = document.getElementById('audio-player');
      const nowPlaying = document.getElementById('now-playing');
      
      if (currentPlayingId === trackId) {
        // Stop playing
        stopPlaying();
        return;
      }
      
      // Find track
      const track = allTracks.find(t => t._id === trackId);
      if (!track || !track.fn) return;
      
      // Build audio URL
      const audioUrl = (track.primary || 'https://d1qg6pckcqcdk0.cloudfront.net/') + track.fn + '.m4a';
      
      // Update now playing bar - only use local images
      let imgSrc = '';
      if (track.album?.localImage) {
        const filename = track.album.localImage.replace(/^.*[\\\/]/, '');
        imgSrc = '/imgs/' + encodeURIComponent(filename);
      }
      
      document.getElementById('np-cover').src = imgSrc || '';
      document.getElementById('np-title').textContent = track.title;
      document.getElementById('np-artist').textContent = track.track_artist;
      
      // Play audio
      audio.src = audioUrl;
      audio.play();
      
      currentPlayingId = trackId;
      nowPlaying.classList.add('active');
      
      // Update button states
      updatePlayButtons();
    }
    
    function stopPlaying() {
      const audio = document.getElementById('audio-player');
      const nowPlaying = document.getElementById('now-playing');
      
      audio.pause();
      audio.src = '';
      currentPlayingId = null;
      nowPlaying.classList.remove('active');
      updatePlayButtons();
      document.getElementById('play-pause-btn').textContent = '▶';
    }
    
    function updatePlayButtons() {
      document.querySelectorAll('[data-play-id]').forEach(btn => {
        const id = btn.getAttribute('data-play-id');
        if (id === currentPlayingId) {
          btn.classList.add('playing');
          btn.textContent = '⏹';
        } else {
          btn.classList.remove('playing');
          btn.textContent = '▶';
        }
      });
    }
    
    function togglePlayPause() {
      const audio = document.getElementById('audio-player');
      const btn = document.getElementById('play-pause-btn');
      if (audio.paused) {
        audio.play();
        btn.textContent = '⏸';
      } else {
        audio.pause();
        btn.textContent = '▶';
      }
    }
    
    function formatTime(seconds) {
      if (isNaN(seconds)) return '0:00';
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return mins + ':' + (secs < 10 ? '0' : '') + secs;
    }
    
    function seekTo(event) {
      const audio = document.getElementById('audio-player');
      const bar = document.getElementById('progress-bar');
      const rect = bar.getBoundingClientRect();
      const percent = (event.clientX - rect.left) / rect.width;
      audio.currentTime = percent * audio.duration;
    }
    
    function setVolume(value) {
      const audio = document.getElementById('audio-player');
      audio.volume = value / 100;
      updateVolumeIcon(value);
    }
    
    function toggleMute() {
      const audio = document.getElementById('audio-player');
      const slider = document.getElementById('volume-slider');
      if (audio.volume > 0) {
        audio.dataset.prevVolume = audio.volume;
        audio.volume = 0;
        slider.value = 0;
      } else {
        audio.volume = audio.dataset.prevVolume || 1;
        slider.value = audio.volume * 100;
      }
      updateVolumeIcon(audio.volume * 100);
    }
    
    function updateVolumeIcon(value) {
      const btn = document.getElementById('volume-btn');
      if (value == 0) btn.textContent = '🔇';
      else if (value < 50) btn.textContent = '🔉';
      else btn.textContent = '🔊';
    }
    
    function playNext() {
      if (!currentPlayingId) return;
      const currentIndex = filteredTracks.findIndex(t => t._id === currentPlayingId);
      if (currentIndex < filteredTracks.length - 1) {
        togglePlay(filteredTracks[currentIndex + 1]._id);
      }
    }
    
    function playPrevious() {
      if (!currentPlayingId) return;
      const currentIndex = filteredTracks.findIndex(t => t._id === currentPlayingId);
      if (currentIndex > 0) {
        togglePlay(filteredTracks[currentIndex - 1]._id);
      }
    }
    
    // Audio event handlers
    const audioPlayer = document.getElementById('audio-player');
    
    audioPlayer.addEventListener('timeupdate', () => {
      const current = audioPlayer.currentTime;
      const duration = audioPlayer.duration;
      document.getElementById('current-time').textContent = formatTime(current);
      document.getElementById('progress-fill').style.width = (current / duration * 100) + '%';
    });
    
    audioPlayer.addEventListener('loadedmetadata', () => {
      document.getElementById('duration').textContent = formatTime(audioPlayer.duration);
      document.getElementById('play-pause-btn').textContent = '⏸';
    });
    
    audioPlayer.addEventListener('ended', () => {
      playNext(); // Auto-play next track
    });
    
    audioPlayer.addEventListener('play', () => {
      document.getElementById('play-pause-btn').textContent = '⏸';
    });
    
    audioPlayer.addEventListener('pause', () => {
      document.getElementById('play-pause-btn').textContent = '▶';
    });
    
    // Check for admin mode
    if (new URLSearchParams(window.location.search).get('showAdmin') === 'true') {
      document.getElementById('admin-section').style.display = 'block';
    }
    
    // Load tracks on page load
    loadTracks();
    
    async function showTrackDetails(trackId) {
      const overlay = document.getElementById('modal-overlay');
      const modalBody = document.getElementById('modal-body');
      const modalCover = document.getElementById('modal-cover');
      const modalTitle = document.getElementById('modal-track-title');
      const modalArtist = document.getElementById('modal-track-artist');
      
      overlay.classList.add('active');
      modalBody.innerHTML = 'Loading...';
      
      try {
        const res = await fetch('/tracks/' + trackId);
        const track = await res.json();
        
        // Set header info
        modalTitle.textContent = track.title;
        modalArtist.textContent = track.track_artist;
        
        // Set cover image - only use local images
        let imgSrc = '';
        if (track.album?.localImage) {
          const filename = track.album.localImage.replace(/^.*[\\\/]/, '');
          imgSrc = '/imgs/' + encodeURIComponent(filename);
        }
        modalCover.src = imgSrc || '';
        modalCover.style.display = imgSrc ? 'block' : 'none';
        
        // Build detail sections
        let html = '';
        
        // Track info
        html += '<div class="detail-section"><h3>Track Info</h3><div class="detail-grid">';
        html += '<span class="detail-label">Title:</span><span class="detail-value">' + (track.title || '-') + '</span>';
        html += '<span class="detail-label">Artist:</span><span class="detail-value">' + (track.track_artist || '-') + '</span>';
        html += '<span class="detail-label">Filename:</span><span class="detail-value">' + (track.fn || '-') + '</span>';
        if (track.duration) html += '<span class="detail-label">Duration:</span><span class="detail-value">' + Math.round(track.duration) + 's</span>';
        html += '<span class="detail-label">Holiday:</span><span class="detail-value">' + (track.holiday ? 'Yes' : 'No') + '</span>';
        html += '</div></div>';
        
        // Album info
        if (track.album) {
          html += '<div class="detail-section"><h3>Album</h3><div class="detail-grid">';
          html += '<span class="detail-label">Title:</span><span class="detail-value">' + (track.album.title || '-') + '</span>';
          html += '<span class="detail-label">Year:</span><span class="detail-value">' + (track.album.year || '-') + '</span>';
          html += '<span class="detail-label">Label:</span><span class="detail-value">' + (track.album.label || '-') + '</span>';
          if (track.album.asin) html += '<span class="detail-label">ASIN:</span><span class="detail-value"><a href="https://www.amazon.com/dp/' + track.album.asin + '" target="_blank">' + track.album.asin + '</a></span>';
          html += '</div></div>';
        }
        
        // Artist info
        if (track.artist) {
          html += '<div class="detail-section"><h3>Artist</h3><div class="detail-grid">';
          html += '<span class="detail-label">Display:</span><span class="detail-value">' + (track.artist.artistdisplay || '-') + '</span>';
          html += '<span class="detail-label">Category:</span><span class="detail-value">' + (track.artist.artistcat || '-') + '</span>';
          html += '</div></div>';
        }
        
        // Composer info
        if (track.composer) {
          html += '<div class="detail-section"><h3>Composer</h3><div class="detail-grid">';
          html += '<span class="detail-label">Display:</span><span class="detail-value">' + (track.composer.display || track.composer.value || '-') + '</span>';
          html += '</div></div>';
        }
        
        // URLs
        html += '<div class="detail-section"><h3>Streaming URLs</h3><div class="detail-grid">';
        if (track.primary) html += '<span class="detail-label">Primary CDN:</span><span class="detail-value"><a href="' + track.primary + track.fn + '.m4a" target="_blank">' + track.primary + '</a></span>';
        if (track.secondary) html += '<span class="detail-label">Secondary CDN:</span><span class="detail-value"><a href="' + track.secondary + track.fn + '.m4a" target="_blank">' + track.secondary + '</a></span>';
        html += '</div></div>';
        
        // Metadata
        html += '<div class="detail-section"><h3>Metadata</h3><div class="detail-grid">';
        html += '<span class="detail-label">Original ID:</span><span class="detail-value">' + (track.originalId || '-') + '</span>';
        html += '<span class="detail-label">Created:</span><span class="detail-value">' + (track.createdAt ? new Date(track.createdAt).toLocaleString() : '-') + '</span>';
        html += '</div></div>';
        
        modalBody.innerHTML = html;
      } catch (err) {
        modalBody.innerHTML = '<p style="color: #dc3545;">Error loading track details: ' + err.message + '</p>';
      }
    }
    
    function closeModal(event) {
      if (!event || event.target.id === 'modal-overlay') {
        document.getElementById('modal-overlay').classList.remove('active');
      }
    }
    
    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
    
    async function deleteAll() {
      if (!confirm('Are you sure you want to delete ALL records? This cannot be undone!')) {
        return;
      }
      
      const btn = document.querySelector('.delete-btn');
      const status = document.getElementById('status');
      
      btn.disabled = true;
      btn.textContent = '⏳ Deleting...';
      status.className = 'status';
      
      try {
        const res = await fetch('/all', { method: 'DELETE' });
        const data = await res.json();
        
        if (data.success) {
          document.getElementById('stat-tracks').textContent = '0';
          document.getElementById('stat-albums').textContent = '0';
          document.getElementById('stat-artists').textContent = '0';
          
          status.textContent = '✓ Deleted ' + data.deleted.tracks + ' tracks, ' + data.deleted.albums + ' albums, ' + data.deleted.artists + ' artists';
          status.className = 'status success';
          
          setTimeout(() => location.reload(), 1500);
        } else {
          status.textContent = '✗ Error: ' + (data.error || 'Unknown error');
          status.className = 'status error';
        }
      } catch (err) {
        status.textContent = '✗ Error: ' + err.message;
        status.className = 'status error';
      } finally {
        btn.disabled = false;
        btn.textContent = '🗑️ Delete All';
      }
    }
    
    async function refresh() {
      const btn = document.querySelector('.refresh-btn');
      const status = document.getElementById('status');
      const urlInput = document.getElementById('url-input');
      
      btn.disabled = true;
      btn.textContent = '⏳ Loading...';
      status.className = 'status';
      
      try {
        const url = urlInput.value ? '/refresh?url=' + encodeURIComponent(urlInput.value) : '/refresh';
        const res = await fetch(url, { method: 'POST' });
        const data = await res.json();
        
        if (data.success) {
          document.getElementById('stat-tracks').textContent = data.after.tracks;
          document.getElementById('stat-albums').textContent = data.after.albums;
          document.getElementById('stat-artists').textContent = data.after.artists;
          
          status.textContent = '✓ Refresh complete! ' + data.newTracks + ' new tracks, ' + data.existingTracks + ' existing';
          status.className = 'status success';
          
          // Reload tracks without page refresh to keep music playing
          await loadTracks();
        } else {
          status.textContent = '✗ Error: ' + (data.error || 'Unknown error');
          status.className = 'status error';
        }
      } catch (err) {
        status.textContent = '✗ Error: ' + err.message;
        status.className = 'status error';
      } finally {
        btn.disabled = false;
        btn.textContent = '🔄 Refresh Data';
      }
    }
    
    // Check image download status periodically
    async function checkImageStatus() {
      try {
        const res = await fetch('/images/status');
        const data = await res.json();
        const statusEl = document.getElementById('image-status');
        const countEl = document.getElementById('image-count');
        
        if (data.pending > 0 || data.isProcessing) {
          statusEl.style.display = 'inline-block';
          statusEl.className = 'image-status downloading';
          countEl.textContent = data.pending;
        } else {
          statusEl.style.display = 'none';
          statusEl.className = 'image-status';
        }
      } catch (e) {
        // Ignore errors
      }
    }
    
    function exportData() {
      const status = document.getElementById('status');
      status.textContent = '📦 Preparing export...';
      status.className = 'status success';
      
      // Trigger download
      window.location.href = '/export';
      
      setTimeout(() => {
        status.textContent = '✓ Export download started';
        status.className = 'status success';
      }, 500);
    }
    
    async function importData(input) {
      const file = input.files[0];
      if (!file) return;
      
      if (!confirm('This will REPLACE all existing data with the imported data. Continue?')) {
        input.value = '';
        return;
      }
      
      const status = document.getElementById('status');
      status.textContent = '📥 Importing...';
      status.className = 'status success';
      
      try {
        const res = await fetch('/import', {
          method: 'POST',
          body: file
        });
        
        const data = await res.json();
        
        if (data.success) {
          status.textContent = '✓ Imported ' + data.imported.tracks + ' tracks, ' + data.imported.albums + ' albums, ' + data.imported.images + ' images';
          status.className = 'status success';
          setTimeout(() => location.reload(), 1500);
        } else {
          status.textContent = '✗ Error: ' + (data.error || 'Unknown error');
          status.className = 'status error';
        }
      } catch (err) {
        status.textContent = '✗ Error: ' + err.message;
        status.className = 'status error';
      }
      
      input.value = '';
    }
    
    // Poll for image status every 2 seconds
    setInterval(checkImageStatus, 2000);
    checkImageStatus();
    
    // ============ ARTISTS VIEW ============
    async function loadArtists() {
      try {
        const res = await fetch('/artists');
        allArtists = await res.json();
        filteredArtists = allArtists;
        renderArtists();
      } catch (err) {
        console.error('Failed to load artists:', err);
      }
    }
    
    function handleArtistSearch() {
      const query = document.getElementById('artist-search').value.toLowerCase().trim();
      if (!query) {
        filteredArtists = allArtists;
      } else {
        filteredArtists = allArtists.filter(artist => 
          artist.artistdisplay?.toLowerCase().includes(query) ||
          artist.artistcat?.toLowerCase().includes(query)
        );
      }
      renderArtists();
    }
    
    function renderArtists() {
      const grid = document.getElementById('artists-grid');
      document.getElementById('artist-count').textContent = filteredArtists.length + ' artists';
      
      grid.innerHTML = filteredArtists.map(artist => 
        '<div class="card" onclick="showArtistDetail(\\'' + artist._id + '\\')">' +
        '<h3>' + (artist.artistdisplay || 'Unknown') + '</h3>' +
        '<p>' + (artist.artistcat || 'No genre') + '</p>' +
        '<div class="count">' + (artist.trackCount || 0) + ' tracks</div>' +
        '</div>'
      ).join('');
    }
    
    function showArtistDetail(artistId) {
      const artist = allArtists.find(a => a._id === artistId);
      if (!artist) return;
      
      document.getElementById('artist-list').style.display = 'none';
      document.getElementById('artist-detail').style.display = 'block';
      document.getElementById('artist-detail-name').textContent = artist.artistdisplay;
      document.getElementById('artist-detail-genre').textContent = artist.artistcat || 'No genre';
      
      // Filter tracks by this artist
      const artistTracks = allTracks.filter(t => t.artist?._id === artistId);
      renderArtistTracks(artistTracks);
    }
    
    function renderArtistTracks(tracks) {
      const tbody = document.getElementById('artist-tracks-body');
      tbody.innerHTML = tracks.map(track => {
        let imgSrc = '';
        if (track.album?.localImage) {
          const filename = track.album.localImage.replace(/^.*[\\\\\\/]/, '');
          imgSrc = '/imgs/' + encodeURIComponent(filename);
        }
        const imgHtml = imgSrc ? '<img class="album-cover" src="' + imgSrc + '" alt="" onerror="this.style.display=\\'none\\'">' : '<div class="album-cover"></div>';
        const isPlaying = currentPlayingId === track._id;
        const playBtnClass = isPlaying ? 'play-btn playing' : 'play-btn';
        const playIcon = isPlaying ? '⏹' : '▶';
        
        return '<tr>' +
          '<td><button class="' + playBtnClass + '" onclick="event.stopPropagation(); togglePlay(\\'' + track._id + '\\')" data-play-id="' + track._id + '">' + playIcon + '</button></td>' +
          '<td onclick="showTrackDetails(\\'' + track._id + '\\')">' + imgHtml + '</td>' +
          '<td onclick="showTrackDetails(\\'' + track._id + '\\')">' + (track.title || '-') + '</td>' +
          '<td onclick="showTrackDetails(\\'' + track._id + '\\')">' + (track.album?.title || '-') + '</td>' +
          '<td onclick="showTrackDetails(\\'' + track._id + '\\')">' + (track.album?.year || '-') + '</td>' +
          '</tr>';
      }).join('');
    }
    
    function showArtistList() {
      document.getElementById('artist-list').style.display = 'block';
      document.getElementById('artist-detail').style.display = 'none';
    }
  </script>
</body>
</html>`;
      
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }
    
    // GET /export - Export database and images as zip
    if (url.pathname === '/export' && req.method === 'GET') {
      console.log(`\n[${new Date().toISOString()}] Exporting data...`);
      
      try {
        // Export all collections
        const [tracks, albums, artists, composers, ads] = await Promise.all([
          Track.find().lean(),
          Album.find().lean(),
          Artist.find().lean(),
          Composer.find().lean(),
          Ad.find().lean()
        ]);
        
        const exportData = {
          exportedAt: new Date().toISOString(),
          tracks,
          albums,
          artists,
          composers,
          ads
        };
        
        // Create zip
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="accuradio-backup-${new Date().toISOString().slice(0, 10)}.zip"`
        });
        
        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(res);
        
        // Add database JSON
        archive.append(JSON.stringify(exportData, null, 2), { name: 'database.json' });
        
        // Add images directory
        if (fs.existsSync(IMGS_DIR)) {
          archive.directory(IMGS_DIR, 'imgs');
        }
        
        await archive.finalize();
        console.log('✓ Export complete');
      } catch (error) {
        console.error('Export error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return;
    }
    
    // POST /import - Import database and images from zip
    if (url.pathname === '/import' && req.method === 'POST') {
      console.log(`\n[${new Date().toISOString()}] Importing data...`);
      
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          const zip = new AdmZip(buffer);
          const zipEntries = zip.getEntries();
          
          // Find and parse database.json
          const dbEntry = zipEntries.find(e => e.entryName === 'database.json');
          if (!dbEntry) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No database.json found in zip' }));
            return;
          }
          
          const exportData = JSON.parse(dbEntry.getData().toString('utf8'));
          
          // Extract images
          if (!fs.existsSync(IMGS_DIR)) {
            fs.mkdirSync(IMGS_DIR, { recursive: true });
          }
          
          let imagesImported = 0;
          for (const entry of zipEntries) {
            if (entry.entryName.startsWith('imgs/') && !entry.isDirectory) {
              const filename = path.basename(entry.entryName);
              const destPath = path.join(IMGS_DIR, filename);
              fs.writeFileSync(destPath, entry.getData());
              imagesImported++;
            }
          }
          
          // Clear existing data
          await Promise.all([
            Track.deleteMany({}),
            Album.deleteMany({}),
            Artist.deleteMany({}),
            Composer.deleteMany({}),
            Ad.deleteMany({})
          ]);
          
          // Import data - use insertMany for bulk import
          const results = {
            albums: 0,
            artists: 0,
            composers: 0,
            tracks: 0,
            ads: 0,
            images: imagesImported
          };
          
          if (exportData.albums?.length) {
            await Album.insertMany(exportData.albums, { ordered: false }).catch(() => {});
            results.albums = exportData.albums.length;
          }
          if (exportData.artists?.length) {
            await Artist.insertMany(exportData.artists, { ordered: false }).catch(() => {});
            results.artists = exportData.artists.length;
          }
          if (exportData.composers?.length) {
            await Composer.insertMany(exportData.composers, { ordered: false }).catch(() => {});
            results.composers = exportData.composers.length;
          }
          if (exportData.tracks?.length) {
            await Track.insertMany(exportData.tracks, { ordered: false }).catch(() => {});
            results.tracks = exportData.tracks.length;
          }
          if (exportData.ads?.length) {
            await Ad.insertMany(exportData.ads, { ordered: false }).catch(() => {});
            results.ads = exportData.ads.length;
          }
          
          console.log('✓ Import complete:', results);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, imported: results }));
        } catch (error) {
          console.error('Import error:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
      return;
    }
    
    // DELETE /all - Delete all records
    if (url.pathname === '/all' && req.method === 'DELETE') {
      console.log(`\n[${new Date().toISOString()}] Deleting all records...`);
      
      const statsBefore = await getStats();
      
      // Delete all documents from all collections
      await Promise.all([
        Track.deleteMany({}),
        Album.deleteMany({}),
        Artist.deleteMany({}),
        Composer.deleteMany({}),
        Ad.deleteMany({})
      ]);
      
      console.log('✓ All records deleted');
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        deleted: statsBefore
      }));
      return;
    }
    
    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    
  } catch (error) {
    console.error('Server error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
});

async function start() {
  try {
    await db.connect();
    
    server.listen(PORT, () => {
      console.log(`\n🚀 Server running at http://localhost:${PORT}`);
      console.log(`\nEndpoints:`);
      console.log(`  GET  /           - Web UI`);
      console.log(`  GET  /stats      - Database statistics`);
      console.log(`  GET  /tracks     - All tracks`);
      console.log(`  GET  /artists    - All artists with track counts`);
      console.log(`  GET  /genres     - All genres with counts`);
      console.log(`  GET  /tracks/recent?limit=10 - Recent tracks`);
      console.log(`  POST /refresh?url=<URL> - Refresh data from URL`);
      console.log(`  GET  /export     - Export database and images as zip`);
      console.log(`  POST /import     - Import database and images from zip`);
      console.log(`  DELETE /all      - Delete all records\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
