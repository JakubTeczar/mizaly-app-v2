# Mizaly App v2

Yarn workspaces monorepo: `apps/backend` (Express + TypeScript + Prisma + PostgreSQL), `apps/mobile` (Vite + React PWA, main client app), `apps/admin` (Vite + React, internal admin panel), `packages/shared` (TS types shared across all three). All UI copy is in Polish.

## Dokumentacja

Pełna dokumentacja projektu mieszka w [docs/](docs/) — zajrzyj tam po szerszy kontekst zanim zaczniesz coś większego:

- [docs/ROADMAP.md](docs/ROADMAP.md) — architektura, model danych, ustalone decyzje, fazy prac.
- [docs/Backlog.md](docs/Backlog.md) — rzeczy odłożone na później, znalezione w trakcie pracy.
- [docs/zernio-multi-key-per-organization-plan.md](docs/zernio-multi-key-per-organization-plan.md) — plan (niezaimplementowany) na zwiększenie limitu kont Zernio per organizacja.
- [docs/carousel-post-plan.md](docs/carousel-post-plan.md) — plan (niezaimplementowany) na edytor slajdów karuzeli w kompozytorze posta.

## Konwencje i gotchas

- **Nigdy nie używaj długiego myślnika "—"** w generowanej treści UI ani w promptach do LLM (np. `INTERVIEW_SYSTEM_PROMPT` w `apps/backend/src/routes/ai.ts`) — używaj przecinków/kropek. Jeśli piszesz prompt generujący tekst dla użytkownika, dodaj tę instrukcję wprost do promptu, żeby dotyczyła też modelu, nie tylko kodu pisanego ręcznie.
- **Dwa pliki `.env`**: backend faktycznie czyta `apps/backend/.env` (bo `dotenv/config` ładuje się względem cwd), nie root `.env`. Przy dodawaniu/zmianie zmiennych środowiskowych dla backendu, edytuj `apps/backend/.env`.
- **Zmiana `prisma/schema.prisma` wymaga restartu backendu przed `prisma migrate dev`/`prisma generate`** — na Windows `tsx watch` trzyma otwarty plik silnika zapytań Prisma (`query_engine-windows.dll.node`), więc `prisma generate` rzuci `EPERM` dopóki proces backendu nie zostanie zatrzymany. Objaw przy pominięciu tego kroku: wszystkie żądania autoryzowane zwracają mylące "Nieprawidłowy lub wygasły token" (prawdziwy błąd, Prisma P2022 "kolumna nie istnieje", jest łapany przez ogólny catch w `requireAuth.ts`).
- **Dane logowania seed** (`apps/backend/prisma/seed.ts`): panel admina `admin@mizaly.local` / `admin1234`, konto testowe `demo@mizaly.local` / `demo1234`.
- **Porty dev**: backend `4000`, mobile `5173`, admin `5174` (Vite dev servery, `yarn dev:backend` / `dev:mobile` / `dev:admin` z katalogu głównego).
- Ten monorepo **dostał swój pierwszy git commit dopiero 2026-07-09** — wcześniej nie miał żadnej historii. Uważaj z operacjami zakładającymi istniejące gałęzie/tagi w starszych rozmowach.
