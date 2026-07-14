# Mizaly App v2

Monorepo: `apps/backend` (Express + Prisma), `apps/mobile` (PWA), `apps/admin` (panel administracyjny). Pełny opis w [docs/ROADMAP.md](docs/ROADMAP.md).

## Dokumentacja

Cała dokumentacja projektu (poza tym plikiem) mieszka w [docs/](docs/):

- [docs/ROADMAP.md](docs/ROADMAP.md) — architektura, model danych, fazy prac.
- [docs/Backlog.md](docs/Backlog.md) — rzeczy odłożone na później, znalezione w trakcie pracy.
- [docs/zernio-multi-key-per-organization-plan.md](docs/zernio-multi-key-per-organization-plan.md) — plan rozszerzenia limitu kont Zernio per organizacja (niezaimplementowany).

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
