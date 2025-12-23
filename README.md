# AccuRadio Parser

A Node.js application that parses AccuRadio playlist data from a URL and stores it in MongoDB.

## Features

- Fetches and parses track data from a configurable URL
- Stores tracks, albums, artists, composers, and ads in MongoDB
- Detects and skips duplicate records on refresh
- Web UI for viewing tracks and triggering refreshes
- REST API endpoints

## Quick Start

### 1. Start MongoDB with Docker

```bash
docker-compose up -d
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Run the Server

```bash
node src/server.js
```

Then open http://localhost:3000 in your browser.

### 4. Refresh Data

Either:
- Use the web UI at http://localhost:3000 and enter your URL
- Use the API: `POST http://localhost:3000/refresh?url=YOUR_URL`
- Run the CLI: `node src/fetch.js YOUR_URL`

## Configuration

Set environment variables or edit `src/config.js`:

```bash
# MongoDB connection
MONGODB_URI=mongodb://localhost:27017/accuradio

# Default URL to parse
PARSE_URL=https://your-api-url.com/playlist

# Server port
PORT=3000
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Web UI |
| GET | `/stats` | Database statistics |
| GET | `/tracks` | All tracks with populated relations |
| GET | `/tracks/recent?limit=10` | Recent tracks |
| POST | `/refresh?url=<URL>` | Fetch and store data from URL |

## CLI Commands

```bash
# Start web server
node src/server.js

# Fetch data from URL
node src/fetch.js YOUR_URL

# Or with configured URL
PARSE_URL=YOUR_URL node src/index.js
```

## Data Models

### Track
- `track_artist` - Artist name as displayed
- `title` - Track title
- `fn` - Filename/path
- `primary`, `secondary` - CDN URLs
- References to Album, Artist, Composer

### Album
- `title`, `asin`, `year`, `label`
- `cdcover` - Cover image path

### Artist
- `artistdisplay` - Display name
- `artistcat` - Category/sort name

### Composer
- `display`, `value`, `cat`

### Ad
- `ad_type` - 'paid' or 'unpaid'
- `ad_source` - 'adswizz' or 'runspot'
- `fn`, `fn_as`, `fn_ar` - Various URL fields

## Docker Commands

```bash
# Start MongoDB
docker-compose up -d

# Stop MongoDB
docker-compose down

# Stop and remove data
docker-compose down -v
```
