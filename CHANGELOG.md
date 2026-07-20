# Changelog

All notable changes to Workstr will be documented here.
Versions follow [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`

- **MAJOR** — breaking changes (e.g. DB schema requires migration)
- **MINOR** — new features, backwards compatible
- **PATCH** — bug fixes, visual tweaks

---

## [Unreleased]

## [v0.4.1] — 2026-07-20
### Fixed
- Program muscle-map publishing now rasterizes the generated SVG to a real PNG before uploading to nostr.build, avoiding the upstream 500 errors seen with SVG uploads and tagging the published `kind:33402` image metadata as `image/png`. The generated PNG strips text labels so minimal server font sets cannot render missing-glyph square artifacts into the image.

## [v0.4.0] — 2026-07-10
### Changed
- **Discover author pills are now mobile-compact and cache-safe**: avatars are constrained to 14px with inline critical sizing plus a bumped stylesheet cache key, preventing remote profile pictures from expanding workout/program cards.
- **Discover now shows author names and avatars instead of raw pubkey fragments**: exercise and program discovery resolve each event author's Nostr `kind:0` profile in one batched, cached relay lookup and render compact author pills with lazy-loaded avatars, falling back to a short pubkey when metadata is missing.
- **Published workout summaries now attach the worked-muscle body map image**: sharing a session from the finish modal or from History generates the same front/back muscle map as the History/Programs cards, uploads it through the existing NIP-96/nostr.build media flow, appends the image URL to the kind:1 note, and includes a NIP-92 `imeta` tag. If image generation/upload fails, Workstr still publishes the text summary rather than blocking the share.
- **Workout history can publish unpublished sessions from the expanded card**: unpublished history entries show a `Publish summary` action that shares the workout note through Idenstr, then the card flips to the existing `shared` state. Already-shared sessions show a disabled `Published` button instead of offering a duplicate republish.
- **Workout history now shows the same muscle body-map thumbnails as program cards**: each completed session uses its logged exercises to render the front/back muscle map in the History list, with worked muscle groups listed under the session metadata.
- **Discovered programs now render like the library**: the Workouts → Discover tab shows relay-shared programs as the same expandable workout cards as your own programs — muscle body-map thumbnail, name with a source pill (NIP-101e / Workstr, or "in library" once imported), exercise count / description / estimated duration, and targeted muscle groups. Expanding a card lists its exercises inline with sets × reps, weight, rest, and images; the import action moved into the expanded card. Muscle maps and images resolve through your local library, so they fill in for programs whose exercises you have imported.

### Added
- **Raw JSON inspector for published exercises and programs**, mirroring Feedstr's raw-event viewer: a `{ } JSON` button in the detail view of any published exercise (kind:33401) and on any published program card (kind:33402) fetches the live event from the public relays (the relays are the source of truth, not a local copy) and shows it in a read-only terminal-style panel with Copy JSON / Copy event ID actions and a list of which relays currently hold the event. The program Publish button now reads "Update on relays" once published, matching the exercise detail view.
- **Multi-select in the exercise library** for bulk actions, matching the Liftme pattern: a Select toggle in the library header puts the grid in selection mode (tap cards to check them, Select all respects the active search/filters), and a bottom action bar publishes the whole selection to relays or deletes it in one go, with per-item progress and a confirmation before deleting. Selection mode exits automatically when navigating away.

## [v0.3.0] — 2026-07-06
### Added
- **Statistics hero cards**, mirroring the original Liftme app: the Statistics → Training tab now opens with three summary cards — day streak (with a flame that lights up gold while a streak is active), total sessions, and all-time total volume in your weight unit. The volume total that previously sat mislabelled next to the "Weekly volume" heading moved into its own card.

## [v0.2.0] — 2026-07-01
### Added
- A proper **Workstr app logo**, in the same family as Idenstr and Feedstr: a dark-purple squircle with a `wk` monogram, the glowing "str" orbit arc, and a small dumbbell accent (the fitness counterpart to Idenstr's key and Feedstr's feed-lines). It now appears in the header, the browser tab (favicon), and as the PWA / iOS home-screen icon. Adds `favicon.ico`, a 32px favicon, header logo, 192/512 maskable PWA icons, an opaque apple-touch icon, and a `manifest.webmanifest` so Workstr installs as a standalone app. Branding assets are served without authentication (like Idenstr) so the icon still loads on the Basic-auth challenge instead of falling back to a generated letter tile.
- The **Statistics → Body** tab is now a full body-tracking page rather than just a weight log. From your logged weights it shows three summary cards (current weight, 7-day rolling average, total change since the first entry), a **BMI** zone bar (underweight / normal / overweight / obese) with a marker at your current value, a **weight-trend** chart, and a **goal-progress** bar. A new **Profile** form captures your height (cm) and target weight; BMI needs the height and goal progress needs the target, and both are stored server-side in the app DB so they survive backups and follow your weight unit (kg/lbs). Mirrors the Body page from the original Liftme app.
- Programs can now be **published to Nostr** as standard NIP-101e workout templates (`kind:33402`), so any NIP-101e client can run them — mirroring how exercises publish as `kind:33401`. A program is a local-DB item by default; publishing is one optional action that signs and broadcasts it through Idenstr, addressable by a `workstr:program:<slug>` `d`-tag (re-publishing updates rather than duplicates). Each member exercise is referenced by its `33401:` coordinate (one `exercise` tag per prescribed set), and the exact Workstr prescription rides along in a namespaced `workstr_meta` tag for lossless re-import. Because a published template must reference published exercises, **publishing a program first auto-publishes (or re-publishes) every exercise it contains**; if any exercise fails to publish, the whole program publish fails and nothing is recorded.
- A **Discover** sub-tab under Workouts, mirroring the exercise Discover: it reads workout templates (`kind:33402`) shared on your relays and imports them into your library. Importing a program fetches and imports any of its referenced exercises you don't already have, then recreates the program locally with your prescription.

### Changed
- **Breaking:** programs are no longer signed as private `kind:30078` (NIP-78) events stored in the Idenstr private relay. They are now local-DB-first with an optional public `kind:33402` broadcast, exactly like exercises. The read-only "Local vault" sheets view in Settings has been removed. A least-privilege Workstr token now needs `publish:kind:33402` instead of `sign:kind:30078` — **re-authorize your Idenstr token** to add the new scope. The `sheets` table gains `slug`, `nostr_pubkey` and `nostr_address` columns (migrated in place); any program previously "published" as a private `30078` event is shown as unpublished until you publish it publicly.

## [v0.1.1] — 2026-06-25
### Changed
- Trimmed the Idenstr scopes Workstr requests to only the ones it actually uses: dropped `sign:kind:33401` and `publish:kind:30078` (never exercised — exercises publish via `publish:kind:33401`, sheets sign via `sign:kind:30078`). A least-privilege Workstr token now needs six scopes instead of eight, all selectable as checkboxes in Idenstr.

## [v0.1.0] — 2026-06-25
### Changed
- Backend hardening and efficiency pass: prepared SQL statements are cached and reused, the session list is built with one grouped query instead of an aggregate per session, Idenstr requests time out instead of hanging when Idenstr is unreachable, request bodies are size-capped, static assets are gzip-compressed, and relay discovery is bounded by a small connection pool. Removed unused code.
### Added
- The **Discover** tab now has a filter bar matching the Library's: a live text search (name, muscle group and tags) plus category, muscle and difficulty dropdowns. The dropdowns are populated from whatever the relays actually returned, and filtering happens instantly client-side against the already-fetched results (no extra relay round-trip). The status line shows how many of the shared exercises match your filters.
- Discover now also reads NIP-101e exercise templates (`kind:33401`) from the same Idenstr relay list as Workstr-native events. It keeps Workstr `kind:30078` and NIP-101e results separate internally, labels cards by source, rejects noisy/non-fitness `33401` collisions, maps NIP-101e tags/title into Workstr recovery muscles before import, and renders NIP-92/YouTube demo media as card thumbnails plus instruction/demo links when present.
- The **Discover** sub-tab now finds exercises shared on your relays. It reads the public relay list from Idenstr and queries them for shared exercise events (`kind:30078`, `t:exercise`), deduplicating by address and keeping the newest version of each. Each result shows as a card with its image, muscle group and author; **Import** saves it into your library (its image is downloaded into the local database per the images-in-DB policy, source marked `nostr`, with the originating event recorded). Re-importing the same exercise is detected and skipped.
- Exercises can be **published to Nostr** as standard NIP-101e exercise templates (`kind:33401`) so any NIP-101e client (POWR, etc.) can discover them — not just Workstr. Publishing signs and broadcasts the event through Idenstr, addressable by a `workstr:exercise:<slug>` `d`-tag (re-publishing updates rather than duplicates) with the spec's required tags (`title`, `format`, `format_units`, `equipment`, `difficulty`, `imeta`) and `t` discovery hashtags. Workstr-only richness rides along in namespaced tags other clients ignore: `t:workstr`/`client:workstr` identity (so Workstr can filter its own library out of the shared pool), the granular `workstr_muscle` recovery map (primary/secondary roles), and a `workstr_meta` payload — together these let a Workstr exercise re-import losslessly. The locally stored image is uploaded to nostr.build (NIP-96, authed with a NIP-98 event Idenstr signs) and referenced as a public URL in the event, while the library keeps its own copy. The published event id, author pubkey and `33401:` address are recorded on the exercise. Requires the new Idenstr scopes `relays:read`, `sign:kind:27235`, `sign:kind:33401` and `publish:kind:33401`.
- A **Quick workout** generator in the Recovery tab, ported from Liftme: pick a duration (20/30/45/60 min) and it builds a balanced session from exercises whose muscle groups are recovered (ready, ≥80%), round-robining across muscle groups to fill the time budget and favouring compound and previously-logged movements. You can swap any exercise for another targeting the same muscle or drop it, then Start — the generated workout runs as a temporary, hidden program that is removed automatically when the session ends.
- Programs now carry a target **weight** per exercise, matching Liftme: a weight column in the program builder (entered in your chosen unit), shown as `sets × reps @ weight` on each exercise card and as a Weight cell in its detail grid, and pre-filled as the placeholder when you log that exercise in a live session. Weight is stored canonically in kg (existing databases are migrated in place to add the column) and included in the published program event.
- A **History** sub-tab in Workouts (between Programs and Recovery) listing every completed session newest-first, each with its date, duration, set count, and volume. Expanding a session unfolds the exercises and the sets you logged (reps × weight), the session note, and a Delete action that removes it from your history and stats — matching Workstr's accordion idiom rather than a drawer.

### Changed
- Discover no longer reads legacy `kind:30078` exercise events from relays — only standard NIP-101e `kind:33401` exercise templates are shown (Workstr publishes its own exercises as `33401` now, so its shared library still appears). Importing an exercise is unchanged.
- Exercises now have Library / Discover sub-tabs. Library is the local database; Discover is the relay-facing placeholder for future exercise imports. New installs start with an empty exercise library instead of auto-seeding bundled exercises.
- Removed the bundled exercise seed module/dataset. Existing rows from older databases are treated like manually-created exercises in the UI instead of showing a seed badge.
- Exercise images are now always stored locally in the database and served from the cached `api/v1/exercises/:slug/image` endpoint — the library never hot-links an external URL. Creating or editing an exercise with a remote (`http(s)`) image downloads it into the DB; existing exercises that pointed at external image URLs were migrated in place. This removes per-render requests to the public internet (e.g. raw.githubusercontent.com), so the library loads fast and works offline — a localised image now serves from the LAN in ~13ms versus ~280ms from GitHub.
- Deleting an exercise now permanently removes it when nothing references it, instead of leaving a hidden `deleted` row in the database forever. Exercises still used by a program or a past workout are kept (hidden from the Library) so that history keeps showing their name rather than a bare slug. Existing orphaned `deleted` rows were purged.
- Rebuilt the program builder to match Liftme's workout builder: a type-to-search exercise picker with a results dropdown (replacing the plain select), and exercise rows with a thumbnail, name + muscle, inline Sets/Reps/Rest inputs, and move-up/down + remove controls.
- Reworked the Workouts area to match Liftme: "Sheets" is now **Programs**, and the separate **Train** sub-tab is gone — you start a workout straight from a program. Each program is an expandable card with a composite body-map thumbnail (the muscles it works), exercise count, estimated duration, and muscle-group list; expanding it lists the exercises (each opens to Sets/Reps/Rest and notes) with Start / Edit / Publish / Delete actions. An in-progress session shows a Resume card at the top. The session-complete recap now opens as a modal (it previously lived in the removed Train tab). Recovery is unchanged.

### Fixed
- Saving the Idenstr connection (token/URLs) from Settings no longer fails with a permission error. The settings form writes back to the bind-mounted `.env`, but the container's entrypoint only fixed ownership of `/data`, leaving `.env` unwritable by the non-root app user — so every in-app save silently failed and the app kept using stale values. The entrypoint now makes `/app/.env` read-write at startup (without taking ownership, so the host `docker compose` CLI can still read it), so fresh installs work out of the box.
- Re-uploading an exercise image now shows the new image immediately on library cards. Card thumbnails are served from a cached `/image` endpoint whose URL was keyed only on the exercise slug, so after replacing an image the browser kept serving the old cached copy for up to a day. The URL now carries the exercise's last-updated time, so each edit busts the cache.
- Discover exercise cards now render the same coloured difficulty badge treatment as Library cards (beginner/intermediate/advanced), with a visible fallback style for unknown custom difficulty labels.
- The kg/lbs weight-unit setting now actually converts values instead of only swapping the label. Weights are stored canonically in kg and converted to the chosen unit everywhere they appear (session logging, history, program weights, body weight, volume, PRs and estimated 1RM), and inputs you type in lbs are converted back to kg on save. The shared workout-summary note published via Idenstr now also renders its weights and total volume in your chosen unit (with the unit suffix), instead of always in kg. Previously choosing lbs left every number unchanged and just relabelled it.
- Exercise library cards no longer break their HTML on the image fallback (the placeholder markup was being inlined into an `onerror` attribute, leaking SVG fragments as stray text and rendering a phantom second image that shoved the tags around). The photo now layers cleanly over a placeholder icon that shows through only when the image is missing or fails to load.

### Changed
- Reworked the exercise detail view to match Liftme: a Sets / Reps / Rest box row, a Target-muscles section with an anatomical body map that highlights the worked muscles, a labelled Equipment section, and a Tags section (empty/null tags filtered out) — in place of the single unlabelled badge strip.
- Rebuilt the active training surface so it matches the rest of the suite and Idenstr/Feedstr instead of looking like a bolt-on. The overlay now uses the sovereign-purple void theme, cyber-grid backdrop, and Inter + monospace type (was a red-tinted background with serif headings); the header gains a live-session eyebrow, an elapsed-time chip, and a workout progress bar; nav dots, the rest ring, and buttons all use the house palette (purple for navigation/current, bitcoin-gold reserved for the Log action, green for completion).
- Reworked the in-session logging flow: logging a set updates in place (no full re-render, so focus and scroll are kept), marks the set done with a pop animation, unlocks the next set, and carries the reps/weight forward into it. The "Start a session" screen is now a card grid.

### Added (training view)
- In-session quality-of-life carried over from Liftme: a live PR alert (an Epley estimated-1RM that beats your previous best pops a toast), a collapsible "How to perform" instructions panel per exercise, a "Next up" hint on the rest countdown, and a screen-wake fallback (muted looping video) so the display stays on over plain HTTP/LAN where the Wake Lock API is unavailable.
- Rich session-complete summary: duration, total sets, volume, and exercise count as stat cards, personal-record chips earned during the session, and a per-exercise "vs last time" volume comparison — alongside the existing Share-summary-via-Idenstr action.

### Added
- First build of Workstr: a sovereign, self-hosted workout tracker in the `*str` stack (Node.js, `node:sqlite`, single-page vanilla frontend), styled to match Idenstr.
- DB-first data model: exercises, workout sheets, sessions with set-by-set logging, weekly plan, mesocycles, body weight log, and derived statistics (weekly volume, muscle distribution, estimated-1RM personal records, training streak) all live in the local database.
- Exercise library with search, category/muscle/difficulty filters, favourites, and create/edit/delete.
- Workout sheet builder: ordered exercises with per-exercise sets/reps/rest, reorder and edit.
- Active session logging from a sheet (or freestyle), with finish and history.
- Idenstr link (Authority): a Connect page to set the Idenstr URL + scoped API token and test the connection. Workstr has no login of its own (like Feedstr) — it relies on the network boundary and its scoped token; optional HTTP Basic auth turns on if `WORKSTR_AUTH_USER`/`WORKSTR_AUTH_PASSWORD` are set.
- Nostr layer through Idenstr: publish a workout sheet as a private, replaceable `kind:30078` event (NIP-78) signed and stored in the vault; share a workout summary as a `kind:1` note that Idenstr signs and publishes to your write relays.
- Read-only access to the Idenstr local relay (`WORKSTR_LOCAL_RELAY`): Workstr reads canonical events back from the write-ahead vault (e.g. the stored sheets shown on the Connect page). It never writes — the relay is pinned to the owner key — and needs no token scope for reads.

### Changed
- Exercise cards were rebuilt to match Liftme — a photo with source and difficulty badges, name, muscle group, and equipment/category tags — and the detail view shows the photo plus numbered instructions. New/edited exercises can carry an image URL.
- Reworked the navigation to the shared workout-app layout: a fixed left sidebar (Exercises, Workouts, Planner, Statistics, with Settings pinned at the bottom) replaces the top tab bar, with a logo topbar and per-page sub-tabs (Workouts: Sheets/Train/Recovery; Planner: Week/Mesocycles; Statistics: Training/Body). The Idenstr connection, vault, and weight-unit preference now live under Settings; the separate Overview page is gone. The Idenstr purple theme is unchanged. On phones the sidebar becomes a bottom nav bar.

### Added (recovery)
- Muscle recovery view (Workouts → Recovery): estimated per-muscle-group readiness derived from completed sessions over the last 10 days, with per-group base recovery hours (larger groups recover slower) adjusted by training volume, an overall-readiness figure, and a ready-count. Primary muscle counts full, secondary muscles half. New `GET /api/v1/recovery`.
- Anatomical body map on the Recovery view: a front + back figure whose muscle regions are coloured by readiness (green ready / gold partial / red recovering / dim untrained), with a hover tooltip (muscle, percent, status, hours-to-full), muscle highlight, a status legend, and a side-by-side ranked list. Themed in the Idenstr palette; stacks on mobile.

### Notes
- Sharing a summary requires Idenstr to allow the `publish:kind:1` scope on `POST /api/v1/events/publish` (currently admin-only); see the stack working document.
- Weight unit (kg/lbs) is a display label in this version; stored values are not converted when the unit is switched.
- AI features (exercise/image/vision generation) are deferred to a later phase.

[Unreleased]: https://github.com/sette7blo/workstr/compare/v0.4.1...HEAD
[v0.4.1]: https://github.com/sette7blo/workstr/compare/v0.4.0...v0.4.1
[v0.4.0]: https://github.com/sette7blo/workstr/compare/v0.3.0...v0.4.0
[v0.3.0]: https://github.com/sette7blo/workstr/compare/v0.2.0...v0.3.0
[v0.2.0]: https://github.com/sette7blo/workstr/compare/v0.1.1...v0.2.0
[v0.1.1]: https://github.com/sette7blo/workstr/compare/v0.1.0...v0.1.1
[v0.1.0]: https://github.com/sette7blo/workstr/releases/tag/v0.1.0
