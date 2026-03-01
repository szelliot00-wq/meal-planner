# Meal Planner

## What this project is
A weekly meal planning web app for Steve, Zoe, and Dylan. Drag and drop meals onto a 7-day grid (lunch, dinner per person), then generate a consolidated Tesco shopping list. Built with plain HTML, CSS, and JavaScript — no frameworks, no build tools.

## How to run
Open `index.html` in a browser. No server or build step needed.

Hosted on the spare MacBook Pro at `http://192.168.1.40:8090` via `python3 -m http.server 8090` (launchd agent `com.steveelliott.meal-planner`).

## Key features
- Stacked single-page layout with all 7 days visible, configurable start day (default Saturday)
- Drag and drop meals from sidebar (RHS) to grid cells
- Click assigned meals to remove them
- Generate consolidated shopping list with merged quantities
- Copy shopping list to clipboard
- Auto-save draft to localStorage on every change
- Save weeks to history, view past weeks, copy a past week forward
- Recipe detail modal with instructions, timing, and source link
- Google Sheets integration for recipe database (with hardcoded fallback)
- Pending recipe review: orange badge in header → approve or reject new recipes
- Food requests: kids tap "+ New Food Request", enter their name and food — goes to Pending tab

## Files
- `index.html` — single page, all structure
- `app.js` — all logic
- `styles.css` — all styles
- `config.js` — API keys (gitignored — not in GitHub)
- `config.example.js` — template for config.js

## Config (API keys)
Keys live in `config.js` (gitignored). Copy `config.example.js` to `config.js` and fill in:
```js
var SPREADSHEET_ID = '1HBBIfMdz47mdUzzTS7IlLhuFVV5Z98EuXZJeWXFl6mw';
var SHEETS_API_KEY = 'AIzaSyAuPCZcxEoAynplB4kODQ7v6pdym5eRovM';
```
On the MacBook Pro the file lives at `~/Claude-projects/meal-planner/config.js` — it is NOT deployed via git, so create it manually after any fresh clone.

## Data
- 5 default meals with per-person ingredients (used when Google Sheets is not configured)
- Meal data defined in the DEFAULT_MEALS array in app.js
- Can be loaded from Google Sheets instead — see below

## Google Sheets Integration
To load recipes from a Google Sheet:

1. Create a Google Sheet with three tabs:
   - **Recipes** — columns: `RecipeID | RecipeName | Instructions | PrepTime | CookTime | Source | Type`
   - **Ingredients** — columns: `RecipeID | IngredientName | Quantity | Unit`
   - **Pending** — same columns as Recipes (auto-created by the pipeline server)
2. Ingredient column format:
   - `Quantity` = **numeric string** (e.g. `"100"`, `"2"`, `"0.5"`) — no units embedded
   - `Unit` = **unit string** (e.g. `"g"`, `"ml"`, `"tsp"`, `"tbsp"`, or `""` for countable items)
   - All quantities are **per person**
   - This matches the format written by the `tiktok-recipe-pipeline`
3. Share the sheet as "Anyone with the link" (Viewer access)
4. Fill in `config.js` with SPREADSHEET_ID and SHEETS_API_KEY (read-only API key)
5. Recipes are cached in localStorage for 1 hour. Click "Refresh Recipes" in the sidebar to force re-fetch.
6. If the sheet is unavailable or not configured, the app falls back to the 5 default meals.

## Recipe approval workflow
New TikTok recipes land in the **Pending** Google Sheet tab, not Recipes. The pipeline server at `http://192.168.1.40:8080` handles the review API.

- **Orange badge** in header shows count of pending items (hidden when empty)
- **Click badge** → review modal with Approve / Reject per recipe
  - Approve: moves row from Pending to Recipes (meal becomes available immediately after cache expires)
  - Reject: deletes row from Pending
- Food requests (type=`request`) show in red with a "Food request" tag; can only be Rejected (not self-approved)
- After approving, click "Refresh Recipes" in the sidebar to reload the meal list immediately

## Food requests
Kids tap **"+ New Food Request"** at the top of the sidebar:
- Select Dylan or Zoe
- Type what they want
- Tap Send — modal closes immediately with "Request sent!" toast
- The request is sent to the pipeline API in the background and appears in Pending with `type=request`
- Approved requests appear in the meal sidebar with a red left border

## Pipeline API (http://192.168.1.40:8080)
The `API_BASE` variable in `app.js` points to the pipeline server. All calls are fire-and-forget or read-only:
- `GET /pending` — fetch count and list of pending items
- `POST /approve/{id}` — approve a recipe
- `DELETE /pending/{id}` — reject a recipe
- `POST /request` — submit a food request

The meal planner silently ignores API errors (badge stays hidden, toasts don't error) so it still works offline or away from home WiFi.

## Shopping list format
Ingredients from all sources (Google Sheets and DEFAULT_MEALS) use the same unified format:
`{ name: string, quantity: number, unit: string }`

The shopping list merges by `name + unit`, sums quantities, and displays as:
- `"300g Beef Mince"` — units that attach without a space: g, kg, ml, l
- `"2 tbsp Soy Sauce"` — other units get a space
- `"3 Eggs"` — no unit

## Rules
- Keep things simple. No unnecessary libraries or frameworks.
- Use clean, readable code with comments explaining what things do.
- All logic goes in `app.js`, all styles in `styles.css`.
- config.js must never be committed — keep secrets out of git.
- When in doubt, ask before making big changes.
