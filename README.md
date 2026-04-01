# MeetingMind

**AI-powered meeting intelligence platform** -- record meetings, get real-time transcriptions, auto-generated notes, action items, and semantic search across your entire meeting history.

## What It Does

MeetingMind captures audio from your meetings (microphone + system audio), transcribes them in real-time using Deepgram Nova-3, then uses Claude to generate structured notes with executive summaries, key decisions, and action items. Everything is searchable via RAG-powered semantic queries.

### Core Features

- **Real-time transcription** -- Deepgram Nova-3 with speaker diarization and multichannel support
- **AI-generated meeting notes** -- Claude produces executive summaries, key points, decisions, action items, and open questions
- **Automatic task extraction** -- Action items from meetings become trackable tasks with due dates and assignees
- **Semantic search (RAG)** -- Ask questions across your entire meeting history using OpenAI embeddings + pgvector
- **Audio recording & playback** -- Recordings stored in MinIO (S3-compatible), playable from the web dashboard
- **Project organization** -- Group meetings, tasks, and team members by project
- **Kanban task board** -- Track tasks extracted from meetings with drag-and-drop status management
- **Team intelligence** -- View workload, meeting participation, and commitments per team member
- **Calendar sync** -- Google Calendar and Microsoft Outlook integration via OAuth
- **Desktop app** -- Electron app for system-level audio capture with tray integration
- **Export** -- Download notes as Markdown, PDF, or DOCX

## Architecture

```
                    +-----------+
                    |  Frontend |  Next.js 15 + React 19
                    |  :3000    |  Tailwind, Radix UI
                    +-----+-----+
                          |
                    +-----+-----+
                    |   NGINX   |  API Gateway
                    |   :80     |  Route-based proxy
                    +-----+-----+
                          |
        +---------+-------+-------+---------+---------+
        |         |       |       |         |         |
   +----+---+ +---+----+ +--+--+ +---+---+ +---+---+ +---+---+
   |  Auth  | |Meeting | |Trans| |  AI   | |Project| | Task  |
   | :8001  | | :8002  | |:8003| | :8004 | | :8005 | | :8006 |
   +----+---+ +---+----+ +--+--+ +---+---+ +---+---+ +---+---+
        |         |       |       |         |         |
        +----+----+---+---+-------+---------+---------+
             |        |                |
        +----+---+ +--+---+    +------+------+
        |Postgres| | Redis|    |   Workers   |
        |pgvector| |      |    | AI/Embed/Cal|
        +--------+ +------+    +------+------+
                                      |
                               +------+------+
                               |    MinIO    |
                               | Audio Store |
                               +-------------+

   +-------------------+
   | Electron Desktop  |  System audio capture
   | App               |  Deepgram WebSocket
   +-------------------+
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, Tailwind CSS 4, Radix UI, Zustand, Jotai, Framer Motion |
| Desktop | Electron + Vite, AudioWorklet for PCM capture |
| API Gateway | NGINX with WebSocket support |
| Backend Services | FastAPI (Python 3.12), async SQLAlchemy, Pydantic v2 |
| Database | PostgreSQL 16 + pgvector + pg_trgm |
| Cache/Broker | Redis 7 (sessions, Celery broker, result backend) |
| Object Storage | MinIO (S3-compatible, meeting audio) |
| Task Queue | Celery 5.4 with dedicated queues (ai, embeddings, calendar) |
| AI | Anthropic Claude (notes), OpenAI text-embedding-3-small (RAG), Deepgram Nova-3 (STT) |
| Auth | JWT + Google OAuth + Microsoft OAuth + device login |
| Monitoring | Flower (Celery dashboard) |

### Services

| Service | Port | Responsibility |
|---------|------|---------------|
| `auth-svc` | 8001 | OAuth (Google/Microsoft), device login, JWT, user settings (encrypted) |
| `meeting-svc` | 8002 | Meeting CRUD, WebSocket audio streaming, Deepgram relay, transcript persistence |
| `transcript-svc` | 8003 | Transcript/utterance CRUD, speaker management, full-text search |
| `ai-svc` | 8004 | Note generation, RAG queries, pre-meeting briefs |
| `project-svc` | 8005 | Projects, team members, people intelligence |
| `task-svc` | 8006 | Task CRUD, Kanban board, lifecycle management, deadlines |
| `ai-worker` | -- | Celery worker: generates meeting notes via Claude, creates tasks from action items |
| `embedding-worker` | -- | Celery worker: generates OpenAI embeddings for RAG search |
| `calendar-worker` | -- | Celery worker: syncs Google/Microsoft calendars every 5 minutes |

## Getting Started

### Prerequisites

- Docker & Docker Compose
- API keys for: [Deepgram](https://console.deepgram.com), [Anthropic](https://console.anthropic.com), [OpenAI](https://platform.openai.com)
- (Optional) Google/Microsoft OAuth credentials for calendar sync

### 1. Clone and configure

```bash
git clone https://github.com/your-username/meetingmind.git
cd meetingmind
cp .env.example .env
```

Edit `.env` and fill in your API keys:

```env
DEEPGRAM_API_KEY=your-deepgram-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key
OPENAI_API_KEY=your-openai-api-key
JWT_SECRET=generate-a-strong-random-string
```

### 2. Start everything

```bash
docker compose up -d
```

This starts all 15 services. First boot takes ~2 minutes for health checks.

### 3. Seed sample data (optional)

```bash
docker exec -i meetingmind-postgres-1 psql -U notetaker -d ai_notetaker < seed.sql
```

### 4. Access the app

| URL | What |
|-----|------|
| http://localhost:3000 | Web dashboard |
| http://localhost:80 | API gateway |
| http://localhost:5555 | Flower (Celery monitoring) |
| http://localhost:9001 | MinIO console |

The web dashboard auto-authenticates via device login (no sign-up required for development).

### 5. Electron desktop app (optional)

```bash
cd electron
npm install
npm run dev
```

## How the Data Pipeline Works

```
Record Audio ──> Deepgram (real-time STT) ──> Persist Utterances to DB
                                                       |
Stop Meeting ──> Finalize Transcript ──> Celery: AI Worker
                                                       |
                                          Claude generates notes
                                          + extracts action items
                                          + creates Task rows
                                                       |
                                          Celery: Embedding Worker
                                                       |
                                          OpenAI embeds notes/utterances
                                          into pgvector for RAG search
```

1. **Recording**: Electron captures mic + system audio as 16-bit PCM, sends via WebSocket
2. **Transcription**: Meeting service relays audio to Deepgram, broadcasts results to viewers, and persists final utterances to the database
3. **Stop**: Meeting status transitions to PROCESSING, Celery task is enqueued
4. **AI Processing**: Claude generates structured notes from the transcript; action items become Task rows with parsed due dates
5. **Embeddings**: OpenAI embeds summaries, decisions, key points, and utterance chunks into pgvector
6. **Search**: RAG queries use cosine similarity over embeddings to find relevant context, then Claude answers

## Project Structure

```
meetingmind/
├── frontend/                 # Next.js 15 web dashboard
│   ├── app/(dashboard)/      # Dashboard pages (meetings, projects, tasks, team, settings)
│   ├── components/ui/        # Radix-based UI components
│   └── lib/                  # API client, hooks, stores
├── electron/                 # Electron desktop recorder
│   └── src/
│       ├── main/             # Audio capture, Deepgram stream, IPC handlers
│       ├── preload/          # Context bridge
│       └── renderer/         # React UI (recording, meetings, transcript, settings)
├── services/
│   ├── api-gateway/          # NGINX reverse proxy
│   ├── auth/                 # Authentication service
│   ├── meeting/              # Meeting + WebSocket + audio storage
│   ├── transcript/           # Transcript CRUD + search
│   ├── ai-processing/       # Notes generation + RAG queries
│   ├── project/              # Projects + team + people intelligence
│   └── task/                 # Tasks + Kanban + lifecycle
├── workers/                  # Celery workers (AI, embeddings, calendar)
├── shared/                   # Shared models, auth, config, database
├── docker-compose.yml        # Full stack orchestration
├── seed.sql                  # Sample data for development
└── seed.py                   # Python seeder alternative
```

## API Endpoints

All endpoints are accessible through the API gateway at `http://localhost/api/v1/`.

<details>
<summary>Auth</summary>

- `POST /auth/device-login` -- Device login (returns JWT)
- `POST /auth/login/google` -- Google OAuth callback
- `POST /auth/login/microsoft` -- Microsoft OAuth callback
- `GET /auth/me` -- Current user
- `GET /auth/oauth/google/url` -- Get Google OAuth consent URL
- `GET /auth/oauth/microsoft/url` -- Get Microsoft OAuth consent URL

</details>

<details>
<summary>Meetings</summary>

- `POST /meetings/` -- Create meeting
- `GET /meetings/` -- List meetings (filterable by project)
- `GET /meetings/{id}` -- Get meeting details
- `POST /meetings/{id}/start` -- Start recording
- `POST /meetings/{id}/stop` -- Stop recording (triggers AI processing)
- `GET /meetings/{id}/audio` -- Stream recorded audio
- `WebSocket /meetings/{id}/ws` -- Live audio + transcription

</details>

<details>
<summary>Notes & Search</summary>

- `GET /notes/meeting/{id}` -- Get meeting notes
- `POST /notes/meeting/{id}/regenerate` -- Regenerate notes
- `POST /queries/` -- RAG search across meetings
- `POST /queries/pre-brief/{id}` -- Pre-meeting brief

</details>

<details>
<summary>Projects, Tasks, Team</summary>

- `CRUD /projects/` -- Project management
- `CRUD /tasks/` -- Task management
- `GET /tasks/board/` -- Kanban board view
- `GET /team/` -- Team members
- `GET /people/{id}/intelligence` -- People intelligence

</details>

<details>
<summary>Settings</summary>

- `GET /settings/` -- List user settings
- `PUT /settings/` -- Upsert settings (API keys encrypted with AES-256)
- `DELETE /settings/{key}` -- Delete a setting

</details>

## Environment Variables

See [`.env.example`](.env.example) for the full list. The critical ones:

| Variable | Required | Description |
|----------|----------|-------------|
| `DEEPGRAM_API_KEY` | Yes | Speech-to-text transcription |
| `ANTHROPIC_API_KEY` | Yes | Meeting note generation (Claude) |
| `OPENAI_API_KEY` | Yes | Embedding generation for RAG search |
| `JWT_SECRET` | Yes | JWT signing key (change from default!) |
| `GOOGLE_CLIENT_ID` | No | Google OAuth + Calendar |
| `MICROSOFT_CLIENT_ID` | No | Microsoft OAuth + Calendar |

## License

MIT

<!-- activity: pr-1-meetingmind -->
