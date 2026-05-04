# Liftme — Workout Intelligence

A self-hosted workout tracker and training planner. Build exercises from AI generation, a seed library, or camera import. Plan mesocycles, log sessions set-by-set, and track progress with charts and personal records. Runs entirely in Docker.

---

## Features

- **Exercise library** — browse, filter by category/muscle/equipment/difficulty, favourite exercises
- **AI generation** — describe an exercise and get full details with a fitness photo
- **Camera import** — photograph a gym poster or exercise card; AI extracts it
- **Seed browser** — import from 800+ exercises in the free-exercise-db
- **Staging workflow** — all imports require your approval before going active
- **Workout builder** — named templates with exercises, sets, reps, and rest targets
- **Active session overlay** — fullscreen dark mode, set-by-set logging, rest timer, auto-progression
- **Screen wake lock** — keeps your phone awake during active workouts
- **Mesocycle planner** — multi-week training blocks with workout scheduling
- **Weekly planner** — 7-day grid with morning/afternoon/evening slots
- **Statistics dashboard** — weekly volume charts, muscle group distribution, personal records, workout streaks
- **Body tracking** — log weight, BMI zone bar, weight trend chart, goal progress
- **Backup & restore** — export everything (database, exercises, images, settings) as a zip file
- **Weight unit preference** — kg or lbs, applied everywhere
- No account, no cloud, no tracking — your data stays on your server

---

## Quick Start

No build required — pull straight from Docker Hub.

**1. Create a `docker-compose.yml`:**

```yaml
services:
  liftme:
    image: dockersette/liftme:latest
    ports:
      - "5001:5001"
    volumes:
      - ./exercises:/app/exercises
      - ./images:/app/images
      - ./data:/app/data
      - ./.env:/app/.env
    restart: unless-stopped
```

**2. Create a `.env` file:**

```env
PPQ_API_KEY=your-key-here
PPQ_BASE_URL=https://api.ppq.ai/v1
PPQ_MODEL=claude-haiku-4-5
PPQ_IMAGE_MODEL=gpt-image-1
PPQ_VISION_MODEL=claude-haiku-4-5

FLASK_HOST=0.0.0.0
FLASK_PORT=5001
FLASK_DEBUG=false
```

**3. Start it:**

```bash
docker compose up -d
```

**4. Open it:**

```
http://YOUR_SERVER_IP:5001
```

---

## Updating

```bash
docker compose pull && docker compose up -d
```

---

## AI Provider

Liftme uses any OpenAI-compatible endpoint. The recommended provider is [PPQ.ai](https://ppq.ai), which gives access to Claude and OpenAI models via a single API key and endpoint.

You can configure the key and models directly in the Settings tab after first launch. Three model slots are available:

- **Text model** — exercise detail generation
- **Image model** — fitness photo generation
- **Vision model** — camera/image import extraction (must support vision)

---

## Port

Default is **5001**. Change the left side of the ports mapping to use a different host port:

```yaml
ports:
  - "8080:5001"   # serve on port 8080 instead
```

---

## Security

Liftme has no authentication. It is designed for **personal / home server use only**, behind a firewall or VPN. Do not expose port 5001 to the public internet without adding an auth layer (e.g. HTTP Basic Auth via an nginx reverse proxy).

---

## License

MIT
