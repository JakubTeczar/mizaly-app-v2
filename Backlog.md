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

## 3. Przegląd UX-owy panelu tworzenia posta

Panel "Stwórz posta social media" (`PostSection.tsx`) urósł organicznie (AI szybkie/dokładne, szablon relacji + nazwa serii, pierwszy komentarz z podpowiedzią, zdjęcia z podpowiedzią o przycinaniu, platformy, itd.) i robi się przeładowany — dużo etykiet/podpowiedzi na raz, łatwo się pogubić.

- [ ] Przegląd całego formularza pod kątem hierarchii informacji — co użytkownik musi widzieć zawsze, a co może być domyślnie zwinięte/ukryte (np. za "Zaawansowane", collapsible, tooltipy zamiast stałego tekstu pod polem).
- [ ] Rozważyć pogrupowanie sekcji (np. treść / media / dystrybucja) zamiast jednego długiego formularza.
- [ ] Skrócić/ograniczyć liczbę stale widocznych `hint-text` — część z nich może być tooltipem albo pokazywać się tylko w kontekście (np. błędu, pierwszego użycia).

Kontekst: zgłoszone przy okazji dodawania kolejnych opcji (szablon relacji) do i tak już rozbudowanego formularza (2026-07-07) — świadomy sygnał, że panel potrzebuje uproszczenia, zanim dojdą kolejne funkcje (karuzele, punkt 2 powyżej).

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
