// =============================================================
//  Главный модуль приложения
// =============================================================

// ── Состояние ─────────────────────────────────────────────────
const state = {
  currentScreen:    'welcome',
  selectedFile:     null,
  selectedImageBase64: null, // готовый base64 для API
  selectedStyle:    'fast',
  generationCount:  parseInt(localStorage.getItem('holodilnik_gen') || '0'),
  afterModalAction: null,
}

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
    try {
      bridge.send('VKWebAppInit')
    } catch (e) {
      // Не критично — продолжаем без VK
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  НАВИГАЦИЯ МЕЖДУ ЭКРАНАМИ
// ═══════════════════════════════════════════════════════════════

function showScreen(screenId) {
  const current = document.getElementById(`screen-${state.currentScreen}`)
  const next    = document.getElementById(`screen-${screenId}`)

  if (!next || state.currentScreen === screenId) return

  // Выход текущего экрана
  if (current) {
    current.classList.add('slide-out')
    setTimeout(() => {
      current.classList.add('hidden')
      current.classList.remove('slide-out')
    }, 250)
  }

  // Вход нового экрана
  next.classList.remove('hidden')
  next.classList.add('screen')
  // Небольшая задержка для начала анимации
  requestAnimationFrame(() => {
    next.style.opacity = ''
    next.style.transform = ''
  })

  state.currentScreen = screenId

  // Прокрутить вверх при переходе
  next.scrollTop = 0
}

// ═══════════════════════════════════════════════════════════════
//  ЗАГРУЗКА ФОТО
// ═══════════════════════════════════════════════════════════════

function triggerInput(source) {
  const inputId = source === 'camera' ? 'input-camera' : 'input-gallery'
  document.getElementById(inputId).click()
}

function handleUploadZoneClick(event) {
  // Не открываем диалог, если уже есть фото (клик по превью)
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
    // Читаем EXIF-ориентацию из первых байт файла
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

      // Рисуем на canvas с правильным поворотом + сжатие до 512px
      const MAX = 512
      const canvas  = document.createElement('canvas')
      const ctx     = canvas.getContext('2d')
      let sw = img.naturalWidth
      let sh = img.naturalHeight
      const rotated = orientation >= 5

      // Сжимаем до MAX
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

  const pills = ['fast', 'detailed', 'diet']
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
  // Валидация: нужно фото
  if (!state.selectedFile) {
    const zone = document.getElementById('upload-zone')
    zone.classList.add('error-shake')
    setTimeout(() => zone.classList.remove('error-shake'), 500)
    showUploadError('Пожалуйста, добавьте фото холодильника')
    return
  }

  hideUploadError()

  // Показываем окно подписки только если ещё не подписан
  const alreadySubscribed = localStorage.getItem('holodilnik_subscribed') === '1'
  const publics = CONFIG.VK_PUBLICS

  if (!alreadySubscribed && publics && publics.length > 0) {
    const vkPublic = publics[0]
    if (vkPublic && (vkPublic.id > 0 || vkPublic.url)) {
      state.afterModalAction = doSubmit
      showSubscribeModal(vkPublic)
      return
    }
  }

  doSubmit()
}

async function doSubmit() {
  showScreen('loading')
  startLoadingPhrases()

  try {
    const recipes = await analyzeAndGetRecipes(state.selectedFile, state.selectedStyle)
    renderRecipes(recipes)

    state.generationCount++
    localStorage.setItem('holodilnik_gen', state.generationCount)

    stopLoadingPhrases()
    showScreen('recipes')
    setTimeout(animateRecipeCards, 200)

  } catch (err) {
    stopLoadingPhrases()
    showScreen('recipes')
    showRecipesError(err.message || 'Не удалось получить рецепты. Проверьте интернет и попробуйте ещё раз.')
  }
}

// ═══════════════════════════════════════════════════════════════
//  АНИМАЦИЯ ЭКРАНА ЗАГРУЗКИ
// ═══════════════════════════════════════════════════════════════

let phraseTimer  = null
let phraseIndex  = 0

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
    el.textContent   = LOADING_PHRASES[phraseIndex]
    el.style.opacity = '1'
  }, 200)
}

function stopLoadingPhrases() {
  if (phraseTimer) {
    clearInterval(phraseTimer)
    phraseTimer = null
  }
}

// ═══════════════════════════════════════════════════════════════
//  РЕНДЕР РЕЦЕПТОВ
// ═══════════════════════════════════════════════════════════════

function renderRecipes(recipes) {
  const container = document.getElementById('recipes-container')
  container.innerHTML = ''

  // Скрыть блок ошибки
  document.getElementById('recipes-error').classList.remove('visible')

  const styleNames = { fast: 'быстрые', detailed: 'подробные', diet: 'диетические' }
  document.getElementById('recipes-subtitle').textContent =
    `Нашли 3 блюда (${styleNames[state.selectedStyle] || ''}) из ваших продуктов`

  recipes.forEach((recipe, idx) => {
    const card = createRecipeCard(recipe, idx)
    container.appendChild(card)
  })
}

function createRecipeCard(recipe, idx) {
  const card = document.createElement('article')
  card.className = 'recipe-card'
  card.setAttribute('role', 'listitem')
  card.setAttribute('aria-label', `Рецепт: ${recipe.name}`)

  const emoji = recipe.emoji || '🍽'

  // Ингредиенты (chips)
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
      // Убираем префикс "Шаг N:" если он есть
      const text = step.replace(/^шаг\s*\d+\s*:\s*/i, '')
      return `
        <div class="recipe-step-item">
          <div class="step-counter" aria-label="Шаг ${i + 1}">${i + 1}</div>
          <p class="step-text-body">${escapeHtml(text)}</p>
        </div>
      `
    }).join('')

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
        <div class="recipe-steps-list">
          ${stepsHTML}
        </div>
      </div>
    </div>
  `

  return card
}

function animateRecipeCards() {
  // Анимация задаётся через CSS animation напрямую на .recipe-card
  // Карточки видны сразу после добавления в DOM — ничего дополнительного не нужно
}

function toggleSteps(button) {
  const body = button.nextElementSibling
  const isOpen = body.classList.toggle('open')

  button.classList.toggle('open', isOpen)
  button.setAttribute('aria-expanded', isOpen ? 'true' : 'false')
  body.setAttribute('aria-hidden', isOpen ? 'false' : 'true')
  button.querySelector('.toggle-label').textContent = isOpen ? 'Скрыть шаги' : 'Показать шаги'
}

// ═══════════════════════════════════════════════════════════════
//  ПОДПИСКА НА VK ПАБЛИКИ
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

  // Если была ожидающая задача (например, отправить фото) — запускаем её
  if (state.afterModalAction) {
    const action = state.afterModalAction
    state.afterModalAction = null
    action()
  }
}

function handleOverlayClick(event) {
  // Клик по фону не закрывает модалку — подписка обязательна
}

// Определяем что запущены внутри VK WebView
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
  const publicUrl = overlay.dataset.publicUrl || ''

  btn.classList.add('loading')

  let subscribed = false

  try {
    if (bridge && groupId > 0 && isInsideVK()) {
      // VK WebView — нативный диалог подписки, ждём результата
      const joinPromise = bridge.send('VKWebAppJoinGroup', { group_id: groupId })
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))
      const result = await Promise.race([joinPromise, timeout])
      subscribed = result && result.result === true
    }
    // В браузере вне VK — не пускаем без подписки
  } catch (e) {
    subscribed = false
  }

  btn.classList.remove('loading')

  if (!subscribed) {
    const body = document.getElementById('modal-body')
    if (body) {
      body.textContent = 'Нужно подписаться, чтобы получить рецепты. Нажмите кнопку ещё раз.'
      body.style.color = '#DC2626'
      setTimeout(() => {
        body.textContent = 'Для получения бесплатного результата подпишитесь на наше сообщество — это займёт несколько секунд'
        body.style.color = ''
      }, 3000)
    }
    return
  }

  localStorage.setItem('holodilnik_subscribed', '1')
  hideSubscribeModal()
}

// ═══════════════════════════════════════════════════════════════
//  НОВЫЙ ЗАПРОС
// ═══════════════════════════════════════════════════════════════

function startNewSearch() {
  // Очищаем фото
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

  // Очищаем карточки рецептов
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

  text.innerHTML = `${escapeHtml(message)}
    <br><br>
    <button onclick="handleRetry()" style="
      margin-top: 8px;
      padding: 8px 20px;
      background: #DC2626;
      color: white;
      border: none;
      border-radius: 999px;
      font-family: inherit;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
    ">Попробовать ещё раз</button>`

  block.classList.add('visible')

  // Прокрутить вверх чтобы увидеть ошибку
  document.getElementById('screen-recipes').scrollTop = 0
}

async function handleRetry() {
  if (!state.selectedFile) {
    startNewSearch()
    return
  }

  document.getElementById('recipes-error').classList.remove('visible')
  showScreen('loading')
  startLoadingPhrases()

  try {
    const recipes = await analyzeAndGetRecipes(state.selectedFile, state.selectedStyle)
    renderRecipes(recipes)

    state.generationCount++
    localStorage.setItem('holodilnik_gen', state.generationCount)

    stopLoadingPhrases()
    showScreen('recipes')
    setTimeout(animateRecipeCards, 200)

  } catch (err) {
    stopLoadingPhrases()
    showScreen('recipes')
    showRecipesError(err.message || 'Попробуйте ещё раз чуть позже.')
  }
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

  // Предотвращаем случайное открытие файла при drag-and-drop на весь документ
  document.addEventListener('dragover', e => e.preventDefault())
  document.addEventListener('drop', e => e.preventDefault())
})
