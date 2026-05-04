# Changelog

All notable changes to Liftme will be documented here.
Versions follow [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`

- **MAJOR** — breaking changes (e.g. DB schema requires migration)
- **MINOR** — new features, backwards compatible
- **PATCH** — bug fixes, visual tweaks

---

## [Unreleased]

## [v2.2.0] — 2026-05-04

### Added
- Body tracking: log weight, BMI zone bar, weight trend chart, goal progress, 7-day rolling average
- Body sub-tab in Statistics (Training / Body toggle)
- Backup & restore: export database, exercises, images, and settings as a zip file
- Exercise edit drawer: edit all fields inline, regenerate AI image
- AI Configuration settings: eye toggles, credit ID, test connection, balance display, Monero top-up
- Auto-advance to next exercise after rest timer when all sets are logged

### Changed
- AI image generation prompt now produces single cover photos instead of step-by-step collages
- Equipment from exercise data now included in AI image generation prompt
- Gunicorn timeout increased to 300s for AI image generation

### Fixed
- Approve button in generate result now shows confirmation instead of leaving card open
- Generate form clears when switching tabs
- Drawer image updates immediately after regeneration (cache busting)

### Removed
- AI Plan feature (placed individual exercises, not full workouts)
- Data export section in settings (replaced by backup)

## [v2.1.0] — 2026-05-01

### Added
- Logo mark (dumbbell icon) in topbar header
- iOS home screen support: apple-touch-icon, web app meta tags
- All settings sections now collapsible with chevron toggle

---

## [v2.0.0] — 2026-04-30
### Added
- Statistics dashboard with weekly volume charts, muscle group distribution, personal records, and workout streaks
- Weight unit preference in Settings (kg/lbs)
- Workout sessions now store workout name directly for history resilience
- Temporary workouts for quick/ad-hoc sessions
- Delete session endpoint (replaces cancel-only behaviour)

### Changed
- Renamed project from Workstr to Liftme throughout (DB file, Docker image, user-agent, docs)
- Database file renamed from `workstr.db` to `liftme.db` — existing users must rename manually
- Compose file renamed from `docker-compose.yml` to `compose.yaml`
- Docker image moved from `dockersette/workstr` to `dockersette/liftme`

### Removed
- Nostr backup, restore, identity, and note-signing features and all related API endpoints
- `pynostr` dependency
- `nostr_event_id` column from exercises schema

---

## [v1.1.0] — 2026-04-27
### Fixed
- Equipment filter on exercises page now actually filters when toggled
- Bodyweight exercises (no equipment) no longer hidden by equipment filter
- Workout card action buttons no longer overflow outside the card on narrow screens

### Changed
- Consolidated equipment management into Settings — removed dedicated Equipment tab
- Single comma-separated "My Equipment" field in Settings now drives both exercise filter and AI generation
- Workout cards use two-row layout with actions on second line

### Removed
- Equipment tab, page, and CRUD API endpoints (`/api/equipment`)

---

## [v1.0.0] — 2026-04-21
### Added
- Exercise library: browse, filter by category/muscle/difficulty, difficulty badges, source badges (AI/seed/camera/manual)
- Favorites: heart toggle on any active exercise
- AI exercise generation via PPQ.ai — generates exercise JSON + fitness photo, lands in Staging
- Camera/image import — upload 1–8 images, vision model extracts exercise details, lands in Staging
- Seed browser — browse and multi-select import from free-exercise-db (800+ exercises)
- Staging tab with approve/discard/approve-all/discard-all workflow
- Trash tab — soft delete with restore and permanent delete
- Equipment table with owned/not-owned toggle; "My Equipment" filter in exercises tab
- Weekly planner — 7-day grid with Morning/Afternoon/Evening slots, week navigation
- Exercise picker modal for adding exercises to plan slots
- Workout template builder — named templates with exercises and rep targets
- Active workout overlay — fullscreen dark mode, set-by-set logging, rest timer with skip
- Workout log history — grouped by date with set/weight pills
- AI workout plan generator — goal, days/week, muscle focus, equipment filter; preview before accepting
- Exercise progress tracking — estimated 1RM (Epley formula) and volume trend bars in exercise drawer
- Nostr Kind 30078 backup — sign all active exercises server-side, publish via WebSocket relay
- Nostr restore — import exercises from pasted Nostr event JSON array (lands in Staging)
- Export workout log as JSON or CSV download
- Version endpoint (`GET /api/version`) — reads VERSION file baked in by CI

---

[Unreleased]: https://github.com/sette7blo/liftme/compare/v2.0.0...HEAD
[v2.0.0]: https://github.com/sette7blo/liftme/compare/v1.1.0...v2.0.0
[v1.1.0]: https://github.com/sette7blo/liftme/compare/v1.0.0...v1.1.0
[v1.0.0]: https://github.com/sette7blo/liftme/releases/tag/v1.0.0
