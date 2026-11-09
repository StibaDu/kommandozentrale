import { db } from "../db"
import { parseCard } from "./engine"
import type { Card } from "./types"

/**
 * Kartensuche über Namen *und* Effekte.
 *
 * Deutsch rein, englischer Oracle-Text raus: der Index (`card_fts`) ist
 * englisch, die Eingabe deutsch. Dazwischen liegen ein Glossar, ein paar
 * Mehrwortphrasen und die Scryfall-Tags aus `card_tag`. Alles lokal.
 *
 * Ranking: Relevanz kommt aus FTS5 (Phrase / NEAR / AND), Popularität aus
 * EDHREC. Innerhalb einer Stufe wird nach EDHREC sortiert, nicht nach bm25 —
 * bm25 bevorzugt sonst seltene Wörter und damit obskure Karten.
 */

export type SearchMode = "auto" | "name" | "effect"

export interface SearchOptions {
  mode?: SearchMode
  limit?: number
  /** Farbidentität des offenen Decks. undefined = nicht filtern, [] = farblos. */
  colorIdentity?: string[]
  commanderLegal?: boolean
  maxCmc?: number
  type?: string
  /** Nur legendäre Kreaturen, die als Commander legal sind (Vision-Suche). */
  legendaryCommander?: boolean
}

export interface SearchMatch {
  kind: "name" | "text" | "tag"
  tags: string[]
  snippet: string | null
}

export interface SearchHit {
  card: Card
  score: number
  match: SearchMatch
}

export interface BuiltQuery {
  terms: string[]
  tags: string[]
  phrase: string | null
  near: string | null
  and: string | null
  or: string | null
}

// ---------------------------------------------------------------------------
// Glossar: deutsche Begriffe -> englische Oracle-Begriffe
// ---------------------------------------------------------------------------

/** Umlaute normalisieren, damit "Länder" und "Laender" gleich behandelt werden. */
export function normalizeDe(input: string): string {
  return input
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[’‘]/g, "")
}

const STOPWORDS = new Set(
  (
    "der die das den dem des ein eine einen einem einer eines und oder mit fuer für von vom zu zum zur im in am an auf aus bei beim nach ueber über unter vor hinter neben zwischen " +
    "ich mir mich du dir dich wir uns mein meine meiner meinem meinen dein deine deiner sein seine seiner ihrem ihren ihre ihr es sich was wie wo wenn dann auch noch nur sehr mehr viele wenige " +
    "bringen bringt bringe ab " +
    "the a an of to for with and or in on at from by my me i you your that this which who is are be can " +
    "spielen spielt bauen baut"
  ).split(/\s+/),
)

/** Mehrwortphrasen zuerst ersetzen, bevor einzeln übersetzt wird. */
const PHRASES: Array<[string, string]> = [
  ["alle kreaturen", "creature"],
  ["alle laender", "land"],
  ["alle artefakte", "artifact"],
  ["alle verzauberungen", "enchantment"],
  ["alle bleibenden", "permanent"],
  ["alle gegner", "each opponent"],
  ["karten ziehen", "draw a card"],
  ["eine karte ziehen", "draw a card"],
  ["zieht eine karte", "draw a card"],
  ["ziehe eine karte", "draw a card"],
  ["auf die hand", "to your hand"],
  ["ins spiel", "onto the battlefield"],
  ["aus dem friedhof", "from your graveyard"],
  ["gegner opfert eine kreatur", "player sacrifices a creature"],
  ["gegner opfert", "player sacrifices"],
  ["opfert ein land", "sacrifice a land"],
  ["opfert eine kreatur", "sacrifice a creature"],
  ["zerstoere alle", "destroy all"],
  ["zerstoert alle", "destroy all"],
  ["verbanne alle", "exile all"],
  ["verbannt alle", "exile all"],
  ["mana beschleunigen", "add mana"],
  ["mana geben", "add mana"],
  ["mana erzeugen", "add mana"],
  ["mana bekommen", "add mana"],
  ["mana ziehen", "add mana"],
  ["mana produzieren", "add mana"],
  ["laender suchen", "search land"],
  ["gegner wirft karten ab", "player discards"],
  ["karten abwerfen", "discard a card"],
]

/** Einzelwörter. Werte dürfen mehrere englische Begriffe enthalten. */
const WORDS: Record<string, string> = {
  // Zerstören / Entfernen
  zerstoeren: "destroy",
  zerstoere: "destroy",
  zerstoert: "destroy",
  zerstoerung: "destroy",
  vernichten: "destroy",
  vernichte: "destroy",
  toeten: "destroy",
  toete: "destroy",
  toetet: "destroy",
  entfernen: "remove",
  entferne: "remove",
  entfernt: "remove",
  // Exil
  verbannen: "exile",
  verbanne: "exile",
  verbannt: "exile",
  verbannung: "exile",
  exil: "exile",
  // Opfern
  opfern: "sacrifice",
  opfere: "sacrifice",
  opfert: "sacrifice",
  opfer: "sacrifice",
  // Karten
  ziehen: "draw",
  ziehe: "draw",
  zieht: "draw",
  friedhof: "graveyard",
  friedhoefe: "graveyard",
  bibliothek: "library",
  hand: "hand",
  karte: "card",
  karten: "card",
  // Typen
  land: "land",
  laender: "land",
  kreatur: "creature",
  kreaturen: "creature",
  artefakt: "artifact",
  artefakte: "artifact",
  verzauberung: "enchantment",
  verzauberungen: "enchantment",
  planeswalker: "planeswalker",
  spielstein: "token",
  spielsteine: "token",
  // Mana
  mana: "mana",
  // Spieler / Gegner
  gegner: "opponent",
  gegnerin: "opponent",
  gegnerisch: "opponent",
  spieler: "player",
  // Kontrolle
  kontrolle: "control",
  kontrollieren: "control",
  kontrolliert: "control",
  uebernehmen: "control",
  uebernimmt: "control",
  // Kampf
  angriff: "attack",
  angreifen: "attack",
  angreifend: "attack",
  blocken: "block",
  blockt: "block",
  schaden: "damage",
  lebenspunkte: "life",
  leben: "life",
  // Fähigkeiten
  fliegen: "flying",
  fliegend: "flying",
  fliegt: "flying",
  eile: "haste",
  todesberuehrung: "deathtouch",
  lebensverknuepfung: "lifelink",
  wachsamkeit: "vigilance",
  unzerstoerbar: "indestructible",
  fluchsicher: "hexproof",
  schutz: "protection",
  farblos: "colorless",
  // Aktionen
  suchen: "search",
  suche: "search",
  suchst: "search",
  durchsuche: "search",
  durchsucht: "search",
  mischen: "shuffle",
  bekommt: "get",
  bekommen: "get",
  erhalten: "get",
  erhaelt: "get",
  gewinnen: "win",
  gewinnt: "win",
  gewinnst: "win",
  verlieren: "lose",
  verliert: "lose",
  zauber: "spell",
  spruch: "spell",
  sprueche: "spell",
  bleibend: "permanent",
  bleibende: "permanent",
  permanent: "permanent",
  kopiere: "copy",
  kopieren: "copy",
  kopiert: "copy",
  tappen: "tap",
  getappt: "tap",
  tappe: "tap",
  enttappen: "untap",
  oberste: "top",
  oberen: "top",
  oben: "top",
  zug: "turn",
  runde: "turn",
  runden: "turn",
  extra: "extra",
  verdoppeln: "double",
  verdoppelt: "double",
  mill: "mill",
  millen: "mill",
  abwerfen: "discard",
  abwirft: "discard",
  wirft: "discard",
  ausruesten: "equip",
  anlegen: "attach",
  stirbt: "dies",
  sterben: "die",
  gestorben: "died",
}

/**
 * Begriffe, die direkt auf Scryfall-Tags zeigen. Die Tags sind präziser als
 * Volltext ("wipe" steht in keinem Oracle-Text).
 */
const TAG_HINTS: Record<string, string[]> = {
  wipe: ["sweeper", "multi-removal", "sweeper-one-sided"],
  boardwipe: ["sweeper", "multi-removal", "sweeper-one-sided"],
  boardreset: ["sweeper", "multi-removal"],
  sweeper: ["sweeper", "multi-removal", "sweeper-one-sided"],
  removal: ["spot-removal", "removal-creature", "removal-destroy", "removal-exile", "removal-sacrifice"],
  spotremoval: ["spot-removal"],
  ramp: ["ramp", "land-ramp", "mana-rock", "mana-dork", "ritual"],
  manarock: ["mana-rock"],
  manadork: ["mana-dork"],
  tutor: ["tutor-to-hand", "tutor-to-top", "tutor-to-battlefield", "tutor-land-to-battlefield", "tutor-creature", "tutor-land-basic", "tutor-card", "tutor-artifact", "tutor-instant", "tutor-sorcery", "tutor-enchantment", "tutor-permanent", "tutor-planeswalker", "tutor-mv"],
  suchen: ["tutor-to-hand", "tutor-to-top", "tutor-to-battlefield", "tutor-land-to-battlefield", "tutor-creature", "tutor-land-basic", "tutor-card", "tutor-artifact", "tutor-instant", "tutor-sorcery", "tutor-enchantment", "tutor-permanent", "tutor-planeswalker", "tutor-mv"],
  durchsuchen: ["tutor-to-hand", "tutor-to-top", "tutor-to-battlefield", "tutor-land-to-battlefield", "tutor-creature", "tutor-land-basic", "tutor-card", "tutor-artifact", "tutor-instant", "tutor-sorcery", "tutor-enchantment", "tutor-permanent", "tutor-planeswalker", "tutor-mv"],
  counter: ["counterspell", "counterspell-soft", "counterspell-free", "counterspell-exile", "counterspell-noncreature"],
  counterspell: ["counterspell", "counterspell-soft", "counterspell-free", "counterspell-exile", "counterspell-noncreature"],
  kontern: ["counterspell", "counterspell-soft", "counterspell-free", "counterspell-exile", "counterspell-noncreature"],
  gegenzauber: ["counterspell", "counterspell-soft", "counterspell-free", "counterspell-exile", "counterspell-noncreature"],
  draw: ["draw-engine", "repeatable-pure-draw", "repeatable-card-advantage", "pure-draw", "burst-draw"],
  carddraw: ["draw-engine", "repeatable-pure-draw", "repeatable-card-advantage", "pure-draw", "burst-draw"],
  reanimate: ["reanimate-creature", "mass-reanimation"],
  reanimieren: ["reanimate-creature", "mass-reanimation"],
  wiederbeleben: ["reanimate-creature", "mass-reanimation"],
  token: ["repeatable-creature-tokens"],
  tokens: ["repeatable-creature-tokens"],
  sac: ["sacrifice-outlet-creature"],
  opferoutlet: ["sacrifice-outlet-creature"],
  landdestruction: ["mass-land-denial"],
  ld: ["mass-land-denial"],
  extrazug: ["extra-turn"],
  extrazuege: ["extra-turn"],
  extraturn: ["extra-turn"],
  extraturns: ["extra-turn"],
  lifegain: ["lifegain"],
  drain: ["drain-life"],
  drainen: ["drain-life"],
  draint: ["drain-life"],
  aussaugen: ["drain-life"],
  overrun: ["overrun"],
  clone: ["copy-creature", "clone"],
  uebernehmen: ["theft-creature", "theft-permanent", "theft-mass"],
  stehlen: ["theft-creature", "theft-permanent", "theft-artifact"],
  ziehen: ["draw-engine", "repeatable-pure-draw", "repeatable-card-advantage", "pure-draw", "burst-draw"],
  beschleunigen: ["ramp", "land-ramp", "mana-rock", "mana-dork", "ritual"],
  rampe: ["ramp", "land-ramp", "mana-rock", "mana-dork", "ritual"],
}

const TAG_WEIGHT_BONUS: Record<string, number> = { very_strong: 40, strong: 20, median: 0 }

const TYPE_TERMS = new Set(["creature", "artifact", "land", "enchantment", "instant", "sorcery", "planeswalker", "battle", "token"])

/** Spielerbegriffe sind weich: "Gegner opfert eine Kreatur" soll nicht an "opponent" scheitern. */
const SOFT_TERMS = new Set(["opponent", "player"])

// ---------------------------------------------------------------------------
// Query bauen
// ---------------------------------------------------------------------------

function containsWord(haystack: string, needle: string): boolean {
  if (needle.length <= 4) return haystack.includes(needle)
  return new RegExp(`(^|[^a-z0-9])${needle}([^a-z0-9]|$)`).test(haystack)
}

function cleanTerm(term: string): string {
  return term.replace(/[^a-z0-9]/g, "")
}

/** Nur den Oracle-Text durchsuchen — Namenstreffer gehören in die Namenssuche. */
function textQuery(expression: string): string {
  return `oracle_text_all : (${expression})`
}

interface MappedGerman {
  normalized: string
  /** Phrasen-ersetzter Text (deutsche Einzelwörter bleiben stehen). */
  text: string
  /** Alle Begriffe inkl. roher, unbekannter Wörter (normale Suche). */
  terms: string[]
  /** Nur Begriffe, die wirklich aus dem Glossar stammen. */
  mappedTerms: string[]
  /** Deutsche Wörter/Phrasen, die einen Treffer ausgelöst haben. */
  cues: string[]
}

function mapGerman(input: string): MappedGerman {
  const normalized = normalizeDe(input)
  let text = ` ${normalized} `
  const cues: string[] = []
  const terms: string[] = []
  const mappedTerms: string[] = []

  for (const [phrase, replacement] of PHRASES) {
    if (text.includes(phrase)) {
      text = text.split(phrase).join(` ${replacement} `)
      cues.push(phrase)
      // Die englischen Ersatzwörter stehen sonst nur im Text und gingen
      // für `effectProfile` verloren (das nur Glossar-Treffer behält).
      terms.push(...replacement.split(" "))
      mappedTerms.push(...replacement.split(" "))
    }
  }

  for (const raw of text.split(/[^a-z0-9]+/)) {
    if (!raw || raw.length < 2) continue
    if (STOPWORDS.has(raw)) continue
    const mapped = WORDS[raw]
    if (mapped) {
      const parts = mapped.split(" ")
      terms.push(...parts)
      mappedTerms.push(...parts)
      cues.push(raw)
    } else if (raw.length >= 3) {
      terms.push(raw)
    }
  }

  return { normalized, text, terms, mappedTerms, cues }
}

function uniqueTerms(terms: string[], limit = 8): string[] {
  return [...new Set(terms.map(cleanTerm).filter((t) => t.length >= 2))].slice(0, limit)
}

function deriveTags(normalized: string, terms: string[]): Set<string> {
  const tags = new Set<string>()
  for (const [key, list] of Object.entries(TAG_HINTS)) {
    if (containsWord(normalized, key)) for (const tag of list) tags.add(tag)
  }

  const termSet = new Set(terms)
  const has = (term: string) => termSet.has(term) || termSet.has(`${term}s`)
  if (has("destroy") && has("land")) tags.add("mass-land-denial")
  if ((has("destroy") || has("exile") || has("remove")) && has("land")) tags.add("removal-land")
  if ((has("destroy") || has("exile") || has("remove")) && has("enchantment")) tags.add("removal-enchantment")
  if ((has("destroy") || has("exile") || has("remove")) && has("artifact")) tags.add("removal-artifact")
  if (has("graveyard")) {
    if (has("exile") || has("remove")) {
      tags.add("hate-graveyard")
      tags.add("sweeper-graveyard")
      tags.add("graveyard-seal")
      tags.add("single-minded-graveyard-hate")
    } else {
      // "Friedhof als Ressource" ist das Gegenteil von Hate: Rekursion.
      tags.add("reanimate-creature")
      tags.add("castable-from-graveyard")
      tags.add("regrowth-any")
    }
  }
  if (has("sacrifice") && has("land")) tags.add("sacrifice-outlet-land")
  if (has("sacrifice") && has("creature")) {
    if (has("opponent") || has("player")) tags.add("removal-sacrifice")
    else tags.add("sacrifice-outlet-creature")
  }
  if (has("draw") && has("card")) tags.add("cantrip")
  if (has("mana") && (has("add") || has("produce"))) tags.add("mana-producer")
  if (has("search") && has("land")) tags.add("tutor-land-basic")
  if (has("search") && has("creature")) tags.add("tutor-creature")
  if (has("search") && has("artifact")) tags.add("tutor-artifact")
  if (has("search") && has("permanent")) tags.add("tutor-permanent")
  return tags
}

export function buildQuery(input: string): BuiltQuery {
  const mapped = mapGerman(input)
  const tags = deriveTags(mapped.normalized, mapped.terms)

  const unique = uniqueTerms(mapped.terms)
  const core = unique.length > 2 ? unique.filter((t) => !SOFT_TERMS.has(t)) : unique
  const strict = core.length ? core : unique
  const nearWindow = strict.length <= 2 ? 10 : strict.length === 3 ? 14 : 20

  return {
    terms: unique,
    tags: [...tags],
    phrase: strict.length > 1 ? textQuery(`"${strict.join(" ")}"*`) : null,
    near: strict.length > 1 ? textQuery(`NEAR(${strict.map((t) => `${t}*`).join(" ")}, ${nearWindow})`) : null,
    and: strict.length ? textQuery(strict.map((t) => `${t}*`).join(" AND ")) : null,
    or: unique.length > 1 ? textQuery(unique.map((t) => `${t}*`).join(" OR ")) : strict.length === 1 ? textQuery(`${strict[0]}*`) : null,
  }
}

/** Für Stellen, die nur einen einzelnen Begriff in den FTS-Index schicken wollen. */
export function ftsMatchForTerm(term: string): string | null {
  return buildQuery(term).near ?? buildQuery(term).and
}

export interface EffectProfile {
  /** Englische Oracle-Begriffe aus dem Glossar. */
  terms: string[]
  tags: string[]
  /** Die deutschen Wörter/Phrasen, die den Treffer ausgelöst haben. */
  cues: string[]
}

/**
 * Effekt-Profil eines Freitexts (z. B. der Deck-Vision).
 *
 * Anders als `buildQuery` behält es nur Glossar-Treffer. In einem langen
 * deutschen Text würde jedes unbekannte Wort sonst als roher Suchbegriff
 * im englischen Oracle-Index landen und die Treffer verwässern.
 */
export function effectProfile(input: string): EffectProfile {
  const mapped = mapGerman(input)
  return {
    terms: uniqueTerms(mapped.mappedTerms),
    tags: [...deriveTags(mapped.text, mapped.mappedTerms)].slice(0, 8),
    cues: [...new Set(mapped.cues)].slice(0, 8),
  }
}

// ---------------------------------------------------------------------------
// Ausführung
// ---------------------------------------------------------------------------

interface Filter {
  sql: string
  params: any[]
}

function filters(opts: SearchOptions): Filter {
  const clauses: string[] = ["card.is_one_win = 0"]
  const params: any[] = []

  if (opts.commanderLegal) {
    clauses.push("json_extract(card.legalities, '$.commander') = 'legal'")
  }
  if (opts.colorIdentity) {
    if (opts.colorIdentity.length === 0) {
      clauses.push("json_array_length(card.color_identity) = 0")
    } else {
      const placeholders = opts.colorIdentity.map(() => "?").join(",")
      clauses.push(`NOT EXISTS (SELECT 1 FROM json_each(card.color_identity) WHERE value NOT IN (${placeholders}))`)
      params.push(...opts.colorIdentity)
    }
  }
  if (opts.maxCmc != null) {
    clauses.push("card.cmc <= ?")
    params.push(opts.maxCmc)
  }
  if (opts.type) {
    clauses.push("card.type_line LIKE ? COLLATE NOCASE")
    params.push(`%${opts.type}%`)
  }
  if (opts.legendaryCommander) {
    clauses.push("card.is_legendary = 1 AND card.is_creature = 1")
  }
  return { sql: clauses.join(" AND "), params }
}

function escapeLike(value: string): string {
  return value.replace(/[%_]/g, "")
}

function edhrecBonus(rank: number | null): number {
  if (rank == null) return 0
  return 120 * (1 - Math.min(1, Math.log10(rank + 10) / 6))
}

interface Candidate {
  row: any
  score: number
  nameHit: boolean
  textHit: boolean
  tags: Set<string>
  snippets: string[]
}

function snippetFor(text: string | null, terms: string[]): string | null {
  if (!text) return null
  const lower = text.toLowerCase()
  let index = -1
  let length = 0
  for (const term of terms) {
    const at = lower.indexOf(term)
    if (at >= 0 && (index < 0 || at < index)) {
      index = at
      length = term.length
    }
  }
  if (index < 0) return null
  const start = Math.max(0, index - 70)
  const end = Math.min(text.length, index + length + 100)
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`
}

function ftsRows(match: string, filter: Filter, limit: number): any[] {
  try {
    return db
      .query(
        `SELECT card.* FROM card_fts JOIN card ON card.oracle_id = card_fts.oracle_id
         WHERE card_fts MATCH ? AND ${filter.sql}
         ORDER BY card.edhrec_rank IS NULL, card.edhrec_rank
         LIMIT ?`,
      )
      .all(match, ...filter.params, limit) as any[]
  } catch {
    return []
  }
}

function tagRows(tags: string[], filter: Filter, limit: number): any[] {
  if (!tags.length) return []
  const placeholders = tags.map(() => "?").join(",")
  try {
    return db
      .query(
        `SELECT card.*, ct.tag AS _tag, ct.weight AS _weight
         FROM card JOIN card_tag ct ON ct.oracle_id = card.oracle_id
         WHERE ct.tag IN (${placeholders}) AND ${filter.sql}
         ORDER BY card.edhrec_rank IS NULL, card.edhrec_rank
         LIMIT ?`,
      )
      .all(...tags, ...filter.params, limit) as any[]
  } catch {
    return []
  }
}

function runSearch(built: BuiltQuery, opts: SearchOptions, withName: boolean, nameQuery = ""): SearchHit[] {
  const limit = Math.min(50, Math.max(1, opts.limit ?? 18))
  const filter = filters(opts)
  const candidates = new Map<string, Candidate>()

  const add = (row: any, score: number, source: "name" | "text" | "tag") => {
    const existing = candidates.get(row.oracle_id)
    if (!existing) {
      candidates.set(row.oracle_id, {
        row,
        score,
        nameHit: source === "name",
        textHit: source === "text",
        tags: new Set(source === "tag" && row._tag ? [row._tag] : []),
        snippets: source === "text" ? [snippetFor(row.oracle_text_all, built.terms) ?? ""].filter(Boolean) : [],
      })
      return
    }
    existing.score = Math.max(existing.score, score)
    if (source === "name") existing.nameHit = true
    if (source === "text") {
      existing.textHit = true
      const snippet = snippetFor(row.oracle_text_all, built.terms)
      if (snippet && !existing.snippets.includes(snippet)) existing.snippets.push(snippet)
    }
    if (source === "tag" && row._tag) existing.tags.add(row._tag)
  }

  // 1) Name — bleibt erste Priorität, damit Tippen funktioniert.
  let exactName = false
  if (withName) {
    const q = escapeLike(nameQuery)
    if (q.length >= 2) {
      const rows = db
        .query(
          `SELECT card.* FROM card WHERE name LIKE ? COLLATE NOCASE AND ${filter.sql}
           ORDER BY (name = ? COLLATE NOCASE) DESC, edhrec_rank IS NULL, edhrec_rank LIMIT 80`,
        )
        .all(`%${q}%`, ...filter.params, q) as any[]
      for (const row of rows) {
        const name = String(row.name).toLowerCase()
        const query = q.toLowerCase()
        const score = name === query ? 1200 : name.startsWith(query) ? 600 : 220
        if (score >= 1200) exactName = true
        add(row, score, "name")
      }
    }
  }

  // 2) Volltext: Phrase, NEAR, AND, sonst OR.
  //    Bei exaktem Namenstreffer bleibt es bei Namen — sonst rauscht "Sol Ring" zu.
  if (built.and && !exactName) {
    if (built.phrase) {
      const rows = ftsRows(built.phrase, filter, 120)
      rows.forEach((row, i) => add(row, 260 * (1 - i / Math.max(120, rows.length)), "text"))
    }
    if (built.near) {
      const rows = ftsRows(built.near, filter, 300)
      rows.forEach((row, i) => add(row, 220 * (1 - i / Math.max(300, rows.length)), "text"))
    }
    const andRows = ftsRows(built.and, filter, 300)
    if (andRows.length) {
      andRows.forEach((row, i) => add(row, 180 * (1 - i / Math.max(300, andRows.length)), "text"))
    } else if (built.or) {
      // Ein unbekanntes deutsches Wort im AND würde sonst jeden Treffer verhindern.
      const relaxed = ftsRows(built.or, filter, 200)
      relaxed.forEach((row, i) => add(row, 90 * (1 - i / Math.max(200, relaxed.length)), "text"))
    }
  }

  // 3) Tags — präziser als Volltext und oft der eigentliche Treffer.
  //    Ein Volltext-Treffer zählt mehr als ein Tag allein.
  const tagBase = 340
  const rows = exactName ? [] : tagRows(built.tags, filter, 700)
  const tagsPerCard = new Map<string, { tags: Set<string>; bonus: number }>()
  for (const row of rows) {
    const entry = tagsPerCard.get(row.oracle_id) ?? { tags: new Set<string>(), bonus: 0 }
    entry.tags.add(row._tag)
    entry.bonus = Math.max(entry.bonus, tagBase + (TAG_WEIGHT_BONUS[row._weight] ?? 0))
    tagsPerCard.set(row.oracle_id, entry)
  }
  for (const row of rows) {
    const entry = tagsPerCard.get(row.oracle_id)
    if (!entry) continue
    add(row, entry.bonus, "tag")
  }

  const typeTerms = built.terms.filter((t) => TYPE_TERMS.has(t))
  const hits: SearchHit[] = []
  for (const candidate of candidates.values()) {
    const multi = (candidate.nameHit ? 1 : 0) + (candidate.textHit ? 1 : 0) + (candidate.tags.size > 0 ? 1 : 0)
    // "Tutor für Kreaturen" soll den Kreatur-Tutor vor dem Allrounder zeigen.
    const text = String(candidate.row.oracle_text_all ?? "").toLowerCase()
    const typeBoost = typeTerms.some((term) => text.includes(term)) ? 90 : 0
    const score = candidate.score + edhrecBonus(candidate.row.edhrec_rank) + (multi > 1 ? 30 : 0) + typeBoost
    hits.push({
      card: parseCard(candidate.row),
      score,
      match: {
        kind: candidate.nameHit ? "name" : candidate.tags.size > 0 ? "tag" : "text",
        tags: [...candidate.tags].slice(0, 4),
        snippet: candidate.snippets[0] ?? null,
      },
    })
  }

  hits.sort((a, b) => b.score - a.score || (a.card.edhrec_rank ?? 999999) - (b.card.edhrec_rank ?? 999999))
  return hits.slice(0, limit)
}

// ---------------------------------------------------------------------------
// Öffentliche API
// ---------------------------------------------------------------------------

const searchCache = new Map<string, SearchHit[]>()
const SEARCH_CACHE_MAX = 200

function cacheKeyFor(query: string, opts: SearchOptions, withName: boolean): string {
  return JSON.stringify([
    query.trim().toLowerCase(),
    withName,
    opts.mode ?? "auto",
    opts.limit ?? 18,
    opts.colorIdentity ?? null,
    Boolean(opts.commanderLegal),
    opts.maxCmc ?? null,
    opts.type ?? null,
  ])
}

export function searchCards(input: string, opts: SearchOptions = {}): SearchHit[] {
  const query = input.trim()
  if (!query) return []
  const mode = opts.mode ?? "auto"
  const withName = mode !== "effect"
  const built = buildQuery(query)
  if (!withName && !built.and && !built.tags.length) return []

  const key = cacheKeyFor(query, opts, withName)
  const cached = searchCache.get(key)
  if (cached) return cached

  const hits = runSearch(built, opts, withName, query)
  if (searchCache.size >= SEARCH_CACHE_MAX) searchCache.clear()
  searchCache.set(key, hits)
  return hits
}

export interface StructuredQuery {
  terms?: string[]
  tags?: string[]
  maxCmc?: number | null
  type?: string | null
}

/** Für die Interpretation durch das Modell: englische Begriffe und Tags. */
export function searchStructured(spec: StructuredQuery, opts: SearchOptions = {}): SearchHit[] {
  const terms = [...new Set((spec.terms ?? []).flatMap((term) => buildQuery(term).terms))].slice(0, 8)
  const tags = [...new Set((spec.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 8)
  if (!terms.length && !tags.length) return []

  const nearWindow = terms.length <= 2 ? 10 : terms.length === 3 ? 14 : 20
  const built: BuiltQuery = {
    terms,
    tags,
    phrase: terms.length > 1 ? `oracle_text_all : ("${terms.join(" ")}"*)` : null,
    near: terms.length > 1 ? `oracle_text_all : (NEAR(${terms.map((t) => `${t}*`).join(" ")}, ${nearWindow}))` : null,
    and: terms.length ? `oracle_text_all : (${terms.map((t) => `${t}*`).join(" AND ")})` : null,
    or: terms.length > 1 ? `oracle_text_all : (${terms.map((t) => `${t}*`).join(" OR ")})` : terms.length ? `oracle_text_all : (${terms[0]}*)` : null,
  }
  return runSearch(built, { ...opts, maxCmc: spec.maxCmc ?? opts.maxCmc, type: spec.type ?? opts.type }, false)
}
