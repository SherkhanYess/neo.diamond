# Neo Diamond — Онлайн-склад (MVP)

Готовая статическая сборка для GitHub Pages + облачная синхронизация состояния через Supabase.

## Как запустить на GitHub Pages

1. Создайте репозиторий `neo.diamond` в своём GitHub.
2. Скопируйте файлы проекта в репозиторий и сделайте пуш в ветку `main`:
   - `git init`
   - `git add .`
   - `git commit -m "init"`
   - `git branch -M main`
   - `git remote add origin git@github.com:<ваш_логин>/neo.diamond.git`
   - `git push -u origin main`
3. В Settings → Pages включите Pages для репозитория. Режим: "GitHub Actions". 
   В репозитории уже есть workflow `.github/workflows/pages.yml`, который будет публиковать `index.html`.

После пуша GitHub Actions автоматически развернёт сайт. Адрес вида:
`https://<ваш_логин>.github.io/neo.diamond/`

## Облачная синхронизация (Supabase)

Чтобы уйти от переполнения localStorage и получить бэкап/совместную работу:

1) Создайте проект в Supabase
- https://supabase.com/ → New project
- Скопируйте `Project URL` и `anon public key` (Settings → API)

2) Создайте таблицу для состояния
Зайдите в SQL Editor и выполните SQL:

```
create table if not exists public.nd_state (
  org text primary key,
  updated_at timestamptz not null default now(),
  blob jsonb not null
);
-- Упростим: разрешим анонимное чтение/запись (для MVP). Для продакшена настройте RLS/политики.
alter table public.nd_state enable row level security;
create policy "nd_state_select" on public.nd_state for select using ( true );
create policy "nd_state_upsert" on public.nd_state for insert with check ( true );
create policy "nd_state_update" on public.nd_state for update using ( true );
```

3) Создайте storage bucket для фото (опционально, можно позже)
- Storage → New bucket → имя `photos`, Public: ON

4) Настройте приложение
- Откройте сайт → вкладка "Настройки" → раздел "Облако (Supabase)" (в интерфейсе).
- Введите Supabase URL, anon key, организацию (любой строковый идентификатор, напр. `default`).
- Кнопки: "Проверить", "Сохранить в облако", "Загрузить из облака".

Примечание: фото сейчас сжимаются перед сохранением и могут храниться локально как data URL. Для полного ухода от localStorage можно донастроить загрузку фото в `photos` bucket и хранить только URL. (Могу включить это по запросу.)

## Локальная разработка (по желанию)
Сайт статический, поэтому достаточно открыть `index.html` в браузере. Для публикации в Pages сборка не требуется.

## Интеграции и бекэнд
- Telegram-уведомления: в `api/worker.js` добавлен эндпоинт `/api/telegram/notify`.
  - Настройте переменные окружения для Cloudflare Worker:
    - `TELEGRAM_BOT_TOKEN` — токен вашего бота
    - (опционально) `TELEGRAM_CHAT_ID` — чат/канал по умолчанию
  - В UI на вкладке "Настройки → Уведомления" включите отправку и укажите Chat ID (или @channelusername), можно отправить тест.
  - При создании заказа фронтенд отправит POST на `/api/telegram/notify` с текстом.
- Для финансов "Финолог" запланирован через serverless-прокси (секреты на сервере, не в браузере).
- В этом репо настроен фронтенд + serverless-прокси в `api/` (Cloudflare Workers) и облачный бэкап через Supabase.

Если хотите, могу добавить:
- Выгрузку фото в Supabase Storage (URL вместо data URI) с автоподстановкой.
- Отдельный бэкенд (Workers) в папке `api/` + GitHub Actions для деплоя.
- Миграции для полноценной реляционной схемы вместо хранения единого JSON.

## Безопасность
- `anon key` Supabase в этом MVP используется на клиенте (как принято в Supabase). Для продакшена желательно включить RLS и узкие политики.

---
Вопросы/пожелания — в Issues или пишите мне. 🚀
