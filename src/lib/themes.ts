import { db } from "../db"
import {
  bracketQuotas,
  fitsColorIdentity,
  HOUSE_BUDGET,
  makeDeckCard,
  parseCard,
  roleFor,
  tagsFor,
  type Candidate,
} from "./engine"
import { normalizeDe } from "./cardsearch"
import type { BracketId, Card, DeckCard, DeckSettings, Role } from "./types"
import type { VisionCandidate } from "./vision"

/**
 * Mechanik-/Themen-Erkennung für die Deck-Vision.
 *
 * Die Vision ist kein Stimmungstext: Wenn der Spieler "Shadow" sagt, muss der
 * Builder Shadow-Karten und deren Synergien suchen — nicht generische
 * Bracket-Staples. Die Erkennung ist bewusst deterministisch (Glossar +
 * Scryfall-Keywords + Tags + Oracle-Volltext), damit sie auch ohne LLM läuft.
 */

export interface ThemeDef {
  id: string
  label: string
  triggers: string[]
  keywords?: string[]
  tags?: string[]
  excludeTags?: string[]
  terms?: string[]
  synergyTags?: string[]
}

const THEME_DEFS: ThemeDef[] = [
  {
    id: "shadow",
    label: "Shadow",
    triggers: ["shadow", "schatten", "schattenkreatur", "schattenkreaturen"],
    keywords: ["shadow"],
    tags: ["gives-shadow", "gains-shadow", "synergy-shadow", "shadow-counter"],
    excludeTags: ["hate-shadow", "removes-shadow"],
  },
  {
    id: "flying",
    label: "Fliegen",
    triggers: ["flying", "fliegen", "fliegend", "flieger"],
    keywords: ["flying"],
    tags: ["gives-flying", "gives-evasion", "evasion"],
  },
  {
    id: "first-strike",
    label: "Erstschlag",
    triggers: ["first strike", "erstschlag", "erstschläge"],
    keywords: ["first strike"],
    tags: ["gives-first-strike"],
  },
  {
    id: "double-strike",
    label: "Doppelschlag",
    triggers: ["double strike", "doppelschlag"],
    keywords: ["double strike"],
    tags: ["gives-double-strike"],
  },
  {
    id: "deathtouch",
    label: "Todesberührung",
    triggers: ["deathtouch", "todesberuehrung", "todesberührung"],
    keywords: ["deathtouch"],
    tags: ["gives-deathtouch"],
  },
  {
    id: "lifelink",
    label: "Lebensverknüpfung",
    triggers: ["lifelink", "lebensverknuepfung", "lebensverknüpfung"],
    keywords: ["lifelink"],
    tags: ["lifegain", "gives-lifelink", "soulbond"],
  },
  {
    id: "vigilance",
    label: "Wachsamkeit",
    triggers: ["vigilance", "wachsamkeit"],
    keywords: ["vigilance"],
    tags: ["gives-vigilance"],
  },
  {
    id: "haste",
    label: "Eile",
    triggers: ["haste", "eile"],
    keywords: ["haste"],
    tags: ["gives-haste"],
  },
  {
    id: "trample",
    label: "Trampelschaden",
    triggers: ["trample", "trampelschaden"],
    keywords: ["trample"],
    tags: ["gives-trample", "overrun"],
  },
  {
    id: "menace",
    label: "Bedrohung",
    triggers: ["menace", "bedrohung"],
    keywords: ["menace"],
    tags: ["gives-menace"],
  },
  {
    id: "prowess",
    label: "Prowess",
    triggers: ["prowess", "prunk"],
    keywords: ["prowess"],
    tags: ["prowess", "spellslinger"],
  },
  {
    id: "infect",
    label: "Infect / Toxic",
    triggers: ["infect", "infizieren", "toxic", "gift", "poison"],
    keywords: ["infect", "toxic"],
    tags: ["infect", "toxic", "poison", "proliferate"],
  },
  {
    id: "protection",
    label: "Schutz",
    triggers: ["indestructible", "unzerstoerbar", "hexproof", "fluchsicher", "ward", "abwehr", "protection", "schutz"],
    keywords: ["indestructible", "hexproof", "ward", "protection"],
    tags: ["gives-indestructible", "gives-hexproof", "gives-ward", "protects-creature", "protects-all", "protects-permanent"],
  },
  {
    id: "landfall",
    label: "Landfall",
    triggers: ["landfall", "landung", "laender ins spiel", "länder ins spiel"],
    terms: ["landfall"],
    tags: ["landfall", "lands-matter"],
  },
  {
    id: "sacrifice",
    label: "Opfern",
    triggers: ["sacrifice", "opfern", "opfer", "aristocrats", "aristokraten"],
    terms: ["sacrifice"],
    tags: ["sacrifice-outlet-creature", "sacrifice-outlet-permanent", "free-sacrifice-outlet", "death-trigger"],
  },
  {
    id: "tokens",
    label: "Spielsteine",
    triggers: ["token", "tokens", "spielstein", "spielsteine"],
    terms: ["token"],
    tags: ["repeatable-creature-tokens", "creates-tokens", "token"],
  },
  {
    id: "counters",
    label: "+1/+1-Marken",
    triggers: ["+1/+1", "counter", "marken", "counters"],
    terms: ["counter"],
    tags: ["counters-matter", "repeatable-pp-counters", "gains-pp-counters"],
  },
  {
    id: "graveyard",
    label: "Friedhof / Reanimation",
    triggers: ["graveyard", "friedhof", "reanimate", "reanimieren", "wiederbeleben"],
    terms: ["graveyard"],
    tags: ["reanimate-creature", "mass-reanimation", "castable-from-graveyard", "regrowth-any"],
  },
  {
    id: "artifacts",
    label: "Artefakte",
    triggers: ["artifact", "artefakt", "artefakte", "artifacts"],
    terms: ["artifact"],
    tags: ["artifacts-matter", "artifact"],
  },
  {
    id: "enchantments",
    label: "Verzauberungen",
    triggers: ["enchantment", "verzauberung", "verzauberungen", "enchantress", "aura", "auren"],
    terms: ["enchantment", "aura"],
    tags: ["enchantments-matter", "enchantress", "aura"],
  },
  {
    id: "spellslinger",
    label: "Zaubersprüche",
    triggers: ["spellslinger", "zauberspruch", "zaubersprueche", "zaubersprüche", "instant", "sorcery"],
    terms: ["instant", "sorcery"],
    tags: ["spellslinger", "magecraft", "storm"],
  },
  {
    id: "blink",
    label: "Blink / Flackern",
    triggers: ["blink", "flackern", "flicker"],
    terms: ["exile", "return"],
    tags: ["blink", "flicker"],
  },
  {
    id: "mill",
    label: "Mill",
    triggers: ["mill", "muehlen", "mühlen"],
    terms: ["mill"],
    tags: ["mill"],
  },
  {
    id: "discard",
    label: "Abwerfen / Wheels",
    triggers: ["discard", "abwerfen", "wheel", "raeder", "räder"],
    terms: ["discard"],
    tags: ["discard-outlet", "wheel", "discard-matter"],
  },
  {
    id: "lifegain",
    label: "Lebensgewinn",
    triggers: ["lifegain", "lebensgewinn", "leben gewinnen"],
    terms: ["gain life"],
    tags: ["lifegain"],
  },
  {
    id: "drain",
    label: "Leben absaugen",
    triggers: ["drain", "absaugen", "leben verlieren"],
    terms: ["lose life"],
    tags: ["drain-life"],
  },
  {
    id: "voltron",
    label: "Voltron / Ausrüstung",
    triggers: ["voltron", "equipment", "ausruestung", "ausrüstung"],
    terms: ["equipment", "aura"],
    tags: ["equipment", "equipment-matters", "aura"],
  },
  {
    id: "superfriends",
    label: "Superfriends",
    triggers: ["superfriends", "planeswalker", "planeswalker deck"],
    terms: ["planeswalker"],
    tags: ["planeswalker"],
  },
  {
    id: "slivers",
    label: "Sliver",
    triggers: ["sliver", "slivers", "remasuri", "remasuris"],
    terms: ["sliver"],
    tags: ["sliver"],
  },
  {
    id: "dragons",
    label: "Drachen",
    triggers: ["dragon", "dragons", "drache", "drachen"],
    terms: ["dragon"],
    tags: ["dragon"],
  },
  {
    id: "elves",
    label: "Elfen",
    triggers: ["elf", "elfen", "elves"],
    terms: ["elf"],
    tags: ["elf"],
  },
  {
    id: "zombies",
    label: "Zombies",
    triggers: ["zombie", "zombies", "untote"],
    terms: ["zombie"],
    tags: ["zombie"],
  },
  {
    id: "vampires",
    label: "Vampire",
    triggers: ["vampire", "vampire", "vampir", "vampire"],
    terms: ["vampire"],
    tags: ["vampire"],
  },
  {
    id: "goblins",
    label: "Goblins",
    triggers: ["goblin", "goblins"],
    terms: ["goblin"],
    tags: ["goblin"],
  },
  {
    id: "merfolk",
    label: "Meervolk",
    triggers: ["merfolk", "meervolk"],
    terms: ["merfolk"],
    tags: ["merfolk"],
  },
  {
    id: "treasure",
    label: "Schätze",
    triggers: ["treasure", "schatz", "schaetze", "schätze"],
    terms: ["treasure"],
    tags: ["treasure", "repeatable-treasures"],
  },
  {
    id: "energy",
    label: "Energie",
    triggers: ["energy", "energie"],
    terms: ["energy"],
    tags: ["energy"],
  },
  {
    id: "vehicles",
    label: "Fahrzeuge",
    triggers: ["vehicle", "vehicles", "fahrzeug", "fahrzeuge"],
    terms: ["vehicle"],
    tags: ["vehicle"],
  },
  {
    id: "stax",
    label: "Stax / Lock",
    triggers: ["stax", "lock", "hatebear", "steuern"],
    terms: ["can't", "unless"],
    tags: ["stax", "hatebear", "tax"],
  },
  {
    id: "group-hug",
    label: "Group Hug",
    triggers: ["group hug", "gruppe", "allen helfen"],
    terms: ["each player"],
    tags: ["group-hug", "hug"],
  },
  {
    id: "burn",
    label: "Burn",
    triggers: ["burn", "verbrennen", "schaden"],
    terms: ["damage"],
    tags: ["burn", "damage"],
  },
  {
    id: "aggro",
    label: "Aggro",
    triggers: ["aggro", "aggressiv", "angriff", "attack"],
    terms: ["attack", "haste"],
    tags: ["aggro", "attack"],
  },
  {
    id: "control",
    label: "Kontrolle",
    triggers: ["control", "kontrolle", "kontroll"],
    terms: ["counter", "destroy"],
    tags: ["control", "counterspell"],
  },
  {
    id: "combo",
    label: "Combo",
    triggers: ["combo", "kombo", "unendlich", "infinite"],
    terms: ["untap", "infinite"],
    tags: ["combo", "infinite-combo"],
  },
]

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function hasTrigger(text: string, trigger: string): boolean {
  const t = normalizeDe(trigger).trim()
  if (!t) return false
  if (/^[a-z0-9 ]+$/.test(t)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegex(t)}([^a-z0-9]|$)`).test(text)
  }
  return text.includes(t)
}

export function detectThemes(brief: string): ThemeDef[] {
  const text = normalizeDe(String(brief ?? "")).replace(/\s+/g, " ").trim()
  if (!text) return []
  const found: Array<{ def: ThemeDef; pos: number }> = []
  for (const def of THEME_DEFS) {
    let pos = -1
    for (const trigger of def.triggers) {
      const t = normalizeDe(trigger).trim()
      if (!t) continue
      if (hasTrigger(text, t)) {
        const at = text.indexOf(t)
        pos = at >= 0 ? at : 0
        break
      }
    }
    if (pos >= 0) found.push({ def, pos })
  }
  found.sort((a, b) => a.pos - b.pos || a.def.label.localeCompare(b.def.label, "de"))
  return found.slice(0, 2).map((entry) => entry.def)
}

/** Mindestanzahl Theme-Karten. Shadow hat ~50 Karten → 40; kleine Themes → alle. */
export function themeTarget(available: number): number {
  if (available <= 0) return 0
  return Math.min(available, Math.max(18, Math.round(available * 0.8)), 45)
}

function queryThemeRows(
  theme: ThemeDef,
  commander: Card,
  settings: DeckSettings,
  limit: number,
): any[] {
  const clauses: string[] = [
    "card.oracle_id != ?",
    "card.is_one_win = 0",
    "card.name NOT IN ('Plains','Island','Swamp','Mountain','Forest','Wastes')",
  ]
  const params: any[] = [commander.oracle_id]
  if (!settings.allowBanned) {
    clauses.push("COALESCE(json_extract(card.legalities, '$.commander'), 'legal') != 'banned'")
  }
  if (!settings.allowIllegal) {
    clauses.push("json_extract(card.legalities, '$.commander') = 'legal'")
  }
  if (commander.color_identity.length === 0) {
    clauses.push("json_array_length(card.color_identity) = 0")
  } else {
    const placeholders = commander.color_identity.map(() => "?").join(",")
    clauses.push(`NOT EXISTS (SELECT 1 FROM json_each(card.color_identity) WHERE value NOT IN (${placeholders}))`)
    params.push(...commander.color_identity)
  }

  const positive: string[] = []
  if (theme.keywords?.length) {
    const placeholders = theme.keywords.map(() => "?").join(",")
    positive.push(`EXISTS (SELECT 1 FROM json_each(card.keywords) WHERE lower(value) IN (${placeholders}))`)
    params.push(...theme.keywords.map((keyword) => keyword.toLowerCase()))
  }
  if (theme.tags?.length) {
    const placeholders = theme.tags.map(() => "?").join(",")
    positive.push(`EXISTS (SELECT 1 FROM card_tag ct WHERE ct.oracle_id = card.oracle_id AND lower(ct.tag) IN (${placeholders}))`)
    params.push(...theme.tags.map((tag) => tag.toLowerCase()))
  }
  if (theme.terms?.length) {
    const match = theme.terms.map((term) => `"${String(term).replace(/"/g, "")}"`).join(" OR ")
    positive.push("card.oracle_id IN (SELECT oracle_id FROM card_fts WHERE card_fts MATCH ?)")
    params.push(match)
  }
  if (!positive.length) return []
  clauses.push(`(${positive.join(" OR ")})`)

  if (theme.excludeTags?.length) {
    const placeholders = theme.excludeTags.map(() => "?").join(",")
    clauses.push(`NOT EXISTS (SELECT 1 FROM card_tag ct WHERE ct.oracle_id = card.oracle_id AND lower(ct.tag) IN (${placeholders}))`)
    params.push(...theme.excludeTags.map((tag) => tag.toLowerCase()))
  }

  return db
    .query(
      `SELECT * FROM card WHERE ${clauses.join(" AND ")}
       ORDER BY card.edhrec_rank IS NULL, card.edhrec_rank LIMIT ?`,
    )
    .all(...params, limit) as any[]
}

/**
 * Karten für die erkannten Mechaniken. Keywords/Tags sind präzise; der
 * Oracle-Volltext fängt Mechaniken, die Scryfall nicht als Keyword führt.
 */
export function themeCandidates(
  brief: string,
  commander: Card,
  settings: DeckSettings,
  { perTheme = 120, maxTotal = 240 }: { perTheme?: number; maxTotal?: number } = {},
): VisionCandidate[] {
  const themes = detectThemes(brief)
  if (!themes.length) return []
  const found = new Map<string, VisionCandidate>()
  for (const theme of themes) {
    const rows = queryThemeRows(theme, commander, settings, perTheme)
    const tagMap = tagsFor(rows.map((row) => String(row.oracle_id)))
    for (const row of rows) {
      const oracleId = String(row.oracle_id)
      if (found.has(oracleId)) continue
      const card = parseCard(row)
      const tags = tagMap.get(oracleId) ?? []
      const matched = tags.filter(
        (tag) => (theme.tags ?? []).includes(tag) || (theme.synergyTags ?? []).includes(tag),
      )
      const baseRole = roleFor(card, tags)
      const role: Role = baseRole === "flex" ? "synergy" : baseRole
      found.set(oracleId, {
        card,
        role,
        tags,
        theme: { label: theme.label },
        vision: {
          label: `Thema: ${theme.label}`,
          tags: (matched.length ? matched : [theme.label]).slice(0, 4),
          snippet: null,
        },
      })
      if (found.size >= maxTotal) return [...found.values()]
    }
  }
  return [...found.values()]
}

function pickRemovable(
  list: DeckCard[],
  themeIds: Set<string>,
  quotas: Record<string, number>,
  roleCount: (role: Role) => number,
): DeckCard | null {
  const roleRemoveOrder: Record<string, number> = {
    flex: 0,
    synergy: 2,
    wincon: 3,
    recursion: 4,
    tutor: 5,
    protection: 6,
    wipe: 7,
    removal: 8,
    draw: 9,
    ramp: 10,
  }
  const candidates = list.filter((card) => card.role !== "land" && !themeIds.has(card.oracle_id))
  candidates.sort((a, b) => {
    const priority = (card: DeckCard) => {
      if (card.role === "flex") return 0
      if (roleCount(card.role) > (quotas[card.role] ?? 0)) return 1
      return roleRemoveOrder[card.role] ?? 11
    }
    const pa = priority(a)
    const pb = priority(b)
    if (pa !== pb) return pa - pb
    const ra = a.edhrec_rank ?? 999999
    const rb = b.edhrec_rank ?? 999999
    return rb - ra || b.cmc - a.cmc
  })
  return candidates[0] ?? null
}

/**
 * Harte Theme-Quote nach KI/Engine/Tune: generische Flex-/Rollenkarten werden
 * durch die besten noch nicht gewählten Theme-Karten ersetzt. Dadurch bleibt
 * das Deck auch dann thematisch, wenn das Modell die Vision ignoriert.
 */
export function enforceTheme(
  cards: DeckCard[],
  themeHits: VisionCandidate[],
  commander: Card,
  settings: DeckSettings,
  bracket: BracketId,
): DeckCard[] {
  if (!themeHits.length) return cards
  const target = themeTarget(themeHits.length)
  const themeById = new Map(themeHits.map((hit) => [hit.card.oracle_id, hit]))
  const list = cards.slice()
  const used = new Set(list.map((card) => card.oracle_id))
  const countTheme = () =>
    list.reduce((sum, card) => sum + (themeById.has(card.oracle_id) ? card.quantity : 0), 0)
  let have = countTheme()
  if (have >= target) return list

  const quotas = bracketQuotas(bracket) as Record<string, number>
  const budget = HOUSE_BUDGET[bracket]
  const gcKeep = settings.maxGameChangers != null ? Math.min(budget.gc, settings.maxGameChangers) : budget.gc
  const tutorKeep = settings.maxTutors != null ? Math.min(budget.tutors, settings.maxTutors) : budget.tutors
  const extraKeep = settings.maxExtraTurns != null ? Math.min(budget.extraTurns, settings.maxExtraTurns) : budget.extraTurns
  const roleCount = (role: Role) =>
    list.reduce((sum, card) => sum + (card.role === role ? card.quantity : 0), 0)
  const countIf = (predicate: (card: DeckCard) => boolean) =>
    list.reduce((sum, card) => sum + (predicate(card) ? card.quantity : 0), 0)
  const allowed = (card: Card) => {
    if (card.oracle_id === commander.oracle_id) return false
    if (card.is_one_win) return false
    if (!settings.allowBanned && card.legalities.commander === "banned") return false
    if (!settings.allowIllegal && card.legalities.commander !== "legal") return false
    if (!fitsColorIdentity(card, commander)) return false
    return true
  }
  const isFastMana = (candidate: Candidate) =>
    candidate.tags.includes("adds-multiple-mana") && candidate.card.cmc <= 2

  const candidates = [...themeHits].sort(
    (a, b) => (a.card.edhrec_rank ?? 999999) - (b.card.edhrec_rank ?? 999999),
  )
  for (const candidate of candidates) {
    if (have >= target) break
    if (used.has(candidate.card.oracle_id)) continue
    if (!allowed(candidate.card)) continue
    if (candidate.card.is_game_changer && countIf((card) => card.is_game_changer) >= gcKeep) continue
    if (candidate.tags.includes("extra-turn") && countIf((card) => card.tags.includes("extra-turn")) >= extraKeep) continue
    if (candidate.role === "tutor" && roleCount("tutor") >= tutorKeep) continue
    if (isFastMana(candidate) && countIf((card) => card.tags.includes("adds-multiple-mana") && card.cmc <= 2) >= budget.fastMana) continue
    if (candidate.tags.includes("mass-land-denial") && (!budget.massLandDenial || !settings.allowMassLandDenial)) continue

    const removable = pickRemovable(list, new Set(themeById.keys()), quotas, roleCount)
    if (!removable) break
    const index = list.findIndex((card) => card.oracle_id === removable.oracle_id)
    if (index < 0) continue
    if (removable.quantity > 1) {
      removable.quantity--
    } else {
      list.splice(index, 1)
      used.delete(removable.oracle_id)
    }
    list.push(
      makeDeckCard(
        candidate.card,
        candidate.role,
        `Thema ${candidate.theme?.label ?? "Strategie"}: ${candidate.role}.`,
        candidate.tags,
      ),
    )
    used.add(candidate.card.oracle_id)
    have++
  }
  return list
}
