# Mizaly App v2 — Roadmap

> Wersja robocza — ogólny zarys architektury i planu prac. Do aktualizacji w miarę doprecyzowywania decyzji.

## 1. Przegląd projektu

Mizaly to multi-tenant SaaS do zarządzania social mediami, zbudowany wokół API [Zernio](https://zernio.com) (publikacja, scheduling, analityka, engagement na 15+ platformach). Produkt składa się z trzech niezależnych aplikacji w jednym repozytorium (monorepo):

| Część | Rola | Stack |
|---|---|---|
| **Mobile (PWA)** | Główna aplikacja dla klientów końcowych — instalowalna jako PWA na telefonie | React (Vite) + PWA |
| **Backend** | API, integracja z Zernio, logika biznesowa, multi-tenancy, baza danych | Express.js + TypeScript + PostgreSQL |
| **Admin Panel** | Panel wewnętrzny do zarządzania klientami i systemem | React (Vite) |

## 2. Struktura monorepo

Yarn workspaces (bez Turborepo/Nx na start — dodamy cache buildów później, jeśli CI zacznie być wolne).

```
mizaly-app-v2/
├── apps/
│   ├── mobile/          # PWA — React + Vite + vite-plugin-pwa
│   ├── admin/           # Panel administracyjny — React + Vite
│   └── backend/         # Express.js API
├── packages/
│   └── shared/          # Wspólne typy TS, klient API, stałe (enum platform, itp.)
├── docker-compose.yml   # lokalny PostgreSQL do developmentu
├── package.json         # root — yarn workspaces
└── ROADMAP.md
```

`packages/shared` pozwala trzymać typy DTO (np. `Post`, `SocialAccount`, `User`) w jednym miejscu i importować je zarówno w mobile, admin, jak i backend.

## 3. Backend (Express.js)

> **Uwaga — zakres "posta na stronę":** publikacja na social media idzie normalnie przez integrację z Zernio (patrz niżej). Natomiast "Stwórz posta na stronę" na razie kończy się na zapisie artykułu w bazie danych (status: szkic/zaplanowany/opublikowany) — integracja z konkretnym CMS/stroną użytkownika (realna wysyłka "gdzie indziej") zostanie zaprojektowana później, patrz sekcja 6. Dzięki temu, że `WebsiteArticle` od początku ma docelowy kształt w bazie, podpięcie faktycznej dystrybucji ma być stosunkowo proste, gdy przyjdzie na to czas.

Odpowiedzialności:
- **Auth & multi-tenancy** — użytkownik należy do organizacji (workspace); każdy request skopowany po `organizationId`. JWT (access + refresh token). Logowanie e-mail + hasło (patrz sekcja 5 — magic link to późniejszy etap).
- **Warstwa proxy do Zernio** — mobile/admin nigdy nie rozmawiają z Zernio bezpośrednio; backend trzyma API keys i tokeny OAuth per-tenant, robi forward requestów i cache'uje odpowiedzi.
- **OAuth 2.1 + PKCE flow** — łączenie kont social media użytkownika przez Zernio.
- **CRUD dla treści** — API do tworzenia/edycji/listowania postów, reelsów i artykułów na stronę, wraz ze statusami i datami publikacji (fundament pod kalendarz).
- **Webhook receiver** — odbiera eventy od Zernio (nowe komentarze/DM, statusy publikacji) i pushuje do bazy oraz do klienta przez WebSocket.
- **Real-time wiadomości — Socket.IO** — Railway trzyma długo żyjący kontener (nie serverless), więc zwykły WebSocket/Socket.IO działa bez problemu; prościej niż SSE przy dwukierunkowej komunikacji (odbieranie nowych wiadomości + wysyłanie odpowiedzi), a jak w przyszłości backend będzie skalowany do wielu instancji, dokłada się Redis adapter. Rekomendacja: **Socket.IO**, jeden pokój (`room`) per organizacja.
- **Baza danych** — PostgreSQL + **Prisma** jako ORM. Lokalnie: PostgreSQL w Dockerze (`docker-compose.yml`), na produkcji: Railway Postgres plugin.
- **AI content generation** — endpoint generujący captions/hashtagi/pomysły przez **OpenAI API** (model do ustalenia przy implementacji, np. GPT-4o/GPT-4o-mini).
- **Trendy / analiza konkurencji (Inspiracje)** — na razie **placeholder / "Work in Progress"** — endpoint zwraca statyczną/pustą odpowiedź z informacją, że funkcja jest w budowie; docelowe źródło danych do ustalenia później.
- *(późniejszy etap)* **Integracja z własną stroną internetową użytkownika** — osobny, niezależny od Zernio kanał realnej publikacji artykułów (np. przez CMS API/webhook danego dostawcy strony) — do zaprojektowania po MVP, patrz sekcja 6.
- *(późniejszy etap)* **Wysyłka Magic Linków** — automatyczne generowanie i wysyłka e-mailem (wymaga SMTP/email providera) — na razie admin tworzy konta ręcznie z panelu i sam przekazuje dane logowania.
- *(późniejszy etap)* **Billing** — na razie brak, aplikacja darmowa. Stripe dojdzie później, gdy pojawi się model płatny.

### Szkic modelu danych (wysoki poziom)

- `Organization` (tenant) — nazwa, plan, limity
- `User` — należy do `Organization`, rola (owner/member)
- `SocialAccount` — połączone konto social media (przez Zernio), platforma, tokeny
- `Post` / `ScheduledPost` — treść (Heading, Treść, First comment), media, status, powiązane platformy (social, przez Zernio)
- `Reel` — wideo + tytuł + opis, publikowane na sociale przez Zernio
- `WebsiteArticle` — artykuł na stronę użytkownika, opcjonalnie powiązany z `Post` źródłowym (gdy tworzony "na podstawie" posta social media). **Na razie tylko zapis w bazie** (status szkic/zaplanowany/opublikowany) — bez realnej dystrybucji na stronę.
- `WebsiteIntegration` *(późniejszy etap)* — dane połączenia z CMS/stroną danego tenanta (endpoint, klucz API, typ platformy strony) — potrzebne dopiero, gdy dojdzie realna publikacja na stronę
- `InspirationItem` — zapisana inspiracja (link/treść źródłowa, tagi, notatka)
- `Conversation` / `Message` — ujednolicona skrzynka wiadomości (z Zernio engagement API)
- `AdminUser` — osobna rola do panelu administracyjnego

## 4. Mobile PWA — 4 zakładki

### 📌 Inspiracje
- **Trendujące treści** — 🚧 *Work in Progress* — placeholder w UI, docelowe źródło danych do ustalenia później (Zernio nie dostarcza tego wprost).
- **Analiza konkurencji** — 🚧 *Work in Progress* — placeholder w UI, jw.
- Tablica zapisanych inspiracji (użytkownik zapisuje znalezione treści na później) — to działa niezależnie od powyższych, można zrobić w MVP (zwykłe CRUD zapisanych linków/treści w bazie)

### ✍️ Tworzenie
Zakładka podzielona na 4 pod-sekcje:

1. **Kalendarz publikacji** — widok z datami u góry; po wybraniu dnia pokazuje posty opublikowane lub zaplanowane na ten dzień.
2. **Stwórz posta social media** — formularz: Heading, Treść, First comment, Zdjęcia. Publikacja/scheduling przez Zernio na wybrane platformy. *W kolejnym kroku*: generowanie treści przez AI (na podstawie promptu/inspiracji).
3. **Stwórz posta na stronę** — artykuł na własną stronę internetową użytkownika. Dwie ścieżki: (a) na podstawie istniejącego posta social media wygeneruj artykuł, (b) stwórz artykuł od zera. **Na razie: tylko zapis w bazie** — realna integracja z konkretnym CMS/stroną (żeby artykuł faktycznie się tam pojawił) to osobny, późniejszy etap (patrz sekcja 3 i 6).
4. **Dodaj Reelsa** — uproszczony flow: wgraj wideo, dodaj tytuł i opis, publikuj na sociale (przez Zernio).

### 📊 Analitykę
- Metryki per post i per konto (zasięgi, engagement, followersi) — dane z Zernio Analytics
- Porównanie platform / trendy w czasie

### 💬 Wiadomości
- Ujednolicona skrzynka komentarzy i DM ze wszystkich podłączonych platform (Zernio engagement API)
- Odpowiadanie z poziomu aplikacji

## 5. Panel administracyjny

- **Zarządzanie użytkownikami/klientami** — lista organizacji, użytkowników, plany, blokowanie kont
- **Dodawanie userów (MVP)** — admin ręcznie tworzy konto użytkownika (e-mail + hasło startowe albo hasło ustawiane od razu) z poziomu panelu; wysyłkę danych do logowania (docelowo Magic Link) admin robi na razie sam, poza systemem
- **Metryki biznesowe** — dashboard: aktywni użytkownicy, przychody, wykorzystanie limitów
- **Konfiguracja systemu** — zarządzanie integracją Zernio (globalne API keys, monitoring webhooków), ustawienia planów/limitów

### Auth — plan docelowy
Docelowo dwie ścieżki logowania: (1) samodzielna rejestracja e-mail + hasło, (2) Magic Link wysyłany przez admina z panelu. **Na start implementujemy tylko e-mail + hasło** (rejestracja/logowanie) — Magic Link (generowanie tokenu + automatyczna wysyłka e-mail) to późniejszy etap, wymaga integracji z providerem e-mail.

## 6. Ustalenia (zamknięte decyzje)

- ✅ ORM: **Prisma**
- ✅ Provider LLM: **OpenAI**
- ✅ Trendy/analiza konkurencji: **placeholder "Work in Progress"** na start
- ✅ Billing: **brak na razie**, aplikacja darmowa
- ✅ Real-time dla wiadomości: **Socket.IO**
- ✅ Hosting: **Railway** (mobile PWA, admin, backend, Postgres — wszystko na Railway)
- ✅ Auth: **e-mail + hasło** na start; Magic Link (wysyłany przez admina) — późniejszy etap
- ✅ Lokalna baza danych: **PostgreSQL w Dockerze** (`docker-compose.yml`)
- ✅ Integracja "posta na stronę": na razie tylko **zapis w bazie** (`WebsiteArticle`), bez realnej wysyłki

## 7. Otwarte decyzje / do zrobienia później

- [ ] Integracja "posta na stronę" — jaki system/CMS strony użytkownicy będą podłączać (WordPress? własny headless CMS? uniwersalny webhook?) — wpływa na kształt `WebsiteIntegration`
- [ ] Docelowe źródło danych do trendów/analizy konkurencji (Inspiracje)
- [ ] Provider e-mail do wysyłki Magic Linków, gdy ta funkcja zostanie zaimplementowana
- [ ] Model płatności/limity, gdy pojawi się billing

## 8. Zmienne środowiskowe (.env)

**Dostarczone:**
- `ZERNIO_API_KEY` — klucz API do Zernio (social media)
- `OPENAI_API_KEY` — klucz API do OpenAI (generowanie treści przez AI)

**Do dodania przy implementacji (nic dodatkowego z zewnątrz nie jest potrzebne, poza konfiguracją):**
- `DATABASE_URL` — connection string do PostgreSQL (lokalnie z Dockera, na Railway automatycznie z pluginu Postgres)
- `JWT_SECRET` / `JWT_REFRESH_SECRET` — do podpisywania tokenów auth (wygenerowane losowo, nie trzeba niczego zakładać)
- `ZERNIO_WEBHOOK_SECRET` — do weryfikacji podpisów webhooków od Zernio (pojawi się przy konfiguracji webhooka w dashboardzie Zernio, na etapie integracji)

**Później (nie teraz):**
- Provider e-mail (SMTP / np. Resend, Postmark) — dopiero gdy wdrożymy automatyczną wysyłkę Magic Linków
- Klucze Stripe — dopiero gdy pojawi się billing

Podsumowując: podane dwa klucze (Zernio + OpenAI) **wystarczą na start** — reszta zmiennych to rzeczy generowane/konfigurowane w trakcie budowy (sekrety, connection stringi), nie wymagają zakładania kont w dodatkowych serwisach na tym etapie.

## 9. Fazy prac (proponowana kolejność)

1. **Setup** — scaffold monorepo (yarn workspaces), `docker-compose.yml` z lokalnym Postgresem, Prisma, CI, środowiska (.env), konto testowe Zernio (sandbox), konfiguracja Railway
2. **Fundament** — auth e-mail+hasło + multi-tenancy w backendzie, szkielet admin panelu (logowanie + lista organizacji + dodawanie userów)
3. **Integracja Zernio** — OAuth PKCE flow łączenia kont social media, listowanie podłączonych kont
4. **Mobile MVP — Tworzenie** — kalendarz publikacji + kompozytor posta social media (z realną publikacją przez Zernio) + Reels + kompozytor posta na stronę (na razie tylko zapis `WebsiteArticle` w bazie, bez realnej wysyłki) — najważniejsza wartość produktu
5. **Tworzenie — AI generation** — generowanie treści postów przez OpenAI
6. **Analitykę** — pobieranie i wizualizacja metryk z Zernio
7. **Wiadomości** — ujednolicona skrzynka (Zernio engagement) + real-time przez Socket.IO
8. **Inspiracje** — tablica zapisanych inspiracji (CRUD) od razu; trendy i analiza konkurencji jako placeholder "Work in Progress" do czasu rozstrzygnięcia źródła danych
9. **Tworzenie — realna publikacja na stronę** — integracja z konkretnym CMS/stroną użytkownika, żeby zapisane `WebsiteArticle` faktycznie trafiały na stronę (po rozstrzygnięciu integracji)
10. **Panel admina — pełny zakres** — zarządzanie klientami, dashboard metryk, konfiguracja systemu
11. **Magic Link** — automatyczna wysyłka e-mailem, gdy dojdzie provider e-mail
12. **Billing** — dopiero gdy pojawi się model płatny
13. **Polish** — instalowalność PWA, offline support, push notifications, dopracowanie UX
14. **Launch prep**
