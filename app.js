// ==============================================
// MEAL PLANNER - app.js
// Weekly meal planner with drag-and-drop,
// shopping list generation, and history.
// Stacked single-page layout, configurable start day.
// ==============================================

// ── SECTION 1: Constants and Data ──────────────

// ── Google Sheets Configuration ──
// To load recipes from a Google Sheet instead of the defaults below:
// 1. Create a Google Sheet with two tabs: "Recipes" and "Ingredients"
//    Recipes columns:  RecipeID | RecipeName | Instructions | PrepTime | CookTime | Source
//    Ingredients cols: RecipeID | IngredientName | Quantity | Unit
// 2. Share the sheet as "Anyone with the link" (Viewer)
// 3. Get a Google Sheets API key from Google Cloud Console
// 4. Fill in SPREADSHEET_ID and SHEETS_API_KEY below
// Leave SPREADSHEET_ID as empty string to use the hardcoded fallback meals.
// SPREADSHEET_ID and SHEETS_API_KEY are loaded from config.js (gitignored)
var SHEETS_CACHE_TTL = 3600000; // 1 hour in milliseconds

// ── Recipe Pipeline API (for pending review + food requests) ──
// Empty string = same origin (served via FastAPI on port 8080)
var API_BASE = '';

// All 7 days in standard order — we rotate based on startDay setting
var ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
var DAY_LABELS = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday'
};

// Meal slots: lunch and dinner only (no breakfast)
var MEALS_OF_DAY = ['lunch', 'dinner'];
var MEAL_LABELS = { lunch: 'Lunch', dinner: 'Dinner' };

// People in the household
var PEOPLE = ['steve', 'zoe', 'dylan'];
var PEOPLE_LABELS = { steve: 'Daddy', zoe: 'Zbutt', dylan: 'Dyl-Boi' };

/**
 * DEFAULT_MEALS - fallback menu used when Google Sheets is not configured.
 * Each meal has an id, name, ingredients, and optional recipe details.
 * Ingredient quantities are PER PERSON.
 */
var DEFAULT_MEALS = [
  {
    id: 'spaghetti-bolognese',
    name: 'Spaghetti Bolognese',
    instructions: '',
    prepTime: '',
    cookTime: '',
    source: '',
    ingredients: [
      { name: 'Spaghetti', quantity: 100, unit: 'g' },
      { name: 'Beef Mince', quantity: 150, unit: 'g' },
      { name: 'Tinned Chopped Tomatoes', quantity: 0.5, unit: 'tin' },
      { name: 'Onion', quantity: 0.5, unit: '' },
      { name: 'Garlic Cloves', quantity: 1, unit: '' },
      { name: 'Olive Oil', quantity: 1, unit: 'tbsp' },
      { name: 'Parmesan', quantity: 20, unit: 'g' }
    ]
  },
  {
    id: 'chicken-stir-fry',
    name: 'Chicken Stir Fry',
    instructions: '',
    prepTime: '',
    cookTime: '',
    source: '',
    ingredients: [
      { name: 'Chicken Breast', quantity: 150, unit: 'g' },
      { name: 'Egg Noodles', quantity: 100, unit: 'g' },
      { name: 'Soy Sauce', quantity: 2, unit: 'tbsp' },
      { name: 'Mixed Peppers', quantity: 1, unit: '' },
      { name: 'Spring Onions', quantity: 2, unit: '' },
      { name: 'Garlic Cloves', quantity: 1, unit: '' },
      { name: 'Sesame Oil', quantity: 1, unit: 'tsp' }
    ]
  },
  {
    id: 'beans-on-toast',
    name: 'Beans on Toast',
    instructions: '',
    prepTime: '',
    cookTime: '',
    source: '',
    ingredients: [
      { name: 'Baked Beans', quantity: 0.5, unit: 'tin' },
      { name: 'Bread', quantity: 2, unit: 'slices' },
      { name: 'Butter', quantity: 10, unit: 'g' },
      { name: 'Cheddar Cheese', quantity: 30, unit: 'g' }
    ]
  },
  {
    id: 'salmon-and-veg',
    name: 'Salmon & Roasted Veg',
    instructions: '',
    prepTime: '',
    cookTime: '',
    source: '',
    ingredients: [
      { name: 'Salmon Fillet', quantity: 1, unit: '' },
      { name: 'Broccoli', quantity: 100, unit: 'g' },
      { name: 'Sweet Potato', quantity: 1, unit: '' },
      { name: 'Olive Oil', quantity: 1, unit: 'tbsp' },
      { name: 'Lemon', quantity: 0.5, unit: '' }
    ]
  },
  {
    id: 'omelette',
    name: 'Omelette',
    instructions: '',
    prepTime: '',
    cookTime: '',
    source: '',
    ingredients: [
      { name: 'Eggs', quantity: 3, unit: '' },
      { name: 'Butter', quantity: 10, unit: 'g' },
      { name: 'Cheddar Cheese', quantity: 30, unit: 'g' },
      { name: 'Mushrooms', quantity: 50, unit: 'g' },
      { name: 'Cherry Tomatoes', quantity: 4, unit: '' }
    ]
  }
];

// Active meals array — populated during initialization from Sheets or defaults
var MEALS = [];


// ── SECTION 2: State ───────────────────────────

// The current week's meal assignments: { "mon-lunch-steve": "omelette", ... }
var currentPlan = {};

/// Free-form notes per slot — Daddy only: { "mon-lunch-steve": "Out" }
var currentPlanNotes = {};

// The effective week ID for the currently displayed plan.
// May differ from getCustomWeekId(new Date()) on the last day of the week
// when data was already planned ahead for next week.
var effectiveWeekId = null;

// Set to true when the plan was loaded from mealPlannerNext (legacy recovery).
// syncFromServer will push local data to server instead of pulling.
var recoveredFromNext = false;

// Count of in-flight server saves. While > 0, syncFromServer must not overwrite
// local plan with a stale server response that hasn't seen the local change yet.
var pendingServerSaves = 0;

// Which day the week starts on (configurable, default Friday)
var startDay = 'fri';

// Current person viewing the planner ('steve' | 'zoe' | 'dylan' | null)
var currentUser = null;

// Per-person meal favourite counts: { steve: { mealId: count }, ... }
var favourites = {};

// Current text in the meal search/filter input
var mealFilter = '';

// Which sidebar tab is active
var sidebarTab = 'meals'; // 'meals' | 'wishes' | 'tescos'

// Last fetched wishlist data { week_id, submissions }
var wishlistData = null;


// ── SECTION 3: Utility Functions ───────────────

/**
 * Get the ordered list of 7 days starting from startDay.
 * e.g. if startDay is 'fri', returns ['fri','sat','sun','mon','tue','wed','thu']
 */
function getOrderedDays() {
  var idx = ALL_DAYS.indexOf(startDay);
  return ALL_DAYS.slice(idx).concat(ALL_DAYS.slice(0, idx));
}

/**
 * Build a slot key string from day, meal, and person.
 * e.g. slotKey('mon', 'lunch', 'steve') -> "mon-lunch-steve"
 */
function slotKey(day, meal, person) {
  return day + '-' + meal + '-' + person;
}

/**
 * Look up a meal object by its ID.
 * Returns undefined if not found.
 */
function findMeal(mealId) {
  for (var i = 0; i < MEALS.length; i++) {
    if (MEALS[i].id === mealId) return MEALS[i];
  }
  return undefined;
}

/**
 * Get the ISO week identifier for a date, e.g. "2026-W06".
 * Handles year boundaries correctly.
 */
function getWeekId(date) {
  var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  var dayNum = d.getUTCDay() || 7; // make Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // nearest Thursday
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(weekNo).padStart(2, '0');
}

/**
 * Get the start-of-week date based on the configurable startDay.
 * e.g. if startDay is 'fri' and today is Wednesday,
 * returns last Friday's date.
 */
function getWeekStartDate(date) {
  var d = new Date(date);
  // Map day keys to JS day numbers (Sun=0, Mon=1, ... Sat=6)
  var dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  var targetDay = dayMap[startDay];
  var currentDay = d.getDay();
  var diff = currentDay - targetDay;
  if (diff < 0) diff += 7;
  d.setDate(d.getDate() - diff);
  return d;
}

/**
 * Return a human-readable label for the week based on the startDay setting.
 * e.g. "6 Feb - 12 Feb 2026" for a Friday-to-Thursday week.
 */
function getWeekLabel(date) {
  var weekStart = getWeekStartDate(date);
  var weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  var opts = { day: 'numeric', month: 'short' };
  var optsYear = { day: 'numeric', month: 'short', year: 'numeric' };
  return weekStart.toLocaleDateString('en-GB', opts) + ' - ' +
         weekEnd.toLocaleDateString('en-GB', optsYear);
}

/**
 * Get a unique week identifier that accounts for startDay.
 * Uses the start date of the week as the ID.
 */
function getCustomWeekId(date) {
  var weekStart = getWeekStartDate(date);
  var y = weekStart.getFullYear();
  var m = String(weekStart.getMonth() + 1).padStart(2, '0');
  var d = String(weekStart.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

/**
 * Returns the "effective" date for rendering purposes.
 * When the week is locked and the current user is not Daddy,
 * returns a date 7 days in the future (next week).
 */

/**
 * Format a quantity + unit for display.
 * e.g. formatQuantity(300, 'g') -> "300g"
 *      formatQuantity(2.5, 'tin') -> "2.5 tin"
 *      formatQuantity(3, '') -> "3"
 */
function formatQuantity(quantity, unit) {
  var q = Math.round(quantity * 10) / 10;
  var qStr = (q % 1 === 0) ? String(Math.round(q)) : String(q);

  if (!unit) return qStr;

  // Units that attach directly (no space)
  var noSpace = ['g', 'kg', 'ml', 'l'];
  if (noSpace.indexOf(unit) !== -1) {
    return qStr + unit;
  }

  return qStr + ' ' + unit;
}

/**
 * Count how many meals are assigned for a given day (total across all slots).
 */
function countMealsForDay(day) {
  var count = 0;
  MEALS_OF_DAY.forEach(function(meal) {
    PEOPLE.forEach(function(person) {
      var meals = currentPlan[slotKey(day, meal, person)];
      if (meals && meals.length) count += meals.length;
    });
  });
  return count;
}

/**
 * Create an empty plan with all slots set to empty arrays.
 * (7 days x 2 meals x 3 people)
 */
function createEmptyPlan() {
  var plan = {};
  ALL_DAYS.forEach(function(day) {
    MEALS_OF_DAY.forEach(function(meal) {
      PEOPLE.forEach(function(person) {
        plan[slotKey(day, meal, person)] = [];
      });
    });
  });
  return plan;
}

/**
 * Show a temporary toast notification at the bottom of the screen.
 */
function showToast(message) {
  var existing = document.querySelector('.toast');
  if (existing) existing.remove();

  var toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(function() {
    if (toast.parentNode) toast.remove();
  }, 2500);
}


// ── SECTION 4: Persistence (localStorage) ──────

/**
 * Save start day preference to localStorage.
 */
function saveStartDay() {
  try {
    localStorage.setItem('mealPlannerStartDay', startDay);
  } catch (e) { /* fail silently */ }
}

/**
 * Load start day preference from localStorage.
 */
function loadStartDay() {
  try {
    var saved = localStorage.getItem('mealPlannerStartDay');
    if (saved && ALL_DAYS.indexOf(saved) !== -1) {
      return saved;
    }
  } catch (e) { /* ignore */ }
  return 'sat'; // default to Saturday
}

/**
 * Save the current plan to history. Called automatically on every change.
 */
function savePlan() {
  var computedWeekId = getCustomWeekId(new Date());
  // Use effectiveWeekId if it's the same or in the future (e.g. plan loaded
  // from mealPlannerNext on the last day of the current week).
  var weekId = (effectiveWeekId && effectiveWeekId >= computedWeekId)
    ? effectiveWeekId
    : computedWeekId;
  var weekDate = new Date(weekId + 'T12:00:00');
  var entry = {
    weekId: weekId,
    weekLabel: getWeekLabel(weekDate),
    savedAt: new Date().toISOString(),
    plan: JSON.parse(JSON.stringify(currentPlan)),
    notes: JSON.parse(JSON.stringify(currentPlanNotes))
  };

  try {
    localStorage.setItem('mealPlannerCurrent', JSON.stringify(entry));

    var history = loadHistory();
    var existingIndex = -1;
    for (var i = 0; i < history.length; i++) {
      if (history[i].weekId === weekId) {
        existingIndex = i;
        break;
      }
    }

    if (existingIndex !== -1) {
      history[existingIndex] = entry;
    } else {
      history.unshift(entry);
    }

    if (history.length > 12) {
      history = history.slice(0, 12);
    }

    localStorage.setItem('mealPlannerHistory', JSON.stringify(history));

    // Sync to server in the background so other devices see the change
    pendingServerSaves++;
    fetch(API_BASE + '/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current: entry, history: history })
    }).then(function() {
      pendingServerSaves--;
    }).catch(function() {
      pendingServerSaves--;
    });
  } catch (e) {
    showToast('Error saving — storage may be full');
  }
}

/**
 * Load the history array from localStorage.
 */
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem('mealPlannerHistory')) || [];
  } catch (e) {
    return [];
  }
}

/**
 * Migrate an old-format plan (slot values were null or a single string)
 * to the new format where every slot is an array of meal IDs.
 */
function migratePlan(plan) {
  Object.keys(plan).forEach(function(key) {
    var val = plan[key];
    if (val === null || val === undefined) {
      plan[key] = [];
    } else if (typeof val === 'string') {
      plan[key] = val ? [val] : [];
    }
    // already an array — leave as-is
  });
  return plan;
}

/**
 * Count how many slots in a plan have at least one meal assigned.
 */
function countFilledSlots(plan) {
  if (!plan) return 0;
  var n = 0;
  Object.keys(plan).forEach(function(k) { if (plan[k] && plan[k].length > 0) n++; });
  return n;
}

/**
 * Load the plan on startup. Migrates old single-string slot format to arrays.
 * Also checks mealPlannerNext (legacy store used when Daddy was always on "next week")
 * and prefers whichever store has more meal data — so a locally richer plan
 * is never silently replaced by an empty one synced from the server.
 */
function loadOnStartup() {
  var currentWeekId = getCustomWeekId(new Date());

  var currentData = null;
  try { currentData = JSON.parse(localStorage.getItem('mealPlannerCurrent')); } catch (e) {}

  var nextData = null;
  try { nextData = JSON.parse(localStorage.getItem('mealPlannerNext')); } catch (e) {}

  // Score each source: -1 means "not usable" (wrong weekId or missing)
  var currentFilled = (currentData && currentData.weekId === currentWeekId)
    ? countFilledSlots(currentData.plan) : -1;
  // mealPlannerNext is accepted regardless of weekId (may be one week ahead)
  var nextFilled = (nextData && nextData.plan) ? countFilledSlots(nextData.plan) : -1;

  // Use mealPlannerNext only if it has actual meals AND more than mealPlannerCurrent.
  // This recovers data that was planned ahead and saved to mealPlannerNext
  // by the old "Daddy always on next week" logic.
  if (nextFilled > 0 && nextFilled > currentFilled) {
    effectiveWeekId = nextData.weekId || currentWeekId;
    currentPlanNotes = nextData.notes || {};
    var plan = migratePlan(nextData.plan);
    // Copy into mealPlannerCurrent so it survives future refreshes
    try { localStorage.setItem('mealPlannerCurrent', JSON.stringify(nextData)); } catch (e) {}
    // Signal syncFromServer to push this richer local plan to the server
    recoveredFromNext = true;
    return plan;
  }

  if (currentFilled >= 0) {
    effectiveWeekId = currentWeekId;
    currentPlanNotes = currentData.notes || {};
    return migratePlan(currentData.plan);
  }

  effectiveWeekId = currentWeekId;
  currentPlanNotes = {};
  return createEmptyPlan();
}

/**
 * Fetch the shared plan from the server and update if newer.
 * Falls back silently if offline. Re-renders the grid if the plan changed.
 */
function syncFromServer() {
  if (!MEALS || MEALS.length === 0) return; // not ready yet
  fetch(API_BASE + '/plan')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data) return;

      // Update shared history in localStorage so the week dropdown shows it
      if (data.history && data.history.length > 0) {
        try { localStorage.setItem('mealPlannerHistory', JSON.stringify(data.history)); } catch (e) {}
      }

      // If the server's recipes version has changed, clear the cache and re-fetch
      if (data.recipes_version !== undefined) {
        var localVersion = parseInt(localStorage.getItem('mealPlannerRecipesVersion') || '0', 10);
        if (data.recipes_version > localVersion) {
          try { localStorage.setItem('mealPlannerRecipesVersion', String(data.recipes_version)); } catch (e) {}
          clearMealsCache();
          loadMeals(function(meals, sheetFavourites) {
            MEALS = meals;
            mergeSheetFavourites(sheetFavourites);
            renderMealList();
            renderWeekGrid();
          });
          return; // renderWeekGrid called above — skip plan sync this cycle
        }
      }

      if (!data.current) return;

      // If we just recovered richer data from mealPlannerNext, push it to
      // the server — but only if local actually has more meals than server.
      if (recoveredFromNext) {
        recoveredFromNext = false;
        var localFilledNext = countFilledSlots(currentPlan);
        var serverFilledNext = countFilledSlots(data.current ? data.current.plan : {});
        if (localFilledNext > serverFilledNext) {
          savePlan();
          return;
        }
        // Server has more data — fall through to normal sync logic below
      }

      var activeId = effectiveWeekId || getCustomWeekId(new Date());
      if (data.current.weekId !== activeId) {
        if (data.current.weekId > activeId) {
          // Server is ahead (e.g. plan saved from another device for next week).
          // Adopt the server's week so all devices stay in sync.
          currentPlan = migratePlan(data.current.plan);
          currentPlanNotes = data.current.notes || {};
          effectiveWeekId = data.current.weekId;
          try { localStorage.setItem('mealPlannerCurrent', JSON.stringify(data.current)); } catch (e) {}
          updateWeekLabel();
          renderWeekGrid();
          fetchWishlists();
        } else {
          // Server is behind — push local state up to fix it
          savePlan();
        }
        return;
      }
      var incomingCurr = JSON.stringify(data.current.plan);
      if (incomingCurr === JSON.stringify(currentPlan)) return;

      // If a local save is in-flight, the server response is stale — skip.
      if (pendingServerSaves > 0) return;

      // Use savedAt timestamps to decide who wins. Local is newer → push;
      // server is newer (or no local timestamp) → adopt server.
      var serverSavedAt = data.current.savedAt || '';
      var localEntry = null;
      try { localEntry = JSON.parse(localStorage.getItem('mealPlannerCurrent')); } catch (e) {}
      var localSavedAt = localEntry ? (localEntry.savedAt || '') : '';
      if (localSavedAt > serverSavedAt) {
        savePlan();
        return;
      }

      currentPlan = migratePlan(data.current.plan);
      currentPlanNotes = data.current.notes || {};
      effectiveWeekId = data.current.weekId;
      try { localStorage.setItem('mealPlannerCurrent', JSON.stringify(data.current)); } catch (e) {}
      renderWeekGrid();
      fetchWishlists();
    })
    .catch(function() {}); // silently ignore if offline
}

/**
 * Copy a past week's plan into the current week.
 */
function copyWeekForward(pastPlan) {
  if (!confirm('This will replace your current week plan. Continue?')) {
    return;
  }

  currentPlan = JSON.parse(JSON.stringify(pastPlan));
  savePlan();
  renderWeekGrid();

  document.getElementById('history-modal-overlay').hidden = true;
  showToast('Past week copied to current plan');
}


// ── SECTION 4B: Google Sheets Integration ──────

/**
 * Build a Google Sheets API v4 URL for fetching a range.
 * e.g. fetches "Recipes!A:F" or "Ingredients!A:D"
 */
function buildSheetsUrl(sheetName, range) {
  return 'https://sheets.googleapis.com/v4/spreadsheets/' +
    SPREADSHEET_ID + '/values/' +
    encodeURIComponent(sheetName + '!' + range) +
    '?key=' + SHEETS_API_KEY;
}

/**
 * Fetch data from a Google Sheet tab.
 * Returns a promise that resolves to an array of row arrays.
 * First row is headers.
 */
function fetchSheetData(sheetName, range) {
  var url = buildSheetsUrl(sheetName, range);
  return fetch(url).then(function(response) {
    if (!response.ok) {
      throw new Error('Sheets API error: ' + response.status);
    }
    return response.json();
  }).then(function(data) {
    return data.values || [];
  });
}

/**
 * Convert a recipe name to a URL-friendly slug ID.
 * e.g. "Spaghetti Bolognese" -> "spaghetti-bolognese"
 * Used as fallback when RecipeID column is empty.
 */
function slugify(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Transform raw Google Sheets data (two sheets) into the MEALS array format.
 * Looks up columns by header name so column order doesn't matter.
 */
function transformSheetData(recipesRows, ingredientsRows) {
  if (recipesRows.length < 2) return { meals: [], sheetFavourites: {} };

  // Find column indices from the Recipes header row
  var rHeader = recipesRows[0].map(function(h) { return h.trim(); });
  var rCols = {
    id: rHeader.indexOf('RecipeID'),
    name: rHeader.indexOf('RecipeName'),
    instructions: rHeader.indexOf('Instructions'),
    prepTime: rHeader.indexOf('PrepTime'),
    cookTime: rHeader.indexOf('CookTime'),
    source: rHeader.indexOf('Source'),
    type: rHeader.indexOf('Type'),
    favZoe:   rHeader.indexOf('Favourite Zoe'),
    favDylan: rHeader.indexOf('Favourite Dylan'),
    favDaddy: rHeader.indexOf('Favourite Daddy')
  };

  // Find column indices from the Ingredients header row
  var iHeader = ingredientsRows.length > 0
    ? ingredientsRows[0].map(function(h) { return h.trim(); })
    : [];
  var iCols = {
    recipeId: iHeader.indexOf('RecipeID'),
    name: iHeader.indexOf('IngredientName'),
    quantity: iHeader.indexOf('Quantity'),
    unit: iHeader.indexOf('Unit')
  };

  // Build a map of RecipeID -> array of ingredient objects
  var ingredientMap = {};
  for (var i = 1; i < ingredientsRows.length; i++) {
    var row = ingredientsRows[i];
    var recipeId = (iCols.recipeId >= 0 && row[iCols.recipeId]) ? row[iCols.recipeId].trim() : '';
    if (!recipeId) continue;

    if (!ingredientMap[recipeId]) {
      ingredientMap[recipeId] = [];
    }

    // Quantity column = numeric quantity per person (e.g. "100", "2", "0.5")
    // Unit column = unit string (e.g. "g", "tsp", "ml", "")
    var rawQty = (iCols.quantity >= 0 && row[iCols.quantity]) ? row[iCols.quantity].trim() : '';
    var rawUnit = (iCols.unit >= 0 && row[iCols.unit]) ? row[iCols.unit].trim() : '';

    ingredientMap[recipeId].push({
      name: (iCols.name >= 0 && row[iCols.name]) ? row[iCols.name].trim() : '',
      quantity: parseFloat(rawQty) || 0,      // numeric quantity per person
      unit: rawUnit                            // unit string: "g", "tsp", "ml", "" etc
    });
  }

  // Build the meals array and extract sheet-defined favourites
  var meals = [];
  var sheetFavourites = { steve: {}, zoe: {}, dylan: {} };
  var seenIds = {};

  for (var j = 1; j < recipesRows.length; j++) {
    var r = recipesRows[j];
    var id = (rCols.id >= 0 && r[rCols.id]) ? r[rCols.id].trim() : '';
    var name = (rCols.name >= 0 && r[rCols.name]) ? r[rCols.name].trim() : '';

    // Skip rows with no recipe name
    if (!name) continue;

    // Auto-generate ID from name if RecipeID column is empty
    if (!id) {
      id = slugify(name);
    }

    // Guard against duplicate IDs — append row number to make unique
    if (seenIds[id]) {
      console.warn('Duplicate RecipeID "' + id + '" for "' + name + '" — fixing automatically');
      id = id + '-' + j;
    }
    seenIds[id] = true;

    meals.push({
      id: id,
      name: name,
      instructions: (rCols.instructions >= 0 && r[rCols.instructions]) ? r[rCols.instructions] : '',
      prepTime: (rCols.prepTime >= 0 && r[rCols.prepTime]) ? r[rCols.prepTime].trim() : '',
      cookTime: (rCols.cookTime >= 0 && r[rCols.cookTime]) ? r[rCols.cookTime].trim() : '',
      source: (rCols.source >= 0 && r[rCols.source]) ? r[rCols.source].trim() : '',
      type: (rCols.type >= 0 && r[rCols.type]) ? r[rCols.type].trim() : 'tiktok',
      ingredients: ingredientMap[id] || []
    });

    // Extract Y markers from favourite columns
    if (rCols.favZoe   >= 0 && r[rCols.favZoe]   && r[rCols.favZoe].trim().toUpperCase()   === 'Y') sheetFavourites.zoe[id]   = true;
    if (rCols.favDylan >= 0 && r[rCols.favDylan] && r[rCols.favDylan].trim().toUpperCase() === 'Y') sheetFavourites.dylan[id] = true;
    if (rCols.favDaddy >= 0 && r[rCols.favDaddy] && r[rCols.favDaddy].trim().toUpperCase() === 'Y') sheetFavourites.steve[id] = true;
  }

  return { meals: meals, sheetFavourites: sheetFavourites };
}

/**
 * Get cached meals from localStorage if the cache is still valid.
 * Returns the cached meals array, or null if expired/missing.
 */
function getCachedMeals() {
  try {
    var cached = JSON.parse(localStorage.getItem('mealPlannerRecipeCache'));
    if (cached && cached.timestamp && cached.meals) {
      var age = Date.now() - cached.timestamp;
      if (age < SHEETS_CACHE_TTL) {
        return { meals: cached.meals, sheetFavourites: cached.sheetFavourites || {} };
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

/**
 * Save meals and sheet favourites to the localStorage cache with a timestamp.
 */
function setCachedMeals(meals, sheetFavourites) {
  try {
    localStorage.setItem('mealPlannerRecipeCache', JSON.stringify({
      timestamp: Date.now(),
      meals: meals,
      sheetFavourites: sheetFavourites || {}
    }));
  } catch (e) { /* fail silently */ }
}

/**
 * Clear the cached meals (used by the "Refresh Recipes" button).
 */
function clearMealsCache() {
  try {
    localStorage.removeItem('mealPlannerRecipeCache');
  } catch (e) { /* ignore */ }
}

/**
 * Load meals from Google Sheets (with caching) or fall back to defaults.
 * Calls the provided callback with the meals array when done.
 */
function loadMeals(callback) {
  // If Google Sheets is not configured, use defaults immediately
  if (!SPREADSHEET_ID || !SHEETS_API_KEY) {
    callback(DEFAULT_MEALS, {});
    return;
  }

  // Check cache first
  var cached = getCachedMeals();
  if (cached && cached.meals.length > 0) {
    callback(cached.meals, cached.sheetFavourites);
    return;
  }

  // Fetch both sheets in parallel — extend Recipes range to J to include favourite columns
  var recipesPromise = fetchSheetData('Recipes', 'A:J');
  var ingredientsPromise = fetchSheetData('Ingredients', 'A:D');

  Promise.all([recipesPromise, ingredientsPromise])
    .then(function(results) {
      var result = transformSheetData(results[0], results[1]);

      if (result.meals.length === 0) {
        showToast('No recipes found in Google Sheet — using defaults');
        callback(DEFAULT_MEALS, {});
        return;
      }

      setCachedMeals(result.meals, result.sheetFavourites);
      showToast('Loaded ' + result.meals.length + ' recipes from Google Sheets');
      callback(result.meals, result.sheetFavourites);
    })
    .catch(function(error) {
      console.error('Failed to load from Google Sheets:', error);
      showToast('Could not load recipes from Google Sheets — using defaults');
      callback(DEFAULT_MEALS, {});
    });
}


// ── SECTION 4C: Favourites ──────────────────────

/**
 * Load user's favourite overrides from localStorage.
 * Structure: { steve: { mealId: true|false }, zoe: {...}, dylan: {...} }
 * true = explicitly starred, false = explicitly unstarred, missing = use sheet default.
 */
function loadFavourites() {
  try {
    var saved = JSON.parse(localStorage.getItem('mealPlannerFavourites2'));
    if (saved && typeof saved === 'object') return saved;
  } catch (e) { /* ignore */ }
  return {};
}

/**
 * Write the current favourites object to localStorage.
 */
function saveFavourites() {
  try {
    localStorage.setItem('mealPlannerFavourites2', JSON.stringify(favourites));
  } catch (e) { /* fail silently */ }
}

/**
 * Merge sheet-defined favourites (Y in H/I/J) into the active favourites.
 * localStorage overrides take precedence — only fills in meals not yet explicitly set.
 */
function mergeSheetFavourites(sheetFavs) {
  PEOPLE.forEach(function(person) {
    var personSheetFavs = sheetFavs[person] || {};
    if (!favourites[person]) favourites[person] = {};
    Object.keys(personSheetFavs).forEach(function(mealId) {
      if (!(mealId in favourites[person])) {
        favourites[person][mealId] = true;
      }
    });
  });
  saveFavourites();
}

/**
 * Return all favourited meal IDs for a person (where favourite === true).
 * Filters out IDs not in the current MEALS array.
 */
function getFavourites(person) {
  var personFavs = favourites[person] || {};
  return Object.keys(personFavs).filter(function(id) {
    return personFavs[id] === true && findMeal(id) !== undefined;
  });
}

/**
 * Toggle a meal's favourite status for the current user.
 * Saves to localStorage and re-renders the meal list.
 */
function toggleFavourite(person, mealId) {
  if (!person) return;
  if (!favourites[person]) favourites[person] = {};
  var newValue = !(favourites[person][mealId] === true);
  favourites[person][mealId] = newValue;
  saveFavourites();
  renderMealList();
  // Write back to Google Sheet in the background
  fetch(API_BASE + '/favourite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe_id: mealId, person: person, actor: currentUser, value: newValue })
  }).catch(function() { /* silent — localStorage already updated */ });
}


// ── SECTION 5: Shopping List Logic ─────────────

/**
 * Generate a consolidated shopping list from the current plan.
 * Iterates all slots, merges duplicate ingredients by name+unit, sums quantities.
 * All ingredient sources use the same format: { name, quantity (number), unit (string) }
 */
function generateShoppingList(plan) {
  var consolidated = {};

  ALL_DAYS.forEach(function(day) {
    MEALS_OF_DAY.forEach(function(mealTime) {
      PEOPLE.forEach(function(person) {
        var key = slotKey(day, mealTime, person);
        // Support both old (string/null) and new (array) formats
        var mealIds = plan[key];
        if (!mealIds) return;
        if (typeof mealIds === 'string') mealIds = [mealIds];

        mealIds.forEach(function(mealId) {
          var meal = findMeal(mealId);
          if (!meal) return;

          meal.ingredients.forEach(function(ing) {
            // Unified format: { name, quantity (number), unit (string) }
            // Merge by name+unit, sum quantities
            var mapKey = ing.name.toLowerCase() + '|' + (ing.unit || '');
            if (consolidated[mapKey]) {
              consolidated[mapKey].quantity += ing.quantity;
            } else {
              consolidated[mapKey] = {
                name: ing.name,
                quantity: ing.quantity,
                unit: ing.unit || ''
              };
            }
          });
        });
      });
    });
  });

  var list = Object.keys(consolidated).map(function(k) {
    return consolidated[k];
  });
  list.sort(function(a, b) {
    return a.name.localeCompare(b.name);
  });

  return list;
}

/**
 * Format a shopping list item.
 * e.g. "300g Beef Mince", "2 tbsp Soy Sauce", "3 Eggs"
 * Each item has: name, quantity (number), unit (string, may be empty).
 */
function formatShoppingItem(item) {
  var q = Math.round(item.quantity * 10) / 10;
  var qStr = (q % 1 === 0) ? String(Math.round(q)) : String(q);

  // Units that attach directly without a space (e.g. "300g Mince", "1.5l Water")
  var noSpace = ['g', 'kg', 'ml', 'l'];
  if (item.unit && noSpace.indexOf(item.unit) !== -1) {
    return qStr + item.unit + ' ' + item.name;
  }
  if (item.unit) {
    return qStr + ' ' + item.unit + ' ' + item.name;
  }
  return qStr + ' ' + item.name;
}

/**
 * Render the shopping list modal with consolidated ingredients.
 * Format: "Nx Ingredient (size)"
 */
function renderShoppingListModal() {
  var list = generateShoppingList(currentPlan);
  var container = document.getElementById('shopping-list-content');

  if (list.length === 0) {
    container.innerHTML = '<div class="shopping-empty">No meals planned yet. ' +
      'Drag meals onto the grid first!</div>';
    return;
  }

  var html = '';
  list.forEach(function(item) {
    html += '<div class="shopping-item">' +
      '<span class="shopping-item-name">' + formatShoppingItem(item) + '</span>' +
      '</div>';
  });
  container.innerHTML = html;
}

/**
 * Copy the shopping list to clipboard as plain text.
 */
function copyShoppingListToClipboard() {
  var list = generateShoppingList(currentPlan);
  if (list.length === 0) {
    showToast('No items to copy');
    return;
  }

  var text = 'Tesco Weekly Shop\n';
  text += '=================\n\n';
  list.forEach(function(item) {
    text += formatShoppingItem(item) + '\n';
  });

  navigator.clipboard.writeText(text).then(function() {
    showToast('Shopping list copied!');
  }).catch(function() {
    showToast('Could not copy — try selecting the text manually');
  });
}


// ── SECTION 5B: Person Selector ────────────────


// ── SECTION 5C: Wishlists ───────────────────────

/**
 * Fetch wishlists from server, update badge, re-render panel if active.
 */
function fetchWishlists() {
  fetch(API_BASE + '/wishlists')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      wishlistData = data;
      updateWishesBadge();
      updateTescosBadge();
      if (sidebarTab === 'wishes') renderWishesPanel();
      if (sidebarTab === 'tescos') renderTescosPanel();
    })
    .catch(function() {});
}

/**
 * Update the Wishes tab badge with submission count.
 */
function updateWishesBadge() {
  var badge = document.getElementById('wishes-badge');
  if (!badge) return;
  var count = wishlistData && wishlistData.submissions
    ? Object.keys(wishlistData.submissions).length
    : 0;
  if (count > 0) {
    badge.textContent = count;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

/**
 * Render share-link copy buttons (Daddy only).
 */
function copyText(text, successMsg) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(function() { showToast(successMsg); })
      .catch(function() { copyTextFallback(text, successMsg); });
  } else {
    copyTextFallback(text, successMsg);
  }
}

function copyTextFallback(text, successMsg) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
    showToast(successMsg);
  } catch (e) {
    showToast('Could not copy link');
  }
  document.body.removeChild(ta);
}

function renderShareLinks(panel) {
  var div = document.createElement('div');
  div.className = 'share-links';

  var btnDylan = document.createElement('button');
  btnDylan.className = 'btn-copy-link';
  btnDylan.textContent = 'Copy Dyl-Boi link';
  btnDylan.addEventListener('click', function() {
    copyText(window.location.origin + '/app/wishlist?for=dylan', 'Dyl-Boi link copied!');
  });
  div.appendChild(btnDylan);

  var btnZoe = document.createElement('button');
  btnZoe.className = 'btn-copy-link';
  btnZoe.textContent = 'Copy Zbutt link';
  btnZoe.addEventListener('click', function() {
    copyText(window.location.origin + '/app/wishlist?for=zoe', 'Zbutt link copied!');
  });
  div.appendChild(btnZoe);

  var btnClear = document.createElement('button');
  btnClear.className = 'btn-copy-link';
  btnClear.textContent = 'Clear all wishlists';
  btnClear.style.color = '#ef4444';
  btnClear.addEventListener('click', function() {
    if (!confirm('Clear all wishlist submissions?')) return;
    fetch(API_BASE + '/wishlists', { method: 'DELETE' })
      .then(function() {
        wishlistData = { week_id: '', submissions: {} };
        updateWishesBadge();
        updateTescosBadge();
        renderWishesPanel();
        renderTescosPanel();
        showToast('Wishlists cleared');
      })
      .catch(function() { showToast('Could not clear wishlists'); });
  });
  div.appendChild(btnClear);

  panel.appendChild(div);
}

/**
 * Render the wishes panel with ranked picks from each kid.
 */
function renderWishesPanel() {
  var panel = document.getElementById('sidebar-wishes-panel');
  if (!panel) return;
  panel.innerHTML = '';

  if (currentUser === 'steve') {
    renderShareLinks(panel);
  }

  if (!wishlistData || !wishlistData.submissions ||
      Object.keys(wishlistData.submissions).length === 0) {
    var empty = document.createElement('div');
    empty.className = 'wishes-empty';
    empty.textContent = 'No wishlists submitted yet.';
    panel.appendChild(empty);
    return;
  }

  ['dylan', 'zoe'].forEach(function(person) {
    var sub = wishlistData.submissions[person];

    panel.appendChild(makeSectionHeader(person, 'wishes'));

    if (!sub) {
      var noSub = document.createElement('div');
      noSub.className = 'wishes-empty';
      noSub.textContent = 'No picks submitted yet.';
      panel.appendChild(noSub);
      return;
    }

    var rankCounter = 0;
    if (sub.picks && sub.picks.length > 0) {
      sub.picks.forEach(function(mealId) {
        var meal = findMeal(mealId);
        if (!meal) return;
        rankCounter++;
        appendMealCard(panel, meal);
        var card = panel.lastElementChild;
        var rankSpan = document.createElement('span');
        rankSpan.className = 'wish-rank';
        rankSpan.textContent = rankCounter;
        card.insertBefore(rankSpan, card.firstChild);
      });
    }

    if (sub.custom_picks && sub.custom_picks.length > 0) {
      sub.custom_picks.forEach(function(name) {
        rankCounter++;
        var row = document.createElement('div');
        row.className = 'wishes-custom-pick';
        var rankSpan = document.createElement('span');
        rankSpan.className = 'wish-rank';
        rankSpan.textContent = rankCounter;
        row.appendChild(rankSpan);
        var nameEl = document.createElement('span');
        nameEl.textContent = name;
        row.appendChild(nameEl);
        panel.appendChild(row);
      });
    }

    if (rankCounter === 0) {
      var noPicks = document.createElement('div');
      noPicks.className = 'wishes-empty';
      noPicks.textContent = 'No meals picked.';
      panel.appendChild(noPicks);
    }

    if (sub.breakfast) {
      var bfLabel = document.createElement('div');
      bfLabel.className = 'wishes-section-label-sm';
      bfLabel.textContent = 'Breakfast';
      panel.appendChild(bfLabel);
      var bfVal = document.createElement('div');
      bfVal.className = 'wishes-notes';
      bfVal.textContent = sub.breakfast;
      panel.appendChild(bfVal);
    }

    if (sub.submitted_at) {
      var ts = document.createElement('div');
      ts.className = 'wishes-submitted-at';
      ts.textContent = new Date(sub.submitted_at).toLocaleString('en-GB', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      });
      panel.appendChild(ts);
    }
  });
}


/**
 * Clear only the tab-relevant part of a person's wishlist submission.
 * tab='wishes' clears picks; tab='tescos' clears notes.
 * If nothing remains after the clear, the whole submission is deleted.
 */
function clearPersonTab(person, tab) {
  var sub = wishlistData && wishlistData.submissions && wishlistData.submissions[person];
  var weekId = (wishlistData && wishlistData.week_id) || getCustomWeekId(new Date());

  var hasPicks = sub && ((sub.picks && sub.picks.length > 0) || (sub.custom_picks && sub.custom_picks.length > 0));
  var hasNotes = sub && sub.notes && sub.notes.trim().length > 0;

  var keepPicks = tab === 'tescos';  // clearing notes → keep picks
  var keepNotes = tab === 'wishes';  // clearing picks → keep notes

  var nothingLeft = (tab === 'wishes' && !hasNotes) || (tab === 'tescos' && !hasPicks);

  function afterClear() {
    updateWishesBadge();
    updateTescosBadge();
    renderWishesPanel();
    renderTescosPanel();
  }

  if (nothingLeft) {
    // Nothing left to keep — delete the whole submission
    fetch(API_BASE + '/wishlists/' + person, { method: 'DELETE' })
      .then(function() {
        if (wishlistData && wishlistData.submissions) delete wishlistData.submissions[person];
        afterClear();
      })
      .catch(function() { showToast('Could not clear'); });
  } else {
    // Overwrite keeping only the relevant part
    var body = {
      week_id: weekId,
      picks: keepPicks && sub.picks ? sub.picks : [],
      notes: keepNotes && sub.notes ? sub.notes : ''
    };
    fetch(API_BASE + '/wishlist/' + person, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function() {
        if (wishlistData && wishlistData.submissions && wishlistData.submissions[person]) {
          if (tab === 'wishes') {
            wishlistData.submissions[person].picks = [];
            wishlistData.submissions[person].custom_picks = [];
          } else {
            wishlistData.submissions[person].notes = '';
          }
        }
        afterClear();
      })
      .catch(function() { showToast('Could not clear'); });
  }
}

/**
 * Build a section header row with a person label and inline clear button.
 * tab controls which part gets cleared ('wishes' or 'tescos').
 */
function makeSectionHeader(person, tab) {
  var row = document.createElement('div');
  row.className = 'wishes-section-header-row';
  var label = document.createElement('span');
  label.className = 'wishes-section-header';
  label.style.margin = '0';
  label.textContent = PEOPLE_LABELS[person];
  row.appendChild(label);
  var btn = document.createElement('button');
  btn.className = 'btn-clear-person';
  btn.textContent = 'Clear';
  (function(p, t) {
    btn.addEventListener('click', function() { clearPersonTab(p, t); });
  })(person, tab);
  row.appendChild(btn);
  return row;
}

/**
 * Parse a notes string into individual items (split by comma, trimmed, non-empty).
 */
function parseTescosItems(notes) {
  if (!notes) return [];
  return notes.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });
}

/**
 * Update the Tescos tab badge with total item count across all kids' notes.
 */
function updateTescosBadge() {
  var badge = document.getElementById('tescos-badge');
  if (!badge) return;
  var count = 0;
  if (wishlistData && wishlistData.submissions) {
    ['dylan', 'zoe'].forEach(function(p) {
      var sub = wishlistData.submissions[p];
      if (sub) count += parseTescosItems(sub.notes).length;
    });
  }
  if (count > 0) {
    badge.textContent = count;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

/**
 * Render the Tescos panel with kids' free-text requests.
 */
function renderTescosPanel() {
  var panel = document.getElementById('sidebar-tescos-panel');
  if (!panel) return;
  panel.innerHTML = '';

  var allItems = [];
  ['dylan', 'zoe'].forEach(function(p) {
    var sub = wishlistData && wishlistData.submissions && wishlistData.submissions[p];
    var items = parseTescosItems(sub && sub.notes);
    if (items.length === 0) return;

    panel.appendChild(makeSectionHeader(p, 'tescos'));

    items.forEach(function(item) {
      var row = document.createElement('div');
      row.className = 'tescos-item';
      row.textContent = item;
      panel.appendChild(row);
      allItems.push(item);
    });
  });

  if (allItems.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'wishes-empty';
    empty.textContent = 'No extra requests yet.';
    panel.appendChild(empty);
    return;
  }

  var copyBtn = document.createElement('button');
  copyBtn.className = 'btn-copy-link';
  copyBtn.textContent = 'Copy all';
  copyBtn.style.marginTop = '0.75rem';
  copyBtn.addEventListener('click', function() {
    copyText(allItems.join('\n'), 'Copied ' + allItems.length + ' items!');
  });
  panel.appendChild(copyBtn);
}


// ── SECTION 6: Rendering ──────────────────────

/**
 * Append a single draggable meal card to a container element.
 */
function appendMealCard(container, meal) {
  var card = document.createElement('div');
  card.className = meal.type === 'request' ? 'meal-card meal-card--request' : 'meal-card';
  card.draggable = true;

  var nameSpan = document.createElement('span');
  nameSpan.className = 'meal-card-name';
  nameSpan.textContent = meal.name;
  card.appendChild(nameSpan);

  // Star toggle — only shown when a user is selected
  if (currentUser) {
    var isFav = favourites[currentUser] && favourites[currentUser][meal.id] === true;
    var starBtn = document.createElement('button');
    starBtn.className = 'meal-card-star' + (isFav ? ' meal-card-star--active' : '');
    starBtn.textContent = '\u2605'; // ★
    starBtn.title = isFav ? 'Remove from favourites' : 'Add to favourites';
    (function(mealId) {
      starBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleFavourite(currentUser, mealId);
      });
    })(meal.id);
    card.appendChild(starBtn);
  }

  if (meal.instructions || meal.prepTime || meal.cookTime || meal.source) {
    var infoBtn = document.createElement('button');
    infoBtn.className = 'meal-card-info';
    infoBtn.textContent = 'i';
    infoBtn.title = 'View recipe';
    infoBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      showRecipeModal(meal.id);
    });
    card.appendChild(infoBtn);
  }

  card.addEventListener('dragstart', function(e) {
    e.dataTransfer.setData('text/plain', meal.id);
    e.dataTransfer.effectAllowed = 'copy';
    card.classList.add('dragging');
  });

  card.addEventListener('dragend', function() {
    card.classList.remove('dragging');
    var highlights = document.querySelectorAll('.drag-over');
    for (var i = 0; i < highlights.length; i++) {
      highlights[i].classList.remove('drag-over');
    }
  });

  container.appendChild(card);
}

/**
 * Render the sidebar meal list.
 * If a user is selected: Favourites section (top 10) then All Meals.
 * Otherwise: flat list (no section headers).
 */
function renderMealList() {
  var container = document.getElementById('meal-list');
  container.innerHTML = '';

  var filter = mealFilter.toLowerCase().trim();
  var favIds = currentUser ? getFavourites(currentUser) : [];
  var favSet = {};
  favIds.forEach(function(id) { favSet[id] = true; });

  // Pinned favourites section — never filtered, always visible at top
  if (favIds.length > 0) {
    var favSection = document.createElement('div');
    favSection.className = 'meal-list-favourites';

    var favHeader = document.createElement('div');
    favHeader.className = 'meal-section-header';
    favHeader.textContent = 'Favourites';
    favSection.appendChild(favHeader);

    favIds.forEach(function(id) {
      var meal = findMeal(id);
      if (meal) appendMealCard(favSection, meal);
    });

    container.appendChild(favSection);
  }

  // Scrollable All Meals section — filtered by search
  var allSection = document.createElement('div');
  allSection.className = 'meal-list-all';

  if (currentUser) {
    var allHeader = document.createElement('div');
    allHeader.className = 'meal-section-header';
    allHeader.textContent = 'All Meals';
    allSection.appendChild(allHeader);
  }

  MEALS.forEach(function(meal) {
    if (favSet[meal.id]) return; // already shown in favourites
    if (filter && meal.name.toLowerCase().indexOf(filter) === -1) return;
    appendMealCard(allSection, meal);
  });

  container.appendChild(allSection);
}

/**
 * Show the recipe detail modal for a given meal.
 * Displays name, timing, instructions, ingredients, and source link.
 */
function showRecipeModal(mealId) {
  var meal = findMeal(mealId);
  if (!meal) return;

  // Set the modal title
  document.getElementById('recipe-modal-title').textContent = meal.name;

  // Build the body content
  var html = '';

  // Timing badges (prep + cook)
  if (meal.prepTime || meal.cookTime) {
    html += '<div class="recipe-timing">';
    if (meal.prepTime) {
      html += '<span class="recipe-time-badge">Prep: ' + meal.prepTime + '</span>';
    }
    if (meal.cookTime) {
      html += '<span class="recipe-time-badge">Cook: ' + meal.cookTime + '</span>';
    }
    html += '</div>';
  }

  // Cooking instructions (split on newlines)
  if (meal.instructions) {
    html += '<div class="recipe-section">';
    html += '<h3 class="recipe-section-title">Instructions</h3>';
    var paragraphs = meal.instructions.split('\n');
    for (var i = 0; i < paragraphs.length; i++) {
      var line = paragraphs[i].trim();
      if (line) {
        html += '<p class="recipe-instruction">' + line + '</p>';
      }
    }
    html += '</div>';
  }

  // Ingredients list (per person)
  if (meal.ingredients && meal.ingredients.length > 0) {
    html += '<div class="recipe-section">';
    html += '<h3 class="recipe-section-title">Ingredients (per person)</h3>';
    meal.ingredients.forEach(function(ing) {
      var qtyText = formatQuantity(ing.quantity, ing.unit);

      html += '<div class="recipe-ingredient">' +
        '<span class="recipe-ingredient-qty">' + qtyText + '</span>' +
        '<span class="recipe-ingredient-name">' + ing.name + '</span>' +
        '</div>';
    });
    html += '</div>';
  }

  // Source link (e.g. TikTok URL, recipe blog)
  if (meal.source) {
    html += '<div class="recipe-section">';
    html += '<a class="recipe-source-link" href="' + meal.source + '" target="_blank" rel="noopener">View original recipe</a>';
    html += '</div>';
  }

  document.getElementById('recipe-modal-content').innerHTML = html;
  document.getElementById('recipe-modal-overlay').hidden = false;
}


/**
 * Render the full week grid — all 7 days stacked vertically.
 * Each day shows Lunch and Dinner rows with 3 person cells.
 */
function renderWeekGrid() {
  var container = document.getElementById('week-grid');
  container.innerHTML = '';
  container.className = 'content week-grid';

  var days = getOrderedDays();

  days.forEach(function(day) {
    // Day block container
    var dayBlock = document.createElement('div');
    dayBlock.className = 'day-block';

    // Day header (e.g. "Friday")
    var header = document.createElement('div');
    header.className = 'day-header';
    var count = countMealsForDay(day);
    header.textContent = count > 0 ? DAY_LABELS[day] + ' (' + count + ')' : DAY_LABELS[day];
    dayBlock.appendChild(header);

    // Meal sections: Lunch and Dinner
    MEALS_OF_DAY.forEach(function(mealTime) {
      var section = document.createElement('div');
      section.className = 'meal-section';

      // Meal label (e.g. "LUNCH")
      var label = document.createElement('div');
      label.className = 'meal-section-label';
      label.textContent = MEAL_LABELS[mealTime];
      section.appendChild(label);

      // Person slots: horizontal row of 3 drop zones
      var slots = document.createElement('div');
      slots.className = 'person-slots';

      PEOPLE.forEach(function(person) {
        var key = slotKey(day, mealTime, person);
        var cell = document.createElement('div');
        cell.className = 'person-cell';
        cell.setAttribute('data-slot', key);

        // Person name label
        var personLabel = document.createElement('div');
        personLabel.className = 'person-label';
        personLabel.textContent = PEOPLE_LABELS[person];
        cell.appendChild(personLabel);

        // Render all assigned meals (multiple allowed)
        var assignedMeals = currentPlan[key] || [];
        var existingNote = currentUser === 'steve' ? (currentPlanNotes[key] || '') : '';
        if (assignedMeals.length > 0 || existingNote) {
          cell.classList.add('has-meal');
          assignedMeals.forEach(function(mealId) {
            renderAssignedMeal(cell, key, mealId);
          });
        }

        // Render note / add-note affordance for Daddy
        if (currentUser === 'steve') {
          if (existingNote) {
            renderNoteTag(cell, key, existingNote);
          } else {
            renderAddNoteBtn(cell, key);
          }
        }

        // Set up drag-and-drop on this cell
        setupDropZone(cell, key);

        slots.appendChild(cell);
      });

      section.appendChild(slots);
      dayBlock.appendChild(section);
    });

    container.appendChild(dayBlock);
  });
}

/**
 * Render an assigned meal tag inside a cell.
 * Clicking it removes just that meal from the slot.
 */
function renderAssignedMeal(cell, key, mealId) {
  var meal = findMeal(mealId);
  if (!meal) return;

  var tag = document.createElement('div');
  tag.className = 'assigned-meal';
  tag.textContent = meal.name;

  if (canEditSlot(key)) {
    var hint = document.createElement('span');
    hint.className = 'remove-hint';
    hint.textContent = ' ✕';
    tag.appendChild(hint);

    tag.addEventListener('click', function() {
      removeMeal(key, mealId);
    });
  }

  cell.appendChild(tag);
}

/**
 * Render a saved free-form note tag inside a cell (Daddy only).
 * Clicking the text makes it editable; clicking ✕ removes it.
 */
function renderNoteTag(cell, key, note) {
  var tag = document.createElement('div');
  tag.className = 'assigned-note';

  var textSpan = document.createElement('span');
  textSpan.className = 'note-text';
  textSpan.textContent = note;
  tag.appendChild(textSpan);

  var removeHint = document.createElement('span');
  removeHint.className = 'remove-hint';
  removeHint.textContent = ' ✕';
  tag.appendChild(removeHint);

  textSpan.addEventListener('click', function() {
    showNoteInput(cell, key, note);
  });

  removeHint.addEventListener('click', function(e) {
    e.stopPropagation();
    delete currentPlanNotes[key];
    savePlan();
    renderWeekGrid();
  });

  cell.appendChild(tag);
}

/**
 * Render a small "✎ add note" button at the bottom of a cell (Daddy only).
 */
function renderAddNoteBtn(cell, key) {
  var btn = document.createElement('button');
  btn.className = 'add-note-btn';
  btn.textContent = '✎ note';
  btn.addEventListener('click', function() {
    showNoteInput(cell, key, '');
  });
  cell.appendChild(btn);
}

/**
 * Replace the note tag / add-note button with an inline text input.
 * Commits on Enter or blur; cancels on Escape.
 */
function showNoteInput(cell, key, currentValue) {
  var existing = cell.querySelector('.assigned-note, .add-note-btn');
  if (existing) existing.remove();

  var wrapper = document.createElement('div');
  wrapper.className = 'note-input-wrapper';

  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'note-input';
  input.value = currentValue;
  input.placeholder = 'e.g. Out, Takeaway…';
  input.setAttribute('inputmode', 'text');
  wrapper.appendChild(input);
  cell.appendChild(wrapper);

  input.focus();
  input.select();

  var committed = false;

  function commit() {
    if (committed) return;
    committed = true;
    var val = input.value.trim();
    if (val) {
      currentPlanNotes[key] = val;
    } else {
      delete currentPlanNotes[key];
    }
    savePlan();
    renderWeekGrid();
  }

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      committed = true;
      renderWeekGrid();
    }
  });

  input.addEventListener('blur', commit);
}

/**
 * Populate and toggle the week dropdown in the header.
 * Shows the current week + past weeks from history.
 */
function renderWeekDropdown() {
  var menu = document.getElementById('week-dropdown-menu');
  menu.innerHTML = '';

  var activeId = effectiveWeekId || getCustomWeekId(new Date());
  var labelDate = new Date(activeId + 'T12:00:00');

  var currentItem = document.createElement('div');
  currentItem.className = 'week-dropdown-item week-dropdown-current';
  currentItem.textContent = getWeekLabel(labelDate);
  menu.appendChild(currentItem);

  // Filter out the current week to avoid duplicates
  var history = loadHistory().filter(function(h) { return h.weekId !== activeId; });
  if (history.length > 0) {
    var divider = document.createElement('div');
    divider.className = 'week-dropdown-divider';
    menu.appendChild(divider);
    history.forEach(function(entry) {
      var item = document.createElement('div');
      item.className = 'week-dropdown-item';
      item.textContent = entry.weekLabel;
      item.addEventListener('click', function() {
        closeWeekDropdown();
        showHistoryModal(entry);
      });
      menu.appendChild(item);
    });
  }
}

function closeWeekDropdown() {
  document.getElementById('week-dropdown-menu').hidden = true;
}

/**
 * Show the history modal with a read-only summary of a past week.
 */
function showHistoryModal(entry) {
  var titleEl = document.getElementById('history-modal-title');
  titleEl.textContent = 'Week: ' + (entry.weekLabel || entry.weekId || '');

  var container = document.getElementById('history-modal-content');
  container.innerHTML = '';

  var plan = entry.plan || {};

  // Use ordered days for display
  var days = getOrderedDays();

  days.forEach(function(day) {
    var hasAny = false;
    var dayHtml = '';

    MEALS_OF_DAY.forEach(function(mealTime) {
      var assignments = [];
      PEOPLE.forEach(function(person) {
        var key = slotKey(day, mealTime, person);
        var mealIds = plan[key];
        if (!mealIds) return;
        if (typeof mealIds === 'string') mealIds = [mealIds]; // old format
        mealIds.forEach(function(mealId) {
          var meal = findMeal(mealId);
          var mealName = meal ? meal.name : mealId;
          assignments.push(PEOPLE_LABELS[person] + ': ' + mealName);
          hasAny = true;
        });
      });

      if (assignments.length > 0) {
        dayHtml += '<div class="history-meal-row">' +
          '<span class="history-meal-label">' + MEAL_LABELS[mealTime] + '</span>' +
          '<span class="history-meal-assignments">' + assignments.join(', ') + '</span>' +
          '</div>';
      }
    });

    if (hasAny) {
      var section = document.createElement('div');
      section.className = 'history-day-summary';
      section.innerHTML = '<h3>' + DAY_LABELS[day] + '</h3>' + dayHtml;
      container.appendChild(section);
    }
  });

  if (container.children.length === 0) {
    container.innerHTML = '<div class="shopping-empty">This week was empty</div>';
  }

  document.getElementById('history-modal-overlay').hidden = false;
}

/**
 * Update the week label in the header.
 */
function updateWeekLabel() {
  var labelDate = effectiveWeekId
    ? new Date(effectiveWeekId + 'T12:00:00')
    : new Date();
  document.getElementById('week-label').textContent = getWeekLabel(labelDate);
}


// ── SECTION 7: Drag and Drop ──────────────────

/**
 * Returns true if the current user is allowed to modify the given slot.
 * Daddy (steve) can edit any slot; Zoe and Dylan can only edit their own.
 */
function canEditSlot(key) {
  if (currentUser === 'steve') return true;
  var person = key.split('-').pop();
  return person === currentUser;
}

/**
 * Set up a grid cell as a drag-and-drop target.
 */
function setupDropZone(cell, key) {
  cell.addEventListener('dragover', function(e) {
    if (!canEditSlot(key)) return; // no highlight for locked slots
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    cell.classList.add('drag-over');
  });

  cell.addEventListener('dragleave', function(e) {
    if (!cell.contains(e.relatedTarget)) {
      cell.classList.remove('drag-over');
    }
  });

  cell.addEventListener('drop', function(e) {
    e.preventDefault();
    cell.classList.remove('drag-over');
    if (!canEditSlot(key)) return;

    var mealId = e.dataTransfer.getData('text/plain');
    if (mealId && findMeal(mealId)) {
      assignMeal(key, mealId);
    }
  });
}


// ── SECTION 8: Actions ────────────────────────

/**
 * Assign a meal to a slot. Adds to the array; ignores duplicates.
 */
function assignMeal(key, mealId) {
  if (!Array.isArray(currentPlan[key])) currentPlan[key] = [];
  if (currentPlan[key].indexOf(mealId) === -1) {
    currentPlan[key].push(mealId);
  }
  savePlan();
  renderWeekGrid();
}

/**
 * Remove a specific meal from a slot. Updates state, saves draft, re-renders.
 */
function removeMeal(key, mealId) {
  if (!Array.isArray(currentPlan[key])) { currentPlan[key] = []; return; }
  currentPlan[key] = currentPlan[key].filter(function(id) { return id !== mealId; });
  savePlan();
  renderWeekGrid();
}

/**
 * Clear all meal assignments for the entire week.
 */
function clearWeek() {
  if (!confirm('Clear all meals for the entire week?')) {
    return;
  }

  ALL_DAYS.forEach(function(day) {
    MEALS_OF_DAY.forEach(function(mealTime) {
      PEOPLE.forEach(function(person) {
        currentPlan[slotKey(day, mealTime, person)] = [];
      });
    });
  });

  currentPlanNotes = {};
  savePlan();
  renderWeekGrid();
  showToast('Week cleared');
}

/**
 * Advance to next week, copying the current plan's meals into it.
 * The effective week ID moves forward 7 days; the old week stays in history.
 */
function startNewWeek() {
  var currentId = effectiveWeekId || getCustomWeekId(new Date());
  var nextStart = new Date(currentId + 'T12:00:00');
  nextStart.setDate(nextStart.getDate() + 7);
  var y = nextStart.getFullYear();
  var m = String(nextStart.getMonth() + 1).padStart(2, '0');
  var d = String(nextStart.getDate()).padStart(2, '0');
  effectiveWeekId = y + '-' + m + '-' + d;

  savePlan();
  updateWeekLabel();
  renderWeekGrid();
  showToast('New week started — same meals carried forward');
}

/**
 * Change the start day of the week.
 * Saves preference and re-renders.
 */
function changeStartDay(newStartDay) {
  startDay = newStartDay;
  saveStartDay();
  updateWeekLabel();
  renderWeekGrid();
}


// ── SECTION 9: Event Listeners ────────────────

// Close shopping list modal
document.getElementById('shopping-modal-close').addEventListener('click', function() {
  document.getElementById('shopping-modal-overlay').hidden = true;
});

// Copy shopping list to clipboard
document.getElementById('copy-list-btn').addEventListener('click', copyShoppingListToClipboard);

// Week dropdown — toggle on button click, close on outside click
document.getElementById('week-dropdown-btn').addEventListener('click', function(e) {
  e.stopPropagation();
  var menu = document.getElementById('week-dropdown-menu');
  if (menu.hidden) {
    renderWeekDropdown();
    menu.hidden = false;
  } else {
    menu.hidden = true;
  }
});
document.addEventListener('click', function(e) {
  if (!document.getElementById('week-dropdown').contains(e.target)) {
    closeWeekDropdown();
  }
});

// Close history detail modal
document.getElementById('history-modal-close').addEventListener('click', function() {
  document.getElementById('history-modal-overlay').hidden = true;
});

// Close modals when clicking the overlay background
document.getElementById('shopping-modal-overlay').addEventListener('click', function(e) {
  if (e.target === this) this.hidden = true;
});
document.getElementById('history-modal-overlay').addEventListener('click', function(e) {
  if (e.target === this) this.hidden = true;
});

// Close recipe detail modal
document.getElementById('recipe-modal-close').addEventListener('click', function() {
  document.getElementById('recipe-modal-overlay').hidden = true;
});
document.getElementById('recipe-modal-done').addEventListener('click', function() {
  document.getElementById('recipe-modal-overlay').hidden = true;
});

// Close recipe modal on overlay click
document.getElementById('recipe-modal-overlay').addEventListener('click', function(e) {
  if (e.target === this) this.hidden = true;
});


// Meal search/filter
document.getElementById('meal-search').addEventListener('input', function() {
  mealFilter = this.value;
  renderMealList();
});

// Close modals on Escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    document.getElementById('shopping-modal-overlay').hidden = true;
    document.getElementById('history-modal-overlay').hidden = true;
    document.getElementById('recipe-modal-overlay').hidden = true;
    document.getElementById('pending-modal-overlay').hidden = true;
  }
});

// New week button
document.getElementById('new-week-btn').addEventListener('click', startNewWeek);

// Clear week button
document.getElementById('clear-week-btn').addEventListener('click', clearWeek);

// Start day dropdown change
document.getElementById('start-day-select').addEventListener('change', function() {
  changeStartDay(this.value);
});

// Sidebar collapse/expand
(function() {
  var sidebar   = document.getElementById('sidebar');
  var layout    = document.querySelector('.layout');
  var collapseBtn = document.getElementById('sidebar-collapse-btn');
  var openBtn   = document.getElementById('sidebar-open-btn');

  function setSidebarCollapsed(collapsed) {
    sidebar.hidden = collapsed;
    layout.classList.toggle('sidebar--collapsed', collapsed);
    openBtn.hidden = !collapsed;
    try { localStorage.setItem('mealPlannerSidebarCollapsed', collapsed ? '1' : '0'); } catch (e) {}
  }

  collapseBtn.addEventListener('click', function() { setSidebarCollapsed(true); });
  openBtn.addEventListener('click', function() { setSidebarCollapsed(false); });

  // Restore saved state
  if (localStorage.getItem('mealPlannerSidebarCollapsed') === '1') {
    setSidebarCollapsed(true);
  }
}());

// Sidebar tab switching
function switchSidebarTab(tab) {
  sidebarTab = tab;
  document.getElementById('tab-meals').classList.toggle('sidebar-tab--active', tab === 'meals');
  document.getElementById('tab-wishes').classList.toggle('sidebar-tab--active', tab === 'wishes');
  document.getElementById('tab-tescos').classList.toggle('sidebar-tab--active', tab === 'tescos');
  document.getElementById('sidebar-meals-panel').hidden = tab !== 'meals';
  document.getElementById('sidebar-wishes-panel').hidden = tab !== 'wishes';
  document.getElementById('sidebar-tescos-panel').hidden = tab !== 'tescos';
}

document.getElementById('tab-meals').addEventListener('click', function() {
  switchSidebarTab('meals');
});

document.getElementById('tab-wishes').addEventListener('click', function() {
  switchSidebarTab('wishes');
  fetchWishlists();
  renderWishesPanel();
});

document.getElementById('tab-tescos').addEventListener('click', function() {
  switchSidebarTab('tescos');
  fetchWishlists();
  renderTescosPanel();
});


// ── SECTION 10: Pending Review + Food Requests ──

/**
 * Fetch the count of pending recipes and update the badge in the header.
 * Shows the badge if count > 0, hides it if 0. Silently fails if offline.
 */
function checkPendingCount() {
  fetch(API_BASE + '/pending')
    .then(function(r) { return r.json(); })
    .then(function(items) {
      var btn = document.getElementById('pending-btn');
      var countEl = document.getElementById('pending-count');
      if (items.length > 0) {
        countEl.textContent = items.length;
        btn.hidden = false;
      } else {
        btn.hidden = true;
      }
    })
    .catch(function() { /* server offline — badge stays hidden */ });
}

/**
 * Show the pending review modal with approve/reject buttons.
 * TikTok recipes get Approve + Reject; food requests get Reject only.
 */
function showPendingModal() {
  var overlay = document.getElementById('pending-modal-overlay');
  var content = document.getElementById('pending-modal-content');
  content.innerHTML = '<p>Loading...</p>';
  overlay.hidden = false;

  fetch(API_BASE + '/pending')
    .then(function(r) { return r.json(); })
    .then(function(items) {
      if (items.length === 0) {
        content.innerHTML = '<p class="pending-empty">No recipes to review.</p>';
        return;
      }

      content.innerHTML = '';
      items.forEach(function(item) {
        var card = document.createElement('div');
        card.className = item.type === 'request'
          ? 'pending-card pending-card--request'
          : 'pending-card';
        card.id = 'pending-card-' + item.recipe_id;

        var nameEl = document.createElement('div');
        nameEl.className = 'pending-card-name';
        nameEl.textContent = item.recipe_name;
        card.appendChild(nameEl);

        if (item.type === 'request') {
          var tagEl = document.createElement('span');
          tagEl.className = 'pending-tag pending-tag--request';
          tagEl.textContent = 'Food request';
          card.appendChild(tagEl);
        } else if (item.instructions) {
          var snippetEl = document.createElement('div');
          snippetEl.className = 'pending-card-snippet';
          // Show first ~120 chars of instructions as a preview
          var snippet = item.instructions.replace(/\n/g, ' ');
          snippetEl.textContent = snippet.length > 120
            ? snippet.slice(0, 120) + '...'
            : snippet;
          card.appendChild(snippetEl);
        }

        var actions = document.createElement('div');
        actions.className = 'pending-card-actions';

        // Approve button — shown for all pending items
        {
          var approveBtn = document.createElement('button');
          approveBtn.className = 'btn btn-primary pending-action-btn';
          approveBtn.textContent = 'Approve';
          (function(id) {
            approveBtn.addEventListener('click', function() {
              // Remove card immediately, fire API in background
              document.getElementById('pending-card-' + id).remove();
              decrementPendingBadge();
              clearMealsCache();
              if (!document.querySelector('.pending-card')) {
                content.innerHTML = '<p class="pending-empty">No recipes to review.</p>';
              }
              fetch(API_BASE + '/approve/' + id, { method: 'POST' })
                .catch(function() { showToast('Approve may have failed — check the sheet'); });
            });
          })(item.recipe_id);
          actions.appendChild(approveBtn);
        }

        // Reject button (always shown)
        var rejectBtn = document.createElement('button');
        rejectBtn.className = 'btn btn-secondary pending-action-btn';
        rejectBtn.textContent = 'Reject';
        (function(id) {
          rejectBtn.addEventListener('click', function() {
            // Remove card immediately, fire API in background
            document.getElementById('pending-card-' + id).remove();
            decrementPendingBadge();
            if (!document.querySelector('.pending-card')) {
              content.innerHTML = '<p class="pending-empty">No recipes to review.</p>';
            }
            fetch(API_BASE + '/pending/' + id, { method: 'DELETE' })
              .catch(function() { showToast('Reject may have failed — check the sheet'); });
          });
        })(item.recipe_id);
        actions.appendChild(rejectBtn);

        card.appendChild(actions);
        content.appendChild(card);
      });
    })
    .catch(function() {
      content.innerHTML = '<p class="pending-empty">Could not load pending recipes.</p>';
    });
}

/** Decrement the pending badge count; hide badge if it reaches zero. */
function decrementPendingBadge() {
  var btn = document.getElementById('pending-btn');
  var countEl = document.getElementById('pending-count');
  var n = parseInt(countEl.textContent, 10) - 1;
  if (n <= 0) {
    btn.hidden = true;
  } else {
    countEl.textContent = n;
  }
}

// Pending modal open/close
document.getElementById('pending-btn').addEventListener('click', showPendingModal);
document.getElementById('pending-modal-close').addEventListener('click', function() {
  document.getElementById('pending-modal-overlay').hidden = true;
});
document.getElementById('pending-modal-done').addEventListener('click', function() {
  document.getElementById('pending-modal-overlay').hidden = true;
});



// ── SECTION 11: Initialization ────────────────

/**
 * Initialize the app. Loads meals (potentially async from Google Sheets),
 * then renders everything once data is ready.
 */
function initApp() {
  // Always fetch fresh recipes from Sheets on load — no stale cache
  clearMealsCache();

  startDay = loadStartDay();
  document.getElementById('start-day-select').value = startDay;
  favourites = loadFavourites();
  currentUser = 'steve';

  currentPlan = loadOnStartup();
  updateWeekLabel();

  // Show loading state in the sidebar meal list (only if Sheets is configured)
  if (SPREADSHEET_ID && SHEETS_API_KEY) {
    var mealListEl = document.getElementById('meal-list');
    mealListEl.innerHTML = '<div class="meals-loading">Loading recipes...</div>';
  }

  // Load meals (async if Google Sheets configured, sync otherwise)
  loadMeals(function(meals, sheetFavourites) {
    MEALS = meals;
    mergeSheetFavourites(sheetFavourites);
    renderMealList();
    renderWeekGrid();
    console.log('Meal Planner loaded (' + MEALS.length + ' recipes)');

    // Initial sync from server — overrides localStorage if server has newer data
    syncFromServer();
    fetchWishlists();
  });

  // Check for pending recipes to review (badge in header)
  checkPendingCount();
}

// Poll for plan changes from other devices: on tab focus and every 30s
document.addEventListener('visibilitychange', function() {
  if (!document.hidden) syncFromServer();
});
setInterval(syncFromServer, 30000);

// Start the app
initApp();
