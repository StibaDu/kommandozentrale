# Rollen und Tags

Die Engine nutzt Scryfall-Tagger-Slugs. Ein Deck ist keine Liste von guten Karten, sondern eine Menge von Rollen, die zusammen einen Plan ergeben.

## Rollen

| Rolle | Aufgabe | Beispiele für Tags |
|---|---|---|
| Land | Mana, Farben, Utility | `land`, `utility-land` |
| Ramp | Beschleunigen | `ramp`, `land-ramp`, `mana-rock`, `mana-dork`, `ritual`, `adds-multiple-mana` |
| Draw | Kartenvorteil | `draw-engine`, `pure-draw`, `burst-draw`, `repeatable-card-advantage` |
| Removal | Einzelbedrohungen beantworten | `spot-removal`, `removal-creature`, `removal-nonland`, `removal-exile` |
| Wipe | Brett zurücksetzen | `sweeper`, `multi-removal` |
| Schutz | Commander/Wincon halten | `protects-creature`, `protects-all`, `gives-hexproof`, `gives-indestructible` |
| Tutor | Gezielt suchen | `tutor-to-hand`, `tutor-to-battlefield`, `tutor-creature` |
| Rekursion | Zweite Chance | `reanimate-creature`, `regrowth-any`, `castable-from-graveyard` |
| Wincon | Spiel beenden | `alternate-win-condition`, `overrun`, `drain-life`, `opponent-loses-life` |
| Synergie | Plan verdichten | `typal-ooze`, `copy-token`, `death-trigger`, `sacrifice-outlet-creature` |
| Flex | Solide Karte ohne feste Rolle | alles andere |

## Primäre vs. sekundäre Rolle

Eine Karte kann mehrere Rollen erfüllen. Für die Quoten zählt die primäre Rolle, für die Analyse dürfen sekundäre Rollen mitgezählt werden. Beispiel: Cultivate ist Ramp und Tutor; für die Quote zählt Ramp. Ein Removal mit Draw ist Removal, aber im Primer als „Interaktion mit Card Advantage“ beschrieben.

## Synergie statt Popularität

EDHREC-Rank ist ein Popularitätssignal, kein Qualitätssignal. Eine Karte mit hohem Rank kann im konkreten Deck schlecht sein. Prüfe immer:

- Passt die Karte zum Commander-Text?
- Erfüllt sie eine Rolle, die noch fehlt?
- Ist sie in dieser Manabase castbar?
- Ist sie gegen das, was der Pod spielt, relevant?

## Anti-Synergie

Rollen können sich gegenseitig ausschalten. Ein Board Wipe im Token-Deck ist oft kein Removal, sondern ein Rückschlag. Ein Friedhofshass im Reanimator ist kein Hate, sondern ein Selbstschuss. Prüfe das vor dem Speichern.
