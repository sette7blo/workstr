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
- **Sovereign Nostr layer** — optionally publish your exercises and programs as standard NIP-101e templates (`kind:33401` / `kind:33402`) so any NIP-101e client can use them, and share a session summary as a `kind:1` note. All are signed (and published) by Idenstr.
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
relays:read         # read your relay list for discovery
sign:kind:27235     # image upload auth (NIP-98)
publish:kind:1      # workout summary (Idenstr signs and publishes)
publish:kind:33401  # share an exercise as a NIP-101e template
publish:kind:33402  # share a program as a NIP-101e workout template
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

## DB vs Nostr

Everything Workstr stores — your exercise library, programs, sessions, set logs, progress, and body-weight — lives in its own `workstr.db` and stays a private local-DB item by default. Nothing leaves your server unless you choose to **publish** it. The publishable slice is opt-in and public: an exercise as a NIP-101e `kind:33401` template, a program as a NIP-101e `kind:33402` workout template, and a session summary as a `kind:1` note. Workstr builds these as *unsigned* events and hands them to Idenstr — Idenstr is the only thing that signs (your keys never touch Workstr) and broadcasts them to your relays. In the UI, an item is **local** until you press **Publish**; publishing a program also publishes the exercises it contains so other clients can run it. See the stack `docs/architecture.md` → Storage Boundary.

## License

MIT
