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
var SPREADSHEET_ID = '';
var SHEETS_API_KEY = '';
var SHEETS_CACHE_TTL = 3600000; // 1 hour in milliseconds

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
var PEOPLE_LABELS = { steve: 'Steve', zoe: 'Zoe', dylan: 'Dylan' };

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

// Which day the week starts on (configurable, default Friday)
var startDay = 'fri';

// Track whether there are unsaved changes
var hasUnsavedChanges = false;


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
 * Count how many meals are assigned for a given day.
 * Max is 6 (2 meals x 3 people).
 */
function countMealsForDay(day) {
  var count = 0;
  MEALS_OF_DAY.forEach(function(meal) {
    PEOPLE.forEach(function(person) {
      if (currentPlan[slotKey(day, meal, person)]) {
        count++;
      }
    });
  });
  return count;
}

/**
 * Create an empty plan with all 42 slots set to null.
 * (7 days x 2 meals x 3 people)
 */
function createEmptyPlan() {
  var plan = {};
  ALL_DAYS.forEach(function(day) {
    MEALS_OF_DAY.forEach(function(meal) {
      PEOPLE.forEach(function(person) {
        plan[slotKey(day, meal, person)] = null;
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
 * Save the current plan as a draft (auto-called on every change).
 */
function saveDraft() {
  try {
    localStorage.setItem('mealPlannerDraft', JSON.stringify(currentPlan));
  } catch (e) { /* fail silently */ }
}

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
  return 'fri'; // default to Friday
}

/**
 * Save the current plan to history (manual "Save Week" action).
 */
function savePlan() {
  var weekId = getCustomWeekId(new Date());
  var entry = {
    weekId: weekId,
    weekLabel: getWeekLabel(new Date()),
    savedAt: new Date().toISOString(),
    plan: JSON.parse(JSON.stringify(currentPlan))
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
    localStorage.removeItem('mealPlannerDraft');

    hasUnsavedChanges = false;
    updateUnsavedIndicator();
    renderHistory();
    showToast('Week saved!');
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
 * Load the plan on startup.
 * Priority: draft > saved current week > empty plan.
 */
function loadOnStartup() {
  try {
    var draft = JSON.parse(localStorage.getItem('mealPlannerDraft'));
    if (draft && Object.keys(draft).length > 0) {
      hasUnsavedChanges = true;
      return draft;
    }
  } catch (e) { /* ignore */ }

  try {
    var data = JSON.parse(localStorage.getItem('mealPlannerCurrent'));
    if (data && data.weekId === getCustomWeekId(new Date())) {
      return data.plan;
    }
  } catch (e) { /* ignore */ }

  return createEmptyPlan();
}

/**
 * Copy a past week's plan into the current week.
 */
function copyWeekForward(pastPlan) {
  if (!confirm('This will replace your current week plan. Continue?')) {
    return;
  }

  currentPlan = JSON.parse(JSON.stringify(pastPlan));
  hasUnsavedChanges = true;
  saveDraft();
  updateUnsavedIndicator();
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
  if (recipesRows.length < 2) return [];

  // Find column indices from the Recipes header row
  var rHeader = recipesRows[0].map(function(h) { return h.trim(); });
  var rCols = {
    id: rHeader.indexOf('RecipeID'),
    name: rHeader.indexOf('RecipeName'),
    instructions: rHeader.indexOf('Instructions'),
    prepTime: rHeader.indexOf('PrepTime'),
    cookTime: rHeader.indexOf('CookTime'),
    source: rHeader.indexOf('Source')
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

    ingredientMap[recipeId].push({
      name: (iCols.name >= 0 && row[iCols.name]) ? row[iCols.name].trim() : '',
      quantity: (iCols.quantity >= 0 && row[iCols.quantity]) ? parseFloat(row[iCols.quantity]) || 0 : 0,
      unit: (iCols.unit >= 0 && row[iCols.unit]) ? row[iCols.unit].trim() : ''
    });
  }

  // Build the meals array from recipe rows
  var meals = [];
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

    meals.push({
      id: id,
      name: name,
      instructions: (rCols.instructions >= 0 && r[rCols.instructions]) ? r[rCols.instructions] : '',
      prepTime: (rCols.prepTime >= 0 && r[rCols.prepTime]) ? r[rCols.prepTime].trim() : '',
      cookTime: (rCols.cookTime >= 0 && r[rCols.cookTime]) ? r[rCols.cookTime].trim() : '',
      source: (rCols.source >= 0 && r[rCols.source]) ? r[rCols.source].trim() : '',
      ingredients: ingredientMap[id] || []
    });
  }

  return meals;
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
        return cached.meals;
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

/**
 * Save meals to the localStorage cache with a timestamp.
 */
function setCachedMeals(meals) {
  try {
    localStorage.setItem('mealPlannerRecipeCache', JSON.stringify({
      timestamp: Date.now(),
      meals: meals
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
    callback(DEFAULT_MEALS);
    return;
  }

  // Check cache first
  var cached = getCachedMeals();
  if (cached && cached.length > 0) {
    callback(cached);
    return;
  }

  // Fetch both sheets in parallel
  var recipesPromise = fetchSheetData('Recipes', 'A:F');
  var ingredientsPromise = fetchSheetData('Ingredients', 'A:D');

  Promise.all([recipesPromise, ingredientsPromise])
    .then(function(results) {
      var meals = transformSheetData(results[0], results[1]);

      if (meals.length === 0) {
        showToast('No recipes found in Google Sheet — using defaults');
        callback(DEFAULT_MEALS);
        return;
      }

      // Cache the transformed data
      setCachedMeals(meals);
      showToast('Loaded ' + meals.length + ' recipes from Google Sheets');
      callback(meals);
    })
    .catch(function(error) {
      console.error('Failed to load from Google Sheets:', error);
      showToast('Could not load recipes from Google Sheets — using defaults');
      callback(DEFAULT_MEALS);
    });
}


// ── SECTION 5: Shopping List Logic ─────────────

/**
 * Generate a consolidated shopping list from the current plan.
 * Iterates all 42 slots, merges duplicate ingredients.
 */
function generateShoppingList(plan) {
  var consolidated = {};

  ALL_DAYS.forEach(function(day) {
    MEALS_OF_DAY.forEach(function(mealTime) {
      PEOPLE.forEach(function(person) {
        var key = slotKey(day, mealTime, person);
        var mealId = plan[key];
        if (!mealId) return;

        var meal = findMeal(mealId);
        if (!meal) return;

        meal.ingredients.forEach(function(ing) {
          var mapKey = ing.name.toLowerCase() + '|' + ing.unit;

          if (consolidated[mapKey]) {
            consolidated[mapKey].quantity += ing.quantity;
          } else {
            consolidated[mapKey] = {
              name: ing.name,
              quantity: ing.quantity,
              unit: ing.unit
            };
          }
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
 * Render the shopping list modal with consolidated ingredients.
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
      '<span class="shopping-item-qty">' + formatQuantity(item.quantity, item.unit) + '</span>' +
      '<span class="shopping-item-name">' + item.name + '</span>' +
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
    text += formatQuantity(item.quantity, item.unit) + '  ' + item.name + '\n';
  });

  navigator.clipboard.writeText(text).then(function() {
    showToast('Shopping list copied!');
  }).catch(function() {
    showToast('Could not copy — try selecting the text manually');
  });
}


// ── SECTION 6: Rendering ──────────────────────

/**
 * Render the sidebar meal list with draggable cards.
 * Each card has an optional info button to view recipe details.
 */
function renderMealList() {
  var container = document.getElementById('meal-list');
  container.innerHTML = '';

  MEALS.forEach(function(meal) {
    var card = document.createElement('div');
    card.className = 'meal-card';
    card.draggable = true;

    // Meal name text
    var nameSpan = document.createElement('span');
    nameSpan.className = 'meal-card-name';
    nameSpan.textContent = meal.name;
    card.appendChild(nameSpan);

    // Info button — shown if the meal has any detail (instructions, timing, or source)
    if (meal.instructions || meal.prepTime || meal.cookTime || meal.source) {
      var infoBtn = document.createElement('button');
      infoBtn.className = 'meal-card-info';
      infoBtn.textContent = 'i';
      infoBtn.title = 'View recipe';
      infoBtn.addEventListener('click', function(e) {
        e.stopPropagation(); // don't interfere with drag
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
  });
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
      html += '<div class="recipe-ingredient">' +
        '<span class="recipe-ingredient-qty">' + formatQuantity(ing.quantity, ing.unit) + '</span>' +
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
 * Update the recipe source indicator in the sidebar.
 * Shows whether recipes come from Google Sheets or hardcoded defaults.
 */
function updateRecipeSource() {
  var el = document.getElementById('recipe-source');
  if (!el) return;

  if (SPREADSHEET_ID && SHEETS_API_KEY) {
    el.textContent = 'From Google Sheets';
    el.className = 'recipe-source recipe-source-sheets';
    document.getElementById('refresh-recipes-btn').hidden = false;
  } else {
    el.textContent = 'Using default recipes';
    el.className = 'recipe-source recipe-source-default';
    document.getElementById('refresh-recipes-btn').hidden = true;
  }
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
    header.textContent = DAY_LABELS[day] + ' (' + count + '/6)';
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

        // If a meal is assigned, show it
        var assignedMealId = currentPlan[key];
        if (assignedMealId) {
          renderAssignedMeal(cell, key, assignedMealId);
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
 * Clicking it removes the assignment.
 */
function renderAssignedMeal(cell, key, mealId) {
  var meal = findMeal(mealId);
  if (!meal) return;

  cell.classList.add('has-meal');

  var tag = document.createElement('div');
  tag.className = 'assigned-meal';
  tag.textContent = meal.name;

  var hint = document.createElement('span');
  hint.className = 'remove-hint';
  hint.textContent = ' (click to remove)';
  tag.appendChild(hint);

  tag.addEventListener('click', function() {
    removeMeal(key);
  });

  cell.appendChild(tag);
}

/**
 * Render the history list in the sidebar.
 */
function renderHistory() {
  var container = document.getElementById('history-list');
  var history = loadHistory();

  if (history.length === 0) {
    container.innerHTML = '<div class="history-empty">No saved weeks yet</div>';
    return;
  }

  container.innerHTML = '';
  history.forEach(function(entry) {
    var item = document.createElement('div');
    item.className = 'history-item';
    item.textContent = entry.weekLabel;

    item.addEventListener('click', function() {
      showHistoryModal(entry);
    });

    container.appendChild(item);
  });
}

/**
 * Show the history modal with a read-only summary of a past week.
 */
function showHistoryModal(entry) {
  var titleEl = document.getElementById('history-modal-title');
  titleEl.textContent = 'Week: ' + entry.weekLabel;

  var container = document.getElementById('history-modal-content');
  container.innerHTML = '';

  // Use ordered days for display
  var days = getOrderedDays();

  days.forEach(function(day) {
    var hasAny = false;
    var dayHtml = '';

    MEALS_OF_DAY.forEach(function(mealTime) {
      var assignments = [];
      PEOPLE.forEach(function(person) {
        var key = slotKey(day, mealTime, person);
        var mealId = entry.plan[key];
        if (mealId) {
          var meal = findMeal(mealId);
          var mealName = meal ? meal.name : mealId;
          assignments.push(PEOPLE_LABELS[person] + ': ' + mealName);
          hasAny = true;
        }
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

  // Wire up the "Copy to Current Week" button
  var copyBtn = document.getElementById('copy-week-btn');
  var newCopyBtn = copyBtn.cloneNode(true);
  copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);
  newCopyBtn.addEventListener('click', function() {
    copyWeekForward(entry.plan);
  });

  document.getElementById('history-modal-overlay').hidden = false;
}

/**
 * Update the "unsaved changes" indicator in the header.
 */
function updateUnsavedIndicator() {
  document.getElementById('unsaved-indicator').hidden = !hasUnsavedChanges;
}

/**
 * Update the week label in the header.
 */
function updateWeekLabel() {
  document.getElementById('week-label').textContent = getWeekLabel(new Date());
}


// ── SECTION 7: Drag and Drop ──────────────────

/**
 * Set up a grid cell as a drag-and-drop target.
 */
function setupDropZone(cell, key) {
  cell.addEventListener('dragover', function(e) {
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

    var mealId = e.dataTransfer.getData('text/plain');
    if (mealId && findMeal(mealId)) {
      assignMeal(key, mealId);
    }
  });
}


// ── SECTION 8: Actions ────────────────────────

/**
 * Assign a meal to a slot. Updates state, saves draft, re-renders.
 */
function assignMeal(key, mealId) {
  currentPlan[key] = mealId;
  hasUnsavedChanges = true;
  saveDraft();
  updateUnsavedIndicator();
  renderWeekGrid();
}

/**
 * Remove a meal from a slot. Updates state, saves draft, re-renders.
 */
function removeMeal(key) {
  currentPlan[key] = null;
  hasUnsavedChanges = true;
  saveDraft();
  updateUnsavedIndicator();
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
        currentPlan[slotKey(day, mealTime, person)] = null;
      });
    });
  });

  hasUnsavedChanges = true;
  saveDraft();
  updateUnsavedIndicator();
  renderWeekGrid();
  showToast('Week cleared');
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

// Save Week button
document.getElementById('save-btn').addEventListener('click', savePlan);

// Generate Shopping List button
document.getElementById('shopping-list-btn').addEventListener('click', function() {
  renderShoppingListModal();
  document.getElementById('shopping-modal-overlay').hidden = false;
});

// Close shopping list modal
document.getElementById('shopping-modal-close').addEventListener('click', function() {
  document.getElementById('shopping-modal-overlay').hidden = true;
});

// Copy shopping list to clipboard
document.getElementById('copy-list-btn').addEventListener('click', copyShoppingListToClipboard);

// Clear All button
document.getElementById('clear-week-btn').addEventListener('click', clearWeek);

// Close history modal
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

// Refresh Recipes button — clears cache and re-fetches from Google Sheets
document.getElementById('refresh-recipes-btn').addEventListener('click', function() {
  clearMealsCache();
  var mealListEl = document.getElementById('meal-list');
  mealListEl.innerHTML = '<div class="meals-loading">Refreshing recipes...</div>';

  loadMeals(function(meals) {
    MEALS = meals;
    renderMealList();
    renderWeekGrid();
    updateRecipeSource();
  });
});

// Close modals on Escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    document.getElementById('shopping-modal-overlay').hidden = true;
    document.getElementById('history-modal-overlay').hidden = true;
    document.getElementById('recipe-modal-overlay').hidden = true;
  }
});

// Start day dropdown change
document.getElementById('start-day-select').addEventListener('change', function() {
  changeStartDay(this.value);
});


// ── SECTION 10: Initialization ────────────────

/**
 * Initialize the app. Loads meals (potentially async from Google Sheets),
 * then renders everything once data is ready.
 */
function initApp() {
  // Load synchronous settings first
  startDay = loadStartDay();
  document.getElementById('start-day-select').value = startDay;
  currentPlan = loadOnStartup();
  updateWeekLabel();
  updateUnsavedIndicator();
  renderHistory();

  // Show loading state in the sidebar meal list (only if Sheets is configured)
  if (SPREADSHEET_ID && SHEETS_API_KEY) {
    var mealListEl = document.getElementById('meal-list');
    mealListEl.innerHTML = '<div class="meals-loading">Loading recipes...</div>';
  }

  // Load meals (async if Google Sheets configured, sync otherwise)
  loadMeals(function(meals) {
    MEALS = meals;
    renderMealList();
    renderWeekGrid();
    updateRecipeSource();
    console.log('Meal Planner loaded (' + MEALS.length + ' recipes)');
  });
}

// Start the app
initApp();
