// =============================================================
//  Модуль работы с OpenAI API (GPT-4o Vision)
// =============================================================

const STYLE_PROMPTS = {
  fast:     'быстрые рецепты (готовить не более 30 минут, минимум сложных шагов)',
  detailed: 'рецепты с подробным пошаговым описанием (каждый шаг чётко объяснён)',
  diet:     'лёгкие диетические рецепты (нежирные, полезные, с небольшим количеством калорий)'
}

const SYSTEM_PROMPT = `Ты — дружелюбный кулинарный помощник для домашней кухни.
Анализируй изображение холодильника и предлагай реалистичные рецепты ТОЛЬКО из продуктов, которые видишь на фото.
Отвечай ТОЛЬКО в формате JSON, без лишнего текста, без markdown, без объяснений.`

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      const MAX = 1024
      let w = img.naturalWidth
      let h = img.naturalHeight

      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX }
        else        { w = Math.round(w * MAX / h); h = MAX }
      }

      const canvas = document.createElement('canvas')
      canvas.width  = w
      canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)

      const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1]
      resolve(base64)
    }

    img.onerror = reject
    img.src = url
  })
}

function buildUserMessage(styleKey) {
  const styleName = STYLE_PROMPTS[styleKey] || STYLE_PROMPTS.fast
  return `Посмотри на содержимое холодильника и предложи ровно 3 ${styleName}.

Используй ТОЛЬКО те продукты, которые видишь на фото.

Ответь строго в формате JSON (без переносов строк внутри строк, без markdown):
{
  "recipes": [
    {
      "name": "Название блюда",
      "time": "25 минут",
      "emoji": "🍳",
      "ingredients": ["Продукт 1", "Продукт 2", "Продукт 3"],
      "steps": ["Шаг 1: ...", "Шаг 2: ...", "Шаг 3: ..."]
    }
  ]
}

Отвечай на русском языке. Не добавляй ничего кроме JSON.`
}

function safeParseJSON(text) {
  // Попытка 1: прямой парсинг
  try {
    return JSON.parse(text)
  } catch (_) {}

  // Попытка 2: извлечь JSON из текста
  try {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
  } catch (_) {}

  return null
}

function validateRecipes(data) {
  if (!data || !Array.isArray(data.recipes)) return false
  if (data.recipes.length === 0) return false

  return data.recipes.every(r =>
    typeof r.name === 'string' &&
    typeof r.time === 'string' &&
    Array.isArray(r.ingredients) &&
    Array.isArray(r.steps)
  )
}

async function analyzeAndGetRecipes(file, styleKey = 'fast') {
  // Используем готовый base64 из state если есть, иначе конвертируем
  const base64Image = (state && state.selectedImageBase64)
    ? state.selectedImageBase64
    : await fileToBase64(file)

  const requestBody = {
    model: 'gpt-4o',
    max_tokens: 2000,
    messages: [
      {
        role: 'system',
        content: SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${base64Image}`,
              detail: 'low'
            }
          },
          {
            type: 'text',
            text: buildUserMessage(styleKey)
          }
        ]
      }
    ]
  }

  const apiKey = CONFIG && CONFIG.OPENAI_API_KEY
  if (!apiKey || apiKey === 'ВСТАВЬТЕ_КЛЮЧ_ЗДЕСЬ') {
    throw new Error('API ключ не настроен. Обратитесь к разработчику.')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 90000)

  let response
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    })
  } catch (e) {
    clearTimeout(timeout)
    if (e.name === 'AbortError') throw new Error('Превышено время ожидания. Попробуйте ещё раз.')
    throw new Error('Нет соединения с сервером. Проверьте интернет.')
  }
  clearTimeout(timeout)

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const msg = errorData?.error?.message || `Ошибка сервера: ${response.status}`
    throw new Error(msg)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content

  if (!content) {
    throw new Error('Пустой ответ от ИИ. Попробуйте ещё раз.')
  }

  const parsed = safeParseJSON(content)

  if (!validateRecipes(parsed)) {
    throw new Error('Не удалось распознать рецепты. Попробуйте загрузить другое фото.')
  }

  return parsed.recipes
}
