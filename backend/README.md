Instrukcje:

1. Przejdź do katalogu backend:
   cd /workspaces/streaminghub-w/backend

2. Skopiuj plik środowiskowy i uzupełnij klucze lokalnie:
   cp .env.example .env
   (edytuj .env, wstaw wartości: SUPABASE_URL, SUPABASE_ANON_KEY, JWT_SECRET itp.)

3. Zainstaluj zależności:
   npm install

4. Uruchom serwer lokalnie:
   npm start
   (w trybie deweloperskim: npm run dev)

Testy lokalne:
- Otwórz http://localhost:3000 i sprawdź, czy front działa oraz czy endpointy /api/* zwracają dane.
- Jeśli używasz Supabase: sprawdź, że SUPABASE_URL i SUPABASE_ANON_KEY w .env są poprawne.

Deploy (publicznie) — jak podmienić klucze:
1. Nie commituj .env do repo. Używaj .env tylko lokalnie.
2. Na hostingu (Render / Railway / Vercel / Netlify) w panelu projektu dodaj zmienne środowiskowe:
   - SUPABASE_URL
   - SUPABASE_ANON_KEY
   - JWT_SECRET
   - PORT (opcjonalnie)
   - DB_PATH (jeśli używasz plikowej bazy SQLite na hostingu — lepiej użyć zdalnej bazy)
3. Render / Railway: stwórz nowy service (Node), podłącz repo, ustaw build/start command (npm install && npm start lub start: npm start), dodaj env vars w settings -> Environment.
4. Vercel / Netlify: do hostowania tylko statycznego frontu; backend node należy deployować osobno (Render/Railway). Na Vercel/Netlify ustaw env vars w Settings -> Environment Variables.

Dodatkowe instrukcje dla Vercel:

1. Przenieś (lub pozostaw) statyczne pliki w katalogu /public (Vercel serwuje public/ jako root).
2. Dodaj pliki serverless do /api (przykład: /api/films.js) — Vercel je zdeployuje jako funkcje.
3. W panelu Vercel (Project Settings → Environment Variables) ustaw:
   - SUPABASE_URL
   - SUPABASE_ANON_KEY
   - SUPABASE_SERVICE_ROLE_KEY  (Tylko na backend; nigdy w repo)
4. Deploy: po pushu do repo Vercel zbuduje i opublikuje frontend + funkcje.
5. Testy:
   - GET /api/films -> lista filmów
   - POST /api/films (body JSON {title,description,url}) -> dodanie filmu (używa service role)
Uwaga: przed deployem upewnij się, że w Supabase masz tabelę "films" (kolumny: id, title, description, url, created_at).

Uwagi bezpieczeństwa:
- SUPABASE_ANON_KEY jest przeznaczony do użytku w przeglądarce (ograniczony dostęp). Nigdy nie umieszczaj SUPABASE_SERVICE_ROLE_KEY w frontendzie.
- Jeśli backend wykonuje operacje, które wymagają sekretnych uprawnień, trzymaj service_role key jako zmienną środowiskową na serwerze i odpal te operacje tylko po stronie serwera.
- Jeśli klucz wycieknie — rotuj (zmień) klucze w panelu Supabase i zaktualizuj je w hostingu.

CORS:
- Jeśli frontend i backend są na różnych domenach, ustaw CORS_ORIGIN w .env (lub w panelu hostingu) na adres frontendu, aby umożliwić zapytania.

Opcjonalne:
- Jeśli chcesz hostować wszystko jednym serwerem: deployuj backend Node (serves static public/) i ustaw env vars tam — wtedy domena.pl będzie obsługiwana przez backend i użyje sekretów z environment.
- Jeśli chcesz hostować frontend oddzielnie: użyj SUPABASE_ANON_KEY w frontendzie do odczytu; zapisy przekierowuj przez backend by ukryć service role.

Podsumowanie:
- Tak — po podmianie kluczy w .env lokalnie aplikacja działa.
- Publicznie: ustaw te same zmienne w panelu hostingu (Render/Railway/Vercel/Netlify). Trzymaj sekrety tylko na serwerze.
