# Backlog

> Rzeczy zidentyfikowane w trakcie pracy, odłożone na później. Nie jest to plan sprintu — kolejność poniżej nie oznacza priorytetu, chyba że zaznaczono inaczej.

## 1. Dynamiczne dopasowanie szablonów graficznych posta do wymiarów per platforma

Szablony graficzne posta (`storyTemplate` — "Nowy post" / "Seria", zob. `apps/backend/src/media/storyTemplate.ts` + select w `PostSection.tsx`) są dziś renderowane w sztywnym rozmiarze 1080×1920 (format Instagram Story) — sztywny `VIEWPORT` w `apps/backend/src/media/render.ts` i sztywne `width`/`height` w `templates/story.css`. To nie są szablony ograniczone do relacji (Stories) — to ogólne szablony graficzne do posta, dziś po prostu używane też do wersji na relację.

Docelowo: każda platforma (Instagram, LinkedIn, Facebook itd.) ma swoje zalecane/wymagane proporcje zdjęcia, które różnią się między sobą (np. Instagram Story wysoki pionowy format, LinkedIn niższy). Skoro szablon to zwykły HTML/CSS renderowany do obrazka przez Puppeteer, da się to zrobić dynamicznie:

- [ ] Zebrać/zdefiniować tabelę zalecanych szerokości i wysokości zdjęć dla każdej obsługiwanej platformy.
- [ ] Sparametryzować `VIEWPORT` w `render.ts` (obecnie stały obiekt) tak, żeby renderer przyjmował rozmiar docelowy jako argument zamiast stałej.
- [ ] Layout szablonu (`story.html`/`story.css`) ma dynamicznie dopasowywać się do zmiennej wysokości — teksty na górze (`header`) i na dole (`main-text`, `descriptionBox`) muszą się przesuwać/skalować proporcjonalnie, a nie być po prostu przycinane, gdy wysokość się zmienia.
- [ ] UI: prawdopodobnie trzeba będzie renderować osobny obrazek na platformę (jeśli post idzie na kilka platform naraz), a nie jeden uniwersalny.

Kontekst: wypłynęło przy budowie funkcji wyboru szablonu graficznego posta (2026-07-07) — na razie zostawiamy jeden sztywny format, temat wraca przy rozszerzaniu szablonów o kolejne platformy.

**Research: Canva Connect API jako alternatywa (2026-07-10)** — patrz sekcja "Research: Canva Connect API" w punkcie 2 poniżej (ten sam API dotyczy obu punktów, 1 i 2). Wniosek w skrócie: **niewart zachodu na obecną skalę** — funkcja, która realnie zastąpiłaby własny pipeline (Autofill, czyli programistyczne generowanie grafik z szablonu), wymaga żeby użytkownik, na którego konto działa integracja, był członkiem organizacji **Canva Enterprise** (custom pricing, realnie $20-50k/rok, zwykle od 50+ miejsc) — nie do udźwignięcia i nie do przełożenia na pojedynczych klientów Mizaly. Zostajemy przy własnym renderze (Puppeteer + HTML/CSS).

## 2. Generowanie karuzeli (post wieloslajdowy na Instagram/LinkedIn)

Pomysł: przy dodawaniu zdjęć w kompozytorze posta ("Zdjęcia") dodać opcję "Wygeneruj karuzelę" — edytor slajdów (dodawanie/usuwanie slajdów, tekst nagłówek+treść per slajd, na razie tylko tekst + ewentualnie zdjęcie jako tło), z podglądem na żywo, jak karuzela będzie wyglądać w poście.

Ustalenia z researchu feasibility (2026-07-07):
- Renderowanie: da się w pełni oprzeć na istniejącym pipeline `render.ts` + wzorcu z `storyTemplate.ts` (nowy szablon HTML/CSS per slajd, sparametryzowany viewport, np. 1080×1080).
- Publikacja: **już działa** — `post.mediaUrls` to tablica, a handler publikacji (`apps/backend/src/routes/posts.ts`, budowa `mediaItems`) wysyła do Zernio wszystkie elementy tej tablicy bez ograniczenia do jednego zdjęcia. Wystarczy, że `mediaUrls` będzie mieć więcej niż jeden URL.
- Upload: mobilny flow (`handlePhotosChange` w `PostSection.tsx`) już zapisuje wiele zdjęć do `mediaUrls` przez ten sam `/api/media/upload` — wygenerowane slajdy mogą iść tym samym torem.
- Świadomie poza zakresem na start: prawdziwy PDF (jak dokumenty LinkedIn) — Puppeteer wspiera `page.pdf()`, ale dziś renderer robi tylko `page.screenshot()`; to osobna, trudniejsza funkcja, do rozważenia później, jeśli będzie potrzebna.

- [ ] Zaprojektować i zaimplementować edytor slajdów w `PostSection.tsx` (przycisk "Wygeneruj karuzelę" przy sekcji Zdjęcia).
- [ ] Nowy szablon HTML/CSS per slajd (tekst góra/dół + opcjonalne tło) analogiczny do `story.html`/`story.css`.
- [ ] Endpoint renderujący pojedynczy slajd do obrazka (analogicznie do `/api/posts/story-preview`), wynik wpychany do `mediaUrls` tym samym `/api/media/upload`.
- [ ] Podgląd na żywo całej karuzeli (kolejność slajdów, przełączanie).

Pełny plan architektury (schemat DB, zmiany API, przepływ UI) rozpisany w [docs/carousel-post-plan.md](carousel-post-plan.md) (2026-07-13).

### Research: Canva Connect API jako alternatywa dla własnego renderera (2026-07-10)

User zauważył, że Canva ma publiczne API z szablonami — sprawdzone pod kątem zastąpienia własnego pipeline'u `render.ts` (Puppeteer) zarówno dla dynamicznych rozmiarów per platforma (punkt 1), jak i generowania karuzeli (ten punkt). Źródło: oficjalna dokumentacja [Canva Connect APIs](https://www.canva.dev/docs/connect/) (`www.canva.dev/docs/connect/`) — [Autofill guide](https://www.canva.dev/docs/connect/autofill-guide/), [Resizes](https://www.canva.dev/docs/connect/api-reference/resizes/), [Exports](https://www.canva.dev/docs/connect/api-reference/exports/), [Create design](https://www.canva.dev/docs/connect/api-reference/designs/create-design/), [Brand template dataset](https://www.canva.dev/docs/connect/api-reference/brand-templates/get-brand-template-dataset/). Context7 MCP nie było podłączone w tej sesji, więc research zrobiony przez WebSearch/WebFetch bezpośrednio na dokumentację Canva.

**Co Canva Connect API realnie oferuje:**
- **Autofill** — jedyna funkcja, która odpowiadałaby temu, co dziś robi `render.ts`: programistyczne wygenerowanie gotowej grafiki z szablonu ("Brand Template") na podstawie podanych danych (pola typu `text`, `image`, `chart`). Flow: pobrać dataset szablonu (jakie pola można wypełnić) → wysłać dane jako asynchroniczny "autofill job" → pollować aż gotowe → pobrać wygenerowany design. Osadzone obrazy trzeba wcześniej wgrać przez osobny endpoint (`asset-uploads`) — **zewnętrzne URL-e obrazków nie są wspierane**, trzeba przesłać plik.
- **Multi-page / karuzele — wygląda na wykonalne**: eksport designu wielostronicowego pozwala wybrać strony do eksportu; jeśli format nie wspiera wielu stron (np. PNG/JPG), wynik to ZIP z osobnym plikiem per strona — czyli dokładnie to, czego trzeba dla karuzeli (osobny obrazek per slajd). Nazwy pól w dataset nie są przypisane do konkretnej strony (płaska lista kluczy), co sugeruje, że pola z różnych stron szablonu wielostronicowego mogą być wypełnione jednym wywołaniem autofill — niepotwierdzone wprost w dokumentacji, ale spójne z tym, że Canva reklamuje Autofill do generowania całych "pitch decków" (z natury wielostronicowych).
- **Resize** — osobne API, tworzy nową kopię istniejącego designu w innym rozmiarze (asynchroniczny job, max 25 mln pikseli²). To odpowiadałoby punktowi 1 (dopasowanie do wymiarów platformy), ale zakłada, że design już istnieje w Canvie — nie generuje go od zera z danych.
- **Tworzenie/edycja niskopoziomowa** — Connect API **nie ma** endpointów do dodawania/duplikowania stron ani edycji elementów wewnątrz designu poza Autofill. Cała logika układu musi siedzieć w szablonie zaprojektowanym ręcznie w edytorze Canvy, nie w kodzie — przeciwieństwo dzisiejszego podejścia (HTML/CSS w repo, pełna kontrola przez kod).

**Wymagania dostępu / koszt (kluczowy wniosek):**
- Samo budowanie integracji z Connect API jest darmowe, ale **funkcje są bramkowane planami Canvy dla konta, na które działa integracja** (nie ma osobnego cennika "per API call"):
  - **Resize** wymaga, żeby użytkownik był na planie z funkcjami premium (Canva Pro wystarczy, ~$15/mies./użytkownika).
  - **Autofill (Brand Templates)** wymaga, żeby użytkownik był członkiem organizacji **Canva Enterprise** — a Enterprise to indywidualnie negocjowana cena, w praktyce **$20 000–$50 000/rok** (mediana ok. $13 300/rok wg danych z realnych zakupów), zwykle od 50+ miejsc, sprzedawane przez kontakt z działem sprzedaży, nie samoobsługowo.
  - To oznacza, że żeby Mizaly (albo — jeśli integracja miałaby działać per-klient — każdy klient Mizaly) mógł automatycznie generować grafiki z szablonu przez API, musiałby mieć konto Canva Enterprise. Nierealne zarówno dla samego Mizaly na tę skalę, jak i tym bardziej dla pojedynczych klientów (małe firmy/twórcy).

**Wniosek:** Canva Connect API **nie zastępuje** dzisiejszego pipeline'u `render.ts` w sposób opłacalny — jedyna funkcja dająca w pełni automatyczne generowanie z danych (Autofill) jest zamknięta za Enterprise. Zostajemy przy własnym rozwiązaniu (Puppeteer + HTML/CSS) opisanym w punktach 1 i 2 wyżej — jest darmowe, w pełni kontrolowane przez kod, i już częściowo zaimplementowane (research feasibility z 2026-07-07 powyżej).

- [x] Zbadać Canva Connect API (Autofill/Resize/Export) jako alternatywę — odrzucone, patrz uzasadnienie wyżej (2026-07-10).

### Przebudowa na edytor canvas (react-konva) + zgłoszony bug uploadu zdjęcia (2026-07-16)

User zgłosił, że wygenerowane slajdy karuzeli "wyglądają dość mocno średnio" — jeden na trwałe zaszyty design (ciemne tło, jedna czcionka, tekst zawsze na środku, `templates/carousel.html`/`.css`). Po researchu opcji (SaaS z gotowymi szablonami jak Bannerbear/Placid/Templated, Canva Autofill, biblioteki canvas open-source) i doprecyzowaniu wymagań, zdecydowano zastąpić cały pipeline Puppeteer+HTML/CSS dla karuzeli prawdziwym edytorem: własne zdjęcie jako tło (bez kadrowania w v1) + tekst swobodnie przesuwany/skalowany (jak mini-Canva), eksport obrazka po stronie klienta (`stage.toDataURL()`), bez ponownego renderu na serwerze.

Zaimplementowane:
- **Biblioteka**: [Konva.js](https://konvajs.org/) przez `react-konva` (+ `use-image`) — MIT, self-hosted, wybrana m.in. dlatego że ma natywne renderowanie po stronie Node.js (przydatne, gdyby kiedyś trzeba było wrócić do renderu serwerowego).
- **Model danych** (`packages/shared`): `CarouselSlide.heading/text` → `CarouselSlide.textLayers: CarouselTextLayer[]` (`id, content, x, y, width, fontSize, fontFamily, color, align`), współrzędne w stałej przestrzeni 1080×1080 (`MODEL_SIZE`), niezależnej od faktycznego rozmiaru canvasu na ekranie (`useContainerWidth` + `scale`).
- **`CarouselSlideEditor.tsx`** przepisany od zera: `<Stage>`/`<Layer>` per slajd, zdjęcie w tle (`SlideBackgroundImage`, center-crop do kwadratu), warstwy tekstu z `draggable` + `Transformer` (uniform scale przez `keepRatio` — unika zniekształcenia glifów), edycja treści przez nakładkę `<textarea>` (dwuklik), mini-toolbar (kolor, czcionka: Montserrat/Bebas Neue/Gantari — te same fonty co reszta apki, żadnych nowych plików fontów).
- **Backend**: usunięty `carouselTemplate.ts`, `templates/carousel.html`/`.css`, endpoint `/api/posts/carousel-slide-preview` — karuzela nie dotyka już Puppeteera, tylko zapisuje JSON layoutu (zod schema zaktualizowana w `routes/posts.ts`).
- **Bundle**: Konva dodaje ~280KB do JS — `CarouselSlideEditor` doładowywany leniwie (`React.lazy` + `Suspense`) w `PostSection.tsx`, więc koszt płaci tylko ten, kto faktycznie otworzy edytor karuzeli.
- **Znaleziony i naprawiony bug w trakcie budowy**: nakładka do edycji tekstu (`<textarea>`) czytała pozycję z referencji do węzła Konva (`ref.x()/.y()`) — dla nowo dodanej warstwy ten ref jeszcze nie był podpięty w momencie renderu (refy podłączają się po commicie, nie w trakcie renderu), więc nakładka nigdy się nie pojawiała. Naprawione przez czytanie pozycji z modelu danych (`selectedLayer.x/y`), nie z węzła canvasu — model jest i tak źródłem prawdy (aktualizowany przez `onDragEnd`/`onTransformEnd`).
- **Zweryfikowane end-to-end przez Playwright** (upload zdjęcia tła, dodanie tekstu, edycja treści, zapis) — zero błędów w konsoli, eksportowany slajd trafia do `mediaUrls` i pojawia się jako miniatura w kompozytorze.

**Zgłoszony bug do zbadania (2026-07-16, koniec sesji)**: User zgłosił, że "wgrywanie zdjęcia nie działa" przy dodawaniu zdjęć do karuzeli — zgłoszone tuż po tym, jak automatyczny test (Playwright, plik testowy `icon-512.png`, jeden slajd) przeszedł bez błędów i zdjęcie renderowało się poprawnie.

**Znaleziona przyczyna i naprawa (2026-07-16)** — trasowanie całej ścieżki uploadu (`CarouselSlideEditor.tsx` → `/api/media/upload` → Cloudinary) wykazało dwa realne braki, oba różne od tego, co pokrywał test z `icon-512.png`:
- `handleBackgroundChange` (`CarouselSlideEditor.tsx`) wysyłał surowy `dataUrl` z `fileToDataUrl` bez żadnego kroku dekodowania/normalizacji — w przeciwieństwie do działającego uploadu zdjęć w `PostSection.handlePhotosChange`, który przepuszcza każde zdjęcie przez `cropToSafeAspectRatio` (realny `<img>` + canvas). Realne zdjęcie z telefonu w formacie, którego przeglądarka nie umie zdekodować (np. HEIC z iPhone'a), wgrywało się na serwer bez błędu i psuło się dopiero później, przy próbie wyświetlenia.
- `SlideBackgroundImage` odczytywał z `useImage()` tylko `image`, ignorując drugi element zwracanej pary (`status: "loading" | "loaded" | "failed"`) — nieudane wczytanie obrazu (błędny format, uszkodzony plik, problem sieciowy) nie dawało żadnego komunikatu, konsoli, ani UI — komponent po prostu renderował `null`.
- Naprawione: dodana `normalizeToJpeg()` w `apps/mobile/src/lib/imageCrop.ts` (dekoduje przez `<img>`, re-enkoduje do JPEG przez canvas, bez przycinania — przycięcie do kwadratu robi już `SlideBackgroundImage` przez Konva `crop`), wywoływana w `handleBackgroundChange` przed uploadem — niezdekodowalny plik teraz rzuca błąd widoczny w UI od razu, przy uploadzie, a nie później. `SlideBackgroundImage` odczytuje teraz `status` i przez nowy prop `onLoadError`/`onBackgroundError` zgłasza błąd do `SlideRowCard`, który wyświetla go w istniejącym `error-text`.
- Typecheck mobile przechodzi. **Nie zweryfikowane end-to-end w przeglądarce z prawdziwym plikiem HEIC** (brak takiego pliku pod ręką w tej sesji) — do potwierdzenia przy najbliższej okazji z realnym zdjęciem z telefonu.

**Naprawa HEIC (2026-07-19)**: powyższa naprawa tylko ujawniała błąd wcześniej, nie usuwała przyczyny - HEIC/HEIF z iPhone'a nie da się zdekodować przez `<img>`/canvas w żadnej przeglądarce poza Safari, więc realne zdjęcia z telefonu wciąż odrzucało. Dodany `heic2any` (dekoder WASM, dociągany dynamicznym importem tylko gdy plik faktycznie jest HEIC/HEIF, żeby nie obciążać wszystkich bundlem ~340KB gzip) w `fileToDataUrl` (`apps/mobile/src/lib/imageCrop.ts`) - konwertuje do JPEG zanim dojdzie do `cropToSafeAspectRatio`/`normalizeToJpeg`. Naprawia to zarówno zdjęcia tła karuzeli, jak i zwykłe zdjęcia posta (`PostSection.handlePhotosChange`), bo oba wołają `fileToDataUrl`. Typecheck + `vite build` przechodzą. **Nie zweryfikowane end-to-end w przeglądarce z prawdziwym plikiem HEIC.**

**Dodane wstawki zdjęciowe (2026-07-19)**: nowy typ warstwy, `CarouselImageLayer` (`packages/shared/src/index.ts`) - `id/url/x/y/width/height`, obok istniejących `textLayers`. Dodane pole `imageLayers: CarouselImageLayer[]` do `CarouselSlide` (backend: `carouselImageLayerSchema` w `routes/posts.ts`). W `CarouselSlideEditor.tsx`: przycisk "+ Dodaj zdjęcie" w toolbarze kanwy (obok "+ Dodaj tekst"), upload przez ten sam `fileToDataUrl` co tło (więc też obsługuje HEIC), ale bez `normalizeToJpeg` - nowa `readImageDimensions()` w `imageCrop.ts` tylko dekoduje i zwraca wymiary, zachowując oryginalny format/przezroczystość (ważne dla wyciętych zdjęć produktowych na przezroczystym tle, tak jak w przykładzie od użytkownika - białe pudełko ze zdjęciem produktu, nie zdjęcie na całe tło). Domyślny rozmiar 420px szerokości z zachowaniem proporcji, wyśrodkowany. Selekcja/Transformer uogólnione do obsługi obu typów warstw (tekst i zdjęcie) przez wspólny `selectedId` i dwie mapy refów. Przycisk tła przemianowany na "Dodaj/Zmień zdjęcie tła" dla odróżnienia od nowego przycisku. Typecheck + `vite build` (mobile/backend/admin) przechodzą.

**Dodany slajd zamykający karuzeli per organizacja (2026-07-19)**: admin może teraz skonfigurować per organizacja (klient) stały ostatni slajd karuzeli - zdjęcie tła + dwa teksty (góra/dół) - automatycznie dodawany do każdej **nowej** karuzeli, usuwalny jak każdy inny slajd (przycisk „×”), oba teksty zostają zwykłymi, edytowalnymi warstwami tekstu w edytorze.
- Prisma: `Organization.closingSlideBackgroundUrl/closingSlideTopText/closingSlideBottomText` (migracja `20260719125257_add_organization_closing_slide_template`).
- Admin (`OrganizationsPage.tsx`): nowy przycisk „Slajd zamykający” obok „Kontekst AI” - modal z uploadem zdjęcia (`POST /api/admin/organizations/:id/closing-slide-background`, wymusza `format: "jpg"` przez Cloudinary, żeby wynikowy URL zawsze dał się zdekodować w przeglądarce niezależnie od tego, co admin wgra, np. HEIC) i dwoma polami tekstowymi (zapis przez rozszerzony `PATCH /api/admin/organizations/:id`).
- Nowy endpoint `GET /api/organizations/me` (`routes/organizations.ts`, zwykła auth usera, nie admina) - jedyny sposób, w jaki mobile czyta cokolwiek o własnej organizacji; na razie zwraca tylko pola slajdu zamykającego.
- Mobile (`CarouselSlideEditor.tsx`): przy **całkiem nowej** karuzeli (`initialSlides.length === 0`, sprawdzane raz przy montowaniu) dociąga szablon i dokleja go jako slajd na końcu (`createClosingSlide`). „+ Dodaj slajd” wstawia nowe slajdy PRZED przypięty slajd zamykający (nie na koniec), dopóki użytkownik go nie usunie - śledzone przez `closingSlideRowIdRef`, nie przez pole w modelu danych. Ponowna edycja zapisanej karuzeli nigdy nie dociąga/wstrzykuje go ponownie (byłby to już zwykły slajd w `initialSlides`).
- Typecheck + `vite build`/`tsc` (mobile/backend/admin) przechodzą. **Nie zweryfikowane end-to-end w przeglądarce** (upload w adminie, automatyczne dodanie w nowej karuzeli, kolejność po dodaniu kolejnych slajdów, usunięcie i przywrócenie zwykłego zachowania „+ Dodaj slajd”).

Wciąż otwarte:
- [ ] Zweryfikować naprawę HEIC z prawdziwym zdjęciem z iPhone'a (upload tła karuzeli i zwykłego zdjęcia posta) - potwierdzić, że się wgrywa i wyświetla poprawnie.
- [ ] Zweryfikować nową funkcję wstawek zdjęciowych end-to-end w przeglądarce (dodanie, przeciąganie, resize, usuwanie, eksport slajdu z wstawką).
- [ ] Zweryfikować slajd zamykający end-to-end (upload w adminie, nowa karuzela w mobile, dodawanie/usuwanie slajdów, zapis i ponowna edycja).
- [ ] Sprawdzić upload w kontekście dotyku (mobile), nie tylko myszką/desktopem — `input[type=file]` na realnym telefonie może się zachowywać inaczej.
- [ ] Dociągnąć testy drag/resize tekstu przez Playwright (przerwane w trakcie tej sesji przez timeout logowania przy kolejnym uruchomieniu skryptu, nieprzebadane do końca) — funkcjonalnie kod wygląda poprawnie (ten sam wzorzec co w naprawionym buggu wyżej), ale warto potwierdzić automatycznie, nie tylko wizualnie.

## 3. Przegląd UX-owy panelu tworzenia posta

Panel "Stwórz posta social media" (`PostSection.tsx`) urósł organicznie (AI szybkie/dokładne, szablon relacji + nazwa serii, pierwszy komentarz z podpowiedzią, zdjęcia z podpowiedzią o przycinaniu, platformy, itd.) i robi się przeładowany — dużo etykiet/podpowiedzi na raz, łatwo się pogubić.

- [x] Przegląd całego formularza pod kątem hierarchii informacji, co użytkownik musi widzieć zawsze, a co może być domyślnie zwinięte/ukryte (np. za "Zaawansowane", collapsible, tooltipy zamiast stałego tekstu pod polem).
- [x] Rozważyć pogrupowanie sekcji (np. treść / media / dystrybucja) zamiast jednego długiego formularza.
- [x] Skrócić/ograniczyć liczbę stale widocznych `hint-text`, część z nich może być tooltipem albo pokazywać się tylko w kontekście (np. błędu, pierwszego użycia).

Kontekst: zgłoszone przy okazji dodawania kolejnych opcji (szablon relacji) do i tak już rozbudowanego formularza (2026-07-07), świadomy sygnał, że panel potrzebuje uproszczenia, zanim dojdą kolejne funkcje (karuzele, punkt 2 powyżej).

Zaimplementowane (2026-07-09), tylko warstwa prezentacji w `PostSection.tsx` + `styles.css`, bez zmian w logice/API:
- Formularz główny podzielony na trzy widoczne grupy oddzielone cienką linią i etykietą (`.form-section` / `.form-section-title`): "Treść posta" (Tytuł, Treść), "Zdjęcia" (upload zdjęć), "Platformy i publikacja" (wybór platform, przyciski akcji).
- Mniej używane pola, pierwszy komentarz i szablon relacji (Instagram Story) wraz z nazwą serii, przeniesione do nowej zwijanej sekcji "Więcej opcji", domyślnie zwiniętej, dokładnie tym samym wzorcem `.collapsible-toggle`/`.collapsible-chevron`/`.collapsible-body` co istniejąca sekcja AI (nowy wariant kontenera `.collapsible-inline`, żeby nie zagnieżdżać pełnej karty w karcie).
- Trzy stałe teksty wyjaśniające (o przycinaniu zdjęć, o wsparciu platform dla pierwszego komentarza, o zakresie szablonu relacji) zamienione na doraźny komponent `InfoTip`, mały przycisk "i" przy etykiecie pola, który po dotknięciu pokazuje tekst pod polem. Użyto przycisku zamiast `title`/hover, bo to mobilna PWA (dotyk, nie hover).
- Ostrzeżenie blokujące publikację (platforma bez podłączonego konta) podniesione z szarego `hint-text` do `.note-banner` (żółty banner), żeby wyraźnie odróżnić od neutralnej podpowiedzi.
- Bez zmian: logika stanu, wywołania `apiClient`, przepływ generowania AI (szybkie/dokładne), efekt debounce podglądu szablonu relacji, handlery zapisu/planowania/publikacji, upload zdjęć (pole pliku zostało poza jakąkolwiek zwijaną sekcją, żeby nie ryzykować problemów z file inputem).

## 4. Inspiracje: YouTube + Newslettery — dopięcie i weryfikacja

Zbudowane w tej sesji (2026-07-07) i przetestowane przez API (curl) oraz jednym pełnym przebiegiem jobów w tle, ale **nigdy nie obejrzane w przeglądarce**:
- Pływający przełącznik źródeł inspiracji (Instagram/YouTube/Newsletter) + serduszko z podstroną ulubionych (`InspirationSourceBar.tsx`, `FavoritesView.tsx`).
- Zarządzanie obserwowanymi kontami IG / kanałami YT (`WatchlistManager.tsx`, `instagramAccounts.ts`, `youtubeChannels.ts`) — konta/kanały nie są już hardkodowane, siedzą w DB (`WatchedInstagramAccount`, `WatchedYoutubeChannel`), seedowane domyślnie przy starcie serwera (`lib/watchlistSeed.ts`).
- Scraping YouTube przez `yt-dlp-exec` (`integrations/youtube.ts`, `jobs/youtubeScrapeJob.ts`) — pobiera 3 najnowsze filmy/kanał, metadane, transkrypcję (auto-napisy) i do 50 komentarzy/film. **Zweryfikowane działającym uruchomieniem** na 3 kanałach z prompta (SzymonNegacz, KubaKlawiter, IBMTechnology) — 9 filmów z pełnymi danymi w DB.
- Widok filmu z 3 akcjami AI na żądanie (streszczenie transkrypcji / obiekcje w komentarzach / powtarzające się tematy) — `routes/youtubeVideos.ts` `/analyze`.
- Newsletter przez IMAP (`integrations/mail.ts`, `jobs/newsletterFetchJob.ts`) — **zweryfikowane działającym uruchomieniem**, 64 wiadomości ściągnięte ze skrzynki `trendy-fitnes@mizaly.pl`. Lista + odczyt pojedynczego newslettera (HTML sanityzowany przez `sanitize-html`).

Do zrobienia / sprawdzenia:
- [ ] **Obejrzeć całość w przeglądarce** (`/inspiracje`, wszystkie 3 zakładki + ulubione) — dotąd tylko typecheck + testy API przez curl, zero wizualnej weryfikacji UI (siatka filmów YouTube, widok filmu, lista/odczyt newslettera, chipy z kontami/kanałami).
- [ ] **Dwa pliki `.env`** — backend faktycznie czyta `apps/backend/.env` (bo `dotenv/config` ładuje się względem cwd), a root `.env` jest niekompletny (brak `DATABASE_URL`/`JWT_SECRET` itd.) i wygląda na nieużywany/porzucony. Dane skrzynki pocztowej (`MAIL_*`) dodane do obu na wszelki wypadek — warto z userem ustalić, czy root `.env` w ogóle jest czemuś potrzebny, i ewentualnie go usunąć, żeby nie mylić przy kolejnych zmianach configu.
- [ ] **Zależności produkcyjne do zweryfikowania na Railway**: `yt-dlp-exec` pobiera binarkę yt-dlp przy `npm install` (działa lokalnie na Windows, powinien pobrać wersję linuksową przy buildzie na Railway, ale nieprzetestowane na docelowym środowisku). `imapflow`/`mailparser`/`sanitize-html` to zwykłe pakiety JS, bez tego ryzyka.
- [ ] **Newsletter job jest wolny przy pierwszym uruchomieniu** — `fetchMailBody` w `integrations/mail.ts` otwiera nowe połączenie IMAP osobno dla każdej wiadomości zamiast jednego połączenia na cały batch; pierwszy przebieg na 64 wiadomościach zajął ok. 2 minuty. Kolejne przebiegi pobierają już tylko nowe wiadomości (dedup po `messageId`), więc w praktyce to głównie koszt jednorazowy, ale warto to zoptymalizować (jedno połączenie, wiele `fetchOne`), jeśli skrzynka zacznie dostawać dużo maili naraz.
- [ ] Scraping YouTube to nieoficjalna metoda (yt-dlp, nie YouTube Data API) — świadomie zaakceptowane ryzyko: może się zepsuć przy zmianach YouTube, technicznie narusza ToS przy automatycznym pobieraniu. Alternatywa (YouTube Data API + osobne rozwiązanie tylko do transkrypcji) omówiona z userem na starcie, odrzucona na rzecz prostoty.
- [ ] Limity na sztywno w kodzie do rewizji, gdy będzie wiadomo dokładnie ile potrzeba: 3 filmy/kanał, 50 komentarzy/film (`COMMENTS_TO_FETCH` w `integrations/youtube.ts`).
- [ ] `MAIL_SMTP_HOST`/`MAIL_SMTP_PORT` są zapisane w env, ale nic jeszcze nie wysyła maili (SMTP) — gotowe na przyszłość, jeśli pojawi się taka potrzeba (np. odpowiadanie na newslettery), ale dziś nieużywane.

Kontekst: zbudowane na żywo w rozmowie z userem (2026-07-07), łącznie z testowaniem na produkcyjnych danych dostępowych do skrzynki i na 3 konkretnych kanałach YouTube podanych przez usera. Backend restartowany ręcznie kilka razy w trakcie sesji (blokady pliku Prisma na Windows, potem żeby złapać nowe zmienne środowiskowe) — zostawiony **uruchomiony i działający** na końcu sesji.

## 5. Inspiracje: Instagram — storage na Cloudflare R2 + pobieranie Reelsów

Zbudowane w tej sesji (2026-07-13):
- **Zdjęcia i filmy (Reelsy) trzymane w Cloudflare R2** zamiast na lokalnym dysku — `lib/r2Store.ts` (nowy, zastępuje usunięty `lib/localImageStore.ts`), bucket `mizaly-reels-storage`. Bucket jest prywatny (S3 API), więc pliki są serwowane przez proxy `routes/inspirationMedia.ts` pod `/media/inspiration/...` (streamuje z R2, nie linkuje bezpośrednio).
- **Rozpoznawanie Reelsów** — Instagram zwraca pole `clips_metadata` tylko dla Reelsów (puste dla zwykłych postów/wideo w feedzie); `instagramScraper.ts` to teraz odczytuje (`isReel`) i wyciąga link do właściwego pliku wideo z `video_versions` (wcześniej ten plik był całkowicie ignorowany — pobierana była tylko miniaturka, nigdy sam film).
- **Nowe pola w DB**: `ScrapedInstagramPost.videoUrl` (String?) i `.isReel` (Boolean) — migracja `20260713055806_add_instagram_reel_video`.
- **Front (mobile)**: `TrendsFeed.tsx` renderuje `<video controls>` z plakietką "Reels" zamiast samej miniatury, gdy post ma `videoUrl`.
- **Naprawiony bug z duplikatami postów** — `id` posta zmienił się kiedyś ze starego surowego ID Instagrama na obecny shortcode (prawdopodobnie przy usuwaniu starej integracji Apify, `apps/backend/src/integrations/apify.ts`, widoczne jako `D` w gicie), przez co `upsert` po `id` tworzył drugi wiersz dla tego samego realnego posta zamiast nadpisać stary. Naprawione:
  - Dodany `@@unique([username, postedAt])` na `ScrapedInstagramPost` (migracja `20260713070000_add_username_postedat_unique`).
  - `inspirationScrapeJob.ts` upsertuje teraz po `(username, postedAt)` zamiast po `id` (z fallbackiem na `id`, gdy `postedAt` jest `null` — Postgres traktuje każdy `NULL` jako odrębny, więc unique constraint by tego nie złapał).
  - Jednorazowo scalono 31 istniejących par duplikatów (zachowując `videoViewCount` ze starego wiersza, jeśli nowy go nie miał) — 104 → 73 wiersze.
- **Optymalizacja: pomijanie ponownego pobierania mediów** — jeśli post już istnieje w DB (po `username`+`postedAt`), `inspirationScrapeJob.ts` nie pobiera/nie wgrywa ponownie zdjęcia/filmu do R2 (media posta i tak się nie zmieniają), tylko odświeża liczniki (polubienia/komentarze/wyświetlenia). **Kod napisany i przechodzi typecheck, ale nie zdążyłem dokończyć końcowej weryfikacji end-to-end (przerwane na koniec sesji) — do zrobienia na start kolejnej: uruchomić scrape drugi raz z rzędu i potwierdzić, że dla już znanych postów nie wykonuje się nowy upload do R2 (np. dodać tymczasowy `console.log` przy pominięciu i sprawdzić w logu).**

Do zrobienia / sprawdzenia:
- [ ] Dokończyć weryfikację optymalizacji "nie pobieraj ponownie już znanych mediów" (patrz wyżej).
- [ ] **Pobieranie komentarzy wciąż nie zaimplementowane** — mechanizm już istnieje (`run_scrapedo.py --include-comments`, `scrape_post_comments()` w `instagram.py`), tylko `instagramScraper.ts` go nie wywołuje. User pytał o to wprost (2026-07-13), chce w przyszłości grupować komentarze tematycznie i liczyć powtarzalność pytań (patrz notatka z początku sesji).
- [ ] **Zdjęcia/filmy ładują się wolno** — każde żądanie idzie przeglądarka → backend → R2 → backend → przeglądarka (prywatny bucket, brak cache po naszej stronie), a zdjęcia są zapisywane w pełnej rozdzielczości oryginału z Instagrama. Dwie możliwe poprawki, nieopisane jeszcze w kodzie: (1) kompresować/zmniejszać zdjęcia przy zapisie do R2, (2) dodać HTTP cache (ETag / conditional GET) w `routes/inspirationMedia.ts`.
- [ ] **Cloudflare dashboard ma dwa tokeny "R2 Account Token"** (oba "All buckets" / Admin Read & Write) — pierwszy powstał zanim bucket istniał i prawdopodobnie jest teraz martwy/nieużywany; do posprzątania (nieistotne funkcjonalnie, tylko porządek).
- [ ] `apps/backend/storage/inspiration/` — zostało tam 60 starych plików zdjęć sprzed migracji na R2 (już zbackfillowane do R2, więc te lokalne kopie są zbędne) — można skasować, żeby zwolnić miejsce na dysku, nieurgentne.
- [ ] Root `.env` miał błędnie wpisane zmienne R2 (literówka `CLAUDFLARE_*` zamiast `CLOUDFLARE_*`, plus zły plik — backend czyta tylko `apps/backend/.env`) — przeniesione i poprawione, ale warto przy okazji ustalić z userem, czy root `.env` w ogóle czemuś służy (patrz też punkt 4 wyżej, ten sam temat wypłynął już wcześniej).

**Dwie nowe pułapki na przyszłość (warto dopisać do `CLAUDE.md`, jeśli wypłyną ponownie):**
- `tsx watch` **nie restartuje się przy zmianie `.env`** — tylko przy zmianie plików `.ts`. Backend trzeba zrestartować ręcznie po każdej zmianie zmiennych środowiskowych, inaczej proces działa dalej ze starymi wartościami w pamięci (złapane dziś na `R2_ENDPOINT` — poprawka w `.env` nie zadziałała, dopóki proces nie został ubity i odpalony ponownie).
- **Cloudflare R2 ma osobne, niekompatybilne endpointy per jurysdykcja** — domyślny `https://<account>.r2.cloudflarestorage.com` i np. `https://<account>.eu.r2.cloudflarestorage.com` to dwie zupełnie oddzielne "przestrzenie" bucketów. Użycie złego endpointu daje `NoSuchBucket` nawet z poprawnym tokenem o pełnym dostępie — wygląda jak błąd uprawnień, a to pomyłka w URL-u. Bucket `mizaly-reels-storage` jest pod endpointem **bez** `.eu.`, mimo że lokalizacja fizyczna to "EEUR (Europa)" (to tylko location hint, nie jurysdykcja).

Kontekst: zbudowane na żywo w rozmowie z userem (2026-07-13), łącznie z realnym debugowaniem środowiska (Windows `App Execution Alias` dla `python3`, brakujące pakiety npm/pip, restart procesów blokujących porty/pliki). Backend zostawiony **uruchomiony** na koniec sesji, ale **z kodem sprzed ostatniej zmiany** (optymalizacja pomijania ponownego pobierania mediów) — zrestartować go po wznowieniu pracy, żeby podłapał najnowszy kod, zanim uruchomi się jakikolwiek scrape.

## 6. Analityka: za mało danych + niejasny przycisk pobierania

Zgłoszone przez usera na koniec sesji (2026-07-16), krótko, do doprecyzowania jutro — zapisane możliwie dosłownie, żeby nie zgadywać intencji:

- [ ] **Za mało danych, żeby analityka miała sens** — user: "aktualnie nie ma pobranych wystarczająco dużo danych, więc trzeba będzie pobrać dane do analityki, żeby analityka była sensowna. I zrobić jakieś ograniczenia." Nieprecyzyjne, do ustalenia jutro: czy to o danych z Zernio (`/api/analytics`, dziś tylko 2 dni danych na koncie demo — patrz sekcja o nowym wykresie w historii tej sesji) czy o czymś innym. "Zrobić jakieś ograniczenia" — jakiego rodzaju (limit czasu/ilości?, nieopisane).
- [ ] **Niejasne, czy pobieranie dodatkowych danych wymaga ręcznej akcji** — user: "czy trzeba kliknąć 'pobierz teraz', żeby się pobrały te dodatkowe posty, czy to się jakoś pokaże [automatycznie]." Uwaga: przycisk **"Pobierz teraz"** istnieje dziś tylko w Inspiracjach (`TrendsFeed.tsx`/`YoutubeSection.tsx` — ręczne wywołanie scrape'a Instagram/YouTube), **nie ma** takiego przycisku przy Analityce/Zernio (tam dane idą przez bezpośrednie wywołanie API przy każdym wejściu na stronę, bez cachowania/kolejki). Do wyjaśnienia z userem: czy pytanie dotyczyło faktycznie Inspiracji, czy oczekuje takiego mechanizmu (manualny trigger + wskaźnik postępu) także dla Analityki.
- [ ] **Przycisk "pobierz" (prawdopodobnie "Pobierz teraz") powinien mieć więcej informacji przy sobie** — user: "przy przycisku 'pobierz' powinno być więcej informacji." Dziś przycisk w Inspiracjach nie ma żadnego opisu/tooltipa, tylko etykietę + spinner tekstowy ("Pobieranie…") w trakcie. Do ustalenia jakich informacji brakuje (np. kiedy było ostatnie pobranie, co konkretnie się pobiera, ile to trwa).

## 7. Kontynuacja pracy z innego urządzenia — checklist środowiska

User chce kontynuować (2026-07-16) z innego urządzenia niż to, na którym powstała cała dzisiejsza praca (edytor karuzeli, feature flags, wykres analityki, plus równoległa praca usera nad klasyfikacją treści w Inspiracjach). Wszystko zostało scommitowane w jednym commicie na `master` ("after a few fixes") i wypchnięte na `origin` na koniec tej sesji. Rzeczy, które **nie** przenoszą się same przez git — do zrobienia na nowym urządzeniu przed dalszą pracą:

- [ ] **`git pull`** na nowym urządzeniu (i `git fetch` najpierw, żeby upewnić się, że commit faktycznie doszedł na `origin/master`).
- [ ] **`yarn install`** od zera — `node_modules` nie jest w repo. Uwaga: `yt-dlp-exec`'s postinstall (`bin-version-check-cli`) rzuca błąd (`TypeError: binary and semverRange arguments required`) — **nieszkodliwe i już zaobserwowane dziś**, paczki i tak się linkują poprawnie, nie próbować tego naprawiać.
- [ ] **Skopiować ręcznie `apps/backend/.env`** (gitignorowany, nie ma go w repo) — bez tego backend odpali się, ale `/api/analytics` i cała reszta integracji zwróci puste/błędne dane. **`apps/backend/.env.example` jest nieaktualny** (brakuje w nim `SCRAPE_DO_KEY`, `MAIL_*`, `R2_*`, i ma starą nazwę `ZERNIO_API_KEY` zamiast `ZERNIO_API_KEY_1`) — nie kopiować samego przykładu, tylko realny plik `.env` z pierwotnej maszyny. Pełna lista zmiennych faktycznie używanych dziś: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `PORT`, `BACKEND_PUBLIC_URL`, `MOBILE_APP_URL`, `ZERNIO_API_KEY_1`, `ZERNIO_API_KEY_2`, `ZERNIO_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `APIFY_API_KEY`, `SCRAPE_DO_KEY`, `MAIL_IMAP_HOST`, `MAIL_IMAP_PORT`, `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET_NAME`, `R2_TOKEN_VALUE`.
- [ ] **Zastosować nową migrację Prisma** — najnowsza to `20260715221136_add_content_classification_fields` (z równoległej pracy usera, dodana w tym samym commicie). Na nowym urządzeniu: `yarn workspace @mizaly/backend prisma migrate deploy` (albo `migrate dev`, jeśli baza jest lokalna/dev). Jeśli to Windows: zatrzymać `tsx watch`/backend **przed** migracją (patrz istniejąca notatka w `CLAUDE.md` o blokadzie pliku silnika Prisma).
- [ ] **Odpalić dev servery od nowa** — nic z uruchomionych dziś procesów (`yarn dev:backend`/`dev:mobile`/`dev:admin`) nie przenosi się między maszynami, oczywiście.
- [ ] Reszta otwartych spraw z tej sesji: patrz punkt 2 (bug z uploadem zdjęcia do karuzeli, do odtworzenia) i punkt 6 (dane analityki + UX przycisku pobierania, do doprecyzowania z userem) wyżej w tym pliku.

Kontekst: zgłoszone en passant na sam koniec sesji poświęconej głównie edytorowi karuzeli (punkt 2), user świadomie odłożył temat na następną sesję ("dobra, na tyle, dzięki") — nie doprecyzowywane na żywo, stąd otwarte pytania wyżej.

## 8. Inspiracje: sekcja "Pomysły na content" (dopięcie migracji + weryfikacja)

Zgłoszone przez usera (2026-07-17): w Inspiracjach jest już "obserwowane konta", "ile treści pobrano z konta" i "co działa najlepiej" (top 3 + ranking klasyfikacji), ale brakuje ostatniego ogniwa — przełożenia tych danych na konkretne, gotowe do nagrania pomysły na content dla klienta (np. "nagraj X w formacie Y, bo Z działa najlepiej"), zamiast zostawiać mu samodzielne wyciąganie wniosków z rankingów.

Ustalenia z planowania: generowanie w tle (doklejone do istniejącego joba scrapującego, nie on-demand), 10 pomysłów domyślnie, dla obu źródeł (Instagram + YouTube), sekcja domyślnie rozwinięta, umieszczona między `ClassificationRanking` ("Co działa najlepiej") a `TopMetricsStrip` ("Top 3") w obecnej kolejności DOM.

**Zaimplementowane i zweryfikowane end-to-end (2026-07-17):**
- Nowy model `ContentIdeaSet` w `apps/backend/prisma/schema.prisma` (global, wzorem `InspirationAnalysis` — "create-only, czytaj najnowszy wiersz per source", pole `ideas Json`) — migracja `20260717182547_add_content_idea_set` zaaplikowana.
- Nowy `apps/backend/src/lib/contentIdeas.ts` — `generateInstagramContentIdeas()`/`generateYoutubeContentIdeas()`: liczy `outlierRatio` przez `computeNormalizedScores`, grupuje wg osi klasyfikacji (port `rankBy()` z `ClassificationRanking.tsx` na backend), bierze top 5 grup + top 3 posty/wideo, woła gpt-4o-mini (`response_format: json_object`) o dokładnie 10 pomysłów `{title, rationale}`, zapisuje przez `prisma.contentIdeaSet.create`.
- Podpięte w `apps/backend/src/jobs/inspirationScrapeJob.ts` i `jobs/youtubeScrapeJob.ts`, zaraz po odpowiednim `classifyUnclassified*()`, w osobnym try/catch (błąd generowania pomysłów nie wywraca całego joba).
- Nowe endpointy odczytu: `GET /api/inspiration/instagram-content-ideas` (`routes/inspiration.ts`) i `GET /api/youtube-videos/content-ideas` (`routes/youtubeVideos.ts`, zarejestrowany **przed** `GET /:id`, żeby nie kolidować z parametrem).
- Nowy frontend `apps/mobile/src/pages/inspiracje/ContentIdeasPanel.tsx` (fetch on mount, lista `.stat-rows`, stan pusty/błąd/ładowanie wg istniejącej konwencji sekcji) — wpięty w `TrendsFeed.tsx` (Instagram) i `YoutubeSection.tsx` (YouTube), między `ClassificationRanking` a `TopMetricsStrip`.

**Weryfikacja wykonana (2026-07-17):** typecheck backend+mobile czysty; generator uruchomiony bezpośrednio na już zescrapowanych/sklasyfikowanych danych (11 kont IG, 4 kanały YT) — zapisał 10 pozycji `{title, rationale}` po polsku dla obu źródeł, bez "—"; oba endpointy zwracają poprawny kształt (pusty przed generacją, wypełniony po); UI zweryfikowane w przeglądarce (Playwright) — na obu zakładkach nagłówki sekcji w kolejności: "...Co działa najlepiej" → "Pomysły na content" → "Top 3 - odchylenie od normy konta/kanału", zero błędów w konsoli.

Zostało:
- [ ] **Commit zmian** — kod nie jest jeszcze scommitowany.
- [ ] Prawdziwy przebieg przez pełny "Pobierz teraz" (scrape-now) na świeżych danych, nie tylko bezpośrednie wywołanie generatora na już istniejących postach — żeby potwierdzić też samo podpięcie w `inspirationScrapeJob.ts`/`youtubeScrapeJob.ts` (logika generatora już zweryfikowana, samo wywołanie z joba jeszcze nie przeszło realnego scrape'a).

Pełny plan (kontekst, uzasadnienie decyzji, dokładne linie do zmiany) zapisany w `C:\Users\kubat\.claude\plans\rippling-marinating-minsky.md`.

## 9. Inspiracje: hook wizualny (wielo-klatkowy) zrobiony, hook tekstowy (za wąski zakres) — nie

Zgłoszone/zrobione w tej sesji (2026-07-17), kontynuacja punktu 8 wyżej (ta sama sesja/dzień):

**Zaimplementowane:**
- Hook wizualny dla Reelsów/wideo: zamiast jednej klatki (dawniej `extractVideoFrame`, seek 1s → fallback 0s) teraz wyciągane są 3 klatki (0s, 1s, 2s) przez ffmpeg (`extractVideoFrames` w `apps/backend/src/lib/mediaAnalysis.ts`) i analizowane razem jednym zapytaniem vision (`analyzeImageBuffers`, nowy prompt `VISION_MULTI_FRAME_SYSTEM_PROMPT`) zamiast osobno per klatkę. Podpięte w `contentClassification.ts` jako `analyzeVideoFrames`.
- Post/zdjęcie (w tym karuzela): bez zmian — nadal tylko pierwsze/okładkowe zdjęcie (`analyzeImage`), bo scraper (`instagramScraper.ts` + `instagram.py`) w ogóle nie pobiera dalszych slajdów karuzeli, tylko okładkę.
- Dodany mały znacznik graficzny typu posta (`MediaTypeBadge` w `ClassificationRanking.tsx`, użyty też w `TrendsFeed.tsx`) — ikonka + etykieta "Zdjęcie" / "Wideo" / "Reels" nad miniaturą; wcześniej badge "Reels" pokazywał się tylko dla Reelsów, zwykłe zdjęcia/wideo nie miały żadnego oznaczenia.
- Przy okazji: paginacja/dociąganie kart w "Trendujące treści" (`TrendsFeed.tsx`) — renderuje 10 postów na start (`PAGE_SIZE`), dogrywa kolejne 10 przez `IntersectionObserver`, gdy user zbliży się do końca listy (dane i tak przychodzą jednym requestem, bo sortowanie "normalized" liczy `outlierRatio` na całym zbiorze kont naraz — patrz `engagementNormalization.ts`).
- Usunięta karta-placeholder "Analiza konkurencji" (`WipCard` w `InstagramSection.tsx` + stub `GET /api/inspiration/competitors` w `inspiration.ts`) — była to funkcja WIP bez ustalonego źródła danych (patrz `docs/ROADMAP.md`), a manualne dodawanie inspiracji już istnieje na dole strony (`InspiracjePage.tsx`, sekcja "Dodaj inspirację ręcznie"), więc nic nie trzeba było dobudowywać. **Uwaga**: `docs/ROADMAP.md` (linie ok. 47, 69, 102, 113, 143) wciąż opisuje "analizę konkurencji" jako planowany placeholder WIP — nieaktualne, do zaktualizowania jeśli user potwierdzi, że funkcja faktycznie odpada.

Checklist do zrobienia:
- [ ] **Hook tekstowy — user zgłosił, że okno/zakres tekstu jest za wąski** ("trzeba było dodać szeroką, w sensie większy zakres tekstowego hooka") — **nie zaimplementowane w tej sesji**. Dziś: `HOOK_WINDOW_SECONDS = 5` w `contentClassification.ts` ogranicza `hookSourceFromTranscript` do pierwszych 5 sekund transkryptu wideo (z fallbackiem na cały tekst, jeśli nic nie mieści się w oknie); dla postów-zdjęć `hookTextSource` to tylko `visualText` (tekst wyciągnięty z obrazka), bez podpisu/caption. Do ustalenia z userem: czy chodzi o zwiększenie `HOOK_WINDOW_SECONDS` (np. do 10-15s), o dorzucenie captionu jako dodatkowego kontekstu, czy o coś innego — zapisane możliwie dosłownie, żeby nie zgadywać intencji.
- [ ] **Nie zweryfikowane end-to-end** — zmiany w hooku wizualnym (3 klatki) przechodzą typecheck, ale nie zostały odpalone na żywym Reelsie (backend nie był uruchomiony w tej sesji z tej strony — user zwolnił port 4000, żeby odpalić go ręcznie samodzielnie). Do potwierdzenia: że ffmpeg faktycznie wyciąga 3 różne klatki, że multi-image vision call działa i zwraca sensowny opis po polsku, bez "—".
- [ ] **Niedokończona/przerwana wiadomość o kolorze i odstępie w UI** — user zaczął pisać "nie używaj żółtego [...] koloru i budża daj troszkę u góry, żeby ten tekst był na całej szerokości", ale wiadomość została przerwana i nigdy nie doprecyzowana ani powtórzona w tej sesji. Nie wiadomo, którego elementu dotyczyło (jakiś żółty element + odstęp/margines u góry + tekst ma zająć pełną szerokość) — do wyjaśnienia z userem, zanim ktokolwiek zgaduje o co chodziło.
- [ ] Karuzele wciąż nie są w ogóle scrapowane wieloslajdowo (tylko okładka) — jeśli docelowo hook wizualny/tekstowy ma uwzględniać całą karuzelę, to osobny, większy temat (scraper Pythonowy `instagram.py`'s `parse_user_posts` nie zbiera `carousel_media`, plus zmiany w `instagramScraper.ts`, Prisma, froncie) — nieporuszone dziś, tylko odnotowane przy okazji.

Kontekst: user kończył pracę na dziś, poprosił o zapisanie otwartych wątków w backlogu zamiast dalszej implementacji.

## 10. Karuzela Reels w Inspiracjach (strzałki) + toggle relacji na Instagramie + szablon posta jako "wkrótce"

Zgłoszone/zrobione w tej sesji (2026-07-17), kontynuacja punktu 9 wyżej (ta sama sesja/dzień). Sesja przerwana w połowie na prośbę usera, bo kończyły mu się dzienne tokeny — poniżej dokładny stan.

**Zaimplementowane i zweryfikowane (build + Playwright):**
- User zgłosił, że strzałki nawigacji w nowej karuzeli Reelsów (`GroupItemCarousel` w `ClassificationRanking.tsx`, z punktu 9) "rozjechały się" — zmierzone przez `getBoundingClientRect()`: same przyciski były już piksel-w-piksel symetryczne, prawdziwą przyczyną były znaki tekstowe "‹"/"›" renderujące się z innym optycznym środkiem zależnie od fontu/OS. Naprawione przez nowy `apps/mobile/src/components/ChevronIcon.tsx` (ikona SVG ze ścieżką, zamiast glifu tekstowego), użyty zarówno w `ClassificationRanking.tsx` jak i w oryginalnej karuzeli `PostPreview.tsx` (ten sam CSS, ta sama potencjalna wada). Zweryfikowane buildem + świeżym skryptem Playwright (pomiar pozycji obu strzałek + zrzut ekranu).

**Zaimplementowane, NIEZWERYFIKOWANE buildem/przeglądarką (przerwane przez limit tokenów):**
- User: "dodaj przełącznik/czek, kiedy daje się relację... teraz się automatycznie dodaje, nawet się nie pytasz. Możesz dać automatycznie zaznaczone, że jak klikniesz platformę Instagram, to automatycznie jest zaznaczone dodanie się relacji, ale daj możliwość wyłączenia tego." — kontekst: `apps/backend/src/routes/posts.ts` (endpoint `/:id/publish`) zawsze auto-publikował relację (Instagram Story) obok posta, jeśli konto Instagram było podłączone i post miał media, bez żadnego pytania usera.
  - Nowy stan `addToStory` (domyślnie `true`) w `PostSection.tsx`, checkbox "Dodaj też do relacji na Instagramie" widoczny tylko gdy `platforms.includes("instagram")`, nowa klasa `.checkbox-field` w `styles.css`.
  - `togglePlatform` ustawia `addToStory` z powrotem na `true` za każdym razem, gdy Instagram zostaje (ponownie) zaznaczony — zgodnie z "automatycznie zaznaczone przy kliknięciu Instagrama".
  - Wysyłane do backendu jako `addToStory` w obu wywołaniach `/publish` (teraz i zaplanuj), tylko gdy Instagram jest wśród wybranych platform (inaczej `undefined`).
  - Backend: `publishSchema` ma nowe opcjonalne pole `addToStory: z.boolean().optional()`; auto-story pomijane, gdy `addToStory === false`. Domyślne zachowanie (pole pominięte/`undefined`) zostaje **bez zmian** (`true`) celowo — `KalendarzSection.tsx`'s "publikuj teraz" z kalendarza wywołuje ten sam endpoint bez żadnego UI do tego wyboru, więc nie powinno się jej zachowanie ciche zmienić.
- User: "daj szablon posta jako wkrótce funkcjonalność" — dotyczy pola "Szablon posta" (`storyTemplate` select: Brak/Nowy post/Seria w `PostSection.tsx`, sekcja "Podgląd posta"). Oznaczone tym samym wzorcem co reszta apki: nowa flaga `FEATURE_FLAGS.postSzablonRelacji: true` w `apps/mobile/src/lib/featureFlags.ts`, badge `.badge-coming-soon` przy etykiecie + `disabled={FEATURE_FLAGS.postSzablonRelacji}` na `<select>` (wizualnie wyszarzone przez istniejącą regułę `.field select:disabled`).

**Dokończone po wznowieniu (ten sam dzień):**
- Build mobile miał 3 błędy typów odkryte dopiero teraz: `platforms.includes("instagram")`/`platform === "instagram"` porównywały string enum `SocialPlatform` z gołym literałem — `===` to toleruje, ale `.includes()` (Array<SocialPlatform>) już nie. Naprawione importem `SocialPlatform` jako wartości (nie tylko `type`) i użyciem `SocialPlatform.INSTAGRAM` we wszystkich miejscach. Build mobile przechodzi czysto.
- Build backend: błąd `contentIdeaSet` nie istnieje na `PrismaClient` faktycznie był tym, na co wyglądał — Prisma Client nie został zregenerowany po dodaniu modelu w punkcie 8. `yarn prisma generate` (żadne `tsx watch` nie blokowało pliku tym razem, oba wcześniej wiszące procesy się nie odzywały) + `prisma migrate status` potwierdził, że migracja `ContentIdeaSet` już była zaaplikowana do bazy. Build backendu przechodzi czysto.
- Zweryfikowane w przeglądarce przez Playwright (`demo@mizaly.local`, `/tworzenie?sekcja=post`): checkbox "Dodaj też do relacji na Instagramie" nie istnieje, gdy Instagram nie jest zaznaczony; pojawia się domyślnie zaznaczony po kliknięciu Instagrama; da się odznaczyć; znika po odznaczeniu platformy; wraca domyślnie zaznaczony po ponownym zaznaczeniu Instagrama. "Szablon posta" renderuje się wyszarzony (`disabled`) z badge'em "Wkrótce", identycznie jak inne pola coming-soon w tej sekcji. Zero błędów konsoli. Zrzuty ekranu potwierdzają wygląd.

Wciąż otwarte:
- [ ] **Nie przetestowana realna publikacja** z odznaczonym checkboxem (potwierdzić, że `addToStory: false` faktycznie dociera do backendu i relacja się nie tworzy) — wymaga podłączonego konta Instagram + prawdziwej publikacji przez Zernio, nieprzetestowane w tej sesji (tylko UI + logika frontu/backendu po stronie kodu).
- [ ] Dwa równolegle wiszące procesy `tsx watch` backendu wciąż odkryte przy wznowieniu (ten sam objaw co w punkcie 8) — tylko jeden faktycznie trzyma port 4000, drugi to zombie. Nieposprzątane, nieszkodliwe, ale warto to ogarnąć przy najbliższej okazji restartu backendu.

Kontekst: user kończył pracę na dziś (kończące się tokeny), poprosił o zapisanie stanu w backlogu z dzisiejszą datą; dokończone/zweryfikowane po wznowieniu tego samego dnia.

## 11. Inspiracje: infinite-scroll osobno dla YouTube i Instagrama + zapamiętywanie pozycji scrolla per zakładka

Zgłoszone przez usera (2026-07-17), nie zaimplementowane w tej sesji:

Mechanizm automatycznego dociągania kart przy zjechaniu w dół (patrz punkt 9 — dziś zaimplementowany tylko dla `TrendsFeed.tsx`/Instagram, `PAGE_SIZE=10` + `IntersectionObserver`) powinien być wdrożony **osobno** dla YouTube (`YoutubeSection.tsx`) — dziś ten komponent renderuje całą listę filmów naraz, bez żadnej paginacji.

Dodatkowo: przy przełączaniu się między zakładkami źródeł (Instagram/YouTube/Newsletter, `InspirationSourceBar.tsx`) strona powinna pamiętać, w którym miejscu (wysokość scrolla) user ostatnio był na danej zakładce, i wracać do tego miejsca przy powrocie na nią — **ale tylko jeśli już się na niej było**. Jeśli user wchodzi na zakładkę pierwszy raz w danej sesji (np. był tylko na Instagramie i teraz wchodzi na YouTube), ta nowa zakładka ma się otworzyć od góry, a nie odziedziczyć wysokość scrolla z poprzedniej zakładki.

Checklist:
- [ ] Dodać ten sam mechanizm paginacji/`IntersectionObserver` (wzorem `TrendsFeed.tsx`, patrz punkt 9) do `YoutubeSection.tsx` — dziś renderuje wszystkie filmy na raz.
- [ ] Rozważyć, czy Newsletter (`NewsletterSection.tsx`) też potrzebuje tego samego mechanizmu, czy lista jest na tyle krótka, że to nieistotne — do potwierdzenia, ile newsletterów typowo jest na liście.
- [ ] Zapamiętywanie pozycji scrolla per zakładka źródła (Instagram/YouTube/Newsletter) w `InspiracjePage.tsx` — np. mapa `Record<InspirationSource, number>` trzymana w state/ref, zapisywana przy zmianie `activeSource` (`onSourceChange`) i przywracana po przełączeniu.
- [ ] Zakładka odwiedzona pierwszy raz w bieżącej sesji ma się otwierać od góry (scroll 0), nie dziedziczyć pozycji z poprzednio oglądanej zakładki — zapamiętywanie działa tylko dla zakładek, na których user faktycznie już był.
- [ ] Ustalić, czy pozycja ma przetrwać tylko w ramach sesji (np. `useRef`/`useState` w `InspiracjePage.tsx`, znika po odświeżeniu strony), czy ma być trwała (np. `sessionStorage`) — nieprecyzowane przez usera, do potwierdzenia.

## 12. Przenoszenie treści z IG: naprawa mediów lokalnych + status przeniesienia per platforma (2026-07-19)

Zgłoszony przez usera bug: publikacja na TikTok z "Przenoszenie treści z IG" (dawniej "Przenoszenie kontentu" — zmieniona nazwa w UI i komentarzach na prośbę usera, żeby się mieściła w jednej linii) rzucała błąd Zernio "Invalid media URL ... points to a local or private network address".

**Przyczyna i naprawa**: `lib/contentTransfer.ts` re-hostował zdjęcia/wideo do prywatnego bucketu Cloudflare R2 i serwował je przez własny backend (`${BACKEND_PUBLIC_URL}${path}`) — wzorzec skopiowany z Inspiracji, gdzie media są *tylko do wyświetlenia* (nigdy nie trafiają do Zernio, więc `localhost` jako `BACKEND_PUBLIC_URL` nie przeszkadza). Przenoszenie treści z IG odwrotnie — ten URL jest przekazywany do Zernio jako `mediaItems[].url`, więc musi być realnie osiągalny z serwerów Zernio, co nie działa lokalnie (domyślny `BACKEND_PUBLIC_URL=http://localhost:4000`).

Naprawione: `lib/contentTransfer.ts` re-hostuje teraz przez Cloudinary (`fetchAsDataUrl` + `uploadMedia`, ten sam mechanizm co zwykłe zdjęcia posta w `routes/media.ts`) — URL zawsze jest prawdziwym publicznym linkiem CDN, niezależnie od tego, gdzie działa backend. Usunięty martwy kod: `routes/contentTransferMedia.ts` (proxy R2), jego mount w `index.ts`, `CONTENT_TRANSFER_MEDIA_ROUTE`/`CONTENT_TRANSFER_OBJECT_PREFIX`/`R2MediaSource` w `lib/r2Store.ts` (R2 zostaje tylko dla Inspiracji, jak było). Wyczyszczony jeden zcache'owany post z uszkodzonym `localhost` URL-em w bazie, żeby kolejne "Odśwież" pobrało go świeżo przez Cloudinary.

**Niezwiązany drive-by, ale ta sama klasa bugu**: `lib/creatorAudit.ts` wciąż re-hostuje przez R2 + `BACKEND_PUBLIC_URL` do analizy OpenAI vision/transkrypcji — OpenAI też nie dosięgnie `localhost` lokalnie. Nie naprawione (user nie prosił), tylko odnotowane.

**Nowa funkcja — status przeniesienia per platforma**: dodane pole `ContentTransferPost.transferredTo` (Prisma `Json?`, migracja `20260719171605_add_content_transfer_post_transferred_to`) — mapa `{ [platform]: ISO data }`, zapisywana przez `markContentTransferPostTransferred()` w `lib/contentTransfer.ts` zaraz po udanej publikacji przez Zernio (`routes/contentTransfer.ts`'s `/:id/publish`, merguje nie nadpisuje — publikacja na drugą platformę nie kasuje zapisu pierwszej). Frontend (`ContentTransferSection.tsx`) pokazuje przy każdej platformie badge "✓ Przeniesione {data}" jeśli już przesłane, i zmienia etykietę przycisku na "Prześlij ponownie" — nie blokuje ponownej wysyłki, tylko informuje. Śledzone lokalnie w naszej bazie (nie odpytywane z Zernio) — ta treść i tak jest już w naszej bazie, a Zernio nie ma pojęcia "to jest transfer posta IG X" do odpytania z powrotem.

Typecheck + `vite build`/`tsc` (mobile/backend) przechodzą. **Nie zweryfikowane end-to-end w przeglądarce** (rzeczywista publikacja na platformę, wyświetlenie badge'a z poprawną datą, ponowna publikacja na tę samą platformę).

Wciąż otwarte:
- [ ] Zweryfikować cały przepływ end-to-end: odśwież → prześlij na platformę → sprawdź, czy badge "Przeniesione" pojawia się z poprawną datą, i czy ponowna wysyłka na tę samą platformę aktualizuje datę bez kasowania innych platform.
- [ ] Rozważyć naprawienie `lib/creatorAudit.ts` tą samą metodą (Cloudinary zamiast R2+`BACKEND_PUBLIC_URL`), jeśli lokalne testowanie Audytu Twórcy kiedykolwiek na to natrafi.

Kontekst: zgłoszone en passant, kontynuacja pracy nad Inspiracjami z tej samej sesji/dnia (patrz punkty 8-10 wyżej).

## 13. Inspiracje: usunięta analiza AI z filmu YouTube + usunięty formularz "Dodaj inspirację ręcznie" (2026-07-19)

Zgłoszone przez usera: w widoku szczegółów filmu YouTube (Inspiracje) nie chce sekcji "Analiza AI" (streszczenie transkrypcji / obiekcje z komentarzy / powtarzające się tematy) — ma być tylko przeglądanie, z linkiem do oryginału.

Usunięte całościowo (nie tylko z UI - user chciał, żeby tej możliwości po prostu nie było):
- `routes/youtubeVideos.ts`: endpoint `POST /:id/analyze` + `ANALYZE_ACTIONS`/`analyzeSchema`, import `openai`.
- `packages/shared/src/index.ts`: typ `YoutubeAnalysisAction` (był używany tylko przez tę funkcję).
- `YoutubeSection.tsx`'s `VideoDetail`: sekcja "Analiza AI" (3 przyciski) + cały powiązany stan (`runningAction`/`results`/`actionError`/`runAction`). Zamiast tego: link "Zobacz oryginał" → `https://www.youtube.com/watch?v=${videoId}` (`videoId` to już natywne id filmu YouTube, `ScrapedYoutubeVideo.id` w schema.prisma, więc nie trzeba nic dociągać z backendu).
- Dla konsekwencji nazewnictwa: link do posta na Instagramie w `TrendsFeed.tsx` przemianowany z "Zobacz na Instagramie" na "Zobacz oryginał" (ta sama etykieta na obu platformach, jak user prosił).
- `InspiracjePage.tsx`: usunięta cała karta/formularz "Dodaj inspirację ręcznie" (`content`/`tags`/`note`/`handleAdd` + pola formularza) — **zostawione** nietknięte: `items`/`loadItems`/`handleDelete`/`FavoritesView`/przycisk serduszka, bo "Zapisz" z `TrendsFeed.tsx` (Instagram) cały czas dopisuje do tej samej listy `InspirationItem` przez `onSaved` - to inna ścieżka do tych samych danych, nie tylko ręczny formularz.

Typecheck + `vite build`/`tsc` (mobile/backend/admin) przechodzą. Nie zweryfikowane wizualnie w przeglądarce.
