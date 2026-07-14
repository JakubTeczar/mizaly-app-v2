# Plan: karuzele w kompozytorze posta (generowanie + publikacja)

> Status: **plan, nie zaimplementowane**. Rozwija punkt 2 z [Backlog.md](Backlog.md) ("Generowanie karuzeli") o konkretną architekturę, zmiany API i schemat DB.

## Punkt wyjścia — co już działa dzisiaj

Zanim projektować cokolwiek nowego, warto podkreślić: **publikacja karuzeli ze zdjęć już działa bez żadnej zmiany kodu**.

- `Post.mediaUrls` (`apps/backend/prisma/schema.prisma:122`) to już `String[]`, nie pojedynczy URL.
- `POST /:id/publish` (`apps/backend/src/routes/posts.ts:276-291`) buduje `mediaItems` ze **wszystkich** elementów `mediaUrls` i wysyła je do Zernio bez ograniczenia do jednego zdjęcia.
- `zernio.ts` (`ZernioMediaItem`/`ZernioPublishParams.mediaItems`, `zernio.ts:203-216`) jest generyczne — nie ma pojęcia "karuzela", po prostu przyjmuje tablicę mediów.
- Mobilny upload (`handlePhotosChange`, `PostSection.tsx:144-171`) już pozwala wybrać wiele zdjęć naraz i dopisuje wszystkie do `mediaUrls`.

Innymi słowy: użytkownik, który dziś doda 3 zdjęcia do posta i opublikuje na Instagram/LinkedIn, **już dostanie karuzelę** po stronie Zernio. To, czego brakuje, to punkt 2 z Backlogu: **edytor slajdów** — możliwość wygenerowania slajdów tekst+tło zamiast (albo obok) wgrywania gotowych zdjęć. Ten dokument projektuje tylko tę brakującą część.

## Architektura

Wzorzec 1:1 z tym, co już istnieje dla szablonu relacji (Instagram Story): `storyTemplate.ts` + `render.ts` (Puppeteer, `page.screenshot()`, HTML/CSS w repo) + `/api/posts/story-preview` do podglądu na żywo. Karuzela to ten sam pipeline z nowym szablonem HTML/CSS per slajd i rozmiarem 1080×1080 zamiast 1080×1920.

Kluczowa decyzja: **nie zmieniać ścieżki publikacji ani `mediaUrls`**. Wygenerowane slajdy trafiają do Cloudinary przez ten sam `/api/media/upload` co ręcznie wgrane zdjęcia i lądują w `mediaUrls` w tej samej kolejności co slajdy — z punktu widzenia publikacji to nieodróżnialne od dzisiejszego multi-upload. Jedyny nowy stan to **edytowalne źródło slajdów** (nagłówek/tekst/tło per slajd), żeby użytkownik mógł wrócić i poprawić karuzelę bez przebudowywania jej od zera z samych URL-i.

## Zmiany schematu DB

Minimalna, w pełni wsteczna zmiana — jedno nowe opcjonalne pole, istniejące posty (`carouselSlides: null`) zachowują się dokładnie jak dziś:

```prisma
model Post {
  // ...bez zmian...
  mediaUrls      String[]
  carouselSlides Json?   // null = zwykłe zdjęcia (dzisiejszy flow), niepuste = wygenerowana karuzela
}
```

`carouselSlides` to tablica obiektów `{ order: number; heading?: string; text?: string; backgroundImageUrl?: string }` — źródło prawdy do re-edycji; `mediaUrls` pozostaje "skompilowanym" wynikiem faktycznie wysyłanym do Zernio, dokładnie jak dziś.

## Zmiany API (`apps/backend`)

- `packages/shared/src/index.ts`: nowy typ `CarouselSlide`, `Post.carouselSlides?: CarouselSlide[] | null`.
- `media/carouselTemplate.ts` (nowy, analogiczny do `storyTemplate.ts`): `buildCarouselSlideHtml({ backgroundImageUrl?, heading?, text? })`.
- `media/render.ts:7`: `VIEWPORT` dziś jest sztywne (1080×1920) — sparametryzować `renderHtmlToJpeg(html, viewport = VIEWPORT)`, domyślna wartość zachowuje dzisiejsze wywołania (`renderStoryJpegBuffer` w `posts.ts`) bez zmian.
- `routes/posts.ts`:
  - `createPostSchema`/`updatePostSchema` (`posts.ts:19-27`): dopisać opcjonalne `carouselSlides`.
  - Nowy `POST /carousel-slide-preview` — lustro `/story-preview` (`posts.ts:156-170`), renderuje jeden slajd do `dataUrl`, bez zapisu do DB/Cloudinary.
  - `POST /:id/publish` (`posts.ts:231-357`) — **bez zmian**, patrz sekcja wyżej.

```ts
// routes/posts.ts — placeholder, analogiczne do storyPreviewSchema/handler powyżej
const carouselSlidePreviewSchema = z.object({
  backgroundImageUrl: z.string().optional(),
  heading: z.string().optional(),
  text: z.string().optional(),
});

router.post(
  "/carousel-slide-preview",
  asyncHandler(async (req, res) => {
    const data = carouselSlidePreviewSchema.parse(req.body);
    const html = buildCarouselSlideHtml(data);
    const buffer = await renderHtmlToJpeg(html, { width: 1080, height: 1080 });
    res.json({ dataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}` });
  })
);
```

## Przepływ UI (`PostSection.tsx`, sekcja "Zdjęcia")

- Przycisk "Wygeneruj karuzelę" obok istniejącego inputu plików, otwiera edytor slajdów w `Modal` (komponent już używany gdzie indziej).
- Lista slajdów: dodaj/usuń, pola nagłówek + tekst, opcjonalne zdjęcie tła (ten sam `fileToDataUrl`/`cropToSafeAspectRatio` co dziś); kolejność zmieniana strzałkami góra/dół (bez drag-and-drop na start, zgodnie z zakresem z Backlogu).
- Podgląd na żywo — ten sam wzorzec debounce co dzisiejszy `templatePreviewUrl` dla szablonu relacji (`PostSection.tsx:110-116`), tylko wołający `/carousel-slide-preview` per slajd.
- "Zapisz karuzelę": renderuje + uploaduje każdy slajd (pętla po `/carousel-slide-preview` → `/api/media/upload`, identycznie jak `handlePhotosChange`), dopisuje wynikowe URL-e do `mediaUrls`/`photoPreviews` i zapisuje surowe slajdy w nowym stanie `carouselSlides`, żeby ponowne otwarcie edytora odtwarzało treść zamiast zaczynać od zera.
- Reszta formularza (wybór platform, harmonogram, publikacja) — bez zmian.

## Świadomie poza zakresem

Prawdziwe wielostronicowe dokumenty LinkedIn (PDF przez `page.pdf()`) — inny typ treści w Zernio, niepotrzebny do standardowej karuzeli zdjęciowej na IG/LinkedIn/Facebook feed. Patrz też punkt 1 Backlogu (dynamiczne wymiary per platforma) — sparametryzowanie `VIEWPORT` powyżej to pierwszy krok w tamtą stronę, robiony tu tylko w zakresie potrzebnym karuzeli (1080×1080).
