# m3u8 Downloader

Docker + Next.js app to download HLS (`.m3u8`) streams as MP4 files — inspired by [jakiyaa/m3u8-downloader](https://github.com/jakiyaa/m3u8-downloader) and the Colab notebook that runs:

```bash
sudo apt install -y ffmpeg
pip install --user m3u8downloader
downloadm3u8 -o output.mp4 "https://…/playlist.m3u8"
```

## Features

- **Single download** (`/`) — title + m3u8 link form
- **Batch downloads** (`/batch`) — table UI for multiple jobs
- **From URL** (`/extract`) — paste a video page URL; auto-fetch title + m3u8 when present
- **Prisma + SQLite** job history and status
- **Background queue** (up to `MAX_CONCURRENT_DOWNLOADS`)
- **shadcn/ui** components + Magic UI-style grid background & animated theme toggle
- **axios · zustand · motion · react-hook-form · react-icons**

## Stack

| Layer | Tech |
|--------|------|
| UI | Next.js (App Router), Tailwind v4, shadcn/ui |
| State | Zustand + axios polling |
| DB | Prisma 7 + SQLite (`better-sqlite3` adapter) |
| Downloader | **Python** `download_stream.py` (`ffmpeg` / `downloadm3u8`) |
| Extract | **Python** `extract_stream.py` (requests + BeautifulSoup) |
| Deploy | Docker / Docker Compose |

## Quick start (Docker)

### One-click / scripted launch (recommended)

**Windows** (double-click or from `cmd`):

```bat
run.bat
```

**Linux / macOS / Git Bash**:

```bash
chmod +x run.sh
./run.sh
```

The scripts will:

1. Verify Docker CLI is installed  
2. Wait/retry until the Docker daemon is running  
3. Detect `docker compose` (v2) or `docker-compose` (v1)  
4. **Fingerprint** app sources (`src/`, `python/`, `prisma/`, Dockerfile, compose, lockfile, …)  
5. Compare to `.docker-build-fingerprint` + container label → detect **old vs new code**  
6. If code changed (or container missing/unhealthy): **`docker compose up -d --build --force-recreate`**  
7. If already running with matching fingerprint: fast path (no rebuild)  
8. Confirm container exists & is running (restart/create with retries)  
9. Poll health at `http://127.0.0.1:38478/api/downloads`  
10. Open the app URL in your default browser  

Force a rebuild anytime:

```bash
FORCE_BUILD=1 ./run.sh
```

```bat
set FORCE_BUILD=1
run.bat
```

### Manual

```bash
docker compose up --build -d
```

Open [http://localhost:38478](http://localhost:38478).

Production listens on **port `38478`** (host + container) so it won’t collide with common Next/dev ports like `3000` / `8080`. Override with `PORT` and the compose `ports:` mapping if needed.

Persistent volumes:

- `m3u8-data` → SQLite database
- `m3u8-downloads` → completed MP4 files

## Local development

### Prerequisites

- Node.js 20+
- ffmpeg on `PATH` (and optionally `pip install m3u8downloader`)

### Setup

```bash
npm install --legacy-peer-deps
cp .env.example .env
npm run db:push
npm run dev
```

App: [http://localhost:3000](http://localhost:3000)

### Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:push` | Push schema to SQLite (dev) |
| `npm run db:migrate` | Create/apply migrations |
| `npm run db:studio` | Prisma Studio |

## Environment

See `.env.example`:

```env
DATABASE_URL="file:./prisma/dev.db"
DOWNLOADS_DIR="./downloads"
MAX_CONCURRENT_DOWNLOADS=2
# DOWNLOADM3U8_BIN=/usr/local/bin/downloadm3u8
# FFMPEG_BIN=ffmpeg
```

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/downloads` | List jobs |
| `POST` | `/api/downloads` | Create one `{ title, url }` or batch `{ items: [...] }` |
| `GET` | `/api/downloads/:id` | Job detail |
| `DELETE` | `/api/downloads/:id` | Delete job (+ file) |
| `PATCH` | `/api/downloads/:id` | `{ "action": "retry" }` |
| `GET` | `/api/downloads/:id/file` | Download completed MP4 |

## Notes

- Only download content you have the right to access.
- Some streams require cookies/headers or DRM; this tool handles plain HLS best.
- Progress is approximate when using ffmpeg without a known duration.
- Default downloader is **ffmpeg** (`DOWNLOADER=ffmpeg`). Set `DOWNLOADER=downloadm3u8` to use the Python CLI from the Colab notebook instead.
- ffmpeg is run with `-nostdin` so it works correctly as a background child process.

## License

MIT
