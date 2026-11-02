/* Настройки подключения. Заполните два поля из Supabase:
   Project Settings → API → Project URL и anon (public) key.
   anon-ключ публичный по задумке Supabase: данные защищены правилами доступа (RLS)
   и входом по паролю, поэтому его можно хранить в репозитории. */
window.KK_CONFIG = {
  supabaseUrl: '',      // например: 'https://abcdefghijkl.supabase.co'
  supabaseAnonKey: '',  // длинная строка, начинается с 'eyJ...' или 'sb_publishable_...'

  /* Запасной канал к Мосбирже, если браузер не пустит к iss.moex.com напрямую.
     Нужен только после разворачивания функции supabase/functions/moex-proxy.
     Пример: 'https://abcdefghijkl.supabase.co/functions/v1/moex-proxy' */
  moexProxyUrl: '',
};
