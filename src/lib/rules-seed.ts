export const BRACKETS = [
  {
    id: 3,
    name: "Upgraded",
    tagline: "Stark verbessert, aber noch nicht optimiert.",
    description:
      "Ein Deck mit klarer Strategie, guter Synergie und einzelnen starken Karten. Bis zu drei Game Changers. Kein cEDH-Renner, aber auch kein Precon.",
    gc_limit: 3,
    expected_turns: "ab Zug 6",
    quotas: { land: 37, ramp: 10, draw: 10, removal: 10, wipe: 3, protection: 3, tutor: 2, recursion: 3, wincon: 2, synergy: 15, flex: 4 },
  },
  {
    id: 4,
    name: "Optimized",
    tagline: "Alles, was die Strategie hergibt, konsequent gebaut.",
    description:
      "Schnelle Manabase, dichte Interaktion, klare Wincons. Combos sind erlaubt, sofern eure Hausregeln sie nicht ausschließen. Hausbudget: bis zu 8 Game Changers, 5 Tutoren, 5 Fast-Mana-Karten, 2 Extra-Züge.",
    gc_limit: null,
    expected_turns: "ab Zug 4",
    quotas: { land: 34, ramp: 12, draw: 12, removal: 12, wipe: 3, protection: 4, tutor: 3, recursion: 2, wincon: 3, synergy: 13, flex: 1 },
  },
  {
    id: 5,
    name: "Unser Maximum",
    tagline: "Das obere Ende eures Pods, kein cEDH-Zwang.",
    description:
      "Volle Power innerhalb eurer Hausregeln. Kein Turn-1-Kill nötig, aber jede Karte muss ihren Platz verdienen. Kein Hausbudget, weil B5 das Maximum des Pods ist. Bewusst anders als das offizielle cEDH-Bracket.",
    gc_limit: null,
    expected_turns: "offen",
    quotas: { land: 32, ramp: 14, draw: 13, removal: 14, wipe: 2, protection: 4, tutor: 4, recursion: 2, wincon: 4, synergy: 10, flex: 0 },
  },
]

export const FORMAT_RULES = [
  {
    id: "deck-size",
    category: "Deckbau",
    title: "Genau 100 Karten, inklusive Commander",
    body:
      "Ein Commander-Deck besteht aus exakt 100 Karten. Der Commander zählt mit und beginnt im Spiel in der Command Zone. Ein Companion kommt zusätzlich dazu und zählt nicht in die 100.",
    citation: "Commander-Regeln, CR 903.5a",
    sort: 10,
  },
  {
    id: "singleton",
    category: "Deckbau",
    title: "Singleton, außer bei Basics",
    body:
      "Von jeder Karte darf nur eine Kopie im Deck sein. Ausnahmen sind Standardländer und Karten, die ausdrücklich mehr Kopien erlauben. Gezählt wird der englische Kartenname.",
    citation: "Commander-Regeln, CR 903.5b",
    sort: 20,
  },
  {
    id: "color-identity",
    category: "Deckbau",
    title: "Farbidentität",
    body:
      "Jede Karte im Deck muss in die Farbidentität des Commanders passen — auch bei 0 Rule. Die Identität umfasst Manasymbole im Manakosten und im Regeltext, Farbindikatoren und characteristic-defining abilities. Bei Partnern ist es die Vereinigung beider Identitäten.",
    citation: "CR 903.4",
    sort: 30,
  },
  {
    id: "commander-eligibility",
    category: "Deckbau",
    title: "Wer darf Commander sein?",
    body:
      "In der Regel eine legendäre Kreatur. Karten, die ausdrücklich sagen, dass sie Commander sein können, zählen ebenfalls. Bei 0 Rule darf auch alles andere gewählt werden, dann ist es aber kein offizielles Commander-Deck.",
    citation: "CR 903.3, Commander-Regeln",
    sort: 40,
  },
  {
    id: "command-zone",
    category: "Spiel",
    title: "Die Command Zone",
    body:
      "Der Commander beginnt im Spiel in der Command Zone und kann von dort gewirkt werden. Wird er aus einer anderen Zone ins Exil oder auf den Friedhof gelegt, darf sein Besitzer ihn stattdessen in die Command Zone legen.",
    citation: "CR 903.6, CR 903.9a",
    sort: 50,
  },
  {
    id: "commander-tax",
    category: "Spiel",
    title: "Commander-Tax",
    body:
      "Jedes Mal, wenn du deinen Commander aus der Command Zone wirkst, kostet er beim nächsten Mal {2} mehr. Die Steuer sammelt sich über das ganze Spiel an.",
    citation: "CR 903.8",
    sort: 60,
  },
  {
    id: "commander-damage",
    category: "Spiel",
    title: "21 Commander-Schaden",
    body:
      "Erleidet ein Spieler insgesamt 21 oder mehr Kampfschaden von demselben Commander, verliert er das Spiel. Schaden von Kopien zählt zum selben Commander, sofern es dieselbe Karte ist.",
    citation: "CR 903.10a",
    sort: 70,
  },
  {
    id: "partner",
    category: "Deckbau",
    title: "Partner, Background, Friends Forever",
    body:
      "Manche Commander erlauben einen zweiten Commander. Partner, Partner with, Choose a Background, Doctor's Companion und Friends Forever haben unterschiedliche Bedingungen. Die Farbidentität des Decks ist dann die Vereinigung beider Karten.",
    citation: "Commander-Regeln, CR 903.3",
    sort: 80,
  },
  {
    id: "companion",
    category: "Deckbau",
    title: "Companion",
    body:
      "Ein Companion startet außerhalb des Spiels und zählt nicht in die 100 Karten. Die Deckliste muss seine Bedingung erfüllen, und seine Farbidentität muss zur Identität des Commanders passen. Er kann einmal pro Spiel aus der Companion-Zone gewirkt werden.",
    citation: "CR 702.139",
    sort: 90,
  },
  {
    id: "multiplayer",
    category: "Spiel",
    title: "Free-for-all für 3 bis 5 Spieler",
    body:
      "Commander wird üblicherweise als Free-for-all gespielt. Bei fünf Spielern sind „each opponent“-Effekte deutlich stärker, während sich 21 Commander-Schaden auf mehr Gegner verteilen. Die Sitzreihenfolge und die politische Dynamik gehören zum Format.",
    citation: "CR 800, Commander-Regeln",
    sort: 100,
  },
  {
    id: "mulligan",
    category: "Spiel",
    title: "London-Mulligan",
    body:
      "Ziehe sieben Karten. Entscheidest du dich für einen Mulligan, mischst du zurück und ziehst wieder sieben; danach legst du eine Karte weniger auf den Boden. In der Freizeitrunde sind freundlichere Varianten üblich, solange alle am Tisch zustimmen.",
    citation: "CR 103.5, Hausregel",
    sort: 110,
  },
  {
    id: "poison",
    category: "Spiel",
    title: "Zehn Giftmarken",
    body:
      "Ein Spieler mit zehn oder mehr Giftmarken verliert das Spiel. Gift ist ein alternativer Siegweg und keine Schadensart.",
    citation: "CR 704.5c",
    sort: 120,
  },
  {
    id: "wishes",
    category: "Spiel",
    title: "Wishes und Sideboards",
    body:
      "Commander hat kein Sideboard. Wishes funktionieren nur, wenn die Runde vorher sagt, worauf sie zugreifen dürfen. Bei 0 Rule könnt ihr das großzügig regeln, solltet es aber vor dem Spiel ansagen.",
    citation: "Commander-Regeln, Hausregel",
    sort: 130,
  },
  {
    id: "bracket-3",
    category: "Bracket",
    title: "Bracket 3: Upgraded",
    body:
      "Stark verbessert, klare Synergie, einzelne Game Changers. Offiziell bis zu drei Game Changers, erwartete Spieldauer ab sechs Zügen. Kein optimiertes cEDH-Metagame.",
    citation: "Commander Brackets, Stand 2026",
    sort: 200,
  },
  {
    id: "bracket-4",
    category: "Bracket",
    title: "Bracket 4: Optimized",
    body:
      "Konsequent auf die Strategie gebaut, schnelle Manabase, dichte Interaktion. Game Changers unbegrenzt, erwartete Spieldauer ab vier Zügen. Combos sind erlaubt, wenn eure Hausregeln sie nicht ausschließen.",
    citation: "Commander Brackets, Stand 2026",
    sort: 210,
  },
  {
    id: "bracket-5",
    category: "Bracket",
    title: "Bracket 5: Unser Maximum",
    body:
      "Eure Hausdefinition: das stärkste, was der Pod spielt. Kein Zwang zu cEDH, kein Turn-1-Rennen. Die Engine behandelt B5 als „alles, was die Gruppe zulässt“, nicht als offizielles cEDH.",
    citation: "Hausregel, in Anlehnung an Commander Brackets",
    sort: 220,
  },
  {
    id: "game-changers",
    category: "Bracket",
    title: "Game Changers",
    body:
      "Game Changers sind Karten, die ein Spiel stark verändern. Bracket 3 erlaubt bis zu drei, Bracket 4 und 5 unbegrenzt. Die App zählt sie automatisch und zeigt sie im Bracket-Audit. Stand 2026: 53 Karten.",
    citation: "Commander Brackets, Scryfall is:gamechanger",
    sort: 230,
  },
  {
    id: "one-win",
    category: "Hausregel",
    title: "1-Win-Karten",
    body:
      "Gemeint sind Karten, die ausdrücklich sagen, dass du das Spiel gewinnst, sobald die Bedingung erfüllt ist. Die App erkennt sie am Oracle-Text „you win the game“ und hält sie aus jedem Deck: aus dem Kandidatenpool, aus Importen und aus manuellen Ergänzungen. Es gibt keinen Schalter.",
    citation: "Hausregel",
    sort: 300,
  },
  {
    id: "zero-rule",
    category: "Hausregel",
    title: "0 Rule",
    body:
      "Bei euch gilt: Legalität ist kein Ausschlusskriterium. Die App prüft standardmäßig nur Struktur (100 Karten, Singleton) und markiert alles andere als Hinweis. Die Farbidentität des Commanders bleibt immer Pflicht. Jeder andere Schalter lässt sich einzeln an- und ausschalten.",
    citation: "Hausregel",
    sort: 310,
  },
  {
    id: "proxies",
    category: "Hausregel",
    title: "Proxies",
    body:
      "Proxies sind erlaubt. Für den Druck zählt nicht der Kartenpreis, sondern Papier, Tinte und Zeit. Die App exportiert Decklisten für den privaten Gebrauch; Druck und Proxy-Produktion laufen in der separaten App. Keine Kartenbilder als Handelsware.",
    citation: "Hausregel",
    sort: 320,
  },
  {
    id: "uugguu-tokens",
    category: "Regelklarstellung",
    title: "Uugguu und Token-Kopien",
    body:
      "Uugguu triggert, wenn eine andere Nicht-Token-Ooze stirbt. Die Kopien, die er erzeugt, sind Token und keine Karten; sie sind 2/2 und nicht legendär. Sie triggern Uugguu also nicht selbst. Sterben sie, gehen sie nur in den Friedhof, nicht auf die Hand.",
    citation: "Kartenruling, Oracle-Text",
    sort: 400,
  },
]
