/* Настройки подключения. Заполните два поля из Supabase:
   Project Settings → API → Project URL и anon (public) key.
   anon-ключ публичный по задумке Supabase: данные защищены правилами доступа (RLS)
   и входом по паролю, поэтому его можно хранить в репозитории. */
window.KK_CONFIG = {
  supabaseUrl: 'https://fjkvzxuuctlinldvmuns.supabase.co',      // например: 'https://fjkvzxuuctlinldvmuns.supabase.co'
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqa3Z6eHV1Y3RsaW5sZHZtdW5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2MTgzNjUsImV4cCI6MjEwOTE5NDM2NX0.vDFN9vMPBbdT0n4eX4TNHXezwbP_RJ4Uo88ukvwlQqM',  // длинная строка, начинается с 'eyJ...' или 'sb_publishable_...'

  /* Запасной канал к Мосбирже, если браузер не пустит к iss.moex.com напрямую.
     Нужен только после разворачивания функции supabase/functions/moex-proxy.
     Пример: 'https://abcdefghijkl.supabase.co/functions/v1/moex-proxy' */
  moexProxyUrl: '',
};
