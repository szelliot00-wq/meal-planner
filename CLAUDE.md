# Meal Planner

## What this project is
A weekly meal planning web app for Steve, Zoe, and Dylan. Drag and drop meals onto a 7-day grid (lunch, dinner per person), then generate a consolidated Tesco shopping list. Built with plain HTML, CSS, and JavaScript — no frameworks, no build tools.

## How to run
Open `index.html` in a browser. No server or build step needed.

## Key features
- Stacked single-page layout with all 7 days visible, configurable start day (default Friday)
- Drag and drop meals from sidebar (RHS) to grid cells
- Click assigned meals to remove them
- Generate consolidated shopping list with merged quantities
- Copy shopping list to clipboard
- Auto-save draft to localStorage on every change
- Save weeks to history, view past weeks, copy a past week forward
- Recipe detail modal with instructions, timing, and source link
- Google Sheets integration for recipe database (with hardcoded fallback)

## Data
- 5 default meals with per-person ingredients (used when Google Sheets is not configured)
- Meal data defined in the DEFAULT_MEALS array in app.js
- Can be loaded from Google Sheets instead — see below

## Google Sheets Integration
To load recipes from a Google Sheet:

1. Create a Google Sheet with two tabs:
   - **Recipes** — columns: `RecipeID | RecipeName | Instructions | PrepTime | CookTime | Source`
   - **Ingredients** — columns: `RecipeID | IngredientName | Quantity | Unit`
2. Ingredient quantities should be PER PERSON (same as the default meals)
3. Share the sheet as "Anyone with the link" (Viewer access)
4. Get a Google Sheets API key:
   - Go to Google Cloud Console (console.cloud.google.com)
   - Create a project (or use an existing one)
   - Enable the "Google Sheets API"
   - Go to APIs & Services > Credentials > Create Credentials > API Key
   - Optionally restrict the key to only the Sheets API
5. Open `app.js` and fill in `SPREADSHEET_ID` and `SHEETS_API_KEY` at the top
6. Recipes are cached in localStorage for 1 hour. Click "Refresh Recipes" in the sidebar to force re-fetch.
7. If the sheet is unavailable or not configured, the app falls back to the 5 default meals.

## Rules
- Keep things simple. No unnecessary libraries or frameworks.
- Use clean, readable code with comments explaining what things do.
- All logic goes in `app.js`, all styles in `styles.css`.
- When in doubt, ask before making big changes.
