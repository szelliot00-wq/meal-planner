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
- Recipes are cached in localStorage for 1 hour (key: `mealPlannerRecipeCache`)
- Falls back to 5 hardcoded default meals if Sheets not configured

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
- Approved requests appear in the meal sidebar with a red left border

## Pipeline API (same server, port 8090)
`API_BASE` in `app.js` is `''` (same origin):
- `GET /pending` — fetch count and list of pending items
- `POST /approve/{id}` — approve a recipe
- `DELETE /pending/{id}` — reject a recipe
- `POST /request` — submit a food request (body: `{"name": "Dylan: Pizza"}`)
- `POST /favourite` — toggle a favourite (body: `{ recipe_id, person, actor, value }`)
- `GET /plan` — fetch shared plan `{ current, history }` from server
- `POST /plan` — save shared plan to server (body: `{ current, history }`)

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
| `mealPlannerHistory` | Array of past week entries (max 12) |
| `mealPlannerRecipeCache` | Cached sheet data + timestamp |
| `mealPlannerRecipesVersion` | Last known `recipes_version` from server (for cache invalidation) |
| `mealPlannerStartDay` | `'mon'`…`'sun'` |

## Rules
- Keep things simple. No unnecessary libraries or frameworks.
- All logic goes in `app.js`, all styles in `styles.css`.
- config.js must never be committed — keep secrets out of git.
- When in doubt, ask before making big changes.
