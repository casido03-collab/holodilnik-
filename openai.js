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
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
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
  const base64Image = await fileToBase64(file)

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

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60000)

  let response
  try {
    response = await fetch('https://blue-limit-95b7.casido03.workers.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
