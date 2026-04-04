# Tool's Studio — Backend

[![Python](https://img.shields.io/badge/python-3.10%2B-blue)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/flask-3.1-lightgrey)](https://flask.palletsprojects.com/)
[![yt-dlp](https://img.shields.io/badge/yt--dlp-2026.3.17-red)](https://github.com/yt-dlp/yt-dlp)
[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Last Commit](https://img.shields.io/github/last-commit/ZHOGIA/Tools-Studio)](https://github.com/ZHOGIA/Tools-Studio)

Tool's Studio Backend is a Python [Flask](https://flask.palletsprojects.com/) REST API that
powers two features: YouTube video and audio downloading via
[yt-dlp](https://github.com/yt-dlp/yt-dlp), and AI-based background removal via
[rembg](https://github.com/danielgatis/rembg). It is designed to run as a standalone server,
separate from the frontend, and communicates exclusively through JSON endpoints.

The server runs on port `5000` by default and supports cross-origin requests (CORS) to allow
decoupled hosting of the frontend on a separate domain or CDN.

See [Tools-Studio — Frontend](https://github.com/ZHOGIA/Tools-Studio/tree/main/frontend) for
the Astro-based frontend that consumes this API.

## Prerequisites

Before running the backend, ensure the following are installed on your system:

- **Python 3.10 or later**
- **FFmpeg** — required for audio extraction and video merging

**FFmpeg installation:**

On Windows, place `ffmpeg.exe` in the same directory as `app.py`. The server detects it
automatically via `shutil.which` (system PATH) and falls back to the local binary if needed.

On Linux (Debian / Ubuntu):

```bash
sudo apt update && sudo apt install ffmpeg
```

## Installation

Clone the repository and navigate into the `backend/` directory. Then create and activate
a virtual environment:

```bash
python -m venv venv
```

On Windows:

```powershell
.\venv\Scripts\activate
```

On Linux / macOS:

```bash
source venv/bin/activate
```

Install all required dependencies from `requirements.txt`:

```bash
pip install -r requirements.txt
```

> **NOTE**: The `onnxruntime-gpu` package in `requirements.txt` targets systems with an
> NVIDIA CUDA-compatible GPU. On systems without a GPU, the server automatically falls back
> to `CPUExecutionProvider` for background removal inference. No manual change is needed.

## Usage

Start the development server:

```bash
python app.py
```

The server will be accessible at `http://0.0.0.0:5000`. The root endpoint returns a health
check response:

```json
{ "status": "ok", "message": "Backend API is running!" }
```

For production deployments, use [Gunicorn](https://gunicorn.org/) instead:

```bash
pip install gunicorn
gunicorn --bind 0.0.0.0:5000 app:app
```

> **NOTE**: The application spawns background threads for download tasks and for periodic
> cleanup. Gunicorn must be run with a single worker (`--workers 1`) to avoid in-memory task
> state being split across processes. For multi-worker deployments, migrate `TASKS` to a
> shared store such as Redis.

## Project Structure

```
backend/
├── app.py            # Flask application, route definitions, hardware detection
├── downloader.py     # yt-dlp integration, task management, progress tracking
├── requirements.txt  # Python dependencies
├── ffmpeg.exe        # FFmpeg binary for Windows (not committed in production)
├── downloads/        # Temporary directory for processed media files
├── Mp3/              # Legacy output directory (unused in current version)
└── Mp4/              # Legacy output directory (unused in current version)
```

## API Reference

### `GET /`

Health check endpoint. Returns server status.

```
200 OK
{ "status": "ok", "message": "Backend API is running!" }
```

---

### `POST /api/info`

Fetches metadata for a given YouTube URL without downloading.

**Request body:**

```json
{ "url": "https://www.youtube.com/watch?v=..." }
```

**Response:**

```json
{
  "title": "Video Title",
  "thumbnail": "https://...",
  "duration": 245,
  "formats": {
    "audio": [
      { "format_id": "bestaudio", "ext": "mp3", "abr": 320, "filesize": 0 }
    ],
    "video": [
      { "format_id": "137", "ext": "mp4", "resolution": 1080, "filesize": 123456789 }
    ]
  }
}
```

> **NOTE**: Videos exceeding 1 hour (3600 seconds) in duration are rejected at this stage
> with a `500` error. This limit exists to protect server stability.

---

### `POST /api/process`

Starts an asynchronous download task and returns a `task_id` immediately.

**Request body:**

```json
{ "url": "https://...", "format": "mp4", "quality": "1080" }
```

**Response:**

```json
{ "task_id": "550e8400-e29b-41d4-a716-446655440000" }
```

---

### `GET /api/status/<task_id>`

Polls the status of a running or completed download task.

**Possible `status` values:** `pending`, `starting`, `downloading`, `processing`, `done`, `error`

**Response (while downloading):**

```json
{
  "status": "downloading",
  "progress": 54.2,
  "speed": "3.20MiB/s",
  "eta": 12
}
```

---

### `GET /api/download/<task_id>`

Serves the processed file as a downloadable attachment. Only available when
`status` is `done`. The file is automatically deleted from disk after 24 hours
via a background cleanup thread.

---

### `POST /api/remove-bg`

Accepts a multipart image upload and returns a PNG with the background removed.

**Form field:** `image` — accepts PNG, JPG, WEBP up to 10 MB.

**Response:** Raw PNG image stream (`image/png`).

The background removal model (`u2net`) is loaded once at server startup. Hardware
acceleration is selected automatically in the following priority order:

1. NVIDIA CUDA (`CUDAExecutionProvider`)
2. DirectML — AMD / Intel GPU (`DmlExecutionProvider`)
3. CPU fallback (`CPUExecutionProvider`)

---

### `POST /api/cleanup/<task_id>`

Manually removes the file associated with a task and clears it from the in-memory
task store. Also accepts `DELETE`.

---

## File Retention Policy

Downloaded media files are stored temporarily in the `downloads/` directory. Two
mechanisms ensure files are removed:

- **Per-download thread**: a daemon thread is started on each `GET /api/download`
  call and deletes the specific file after 24 hours.
- **Periodic cleanup**: a background thread runs hourly and removes any file in
  `downloads/` older than 24 hours, along with stale in-memory task entries.

AI-processed images are never written to disk — they are streamed directly to the
client from an in-memory buffer.

## Decoupled Deployment (Frontend + VPS Backend)

The frontend and backend can be hosted independently. The Astro frontend resolves the
API base URL at runtime:

```js
const API_BASE = import.meta.env.DEV
    ? "http://localhost:5000"
    : "https://api.zhogia.my.id";
```

To point to a different server, update the production URL in `index.astro`. CORS is
enabled globally on the Flask app, so no additional configuration is required on the
backend side.

A typical production setup uses [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
or an NGINX reverse proxy to expose the Flask server on a public domain without opening
a raw port.

## License

This project is licensed under the [MIT License](./LICENSE).
