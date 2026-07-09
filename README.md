# Mizaly App v2

Monorepo: `apps/backend` (Express + Prisma), `apps/mobile` (PWA), `apps/admin` (panel administracyjny). Pełny opis w [ROADMAP.md](ROADMAP.md).

## Wymagania

- Node.js 20+
- Yarn (`npm install -g yarn`, jeśli nie masz)
- Docker Desktop (uruchomiony)

## 1. Instalacja zależności

```bash
yarn install
```

## 2. Zmienne środowiskowe

Skopiuj `.env.example` do `.env` w katalogu głównym oraz w `apps/backend`, uzupełnij:

```
ZERNIO_API_KEY=...
OPENAI_API_KEY=...
JWT_SECRET=...          # dowolny losowy string
JWT_REFRESH_SECRET=...  # dowolny losowy string
```

`DATABASE_URL` jest już ustawione na lokalny Docker (port **5433** — 5432 bywa zajęty przez inne kontenery).

## 3. Baza danych (Docker)

```bash
yarn db:up
```

Następnie w `apps/backend`:

```bash
npx prisma migrate dev
npx tsx prisma/seed.ts
```

Seed tworzy konta testowe:
- Panel admina: `admin@mizaly.local` / `admin1234`
- Konto testowe: `demo@mizaly.local` / `demo1234`

## 4. Uruchomienie aplikacji

W trzech osobnych terminalach (z katalogu głównego):

```bash
yarn dev:backend   # http://localhost:4000
yarn dev:mobile    # http://localhost:5173
yarn dev:admin     # http://localhost:5174
```

## Zatrzymanie bazy danych

```bash
yarn db:down
```
