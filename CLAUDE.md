# Meal Planner

## What this project is
A weekly meal planning web app for Steve, Zoe, and Dylan. Drag and drop meals onto a 7-day grid (breakfast, lunch, dinner per person), then generate a consolidated Tesco shopping list. Built with plain HTML, CSS, and JavaScript — no frameworks, no build tools.

## How to run
Open `index.html` in a browser. No server or build step needed.

## Key features
- Day-tab navigation (Mon-Sun) with 9 cells per day (3 meals x 3 people)
- Drag and drop meals from sidebar to grid cells
- Click assigned meals to remove them
- Generate consolidated shopping list with merged quantities
- Copy shopping list to clipboard
- Auto-save draft to localStorage on every change
- Save weeks to history, view past weeks, copy a past week forward

## Data
- 5 dummy meals with per-person ingredients (will be replaced with Google Sheets integration)
- Meal data is defined in the MEALS array at the top of app.js

## Rules
- Keep things simple. No unnecessary libraries or frameworks.
- Use clean, readable code with comments explaining what things do.
- All logic goes in `app.js`, all styles in `styles.css`.
- When in doubt, ask before making big changes.
