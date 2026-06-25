# Workstr — Sovereign Workout Tracker

A self-hosted workout tracker and training planner in the `*str` Nostr stack. Your
exercises, sheets, and sessions live in your own database. Your workout sheet and
shared summaries are signed and published by **Idenstr** — your keys never touch
Workstr.

Part of the `*str` ecosystem alongside Idenstr (identity/signing) and Feedstr.

## Features

- **Exercise library** — search, filter by category/muscle/difficulty, favourite, create and edit.
- **Workout sheets** — build routines with ordered exercises and set/rep/rest targets.
- **Train** — start a session from a sheet, log sets, finish and review.
- **Plan** — a 7-day weekly grid and mesocycle blocks.
- **Progress** — weekly volume, muscle distribution, estimated-1RM records, training streak, body-weight log.
- **Sovereign Nostr layer** — publish your sheet as a private `kind:30078` event in your vault; share a session summary as a `kind:1` note. Both are signed (and the summary published) by Idenstr.
- No keys held, no cloud, no tracking — your data stays on your server.

## Quick start (Docker Compose)

Requires a running [Idenstr](../idenstr) for signing and publishing.

```bash
cp .env.example .env   # set your Idenstr URL + token and a dashboard user/password
docker compose up -d --build
```

Open `http://<host>:3003`. Workstr has no login of its own — it relies on the
network boundary (keep it on a trusted LAN/tailnet, or behind an HTTPS reverse
proxy) and on its scoped Idenstr token. Go to **Connect**, paste your Idenstr URL
and a scoped token, and **Test connection**. (Optional: set `WORKSTR_AUTH_USER` and
`WORKSTR_AUTH_PASSWORD` to turn on HTTP Basic auth.)

### Idenstr token scopes

Generate a token in Idenstr (API tokens) with:

```text
profile:read
sign:kind:30078     # workout sheet (private, in your vault)
publish:kind:1      # workout summary (Idenstr signs and publishes)
```

## Configuration

| Variable | Required | Description |
|---|---|---|
| `WORKSTR_IDENSTR_URL` | Yes | Idenstr base URL (e.g. `http://host.docker.internal:3000`) |
| `WORKSTR_IDENSTR_TOKEN` | Yes | Scoped Idenstr API token |
| `WORKSTR_AUTH_USER` | No | Optional HTTP Basic username; set with the password to enable a login |
| `WORKSTR_AUTH_PASSWORD` | No | Optional HTTP Basic password |
| `WORKSTR_HOST_BIND` | No | Host/IP to expose on, default `0.0.0.0` (LAN/mesh); set `127.0.0.1` for local-only |
| `WORKSTR_HOST_PORT` | No | Host port, default `3003` |

Data is stored in SQLite at `/data/workstr.db`. For access beyond your LAN/mesh,
put Workstr behind an HTTPS reverse proxy.

## DB vs vault

Workstr follows the stack rule: **signed Nostr events go in the vault; everything else goes in the DB.** Almost everything Workstr stores — your exercise library, sheets, sessions, set logs, progress, and body-weight — lives in its own `workstr.db` and never becomes a Nostr event. Only the narrow publishable slice crosses the line: your `kind:30078` workout sheet and a `kind:1` summary note. Workstr builds these as *unsigned* events and sends them to Idenstr — Idenstr is the only thing that signs (your keys never touch Workstr) and then writes them to your vault / publishes them. In the UI, **"save local" means save to `workstr.db`**; **"publish" / "share"** is the act of handing a specific item to Idenstr to sign and publish. See the stack `docs/architecture.md` → Storage Boundary.

## License

MIT
