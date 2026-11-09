---
name: commander-deckbuilder
description: Baut und prüft Commander-Decks für eine Vierer- bis Fünferrunde mit 0 Rule, Bracket 3 bis 5 und deutschen Primern.
---

# Commander Deckbuilder

## Zweck

Diese Skill baut Commander-Decks, die nicht nur legal aussehen, sondern zu einem konkreten Pod passen. Sie ist für die Kommandozentrale geschrieben, funktioniert aber auch in einer opencode-Session.

Der Ablauf ist immer gleich:

1. Auftrag lesen: Commander, Bracket, Pod-Größe, Hausregeln, gesperrte Karten.
2. Plan zeichnen: Achsen, Wincons, Rollenquoten, Manabase-Bedarf.
3. Kandidaten aus der Datenbank ziehen. Keine Karte aus dem Gedächtnis.
4. Auswählen, begründen, validieren, reparieren.
5. Bracket-Audit, Primer, Maybeboard.

## Harte Regeln

- Der Commander zählt in die 100 Karten und steht nicht in der 99er-Liste.
- Singleton pro englischem Kartennamen, außer Basics und Karten, die mehr Kopien erlauben.
- Farbidentität ist immer Pflicht: Jede Karte im Deck muss in die Identität des Commanders passen, auch bei 0 Rule.
- Keine Karte erfinden. Jeder Name muss in der Kandidatenliste oder in der Datenbank auflösbar sein.
- 1-Win-Karten sind Karten mit „you win the game“ im Oracle-Text. Sie sind immer ausgeschlossen; es gibt keinen Schalter.
- Der Agent speichert kein Deck, das die harten Checks nicht besteht, außer der Nutzer überschreibt bewusst.
- Jede Regelaussage bekommt eine CR-Nummer oder ein Ruling. Keine erfundenen Interaktionen.

## Bracket-Hausbudget

Die App nutzt ein Hausbudget, damit B4 nicht heimlich B5 ist:

| Bracket | Game Changers | Tutoren | Fast Mana | Extra-Züge | Mass Land Denial |
|---|---|---|---|---|---|
| 3 Upgraded | 3 | 3 | 2 | 1 | nein |
| 4 Optimized | 8 | 5 | 5 | 2 | ja, aber sparsam |
| 5 Unser Maximum | kein Limit | kein Limit | kein Limit | kein Limit | ja |

B5 ist ausdrücklich **nicht** cEDH. Es ist das obere Ende des Pods. Wenn der Pod kein cEDH spielt, ist B5 kein Turn-1-Rennen.

## Rollenquoten

Die Engine nutzt feste Quoten, die der Agent als Richtwert bekommt. Er darf abweichen, muss es aber im Primer erklären.

- **B3:** 37 Länder, 10 Ramp, 10 Draw, 10 Removal, 3 Wipes, 3 Schutz, 2 Tutoren, 3 Rekursion, 2 Wincons, 15 Synergie, 4 Flex.
- **B4:** 34 Länder, 12 Ramp, 12 Draw, 12 Removal, 3 Wipes, 4 Schutz, 3 Tutoren, 2 Rekursion, 3 Wincons, 13 Synergie, 1 Flex.
- **B5:** 32 Länder, 14 Ramp, 13 Draw, 14 Removal, 2 Wipes, 4 Schutz, 4 Tutoren, 2 Rekursion, 4 Wincons, 10 Synergie.

Rollen dürfen sich überschneiden. Ein Cultivate ist Ramp und Tutor; für die Quote zählt die primäre Rolle.

## Pod-Größe

- **4 Spieler:** drei Gegner. „Each opponent“ trifft dreimal. 21 Commander-Schaden ist erreichbar, aber nicht trivial.
- **5 Spieler:** vier Gegner. „Each opponent“ trifft viermal, Aggro verliert, Board Wipes und Card Advantage gewinnen. Mehr Interaktion, mehr Mana-Sinks, mehr politische Karten. „Targeted“ Removal ist relativ schwächer, symmetrische Effekte stärker.
- **3 Spieler:** zwei Gegner. Aggro und Commander-Damage sind stärker, „each opponent“ schwächer.

## Anti-Synergie

Vor dem Speichern prüfen:

- Friedhofshass im eigenen Reanimator oder Meren-Deck.
- Board Wipes im Token- oder Elfen-Deck, die das eigene Brett mehr treffen als die Gegner.
- Zu viele farblose Länder in einer pip-lastigen Manabase.
- „Win-more“-Karten, die nur funktionieren, wenn du schon vorn liegst.
- Karten, die den Commander deaktivieren (Humility, Dress Down, Torpor Orb).
- Zu viele Tutoren für B3, zu wenige Interaktion für B5.
- Mass Land Denial ohne Möglichkeit, selbst weiterzuspielen.
- 1-Win-Karten. Sie sind ausgeschlossen; keine vorschlagen.

## Manabase

- Zähle farbige Pips, nicht nur Karten. Eine Karte mit {B}{B} braucht mehr schwarze Quellen als eine mit {1}{B}.
- Jede Farbe braucht genug Quellen, um ihren Anteil der Pips zu tragen. Faustregel: 16–18 Quellen für eine Hauptfarbe, 12–14 für eine Nebenfarbe, 8–10 für einen Splash.
- Getappte Länder sind ein Tempoverlust. In B4/B5 nur so viele, wie der Plan verkraftet.
- Fetches und Duals zählen als Quellen, aber nicht als zwei Länder.
- Die Goldfish-Simulation zeigt verpasste Land Drops und Farb-Screw. Sie ersetzt kein Playtesting.

## Primer

Der Primer ist kein Marketingtext. Er erklärt:

1. **Idee:** Was macht das Deck, in einem Absatz.
2. **Command Zone:** Wie funktioniert der Commander, was ist der häufigste Fehler?
3. **Plan:** Die Achsen, die Wincons, die Reihenfolge.
4. **Regelklarstellung:** Interaktionen, die oft falsch gespielt werden, mit CR-Nummer.
5. **Salzpaket:** Was am Deck nervt und warum es trotzdem fair ist.
6. **Pilotierung:** Mulligan, erste Züge, wann committen, wann zurückhalten.

Ton: direkt, konkret, deutsch. Keine Floskeln. Keine erfundenen Karten. Keine „In der heutigen Meta“-Sätze.

## Evaluationsrubrik

Ein Deck ist gut, wenn:

- 0 harte Legalitätsfehler (wenn der Schalter an ist),
- genau 100 Karten inklusive Commander,
- Rollenquoten zu mindestens 80 Prozent erfüllt,
- Kurve und Manabase plausibel,
- Bracket-Audit innerhalb ±0 des Ziels,
- keine 1-Win-Karte,
- keine offensichtliche Anti-Synergie,
- Primer mit mindestens drei konkreten Interaktionen und einer Regelklarstellung.

Menschliche Bewertung: Spaß, Power, Konsistenz, Salz. Diese Werte kommen aus dem Spielprotokoll, nicht aus dem Modell.
