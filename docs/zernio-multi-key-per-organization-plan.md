# Plan: więcej niż 2 konta Zernio na organizację (wiele kluczy API na organizację)

> Status: **plan, nie zaimplementowane**. Spisane 2026-07-09 po analizie feasibility, w odpowiedzi na pytanie „jak trudne będzie zwiększenie limitu z 2 do 4 kont dla jednej organizacji".

## Kontekst i obecne ograniczenie

Zernio ogranicza każdy klucz API do **2 podłączonych kont** social media. Dziś platforma obsługuje to tak:

- `User.zernioApiKeyId` (Prisma) — każdy user ma przypisany jeden klucz Zernio (id odnoszące się do zmiennej środowiskowej `ZERNIO_API_KEY` / `ZERNIO_API_KEY_<n>`, zob. `apps/backend/src/integrations/zernioApiKeys.ts`).
- `apps/backend/src/routes/admin.ts`, `assertZernioApiKeySlotAvailable` — blokuje przypisanie **trzeciego** usera do tego samego klucza.
- `Organization.zernioProfileId` (Prisma) — **jedno** pole, tworzone leniwie przy pierwszym użyciu (`apps/backend/src/integrations/zernioProfile.ts`, `ensureZernioProfileId`) i **trwale przypięte** do klucza, który je stworzyło.
- Każde wywołanie Zernio (connect/list/publish/analytics/delete) bierze klucz z `resolveZernioApiKey(req.user.zernioApiKeyId)` — czyli z zalogowanego użytkownika robiącego request, nie z konkretnego konta.

**Efekt:** obecny mechanizm pozwala rozdzielać różne **organizacje/klientów** pomiędzy różne klucze (każda organizacja nadal max 2 konta), ale nie pozwala **jednej** organizacji przekroczyć limitu 2 kont przez łączenie kluczy — `zernioProfileId` organizacji jest przypięty do jednego klucza na stałe, więc próba użycia drugiego klucza dla tej samej organizacji skończy się błędem 403/404 po stronie Zernio (profil nie istnieje w przestrzeni drugiego klucza).

## Cel

Pozwolić jednej organizacji korzystać z **wielu** kluczy Zernio jednocześnie, tak żeby limit kont rósł proporcjonalnie (2 klucze = 4 konta, 3 klucze = 6 kont itd.).

## Co trzeba zmienić

### 1. Model danych (Prisma)

- Nowy model łączący organizację z kluczami, których używa, np.:
  ```prisma
  model OrganizationZernioProfile {
    id             String @id @default(cuid())
    organizationId String
    organization   Organization @relation(fields: [organizationId], references: [id])
    zernioApiKeyId String        // "1", "2", ... - id z zernioApiKeys.ts, nie sekret
    zernioProfileId String       // profil Zernio utworzony pod TYM kluczem

    @@unique([organizationId, zernioApiKeyId])
  }
  ```
  Zastępuje dzisiejsze pojedyncze pole `Organization.zernioProfileId` (do usunięcia po migracji danych).
- `SocialAccount` potrzebuje nowego pola `zernioApiKeyId: String` — które konto, którym kluczem zostało podłączone. Bez tego nie da się wiedzieć, którego klucza użyć przy publikacji/analityce/usuwaniu danego konta.
- Przypisanie kluczy przenosi się z `User.zernioApiKeyId` (jeden klucz na usera) na relację organizacja-klucze (jedna organizacja może mieć wiele kluczy przypisanych, np. tabela `OrganizationZernioApiKeyAssignment` albo prościej: lista w polu `String[]` na `Organization`, jeśli nie potrzeba dodatkowych metadanych).

### 2. Limit 2 kont na klucz - zmiana sposobu liczenia

Dzisiejsze `assertZernioApiKeySlotAvailable` liczy **userów** przypisanych do klucza — to tylko przybliżenie prawdziwego ograniczenia Zernio. Po zmianie limit powinien liczyć **faktycznie podłączone konta** (`SocialAccount` z danym `zernioApiKeyId`) w całym systemie, niezależnie od organizacji - to dokładniejsze odwzorowanie realnego limitu Zernio.

### 3. `ensureZernioProfileId` → `ensureZernioProfileId(organizationId, zernioApiKeyId, apiKeySecret)`

Zamiast jednego cache'owanego id, funkcja musi znaleźć/utworzyć profil **per (organizacja, klucz)** - patrząc w nowej tabeli `OrganizationZernioProfile`, nie w jednym polu na `Organization`.

### 4. Flow podłączania konta (`socialAccounts.ts`)

- `POST /connect` musi przyjąć, **którego** z przypisanych organizacji kluczy użyć (jeśli organizacja ma więcej niż jeden), zamiast domyślnie brać klucz zalogowanego usera.
- Trzeba dodać wybór klucza w UI strony "Konta" (`apps/mobile/src/pages/KontaPage.tsx`), gdy organizacja ma więcej niż jeden przypisany klucz - np. prosty select przy przycisku "Połącz platformę", pokazujący ile miejsc zostało na każdym kluczu.
- `GET /` (lista kont) i `DELETE /:id` muszą rozwiązywać klucz **per-konto** (z `SocialAccount.zernioApiKeyId`), nie globalnie z użytkownika.

### 5. Publikacja i analityka (`posts.ts`, `analytics.ts`)

- Publikacja posta na wiele platform może teraz wymagać **osobnych wywołań Zernio dla różnych kluczy** (jeśli konta docelowych platform są podłączone różnymi kluczami) - trzeba pogrupować `platformsPayload`/`mediaItems` po kluczu i wykonać osobne wywołanie `zernio.createZernioPost` per grupa, zamiast jednego wywołania z jednym kluczem.
- Analityka (`analytics.ts`) musi zsumować dane z **wszystkich** kluczy przypisanych do organizacji, nie tylko jednego.

### 6. Panel administracyjny (`apps/admin`)

- Zmiana z "przypisz klucz do użytkownika" (select per user w `OrganizationsPage.tsx`) na "przypisz zestaw kluczy do organizacji" (multi-select albo checkboxy per organizacja).
- Widok powinien pokazywać, ile kont zajmuje organizacja na każdym z przypisanych kluczy (np. "Klucz 1: 2/2, Klucz 2: 1/2").

## Ryzyka / rzeczy do przemyślenia przed startem

- **Migracja istniejących danych**: dzisiejsze `Organization.zernioProfileId` + `User.zernioApiKeyId` trzeba przepisać na nowy model bez utraty już podłączonych kont (organizacje mające dziś 1-2 konta pod jednym kluczem powinny dostać jeden wiersz w `OrganizationZernioProfile` odpowiadający ich obecnemu stanowi).
- **UX wyboru klucza przy connect** - dla organizacji z jednym kluczem nic się nie zmienia (wybór niepotrzebny, domyślny); dopiero przy drugim kluczu pojawia się decyzja, którego użyć - warto to zaprojektować tak, żeby nie komplikować prostego przypadku (1 organizacja = 1 klucz, wciąż najczęstszy).
- **Grupowanie wywołań publikacji per klucz** to najbardziej inwazyjna zmiana w `posts.ts` - warto dobrze przetestować przypadek "post na 3 platformy, konta rozrzucone na 2 klucze".

## Szacowana skala pracy

Średnia/duża zmiana - dotyka schematu Prisma, całej integracji Zernio (`zernioProfile.ts`, `socialAccounts.ts`, `posts.ts`, `analytics.ts`), panelu admina i strony Konta w mobile. Dobrze zrozumiana, bez niewiadomych technicznych - realna do zrobienia w jednym skupionym podejściu, ale nie jest to mała, izolowana poprawka.
