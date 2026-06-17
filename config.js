// =============================================================
//  Настройте эти значения перед деплоем приложения
// =============================================================

const CONFIG = {

  // URL прокси на Google Cloud Functions
  PROXY_URL: 'https://europe-west1-project-621db92b-aeea-43fb-829.cloudfunctions.net/proxy',

  // URL Google Apps Script Web App для трекинга подписок из приложения.
  // Заполнить после деплоя скрипта (Развернуть → Веб-приложение → скопировать URL).
  // Пока пустая строка — трекинг отключён.
  TRACKING_URL: 'https://script.google.com/macros/s/AKfycbwRbI-ERfy4fzGxxu0L8DrM8MT-XPJ8OpYdONH56HIhcGibFo3GS74fLGULSnILK1ov/exec',

  // РЕЖИМ МОДЕРАЦИИ: false = подписки не требуются (для прохождения проверки VK)
  // После получения одобрения VK установите true, чтобы включить проверку подписок
  SUBSCRIPTION_ACTIVE: false,

  // Паблики VK — пользователь должен быть подписан на все для доступа к приложению.
  // Проверяются по порядку: первый незаподписанный показывается пользователю.
  VK_PUBLICS: [
    { id: 84301687,  name: 'Идеи для дачи',   url: 'https://vk.com/ideadacha' },
    { id: 189041751, name: 'Малая дача',       url: 'https://vk.com/mal_dachi' },
    { id: 154419301, name: 'Простой повар',    url: 'https://vk.com/prostpovar' },
    { id: 49119600,  name: '30 минут',         url: 'https://vk.com/30min_meals' },
    { id: 164511121, name: 'Ресничкионлайн',   url: 'https://vk.com/resnichkionline' },
    { id: 175656793, name: 'Сливки юмора',     url: 'https://vk.com/slivkihumora' },
    { id: 166652899, name: 'Фит в тарелке',    url: 'https://vk.com/fitvtarelke' },
    { id: 176975271, name: 'Идеи дома',        url: 'https://vk.com/ideidoma91' },
    { id: 109687628, name: 'Дача секрет',      url: 'https://vk.com/dacha_sekret' },
    { id: 167046442, name: 'Пикник',           url: 'https://vk.com/piknvst' },
  ]
}
