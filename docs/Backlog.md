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

**Zgłoszony bug do zbadania (2026-07-16, koniec sesji)**: User zgłosił, że "wgrywanie zdjęcia nie działa" przy dodawaniu zdjęć do karuzeli — zgłoszone tuż po tym, jak automatyczny test (Playwright, plik testowy `icon-512.png`, jeden slajd) przeszedł bez błędów i zdjęcie renderowało się poprawnie. Rozbieżność do wyjaśnienia jutro:
- [ ] Odtworzyć problem ręcznie (prawdziwe zdjęcie z telefonu/dysku, nie plik testowy) — sprawdzić czy to kwestia formatu/rozmiaru pliku, konkretnego urządzenia/przeglądarki, czy slajdu innego niż pierwszy (drugi+ slajd nie był testowany automatycznie).
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
