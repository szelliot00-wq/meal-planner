# Meal Planner

## What this project is
A weekly meal planning web app for Daddy (Steve), Zbutt (Zoe), and Dyl-Boi (Dylan). Drag and drop meals onto a 7-day grid (lunch, dinner per person), then generate a consolidated Tesco shopping list. Built with plain HTML, CSS, and JavaScript — no frameworks, no build tools.

## How to run
Open `index.html` in a browser. No server or build step needed.

Hosted on the spare MacBook Pro at `http://192.168.1.40:8090/app` via FastAPI/uvicorn (launchd agent `com.steveelliott.tiktok-recipes` on port 8090).

⚠️ **Editing machine ≠ serving machine.** Code is edited on the main MacBook Air (`192.168.1.169`) but served from the spare MacBook Pro (`192.168.1.40`). After editing, copy changed files with:
```bash
scp -F ~/.ssh/config app.js styles.css index.html macbookpro:~/Claude-projects/meal-planner/
scp -F ~/.ssh/config view/index.html macbookpro:~/Claude-projects/meal-planner/view/index.html
```
SSH alias `macbookpro` is defined in `~/.ssh/config` (HostName 192.168.1.40, User steveelliott, IdentityFile ~/.ssh/macbook_pro). Project path on MacBook Pro: `~/Claude-projects/meal-planner/`.

## Key features
- Stacked single-page layout with all 7 days visible
- Configurable start day — moved to a discreet fixed pill at bottom-right of screen
- Drag and drop meals from sidebar (RHS) to grid cells
- Per-person permissions: Zbutt/Dyl-Boi can only edit their own slots; Daddy unrestricted
- Copy shopping list to clipboard (via shopping list modal)
- Auto-save on every action (no Save button)
- Week history in header dropdown — click current week label to see past weeks, click one to view/copy
- Recipe detail modal with instructions, timing, and source link
- Google Sheets integration for recipe database (with hardcoded fallback)
- Pending recipe review: discreet tab fixed at bottom-centre → approve or reject new recipes

## Person identity
- Always Daddy (`currentUser = 'steve'`) — hardcoded on init, no selector
- Internal keys: `steve`, `zoe`, `dylan` — display labels: `Daddy`, `Zbutt`, `Dyl-Boi`
- `PEOPLE_LABELS` in `app.js` controls display names (still used to label grid columns)

## Favourites
- Per-person favourites driven by Google Sheet columns H (Zoe), I (Dylan), J (Daddy) — `Y` = favourite
- Overrides stored in `localStorage` key `mealPlannerFavourites2` (boolean per person per meal)
- Star icon on each meal card to toggle; writes back to sheet via `POST /favourite`
- Favourites section pinned at top of sidebar (scrolls after ~5 cards); All Meals scrollable below
- Search/filter bar filters the All Meals section

## Files
- `index.html` — single page, all structure
- `app.js` — all logic
- `styles.css` — all styles
- `config.js` — API keys (gitignored — not in GitHub)
- `config.example.js` — template for config.js

## Config (API keys)
Keys live in `config.js` (gitignored — never commit). Copy `config.example.js` to `config.js` and fill in your values:
```js
var SPREADSHEET_ID = '1HBBIfMdz47mdUzzTS7IlLhuFVV5Z98EuXZJeWXFl6mw';
var SHEETS_API_KEY = '<your read-only Sheets API key>';
```
On the MacBook Pro the file lives at `~/Claude-projects/meal-planner/config.js` — it is NOT deployed via git, so create it manually after any fresh clone.

⚠️ The API key must never appear in any committed file (app.js, CLAUDE.md, etc). Previous keys were accidentally committed and had to be revoked.

## Google Sheets Integration
Recipes tab columns: `RecipeID | RecipeName | Instructions | PrepTime | CookTime | Source | Type | Favourite Zoe | Favourite Dylan | Favourite Daddy`

- Fetched range is `A:J`
- `Y` in H/I/J marks a meal as a default favourite for that person
- Recipe cache is cleared on every page load — always fetches fresh from Sheets
- Falls back to 5 hardcoded default meals if Sheets not configured
- Duplicate RecipeIDs are detected and made unique automatically (original ID + row index); a `console.warn` is logged to help identify bad sheet data

## Recipe approval workflow
New TikTok recipes land in the **Pending** Google Sheet tab, not Recipes. The pipeline server handles the review API.

- **Discreet tab** fixed at bottom-centre — semi-transparent, hidden when empty
- **Click tab** → review modal with Approve / Reject per item
  - Approve: moves row from Pending to Recipes instantly
  - Reject: deletes row from Pending instantly

## Pipeline API (same server, port 8090)
`API_BASE` in `app.js` is `''` (same origin):
- `GET /pending` — fetch count and list of pending items
- `POST /approve/{id}` — approve a recipe
- `DELETE /pending/{id}` — reject a recipe
- `POST /favourite` — toggle a favourite (body: `{ recipe_id, person, actor, value }`)
- `GET /plan` — fetch shared plan `{ current, history }` from server
- `POST /plan` — save shared plan to server (body: `{ current, history }`)

## Cross-device sync
The current week plan, history, and recipe version are stored in `plan.json` on the server.

- On every save, `savePlan()` POSTs to `/plan` in the background
- On load (after meals ready), `syncFromServer()` fetches `/plan` and re-renders if the plan differs
- Also syncs on tab focus (`visibilitychange`) and every 30 seconds
- localStorage stays as the offline/fallback cache

### Sync safety rules (in `syncFromServer`)
- **Server week ahead of local** (e.g. plan saved from MacBook while iPhone still thinks it's last week) → adopt server's week ID and plan
- **Server week behind local** → push local plan to server
- **Server plan has fewer meals than local** → push local plan to server (prevents an empty device wiping a populated one)

### effectiveWeekId
`app.js` tracks `effectiveWeekId` separately from `getCustomWeekId(new Date())`. On the last day of a week, the plan may already have been saved for the *next* week's ID. `effectiveWeekId` ensures saves, labels, and sync checks all use the correct ID. Loaded from whichever localStorage store (`mealPlannerCurrent` or legacy `mealPlannerNext`) has more filled slots.

### Recipe cache invalidation
When a recipe is approved on the server, `recipes_version` in `plan.json` is incremented. On the next sync, other devices compare this to their locally stored `mealPlannerRecipesVersion`. If the server version is higher, they clear the recipe cache and re-fetch from Google Sheets — new recipes appear within 30 seconds on all devices.

## localStorage keys
| Key | Contents |
|-----|----------|
| `mealPlannerFavourites2` | `{ person: { mealId: bool } }` |
| `mealPlannerCurrent` | Current week plan `{ weekId, weekLabel, savedAt, plan, notes }` |
| `mealPlannerNext` | Legacy store — Daddy's "next week" plan from the old lock-week feature. Still checked on startup as a fallback; whichever of `mealPlannerCurrent`/`mealPlannerNext` has more filled slots wins. |
| `mealPlannerHistory` | Array of past week entries (max 12) |
| `mealPlannerRecipeCache` | Cached sheet data + timestamp (cleared on every page load) |
| `mealPlannerRecipesVersion` | Last known `recipes_version` from server (for cache invalidation) |
| `mealPlannerStartDay` | `'mon'`…`'sun'` |

## Kids wishlist

Kids submit ranked meal picks at `/app/wishlist`. Daddy sees them in the **Wishes** sidebar tab with a badge count, and can drag picks directly into the meal grid.

- `/app/wishlist` — person picker (Dyl-Boi / Zbutt)
- `/app/wishlist?for=dylan` or `?for=zoe` — skips picker, straight to wishlist
- Daddy uses "Copy Dyl-Boi link" / "Copy Zbutt link" buttons in the Wishes tab and pastes into WhatsApp manually
- Wishlist stored in `wishlist.json` on the server (not committed)
- Resets when week rolls over (Friday-based week ID); re-submitting overwrites only that kid's entry
- `GET /wishlists` — returns current week's submissions
- `POST /wishlist/{person}` — body: `{ picks: [mealIds], notes: string, week_id: string }`
- `GET /meals` — returns all recipes for the wishlist page (service account, no browser API key, 5-min cache)

## Weekly wishlist emails
Every Wednesday at 14:00 the pipeline server sends a personalised email to each kid with their wishlist link, CC'd to Daddy. Runs as a background thread in `main.py` — no separate script or launchd agent.

- **Dylan**: dmasterw7@gmail.com → `/app/wishlist?for=dylan`
- **Zoe**: zmasterw5@gmail.com → `/app/wishlist?for=zoe`
- **From**: Daddy (szelliot00@gmail.com)
- Requires `GMAIL_FROM` and `GMAIL_APP_PASSWORD` in `.env` on MacBook Pro
- `MEAL_PLANNER_BASE_URL` defaults to `http://192.168.1.40:8090`

## Gotchas
- **Safari `[hidden]` bug**: browsers where author-stylesheet `display` overrides `[hidden]` (e.g. older iOS Safari). Fixed with `[hidden] { display: none !important; }` at top of `styles.css` and inside `wishlist.html`. Do not remove this rule.
- **iOS home screen shortcut caching**: iPhone shortcuts have an isolated cache and localStorage separate from Safari. The FastAPI server (`main.py`) sends `Cache-Control: no-cache, no-store, must-revalidate` for all HTML responses via a middleware, so the shortcut always fetches fresh HTML. JS files are cache-busted with `?v=N` query strings in `index.html` — bump `N` whenever a breaking JS change is deployed.
- **Script tag version**: `index.html` loads `app.js?v=2` and `config.js?v=2`. Increment both when deploying JS changes that must bypass the shortcut cache.

## Rules
- Keep things simple. No unnecessary libraries or frameworks.
- All logic goes in `app.js`, all styles in `styles.css`.
- config.js must never be committed — keep secrets out of git.
- When in doubt, ask before making big changes.
