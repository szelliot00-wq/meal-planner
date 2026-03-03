# Meal Planner

## What this project is
A weekly meal planning web app for Daddy (Steve), Zbutt (Zoe), and Dyl-Boi (Dylan). Drag and drop meals onto a 7-day grid (lunch, dinner per person), then generate a consolidated Tesco shopping list. Built with plain HTML, CSS, and JavaScript — no frameworks, no build tools.

## How to run
Open `index.html` in a browser. No server or build step needed.

Hosted on the spare MacBook Pro at `http://192.168.1.40:8090/app` via FastAPI/uvicorn (launchd agent `com.steveelliott.tiktok-recipes` on port 8090).

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
- Lock Week: Daddy can lock the current week so Zoe/Dylan see next week instead; auto-clears when week rolls over
  - Columns A–G: RecipeID, RecipeName, Instructions, PrepTime, CookTime, Source, Type
  - Columns H–J: Favourite Zoe, Favourite Dylan, Favourite Daddy (Y = favourite)
- Pending recipe review: discreet tab fixed at bottom-centre → approve or reject new recipes
- Food requests: "+ Request" button in header, select Dyl-Boi or Zbutt, enter food → goes to Pending tab

## Person identity
- On first load, a person selector modal appears ("Who are you?")
- Selection persisted in `localStorage` key `mealPlannerCurrentUser`
- "Viewing as: Daddy · Switch" shown in header; click Switch to change person
- Internal keys: `steve`, `zoe`, `dylan` — display labels: `Daddy`, `Zbutt`, `Dyl-Boi`
- `PEOPLE_LABELS` in `app.js` controls display names

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

## Food requests
Kids tap **"+ Request"** in the header:
- Select Dyl-Boi or Zbutt
- Type what they want
- Tap Send → goes to Pending tab with `type=request`
- Approved requests appear in the meal sidebar styled identically to regular meal cards

## Pipeline API (same server, port 8090)
`API_BASE` in `app.js` is `''` (same origin):
- `GET /pending` — fetch count and list of pending items
- `POST /approve/{id}` — approve a recipe
- `DELETE /pending/{id}` — reject a recipe
- `POST /request` — submit a food request (body: `{"name": "Dylan: Pizza"}`)
- `POST /favourite` — toggle a favourite (body: `{ recipe_id, person, actor, value }`)
- `GET /plan` — fetch shared plan `{ current, history, locked, locked_week_id, next }` from server
- `POST /plan` — save shared plan to server (body: `{ current, history }`)
- `POST /lock` — set/clear week lock (body: `{ locked, week_id }`)
- `POST /plan/next` — save next-week plan (body: `{ current }`) — used when week is locked

## Cross-device sync
The current week plan, history, and recipe version are stored in `plan.json` on the server.

- On every save, `savePlan()` POSTs to `/plan` in the background
- On load (after meals ready), `syncFromServer()` fetches `/plan` and re-renders if the plan differs
- Also syncs on tab focus (`visibilitychange`) and every 30 seconds
- localStorage stays as the offline/fallback cache

### Recipe cache invalidation
When a recipe is approved on the server, `recipes_version` in `plan.json` is incremented. On the next sync, other devices compare this to their locally stored `mealPlannerRecipesVersion`. If the server version is higher, they clear the recipe cache and re-fetch from Google Sheets — new recipes appear within 30 seconds on all devices.

## localStorage keys
| Key | Contents |
|-----|----------|
| `mealPlannerCurrentUser` | `'steve'` \| `'zoe'` \| `'dylan'` |
| `mealPlannerFavourites2` | `{ person: { mealId: bool } }` |
| `mealPlannerCurrent` | Current week plan |
| `mealPlannerNext` | Next-week plan (used when week is locked) |
| `mealPlannerHistory` | Array of past week entries (max 12) |
| `mealPlannerRecipeCache` | Cached sheet data + timestamp (cleared on every page load) |
| `mealPlannerRecipesVersion` | Last known `recipes_version` from server (for cache invalidation) |
| `mealPlannerStartDay` | `'mon'`…`'sun'` |
| `mealPlannerLocked` | `'1'` if week is locked, else `'0'` |
| `mealPlannerLockedWeekId` | Week ID that was locked (e.g. `'2026-03-07'`) |

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

## Gotchas
- **Safari `[hidden]` bug**: browsers where author-stylesheet `display` overrides `[hidden]` (e.g. older iOS Safari). Fixed with `[hidden] { display: none !important; }` at top of `styles.css` and inside `wishlist.html`. Do not remove this rule.

## Rules
- Keep things simple. No unnecessary libraries or frameworks.
- All logic goes in `app.js`, all styles in `styles.css`.
- config.js must never be committed — keep secrets out of git.
- When in doubt, ask before making big changes.
