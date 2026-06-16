// =============================================================
//  Главный модуль приложения
// =============================================================

// ── Состояние ─────────────────────────────────────────────────
const state = {
  currentScreen:       'welcome',
  selectedFile:        null,
  selectedImageBase64: null,
  selectedStyle:       'fast',
  generationCount:     parseInt(localStorage.getItem('holodilnik_gen') || '0'),
  afterModalAction:    null,
  currentRecipes:      [],    // рецепты текущей генерации
  dailyRecipe:         null,  // рецепт дня
}

// Хранилище рецептов по ключу (для кнопок-действий)
const recipeStore = {}

// ── Фразы для экрана загрузки ──────────────────────────────────
const LOADING_PHRASES = [
  'Изучаю ваши продукты...',
  'Придумываю вкусные рецепты...',
  'Подбираю подходящие блюда...',
  'Проверяю наличие ингредиентов...',
  'Почти готово — осталось чуть-чуть!',
  'Составляю список шагов...',
]

// ── VK Bridge ─────────────────────────────────────────────────
const bridge = window.vkBridge || null

function initVK() {
  if (bridge) {
    try { bridge.send('VKWebAppInit') } catch (_) {}
  }
}

// ═══════════════════════════════════════════════════════════════
//  НАВИГАЦИЯ МЕЖДУ ЭКРАНАМИ
// ═══════════════════════════════════════════════════════════════

const SCREENS_WITH_TABS  = ['upload', 'recipes', 'favorites', 'history', 'shopping', 'daily']
const SCREENS_NO_TABS    = ['welcome', 'loading']

// Какой tab активен для данного экрана
const SCREEN_TO_TAB = {
  upload:    'scanner',
  recipes:   'scanner',
  favorites: 'favorites',
  history:   'history',
  shopping:  'shopping',
  daily:     'daily',
}

function showScreen(screenId) {
  const current = document.getElementById(`screen-${state.currentScreen}`)
  const next    = document.getElementById(`screen-${screenId}`)

  if (!next || state.currentScreen === screenId) return

  if (current) {
    current.classList.add('slide-out')
    setTimeout(() => {
      current.classList.add('hidden')
      current.classList.remove('slide-out')
    }, 250)
  }

  next.classList.remove('hidden')
  requestAnimationFrame(() => {
    next.style.opacity = ''
    next.style.transform = ''
  })

  state.currentScreen = screenId
  next.scrollTop = 0

  // Tab bar
  const tabBar = document.getElementById('tab-bar')
  if (SCREENS_WITH_TABS.includes(screenId)) {
    tabBar.classList.remove('hidden')
    updateActiveTab(screenId)
  } else {
    tabBar.classList.add('hidden')
  }
}

function updateActiveTab(screenId) {
  const activeTabId = SCREEN_TO_TAB[screenId]
  document.querySelectorAll('.tab-item').forEach(btn => {
    const isActive = btn.id === `tab-${activeTabId}`
    btn.classList.toggle('active', isActive)
  })
}

// ═══════════════════════════════════════════════════════════════
//  TAB BAR — переключение вкладок
// ═══════════════════════════════════════════════════════════════

function switchTab(tabName) {
  switch (tabName) {
    case 'scanner':
      showScreen('upload')
      break
    case 'favorites':
      renderFavorites()
      showScreen('favorites')
      break
    case 'history':
      renderHistory()
      showScreen('history')
      break
    case 'shopping':
      renderShoppingList()
      showScreen('shopping')
      break
    case 'daily':
      renderDailyRecipe()
      showScreen('daily')
      break
  }
}

// ═══════════════════════════════════════════════════════════════
//  ПОДПИСКИ НА ПАБЛИКИ VK
// ═══════════════════════════════════════════════════════════════

// Проверяет подписки и вызывает onSuccess() если всё ок.
// Если SUBSCRIPTION_ACTIVE: false — сразу пускает (режим модерации).
async function ensureSubscriptions(onSuccess) {
  if (!CONFIG.SUBSCRIPTION_ACTIVE) {
    onSuccess()
    return
  }

  if (!bridge || !isInsideVK()) {
    // В браузере вне VK — пропускаем без проверки
    onSuccess()
    return
  }

  const publics = (CONFIG.VK_PUBLICS || []).filter(p => p.id > 0)
  if (!publics.length) {
    onSuccess()
    return
  }

  // Перебираем паблики по порядку: уже подписанные дают result:true мгновенно.
  // На первом неподписанном VK покажет нативный диалог подписки.
  for (const pub of publics) {
    const ok = await tryJoinPublic(pub)
    if (!ok) {
      // Пользователь отклонил — показываем наш экран с объяснением
      showSubscribeModal(pub)
      state.afterModalAction = () => ensureSubscriptions(onSuccess)
      return
    }
  }

  onSuccess()
}

async function tryJoinPublic(pub) {
  try {
    const joinPromise = bridge.send('VKWebAppJoinGroup', { group_id: pub.id })
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000))
    const result = await Promise.race([joinPromise, timeout])
    return result && result.result === true
  } catch (_) {
    return false
  }
}

// ═══════════════════════════════════════════════════════════════
//  ЗАГРУЗКА ФОТО
// ═══════════════════════════════════════════════════════════════

function triggerInput(source) {
  document.getElementById(source === 'camera' ? 'input-camera' : 'input-gallery').click()
}

function handleUploadZoneClick(event) {
  if (state.selectedFile) return
  triggerInput('gallery')
}

function handleFileInput(input) {
  const file = input.files?.[0]
  if (!file) return

  if (!file.type.startsWith('image/')) {
    showUploadError('Пожалуйста, выберите файл изображения (JPG, PNG)')
    return
  }
  if (file.size > 20 * 1024 * 1024) {
    showUploadError('Файл слишком большой. Максимальный размер — 20 МБ')
    return
  }

  state.selectedFile = file
  showPhotoPreview(file)
  hideUploadError()
  input.value = ''
}

function showPhotoPreview(file) {
  const preview = document.getElementById('photo-preview')
  const zone    = document.getElementById('upload-zone')
  const empty   = document.getElementById('upload-empty-state')
  const actions = document.getElementById('photo-actions')

  const img = new Image()
  const url = URL.createObjectURL(file)

  img.onload = () => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const view = new DataView(e.target.result)
      let orientation = 1

      if (view.getUint16(0, false) === 0xFFD8) {
        let offset = 2
        while (offset < view.byteLength) {
          if (view.getUint16(offset, false) === 0xFFE1) {
            const exif = view.getUint32(offset + 4, false)
            if (exif === 0x45786966) {
              const little = view.getUint16(offset + 10, false) === 0x4949
              const tags = view.getUint16(offset + 14, little)
              for (let i = 0; i < tags; i++) {
                if (view.getUint16(offset + 16 + i * 12, little) === 0x0112) {
                  orientation = view.getUint16(offset + 16 + i * 12 + 8, little)
                  break
                }
              }
            }
            break
          }
          offset += 2 + view.getUint16(offset + 2, false)
        }
      }

      const MAX = 512
      const canvas = document.createElement('canvas')
      const ctx    = canvas.getContext('2d')
      let sw = img.naturalWidth
      let sh = img.naturalHeight
      const rotated = orientation >= 5

      let dw = rotated ? sh : sw
      let dh = rotated ? sw : sh
      if (dw > MAX || dh > MAX) {
        if (dw > dh) { dh = Math.round(dh * MAX / dw); dw = MAX }
        else         { dw = Math.round(dw * MAX / dh); dh = MAX }
      }

      canvas.width  = dw
      canvas.height = dh

      const scaleX = dw / (rotated ? sh : sw)
      const scaleY = dh / (rotated ? sw : sh)
      ctx.scale(scaleX, scaleY)

      const transforms = {
        1: () => {},
        2: () => { ctx.transform(-1, 0, 0, 1, sw, 0) },
        3: () => { ctx.transform(-1, 0, 0, -1, sw, sh) },
        4: () => { ctx.transform(1, 0, 0, -1, 0, sh) },
        5: () => { ctx.transform(0, 1, 1, 0, 0, 0) },
        6: () => { ctx.transform(0, 1, -1, 0, sh, 0) },
        7: () => { ctx.transform(0, -1, -1, 0, sh, sw) },
        8: () => { ctx.transform(0, -1, 1, 0, 0, sw) },
      }
      ;(transforms[orientation] || transforms[1])()
      ctx.drawImage(img, 0, 0)

      const dataUrl = canvas.toDataURL('image/jpeg', 0.6)
      state.selectedImageBase64 = dataUrl.split(',')[1]

      preview.src = dataUrl
      URL.revokeObjectURL(url)
      preview.classList.add('visible')
      empty.style.display = 'none'
      zone.classList.add('has-photo')
      actions.classList.add('visible')
    }
    reader.readAsArrayBuffer(file)
  }

  img.src = url
}

// ═══════════════════════════════════════════════════════════════
//  ВЫБОР СТИЛЯ РЕЦЕПТА
// ═══════════════════════════════════════════════════════════════

function selectStyle(style) {
  state.selectedStyle = style
  const pills = ['fast', 'detailed', 'diet', 'kids']
  pills.forEach(p => {
    const el = document.getElementById(`pill-${p}`)
    if (!el) return
    const active = p === style
    el.classList.toggle('active', active)
    el.setAttribute('aria-checked', active ? 'true' : 'false')
  })
}

// ═══════════════════════════════════════════════════════════════
//  ОТПРАВКА ФОТО И ПОЛУЧЕНИЕ РЕЦЕПТОВ
// ═══════════════════════════════════════════════════════════════

async function handleSubmit() {
  if (!state.selectedFile) {
    const zone = document.getElementById('upload-zone')
    zone.classList.add('error-shake')
    setTimeout(() => zone.classList.remove('error-shake'), 500)
    showUploadError('Пожалуйста, добавьте фото холодильника')
    return
  }
  hideUploadError()
  ensureSubscriptions(doSubmit)
}

async function doSubmit() {
  showScreen('loading')
  startLoadingPhrases()

  try {
    const recipes = await analyzeAndGetRecipes(state.selectedFile, state.selectedStyle)
    state.currentRecipes = recipes
    addToHistory(recipes)
    renderRecipes(recipes)

    state.generationCount++
    localStorage.setItem('holodilnik_gen', state.generationCount)

    stopLoadingPhrases()
    showScreen('recipes')
  } catch (err) {
    stopLoadingPhrases()
    showScreen('recipes')
    showRecipesError(err.message || 'Не удалось получить рецепты. Проверьте интернет и попробуйте ещё раз.')
  }
}

// ═══════════════════════════════════════════════════════════════
//  АНИМАЦИЯ ЭКРАНА ЗАГРУЗКИ
// ═══════════════════════════════════════════════════════════════

let phraseTimer = null
let phraseIndex = 0

function startLoadingPhrases() {
  phraseIndex = 0
  updatePhrase()
  phraseTimer = setInterval(() => {
    phraseIndex = (phraseIndex + 1) % LOADING_PHRASES.length
    updatePhrase()
  }, 2200)
}

function updatePhrase() {
  const el = document.getElementById('loading-phrase')
  if (!el) return
  el.style.opacity = '0'
  setTimeout(() => {
    el.textContent  = LOADING_PHRASES[phraseIndex]
    el.style.opacity = '1'
  }, 200)
}

function stopLoadingPhrases() {
  if (phraseTimer) { clearInterval(phraseTimer); phraseTimer = null }
}

// ═══════════════════════════════════════════════════════════════
//  РЕНДЕР РЕЦЕПТОВ
// ═══════════════════════════════════════════════════════════════

function renderRecipes(recipes) {
  const container = document.getElementById('recipes-container')
  container.innerHTML = ''
  document.getElementById('recipes-error').classList.remove('visible')

  const styleNames = { fast: 'быстрые', detailed: 'подробные', diet: 'диетические', kids: 'детские' }
  document.getElementById('recipes-subtitle').textContent =
    `Нашли 3 блюда (${styleNames[state.selectedStyle] || ''}) из ваших продуктов`

  recipes.forEach(recipe => {
    container.appendChild(createRecipeCard(recipe))
  })
}

function makeRecipeKey(recipe) {
  // Ключ — безопасная строка на основе имени рецепта
  const key = btoa(encodeURIComponent(recipe.name).replace(/%/g, '_')).replace(/[^a-zA-Z0-9]/g, '_')
  recipeStore[key] = recipe
  return key
}

function createRecipeCard(recipe) {
  const card = document.createElement('article')
  card.className = 'recipe-card'
  card.setAttribute('role', 'listitem')
  card.setAttribute('aria-label', `Рецепт: ${recipe.name}`)

  const key   = makeRecipeKey(recipe)
  const emoji = recipe.emoji || '🍽'
  const isFav = isFavorite(recipe.name)

  // Ингредиенты
  const ingredientsHTML = (recipe.ingredients || [])
    .map(ing => `
      <span class="ingredient-chip">
        <span class="ingredient-dot" aria-hidden="true"></span>
        ${escapeHtml(ing)}
      </span>
    `).join('')

  // Шаги
  const stepsHTML = (recipe.steps || [])
    .map((step, i) => {
      const text = step.replace(/^шаг\s*\d+\s*:\s*/i, '')
      return `
        <div class="recipe-step-item">
          <div class="step-counter" aria-label="Шаг ${i + 1}">${i + 1}</div>
          <p class="step-text-body">${escapeHtml(text)}</p>
        </div>
      `
    }).join('')

  // КБЖУ
  let nutritionHTML = ''
  if (recipe.nutrition && recipe.nutrition.calories) {
    const n = recipe.nutrition
    const servings = recipe.servings ? ` · ${recipe.servings} порц.` : ''
    const cost = recipe.cost ? ` · ${escapeHtml(recipe.cost)}${servings}` : servings
    nutritionHTML = `
      <div class="recipe-nutrition">
        <div class="nutrition-grid">
          <div class="nutrition-stat">
            <span class="nutrition-value">${n.calories}</span>
            <span class="nutrition-label">🔥 ккал</span>
          </div>
          <div class="nutrition-stat">
            <span class="nutrition-value">${n.protein}г</span>
            <span class="nutrition-label">Белки</span>
          </div>
          <div class="nutrition-stat">
            <span class="nutrition-value">${n.fat}г</span>
            <span class="nutrition-label">Жиры</span>
          </div>
          <div class="nutrition-stat">
            <span class="nutrition-value">${n.carbs}г</span>
            <span class="nutrition-label">Углеводы</span>
          </div>
        </div>
        ${cost ? `<div class="nutrition-cost">💰 ${escapeHtml(recipe.cost || '')}${servings ? ' · ' + recipe.servings + ' порции' : ''}</div>` : ''}
      </div>
    `
  }

  card.innerHTML = `
    <div class="recipe-top">
      <div class="recipe-meta">
        <span class="recipe-emoji" role="img" aria-label="Иконка блюда">${emoji}</span>
        <div class="recipe-time-badge" aria-label="Время приготовления: ${escapeHtml(recipe.time)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          ${escapeHtml(recipe.time)}
        </div>
      </div>
      <h2 class="recipe-name">${escapeHtml(recipe.name)}</h2>
    </div>

    ${nutritionHTML}

    <div class="recipe-ingredients">
      <p class="ingredients-title">Ингредиенты</p>
      <div class="ingredients-list">${ingredientsHTML}</div>
    </div>

    <div class="recipe-steps-section">
      <button class="recipe-steps-toggle"
              onclick="toggleSteps(this)"
              aria-expanded="false"
              aria-label="Показать шаги приготовления блюда ${escapeHtml(recipe.name)}">
        <span class="toggle-label">Показать шаги</span>
        <span class="toggle-arrow" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </span>
      </button>
      <div class="recipe-steps-body" aria-hidden="true">
        <div class="recipe-steps-list">${stepsHTML}</div>
      </div>
    </div>

    <div class="recipe-actions">
      <button class="recipe-action-btn ${isFav ? 'fav-active' : ''}"
              id="fav-btn-${key}"
              onclick="toggleFavoriteByKey('${key}')"
              aria-label="В избранное">
        <svg viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
        Избранное
      </button>
      <button class="recipe-action-btn"
              onclick="shareRecipeByKey('${key}')"
              aria-label="Поделиться рецептом">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="18" cy="5" r="3"/>
          <circle cx="6" cy="12" r="3"/>
          <circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
        Поделиться
      </button>
      <button class="recipe-action-btn"
              onclick="addToShoppingByKey('${key}')"
              aria-label="Добавить в список покупок">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="9" cy="21" r="1"/>
          <circle cx="20" cy="21" r="1"/>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
        </svg>
        Покупки
      </button>
    </div>
  `

  return card
}

function toggleSteps(button) {
  const body  = button.nextElementSibling
  const isOpen = body.classList.toggle('open')
  button.classList.toggle('open', isOpen)
  button.setAttribute('aria-expanded', isOpen ? 'true' : 'false')
  body.setAttribute('aria-hidden', isOpen ? 'false' : 'true')
  button.querySelector('.toggle-label').textContent = isOpen ? 'Скрыть шаги' : 'Показать шаги'
}

// ═══════════════════════════════════════════════════════════════
//  ИЗБРАННОЕ
// ═══════════════════════════════════════════════════════════════

function getFavorites() {
  try { return JSON.parse(localStorage.getItem('holodilnik_favorites') || '[]') }
  catch (_) { return [] }
}

function saveFavorites(list) {
  localStorage.setItem('holodilnik_favorites', JSON.stringify(list))
}

function isFavorite(name) {
  return getFavorites().some(r => r.name === name)
}

function toggleFavoriteByKey(key) {
  const recipe = recipeStore[key]
  if (!recipe) return

  const list = getFavorites()
  const idx  = list.findIndex(r => r.name === recipe.name)

  if (idx >= 0) {
    list.splice(idx, 1)
    saveFavorites(list)
    updateFavButtonState(key, false)
    showToast('Удалено из избранного')
  } else {
    list.unshift(recipe)
    saveFavorites(list)
    updateFavButtonState(key, true)
    showToast('✓ Добавлено в избранное')
  }
}

function updateFavButtonState(key, isFav) {
  const btn = document.getElementById(`fav-btn-${key}`)
  if (!btn) return
  btn.classList.toggle('fav-active', isFav)
  const svg = btn.querySelector('svg')
  if (svg) svg.setAttribute('fill', isFav ? 'currentColor' : 'none')
}

function renderFavorites() {
  const list    = getFavorites()
  const listEl  = document.getElementById('favorites-list')
  const emptyEl = document.getElementById('favorites-empty')
  const countEl = document.getElementById('favorites-count')

  listEl.innerHTML = ''
  countEl.textContent = list.length
    ? `${list.length} ${plural(list.length, 'рецепт', 'рецепта', 'рецептов')}`
    : '0 сохранённых рецептов'

  if (!list.length) {
    emptyEl.style.display = ''
    listEl.style.display  = 'none'
    return
  }

  emptyEl.style.display = 'none'
  listEl.style.display  = ''

  list.forEach(recipe => {
    const card = createRecipeCard(recipe)

    // Заменяем кнопку «Избранное» на «Удалить» в разделе избранного
    const favBtn = card.querySelector('.recipe-action-btn.fav-active')
    if (favBtn) {
      favBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
        Удалить
      `
      favBtn.style.color = 'var(--c-error)'
      favBtn.style.borderColor = 'rgba(220,38,38,0.25)'
      favBtn.style.background  = 'var(--c-error-light)'
      favBtn.onclick = () => {
        const key = favBtn.id.replace('fav-btn-', '')
        toggleFavoriteByKey(key)
        renderFavorites()
      }
    }

    listEl.appendChild(card)
  })
}

// ═══════════════════════════════════════════════════════════════
//  ИСТОРИЯ
// ═══════════════════════════════════════════════════════════════

function getHistory() {
  try { return JSON.parse(localStorage.getItem('holodilnik_history') || '[]') }
  catch (_) { return [] }
}

function saveHistory(list) {
  localStorage.setItem('holodilnik_history', JSON.stringify(list))
}

function addToHistory(recipes) {
  const now     = new Date()
  const entry   = {
    id:        now.getTime(),
    date:      now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }),
    time:      now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
    timestamp: now.getTime(),
    style:     state.selectedStyle,
    recipes,
  }
  const list = getHistory()
  list.unshift(entry)
  // Храним не более 50 записей
  saveHistory(list.slice(0, 50))
}

function renderHistory() {
  const list    = getHistory()
  const listEl  = document.getElementById('history-list')
  const emptyEl = document.getElementById('history-empty')
  const countEl = document.getElementById('history-count')

  listEl.innerHTML = ''
  countEl.textContent = list.length
    ? `${list.length} ${plural(list.length, 'генерация', 'генерации', 'генераций')}`
    : '0 генераций'

  if (!list.length) {
    emptyEl.style.display = ''
    listEl.style.display  = 'none'
    return
  }

  emptyEl.style.display = 'none'
  listEl.style.display  = ''

  // Группируем по дате
  const groups = {}
  const today     = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })

  list.forEach(entry => {
    let label = entry.date
    if (label === today)     label = 'Сегодня'
    if (label === yesterday) label = 'Вчера'
    if (!groups[label]) groups[label] = []
    groups[label].push(entry)
  })

  const styleNames = { fast: 'Быстрые', detailed: 'Подробные', diet: 'Диетические', kids: 'Детские' }

  Object.entries(groups).forEach(([label, entries]) => {
    const group = document.createElement('div')
    group.className = 'history-date-group'

    const dateLabel = document.createElement('p')
    dateLabel.className = 'history-date-label'
    dateLabel.textContent = label
    group.appendChild(dateLabel)

    entries.forEach(entry => {
      const card = document.createElement('div')
      card.className = 'history-card'
      card.setAttribute('role', 'listitem')

      const recipeList = (entry.recipes || [])
        .map(r => `<div class="history-recipe-item">${escapeHtml(r.emoji || '🍽')} ${escapeHtml(r.name)}</div>`)
        .join('')

      card.innerHTML = `
        <div class="history-card-top">
          <div class="history-card-meta">
            <span class="history-style-badge">${escapeHtml(styleNames[entry.style] || 'Рецепты')}</span>
          </div>
          <span class="history-time">${escapeHtml(entry.time)}</span>
        </div>
        <div class="history-recipes-list">${recipeList}</div>
      `

      // Клик по карточке истории — показываем рецепты
      card.addEventListener('click', () => {
        state.currentRecipes = entry.recipes || []
        renderRecipes(entry.recipes || [])
        document.getElementById('recipes-subtitle').textContent =
          `${entry.date} · ${styleNames[entry.style] || ''}`
        showScreen('recipes')
      })

      group.appendChild(card)
    })

    listEl.appendChild(group)
  })
}

// ═══════════════════════════════════════════════════════════════
//  СПИСОК ПОКУПОК
// ═══════════════════════════════════════════════════════════════

function getShoppingList() {
  try { return JSON.parse(localStorage.getItem('holodilnik_shopping') || '[]') }
  catch (_) { return [] }
}

function saveShoppingList(list) {
  localStorage.setItem('holodilnik_shopping', JSON.stringify(list))
}

function addToShoppingByKey(key) {
  const recipe = recipeStore[key]
  if (!recipe) return
  addRecipeToShopping(recipe)
}

function addRecipeToShopping(recipe) {
  if (!recipe || !recipe.ingredients) return

  const list    = getShoppingList()
  const existing = new Set(list.map(i => i.text.toLowerCase()))
  let   added   = 0

  recipe.ingredients.forEach(ing => {
    if (!existing.has(ing.toLowerCase())) {
      list.push({
        id:         `${Date.now()}_${Math.random()}`,
        text:       ing,
        recipeName: recipe.name,
        checked:    false,
      })
      existing.add(ing.toLowerCase())
      added++
    }
  })

  saveShoppingList(list)
  showToast(added > 0 ? `✓ Добавлено ${added} продуктов в покупки` : 'Все продукты уже в списке')
}

function toggleShoppingItem(itemId) {
  const list = getShoppingList()
  const item = list.find(i => i.id === itemId)
  if (item) {
    item.checked = !item.checked
    saveShoppingList(list)
    renderShoppingList()
  }
}

function clearShoppingList() {
  saveShoppingList([])
  renderShoppingList()
  showToast('Список покупок очищен')
}

function renderShoppingList() {
  const list     = getShoppingList()
  const listEl   = document.getElementById('shopping-list')
  const emptyEl  = document.getElementById('shopping-empty')
  const countEl  = document.getElementById('shopping-count')
  const clearBtn = document.getElementById('btn-clear-shopping')

  listEl.innerHTML = ''

  const unchecked = list.filter(i => !i.checked).length
  const total     = list.length

  countEl.textContent = total
    ? `${unchecked} из ${total} продуктов`
    : '0 продуктов'

  if (!total) {
    emptyEl.style.display = ''
    listEl.style.display  = 'none'
    clearBtn.style.display = 'none'
    return
  }

  emptyEl.style.display  = 'none'
  listEl.style.display   = ''
  clearBtn.style.display = 'flex'

  // Группируем по рецепту
  const groups = {}
  list.forEach(item => {
    const g = item.recipeName || 'Разное'
    if (!groups[g]) groups[g] = []
    groups[g].push(item)
  })

  Object.entries(groups).forEach(([groupName, items]) => {
    const groupEl = document.createElement('div')
    groupEl.className = 'shopping-group'

    const titleEl = document.createElement('p')
    titleEl.className = 'shopping-group-title'
    titleEl.textContent = groupName
    groupEl.appendChild(titleEl)

    items.forEach(item => {
      const el = document.createElement('div')
      el.className = `shopping-item${item.checked ? ' checked' : ''}`
      el.setAttribute('role', 'listitem')
      el.innerHTML = `
        <div class="shopping-checkbox" aria-hidden="true">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="2 6 5 9 10 3"/>
          </svg>
        </div>
        <span class="shopping-item-text">${escapeHtml(item.text)}</span>
      `
      el.addEventListener('click', () => toggleShoppingItem(item.id))
      groupEl.appendChild(el)
    })

    listEl.appendChild(groupEl)
  })
}

// ═══════════════════════════════════════════════════════════════
//  РЕЦЕПТ ДНЯ
// ═══════════════════════════════════════════════════════════════

function getDailyRecipe() {
  if (typeof DAILY_RECIPES === 'undefined' || !DAILY_RECIPES.length) return null
  const start   = new Date(new Date().getFullYear(), 0, 0)
  const now     = new Date()
  const dayOfYear = Math.floor((now - start) / 86400000)
  return DAILY_RECIPES[dayOfYear % DAILY_RECIPES.length]
}

function renderDailyRecipe() {
  const recipe = getDailyRecipe()
  state.dailyRecipe = recipe

  const dateEl = document.getElementById('daily-date')
  if (dateEl) {
    const today = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' })
    dateEl.textContent = today
  }

  const container = document.getElementById('daily-recipe-container')
  container.innerHTML = ''

  if (!recipe) {
    container.innerHTML = '<p style="text-align:center;color:var(--c-text-soft)">Рецепт дня недоступен</p>'
    return
  }

  // Кладём в recipeStore для кнопок
  const key = makeRecipeKey(recipe)

  const card = createRecipeCard(recipe)

  // Меняем кнопку «Избранное» на стандартную для рецепта дня
  container.appendChild(card)
}

// ═══════════════════════════════════════════════════════════════
//  ПОДЕЛИТЬСЯ РЕЦЕПТОМ
// ═══════════════════════════════════════════════════════════════

async function shareRecipeByKey(key) {
  const recipe = recipeStore[key]
  if (!recipe) return

  const text = [
    `🍽 ${recipe.name}`,
    `⏱ ${recipe.time}`,
    '',
    '📋 Ингредиенты:',
    (recipe.ingredients || []).map(i => `• ${i}`).join('\n'),
    '',
    '👨‍🍳 Приготовление:',
    (recipe.steps || []).map((s, i) => `${i + 1}. ${s.replace(/^шаг\s*\d+\s*:\s*/i, '')}`).join('\n'),
    '',
    '📲 Найдено с помощью «Что приготовить?»',
  ].join('\n')

  if (bridge && isInsideVK()) {
    try {
      await bridge.send('VKWebAppShowWallPostBox', { message: text })
      return
    } catch (_) {}
  }

  // Fallback: Web Share API или буфер обмена
  if (navigator.share) {
    try {
      await navigator.share({ title: recipe.name, text })
      return
    } catch (_) {}
  }

  try {
    await navigator.clipboard.writeText(text)
    showToast('✓ Рецепт скопирован в буфер')
  } catch (_) {
    showToast('Не удалось поделиться рецептом')
  }
}

// ═══════════════════════════════════════════════════════════════
//  МОДАЛЬНОЕ ОКНО ПОДПИСКИ
// ═══════════════════════════════════════════════════════════════

function showSubscribeModal(vkPublic) {
  const overlay = document.getElementById('modal-overlay')
  document.getElementById('modal-public-title').textContent = vkPublic.name || 'Наше сообщество'
  document.getElementById('modal-public-desc').textContent  = vkPublic.description || ''
  overlay.dataset.publicId  = vkPublic.id || 0
  overlay.dataset.publicUrl = vkPublic.url || ''
  overlay.classList.add('visible')
}

function hideSubscribeModal() {
  document.getElementById('modal-overlay').classList.remove('visible')
  if (state.afterModalAction) {
    const action = state.afterModalAction
    state.afterModalAction = null
    action()
  }
}

function handleOverlayClick(event) {
  // Клик по фону не закрывает — подписка обязательна
}

function isInsideVK() {
  const ua   = navigator.userAgent || ''
  const href = window.location.href
  return ua.includes('VKAndroid') || ua.includes('VKIOS') ||
         href.includes('vk.com') || href.includes('m.vk.ru') ||
         href.includes('vk_user_id') || href.includes('vk_app_id')
}

async function handleSubscribe() {
  const overlay   = document.getElementById('modal-overlay')
  const btn       = document.getElementById('btn-subscribe')
  const groupId   = parseInt(overlay.dataset.publicId || '0')

  btn.classList.add('loading')

  let subscribed = false
  try {
    if (bridge && groupId > 0 && isInsideVK()) {
      const joinPromise = bridge.send('VKWebAppJoinGroup', { group_id: groupId })
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))
      const result = await Promise.race([joinPromise, timeout])
      subscribed = result && result.result === true
    }
  } catch (_) {
    subscribed = false
  }

  btn.classList.remove('loading')

  if (!subscribed) {
    const body = document.getElementById('modal-body')
    if (body) {
      body.textContent  = 'Нужно подписаться, чтобы продолжить. Нажмите кнопку ещё раз.'
      body.style.color  = '#DC2626'
      setTimeout(() => {
        body.textContent = 'Для получения бесплатного результата подпишитесь на наше сообщество — это займёт несколько секунд'
        body.style.color = ''
      }, 3000)
    }
    return
  }

  hideSubscribeModal()
}

// ═══════════════════════════════════════════════════════════════
//  НОВЫЙ ЗАПРОС
// ═══════════════════════════════════════════════════════════════

function startNewSearch() {
  state.selectedFile = null

  const preview = document.getElementById('photo-preview')
  const zone    = document.getElementById('upload-zone')
  const empty   = document.getElementById('upload-empty-state')
  const actions = document.getElementById('photo-actions')

  preview.src = ''
  preview.classList.remove('visible')
  empty.style.display = ''
  zone.classList.remove('has-photo')
  actions.classList.remove('visible')

  document.getElementById('recipes-container').innerHTML = ''
  document.getElementById('recipes-error').classList.remove('visible')

  hideUploadError()
  showScreen('upload')
}

// ═══════════════════════════════════════════════════════════════
//  ОШИБКИ
// ═══════════════════════════════════════════════════════════════

function showUploadError(message) {
  const block = document.getElementById('upload-error')
  const text  = document.getElementById('upload-error-text')
  text.textContent = message
  block.classList.add('visible')
}

function hideUploadError() {
  document.getElementById('upload-error').classList.remove('visible')
}

function showRecipesError(message) {
  const block = document.getElementById('recipes-error')
  const text  = document.getElementById('recipes-error-text')

  text.innerHTML = `${escapeHtml(message)}<br><br>
    <button onclick="handleRetry()" style="
      margin-top:8px;padding:8px 20px;
      background:#DC2626;color:white;border:none;
      border-radius:999px;font-family:inherit;font-size:14px;
      font-weight:700;cursor:pointer;">Попробовать ещё раз</button>`

  block.classList.add('visible')
  document.getElementById('screen-recipes').scrollTop = 0
}

async function handleRetry() {
  if (!state.selectedFile) { startNewSearch(); return }

  document.getElementById('recipes-error').classList.remove('visible')
  showScreen('loading')
  startLoadingPhrases()

  try {
    const recipes = await analyzeAndGetRecipes(state.selectedFile, state.selectedStyle)
    state.currentRecipes = recipes
    addToHistory(recipes)
    renderRecipes(recipes)

    state.generationCount++
    localStorage.setItem('holodilnik_gen', state.generationCount)

    stopLoadingPhrases()
    showScreen('recipes')
  } catch (err) {
    stopLoadingPhrases()
    showScreen('recipes')
    showRecipesError(err.message || 'Попробуйте ещё раз чуть позже.')
  }
}

// ═══════════════════════════════════════════════════════════════
//  ТОСТ-УВЕДОМЛЕНИЯ
// ═══════════════════════════════════════════════════════════════

function showToast(message) {
  // Удаляем предыдущий тост если есть
  const old = document.querySelector('.toast')
  if (old) old.remove()

  const toast = document.createElement('div')
  toast.className = 'toast'
  toast.textContent = message
  document.body.appendChild(toast)

  requestAnimationFrame(() => {
    toast.classList.add('toast-visible')
    setTimeout(() => {
      toast.classList.remove('toast-visible')
      setTimeout(() => toast.remove(), 300)
    }, 2500)
  })
}

// ═══════════════════════════════════════════════════════════════
//  УТИЛИТЫ
// ═══════════════════════════════════════════════════════════════

function escapeHtml(str) {
  if (typeof str !== 'string') return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function plural(n, one, few, many) {
  const mod10  = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} ${few}`
  return `${n} ${many}`
}

// ═══════════════════════════════════════════════════════════════
//  ИНИЦИАЛИЗАЦИЯ
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  initVK()

  // Клавиатурная навигация для зоны загрузки
  const zone = document.getElementById('upload-zone')
  if (zone) {
    zone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleUploadZoneClick(e)
      }
    })
  }

  // Блокируем drag-and-drop по всему документу
  document.addEventListener('dragover', e => e.preventDefault())
  document.addEventListener('drop', e => e.preventDefault())

  // Предзагрузка рецепта дня (не блокирует UI)
  if (typeof DAILY_RECIPES !== 'undefined') {
    state.dailyRecipe = getDailyRecipe()
  }
})
