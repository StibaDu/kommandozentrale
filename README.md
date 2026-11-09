# Kommandozentrale

Private Commander-Deckwerkstatt für eine Vierer- bis Fünferrunde. Lokal, deutsch, mit Scryfall, den Comprehensive Rules und DeepSeek V4.1 Flash über opencode.

Die App ist eigenständig. Sie fasst `mtg-proxy-lab` nicht an und hängt nicht davon ab. Druck und Proxy-Produktion laufen in einer separaten, eigenständigen App. Die Kommandozentrale exportiert nur Decklisten.

## Schnellstart

```bash
cd ~/kommandozentrale
bun install
bun run ingest       # Scryfall-Karten, Tags, Rulings, CR und Hausregeln
bun run start        # http://localhost:4173
```

Beim ersten Öffnen legst du dein Admin-Profil nur mit Anzeigenamen an. Danach werden automatisch Einladungen für **Dennis, Ingo, Bamdad und Nima** erzeugt. Die Codes und QR-Codes findest du unter **Profil → Einladungen**.

Die App bindet standardmäßig an `0.0.0.0` und ist damit im lokalen WLAN erreichbar:

```bash
bun run start
```

Am Rechner öffnest du oben rechts **Handy** oder **Profil → Handy**. Dort stehen QR-Code und Adresse. Bevorzugt wird die stabile Bonjour-Adresse:

```text
http://<mac-name>.local:4173/m
```

Sie bleibt bei einem WLAN-Wechsel gleich, solange Mac und Handy im selben Netz sind. Die aktuelle IP steht als Fallback daneben. Die macOS-Firewall muss eingehende Verbindungen für Bun erlauben.

Für die PWA die `.local`-Adresse verwenden und einmal über **Zum Home-Bildschirm** installieren. Eine ältere Installation von einer IP-Adresse funktioniert nach einem WLAN-Wechsel nicht mehr und muss einmal neu installiert werden.

**Nur fürs vertrauenswürdige eigene WLAN oder das private Tailscale-Netz:** Die Profile sind passwortlos. Wer die Adresse öffnet, kann ein Profil wählen. Deshalb die App nicht über Cloudflare Tunnel oder eine öffentliche Portweiterleitung ins Internet stellen. Für unterwegs ist Tailscale der vorgesehene Weg: Es ist bereits installiert, die App erkennt es und zeigt die Tailscale-Adresse im Handy-Dialog, sobald es läuft. Auch dort gilt: nur vertrauenswürdige Geräte im Tailscale-Netz.

Der Smoke-Test meldet sich lokal über die Profilwahl an. Ohne Passwort reicht:

```bash
KZ_SMOKE_USER=sebastian bun run smoke
```

Für bestehende Installationen mit Passwort funktioniert weiterhin `KZ_SMOKE_PASSWORD`.

Beim ersten Start dauert der Import etwa zehn Sekunden. Er legt `data/kommandozentrale.db` an und lädt:

- 39.287 Oracle-Karten
- 239.960 Tagger-Zuordnungen
- 79.706 Karten-Rulings
- 3.163 CR-Regeln (Stand 25.09.2026)
- 21 Commander- und Hausregeln
- 3 Brackets

`bun run ingest` kann jederzeit wiederholt werden. Es überschreibt Karten, Regeln und Rulings, nicht eure Decks.

## Was die App kann

### Bauen

- Commander suchen, Bracket 3–5 wählen, Pod-Größe 3–5.
- **Erst Entwurf, dann Deck:** Der Commander startet nur einen unsichtbaren Entwurf. Erst „Deck speichern“ legt Name und Spielerprofil fest; vorher taucht nichts unter „Decks“ auf.
- **Deck-Vision:** Vor dem ersten Build und später im Builder beschreibst du Mechaniken, Tempo, Wincons und No-Gos in bis zu 2.000 Zeichen. Die Vision wird pro Deck gespeichert, beim Bauen an den Agenten übergeben und im Primer erklärt. Der Engine-Fallback baut ohne Vision weiter.
- 0 Rule als Master-Schalter, dazu einzelne Schalter für illegale Karten, Banlist, Un-Cards, Game-Changer-Limit, Tutoren, Extra-Züge, Mass Land Denial, Combos und Salz-Budget. Farbidentität und 1-Win-Karten sind dauerhaft Pflicht bzw. ausgeschlossen und haben keinen Schalter.
- DeepSeek V4.1 Flash baut aus einem lokalen Kandidatenpool. Die Engine repariert und prüft danach: 100 Karten, Singleton, Rollen, Kurve, Farbquellen, Bracket-Budget.
- Wenn der Agent ausfällt, baut die deterministische Engine weiter. Das Deck ist dann weniger elegant, aber spielbar.
- **Import:** Moxfield-, Archidekt- oder einfache Textlisten. Der Parser erkennt Commander-Abschnitt, `1x`-Schreibweisen, Set-Kürzel, Foil-Marker und Sideboard/Maybeboard. Unbekannte Namen und nach den Hausregeln übersprungene Karten werden im Ergebnisbericht gezeigt. Auch ein Import bleibt zunächst ein Entwurf, bis du ihn mit Profil speicherst.
- **Spielprotokoll:** Datum, Pod-Größe, Siegerdeck, Züge, Fun, Salz und Notizen. Beendete Tische speichern zusätzlich alle Teilnehmer, Decks und Endstände. Bei nachgetragenen Runden wird der Sieger als Teilnehmer erfasst, damit die persönliche Statistik stimmt; alte Einträge werden beim Start nachgezogen.
- **Profile und Rechte:** Passwortlose Profilwahl für das lokale WLAN, Einladungscodes und QR-Codes für neue Profile, Admin-Rolle, Deck-Besitz und Lesemodus für fremde Decks. Passwörter werden nicht mehr abgefragt; alte Hashes bleiben nur als Rückfall in der Datenbank.
- **Handy:** Responsive Oberfläche und installierbare PWA; die LAN-Adresse steht im Profil. Einladungs- und Tisch-QR-Codes werden am Host angezeigt und mit der normalen Handy-Kamera gescannt. Ein Scanner innerhalb der Web-App bräuchte HTTPS.

### Karten suchen

- **Effekt statt Name:** Die Suche im Deck-Editor findet Karten über Namen *oder* Wirkung. „Auto“ mischt beides, „Name“ bleibt beim reinen Namensabgleich, „Effekt“ durchsucht nur den Oracle-Text.
- Deutsch wird über ein Glossar auf die englischen Oracle-Begriffe abgebildet; Scryfall-Tags (Boardwipe, Tutor, Ramp, Friedhofshass …) liefern die präzisen Treffer. Treffer zeigen ihre Tags und die Textstelle, die gepasst hat.
- **Ganze Sätze:** Enter schickt die Anfrage durch das kleine Modell `cardquery`, das englische Begriffe und Tags zurückgibt. Das Ergebnis landet in `card_query_cache`; beim zweiten Mal ist die Suche sofort da. Fällt das Modell aus, greift die Stichwortsuche.
- **Im Deck automatisch gefiltert:** Farbidentität des Commanders und Commander-Legalität sind an, solange man eine Karte zum offenen Deck hinzufügt. Bei der Commander-Suche gibt es keinen Filter.
- `bun run scripts/search-eval.ts` misst die Trefferquote gegen 18 deutsche Testanfragen, ohne Server.

### Prüfen

- Bracket-Audit mit Begründung: Game Changers, Tutoren, Fast Mana, Extra-Züge, Mass Land Denial, Combo-Signale, Kurve.
- Hausbudget: B3 max. 3 GCs, 3 Tutoren, 2 Fast Mana, 1 Extra-Zug. B4 max. 8 GCs, 5 Tutoren, 5 Fast Mana, 2 Extra-Züge. B5 ist euer Maximum ohne Hausbudget.
- Goldfish-Simulation für Commander-Zug, verpasste Land Drops und Farb-Screw.
- Warnungen für Rollenlücken, Manabase und Budget-Überschreitungen.

### Mobiler Begleiter

- Eigene Oberfläche unter `/m`; die volle Werkstatt bleibt unter `/`.
- Profile, eigene Decks, Statistiken und der Live-Life-Counter.
- Kein Deckbau und keine Einstellungen auf dem Handy.
- Installierbar als PWA mit eigenem Manifest und Home-Screen-Icon.
- Der Tisch synchronisiert Leben, Poison/Infect, Commander-Schaden, Energy, Erfahrung, Rad, Treasure-, Clue-, Food-, Blood- und Gold-Zähler sowie Monarch, Initiative und Stadtsegen über WebSockets. Jede Spielerkarte zeigt die Zähler aller Spieler; die Detailansicht öffnet die volle Matrix und alle Plus-/Minus-Schritte.
- Touch-first: alle Bedienelemente haben mindestens 44 px Kantenlänge, primäre Aktionen 48 px. Die Tischkarten stehen einspaltig untereinander, damit Leben und Zähler auch mit dem Daumen sicher zu treffen sind.

### Deck-Doctor

- Prüft ein bestehendes Deck gegen Rollenquoten, Hausbudget und Kandidatenpool.
- Vorschläge sind konkrete Paare: eine Karte schneiden, eine Karte ergänzen. Bei Entwürfen darf er auch nur ergänzen; bei überfüllten Decks nur schneiden.
- Neue Karten sind offiziell Commander-legal, respektieren die Farbidentität und werden nicht als 1-Win- oder Mass-Land-Denial-Karte vorgeschlagen.
- Länder werden pro Lauf gedeckelt, damit ein Entwurf nicht nur aus Basics besteht. Weitere Länder kommen im nächsten Lauf.
- Jede Anwendung wird als Revision gesichert. Die letzte Änderung lässt sich im Doctor-Tab direkt zurücknehmen; die letzten zehn Revisionen pro Deck bleiben in der Datenbank.
- Der Doctor ist deterministisch. Er baut das Deck nicht neu und schreibt keinen neuen Primer; er macht kontrollierte Swaps.

### Combos

- Der Combos-Tab fragt Commander Spellbook nach vollständigen und fast vollständigen Linien im aktuellen Deck.
- Jede Linie zeigt Karten, erzeugte Effekte, Voraussetzungen, Bracket-Tag und Popularität. Fast-Combos nennen die fehlende Karte.
- Die App fügt nichts automatisch hinzu. Die Daten sind ein Gesprächsanlass für den Tisch, keine Bauanweisung.
- Ergebnisse werden pro Deckstand zwischengespeichert; „Neu prüfen“ erzwingt eine frische Abfrage. Bei API-Ausfall bleibt der letzte Stand sichtbar.

### Verlauf

- Der Verlauf-Tab zeigt die letzten zehn Revisionen eines Decks.
- Jede Revision zeigt ihren Kartenstand und was sich seitdem geändert hat.
- Wiederherstellen setzt das Deck auf den gewählten Stand zurück. Vorher wird der aktuelle Stand als eigene Revision gesichert, damit auch die Wiederherstellung rücknehmbar bleibt.

### Regeln

- Volltextsuche in den Comprehensive Rules.
- Commander-Regeln, Brackets, Game Changers, Banlist, Partner, Companion, Command Zone, Tax, 21 Commander-Schaden.
- Karten-Rulings pro Karte.
- Jede Regel mit Citation. Die App behauptet nicht, dass die CR die Commander-Regeln ersetzt.

### Art und Export

- Pro Karte: Scryfall-Printings, MPCFill-Community-Arts, eigene Bild-URL.
- Art-Auswahl wird pro Karte gespeichert. Sie ändert nie die Deck-Legalität, weil die Deckliste an `oracle_id` hängt.
- Deckliste als Text für den Import in die separate Druck-App.

### 1-Win-Karten

Die App versteht darunter Karten, deren Oracle-Text ausdrücklich sagt, dass du das Spiel gewinnst (`you win the game`). Sie sind dauerhaft ausgeschlossen: nicht im Kandidatenpool, nicht im Import, nicht per manueller Ergänzung und nicht als Commander. Es gibt keinen Schalter. Andere Combos sind damit nicht automatisch verboten; dafür gibt es den Combo-Schalter und das Bracket-Budget.

## Architektur

```
React 19 (Bun-Build) ── REST ── Hono API ── SQLite
                                      │
                                      ├── Scryfall-Sync
                                      ├── CR- und Rulings-Import
                                      ├── Deck-Engine (Validator, Bracket, Goldfish)
                                      └── opencode ── Agent commander ── DeepSeek V4.1 Flash
```

- **Runtime:** Bun 1.4
- **Web:** React 19, Hono, selbst geschriebenes CSS mit Hallmark-Stamp
- **DB:** SQLite, Drizzle-frei, `bun:sqlite`, FTS5 für Karten und Regeln
- **AI:** `opencode run --agent commander --model ollama-cloud/deepseek-v4.1-flash:1017`
- **Bilder:** Scryfall und MPCFill, serverseitig gefetcht und gecacht
- **Daten:** `data/kommandozentrale.db`, `data/cache/`

Der Agent hat keine Tools und keine Schreibrechte. Er bekommt einen Auftrag und eine Kandidatenliste im Prompt, antwortet mit JSON, die App validiert und repariert. Das ist Absicht: Das Modell entscheidet, die Engine prüft, die Datenbank erinnert.

## Projektstruktur

```
src/
  server.ts          Hono-API, Deck-CRUD, Build-Jobs, Doctor, Art-Endpunkte
  ingest.ts          Scryfall/CR/Rulings-Import
  db.ts              Schema und SQLite
  lib/
    types.ts         Typen, Defaults, Schalter
    rules-seed.ts    Commander-Regeln, Brackets, Hausregeln
    scryfall.ts      Scryfall- und MPCFill-Clients
    engine.ts        Kandidatenpool, Builder, Validator, Bracket, Goldfish
    cardsearch.ts    Effekt-Suche, Glossar, Tag-Synonyme, Ranking
    ai.ts            Prompt mit Deck-Vision, opencode-Aufruf, JSON-Parser
    import.ts        Parser für Decklisten
    doctor.ts        Rollen-/Budget-Diagnose und Swap-Vorschläge
    combos.ts        Commander-Spellbook-Abfrage und Normalisierung
    pod-counters.ts  Zähler- und Statusdefinitionen für den Tisch
    babyzilla.ts     Token-Statistik und Kosten pro OpenCode-Lauf
  client/
    App.tsx          Seiten und Zustand
    ui.tsx           Komponenten, Mana, Markdown, Modal
    ImportModal.tsx  Importformular und Ergebnisbericht
    DeckDoctor.tsx   Doctor-Tab, Vorschläge, Anwenden und Undo
    DeckCombos.tsx   Combos-Tab, Commander Spellbook
    DeckHistory.tsx  Verlauf-Tab, Revisionen und Wiederherstellen
    DeckLab.tsx      Bracket-Labor und Testhand
    MobileConnect.tsx QR-Code und Netzwerkadressen fürs Handy
    AuthScreen.tsx   Ersteinrichtung, Profilwahl und Einladungscode
    entry.ts          Einladungs- und Tischlinks auslesen
    clipboard.ts      Kopieren mit LAN-HTTP-Fallback
    ProfilePage.tsx  Profil, Einladungen mit Link/QR und Handy-Adresse
    mobile.tsx       Mobiler Companion: Tisch, Decks, Profil, Statistik
    settings.ts      0-Rule-Preset
scripts/
  build-client.ts    Bun-Build
  seed-demo.ts       Demo-Deck ohne KI
  smoke.ts           Sanity-Checks ohne KI
  eval.ts            Ein Build über die API, mit Messwerten
opencode.json        Projektkonfiguration: MCP für die App aus
.opencode/agents/
  commander.md       Agent-Prompt, Modell und Tool-Sperre
skill/
  SKILL.md           Deckbuilding-Doctrine für opencode
  references/        Brackets, Rollen, Manabase, Anti-Synergie, Primer
public/
  logo-mark.svg      Logo für Rail, Login und Mobile
  icon.svg           App-Icon und Favicon
  icon-maskable.svg  PWA-Icon mit Safe-Zone
  mobile.css         Mobile Oberfläche und Bottom-Navigation
  index.html
  styles.css         Hallmark-Design
  main.js            gebauter Client
```

Die Marke ist eine Commander-Karte im Bracket-Rahmen: das **K** für Kommandozentrale, die Karte für die Deckwerkstatt und die vier goldenen Winkel für Bracket und Command Zone. `logo-mark.svg` ist die UI-Fassung mit abgerundeter Kachel, `icon.svg` das vollflächige App-Icon; `icon-maskable*.png` sind die Android-Safe-Zone-Varianten.

## Modell und Skill

Das Modell ist fest auf `ollama-cloud/deepseek-v4.1-flash:1017` gesetzt. Der Agent liegt in `.opencode/agents/commander.md`. Die ausführliche Doctrine liegt in `skill/SKILL.md` und den References.

Das ist kein Fine-Tuning. Der Hebel ist:

1. ein präziser Auftrag statt eines leeren Prompts,
2. ein lokaler Kandidatenpool statt halluzinierter Karten,
3. eine deterministische Engine, die Rollen, Kurve, Mana und Bracket prüft,
4. ein Repair-Loop, der erst speichert, wenn die harten Checks grün sind,
5. Evals und die Spielprotokolle eurer Runde.

### Token sparen mit Babyzilla

Die App läuft auf OpenCode, und OpenCode lädt Babyzilla als globales Plugin. Babyzilla komprimiert lange OpenCode-Kontexte und führt darüber Buch; die Zahlen stehen unter **Profil → Babyzilla**. Die App liest den Verbrauch jedes KI-Laufs über `babyzilla cost` und zeigt Prompt-, Output- und Cache-Tokens.

Zusätzlich ist der App-Agent bewusst schlank:

- `.opencode/agents/commander.md` verbietet alle Tools. Der Agent bekommt den Auftrag und die Kandidatenliste im Prompt, nicht als Tool-Schleife.
- `opencode.json` deaktiviert die MCP-Server für dieses Projekt. Die Deckwerkstatt braucht weder Cloudflare noch Reverse-Engineering-Tools.
- Der KI-Build sieht 240 statt 360 Kandidaten. Das ist das Kontextbudget; die Engine repariert und prüft danach weiterhin 100 Karten.

Gemessen: Der Werkzeug- und System-Overhead eines einfachen Commander-Aufrufs fällt dadurch von rund 8,4K auf 1,4K Prompt-Tokens. Der eigentliche Build-Prompt bleibt der größte Posten; die App zeigt seinen geschätzten und den tatsächlich gemessenen Verbrauch.

## Hausregeln

Die Defaults sind 0 Rule: Legalität aus, Banlist aus, Un-Cards an. 1-Win-Karten sind immer ausgeschlossen, und die Farbidentität des Commanders ist immer Pflicht — auch bei 0 Rule. Jeder andere Schalter lässt sich in den Einstellungen einzeln ändern.

B4 hat ein Hausbudget, damit B5 wirklich das Maximum bleibt. Offiziell hat B4 kein Game-Changer-Limit; für eure Runde ist das Hausbudget die nützlichere Bremse.

## Grenzen

- Die Goldfish-Simulation ist eine Heuristik, keine vollständige Spiel-Engine.
- Der Agent kann langsam sein. Ein Build dauert typischerweise ein bis drei Minuten.
- Der Import liest Textlisten, keine CSV-Dateien. Moxfield/Archidekt bitte als Text exportieren.
- Das manuelle Spielprotokoll ist bewusst schlank: Sieger, Züge, Fun, Salz, Notizen. Beendete Live-Tische liefern die vollen Teilnehmerdaten; bei nachgetragenen Runden zählt der Sieger. Kartenleistung und Pod-Balancing kommen später.
- Die App ist für das lokale, vertrauenswürdige WLAN gebaut. Die Profile sind passwortlos; exponiere sie deshalb nicht über Cloudflare Tunnel oder eine Portweiterleitung. Für Zugriff von außen wäre wieder eine echte Anmeldung nötig.
- Die Ersteinrichtung ist nur einmal möglich. Danach gibt es keine offene Registrierung, nur Einladungscodes.
- Der Deck-Doctor ist deterministisch und erklärt seine Swaps mit Engine-Gründen. Die KI erklärt auf Wunsch die fertigen Vorschläge, wählt aber keine Karten aus und ändert sie nicht.
- Der Doctor schlägt nur offiziell legale Karten vor. 0 Rule gilt für den Bestand, nicht als Empfehlung für neue Karten.
- EDHREC hat keine offizielle API. Die App nutzt Scryfall-Tagger, Spellbook-fähige Signale und euer Urteil, nicht EDHREC-Scraping.
- MPCFill ist ein Community-Projekt mit inoffizieller API. Bei Ausfall bleiben Scryfall-Arts und eigene URLs.
- Private Proxies only. Artist- und Copyright-Hinweise nicht entfernen, keine Paywall, kein Weiterverkauf.

## Rechtliches

Scryfall-Daten und -Bilder werden unter der Wizards Fan Content Policy genutzt. Die App ist privates Fan-Projekt, kein offizielles Produkt. Card images © Wizards of the Coast. MPCFill-Arts gehören den jeweiligen Artistinnen und Artists. Die Comprehensive Rules sind ein von Wizards veröffentlichtes Regelwerk; die App zitiert sie für den privaten Gebrauch.
