import { db, json } from "../db"
import {
  DEFAULT_SETTINGS,
  type BracketId,
  type BracketReport,
  type Card,
  type DeckAnalysis,
  type DeckCard,
  type DeckSettings,
  type Role,
} from "./types"
import { BRACKETS } from "./rules-seed"

const ROLE_TAGS: Record<string, string[]> = {
  ramp: ["ramp", "land-ramp", "multi-land-ramp", "mana-rock", "mana-rock-with-set-s-mechanic", "utility-mana-rock", "egg", "mana-dork", "ritual", "adds-multiple-mana", "repeatable-treasures", "treasure", "mana-producer"],
  draw: ["draw-engine", "pure-draw", "repeatable-pure-draw", "burst-draw", "cantrip", "repeatable-card-advantage"],
  removal: [
    "spot-removal",
    "removal-creature",
    "removal-nonland",
    "removal-destroy",
    "removal-exile",
    "removal-sacrifice",
    "removal-bounce",
    "removal-permanent",
  ],
  wipe: ["sweeper", "sweeper-one-sided", "multi-removal"],
  protection: ["protects-creature", "protects-self", "protects-all", "gives-protection", "gives-hexproof", "gives-indestructible", "protects-permanent"],
  tutor: ["tutor-to-hand", "tutor-to-battlefield", "tutor-card", "tutor-creature", "tutor-artifact", "tutor-instant", "tutor-sorcery", "tutor-land-basic", "tutor-land-to-battlefield"],
  recursion: ["reanimate-creature", "mass-reanimation", "castable-from-graveyard", "regrowth-any", "reanimate-permanent"],
  wincon: ["alternate-win-condition", "overrun", "opponent-loses-life", "drain-life"],
  synergy: ["typal-ooze", "copy-creature", "copy-token", "repeatable-creature-tokens", "death-trigger", "sacrifice-outlet-creature", "sacrifice-outlet-land", "free-sacrifice-outlet", "repeatable-sacrifice-outlet"],
  counter: ["counterspell-soft", "counterspell-with-set-mechanic", "counter"],
}

const ROLE_LABELS: Record<string, string> = {
  land: "Land",
  ramp: "Ramp",
  draw: "Draw",
  removal: "Removal",
  wipe: "Wipe",
  protection: "Schutz",
  tutor: "Tutor",
  recursion: "Rekursion",
  wincon: "Wincon",
  synergy: "Synergie",
  flex: "Flex",
  commander: "Commander",
}

const ROLE_REASONS: Record<string, string> = {
  land: "Teil der Manabase. Die Engine prüft Farbquellen und getappte Länder.",
  ramp: "Beschleunigt den Plan und holt den Commander früher auf den Tisch.",
  draw: "Hält die Hand voll, damit das Deck nicht nach dem ersten Wipe leerläuft.",
  removal: "Antwort auf gegnerische Bedrohungen. Interaktion ist in einer Vierer- oder Fünferrunde Pflicht.",
  wipe: "Setzt das Brett zurück, wenn mehrere Gegner aufgebaut haben.",
  protection: "Schützt den Commander oder die Wincon, wenn der Tisch antwortet.",
  tutor: "Sucht gezielt den nächsten Baustein. Zu viele Tutoren ziehen das Deck nach oben.",
  recursion: "Gibt dem Plan eine zweite Chance, wenn die Wincon entfernt wird.",
  wincon: "Bringt das Deck in den Bereich, in dem es tatsächlich gewinnen kann.",
  synergy: "Passt zum Commander-Plan und erhöht die Dichte statt nur gute Karten zu stapeln.",
  flex: "Solide Karte ohne feste Rolle. Wird zuerst geschnitten, wenn etwas fehlt.",
  commander: "Der Commander. Er zählt in die 100 Karten und beginnt in der Command Zone.",
}

const BASIC_BY_COLOR: Record<string, string> = {
  W: "Plains",
  U: "Island",
  B: "Swamp",
  R: "Mountain",
  G: "Forest",
}

export const HOUSE_BUDGET: Record<BracketId, { gc: number; tutors: number; extraTurns: number; fastMana: number; massLandDenial: boolean }> = {
  3: { gc: 3, tutors: 3, extraTurns: 1, fastMana: 2, massLandDenial: false },
  4: { gc: 8, tutors: 5, extraTurns: 2, fastMana: 5, massLandDenial: true },
  5: { gc: 99, tutors: 99, extraTurns: 99, fastMana: 99, massLandDenial: true },
}

export function parseCard(row: any): Card {
  return {
    oracle_id: row.oracle_id,
    name: row.name,
    mana_cost: row.mana_cost ?? null,
    cmc: Number(row.cmc ?? 0),
    type_line: row.type_line ?? "",
    oracle_text: row.oracle_text ?? null,
    oracle_text_all: row.oracle_text_all ?? null,
    colors: json(row.colors, []),
    color_identity: json(row.color_identity, []),
    keywords: json(row.keywords, []),
    legalities: json(row.legalities, {}),
    edhrec_rank: row.edhrec_rank == null ? null : Number(row.edhrec_rank),
    image_uris: json(row.image_uris, null),
    card_faces: json(row.card_faces, null),
    layout: row.layout ?? null,
    set_code: row.set_code ?? null,
    collector_number: row.collector_number ?? null,
    rarity: row.rarity ?? null,
    power: row.power ?? null,
    toughness: row.toughness ?? null,
    loyalty: row.loyalty ?? null,
    defense: row.defense ?? null,
    produced_mana: json(row.produced_mana, []),
    is_game_changer: Boolean(row.is_game_changer),
    is_one_win: Boolean(row.is_one_win),
    is_land: Boolean(row.is_land),
    is_creature: Boolean(row.is_creature),
    is_legendary: Boolean(row.is_legendary),
    tags: undefined,
  }
}

export function cardByName(name: string): Card | null {
  const exact = db.query("SELECT * FROM card WHERE name = ? COLLATE NOCASE LIMIT 1").get(name.trim()) as any
  if (exact) return parseCard(exact)
  const like = db.query("SELECT * FROM card WHERE name LIKE ? COLLATE NOCASE ORDER BY edhrec_rank IS NULL, edhrec_rank LIMIT 1").get(`%${name.trim()}%`) as any
  return like ? parseCard(like) : null
}

export function cardByNameExact(name: string): Card | null {
  const clean = name.trim()
  const row = db
    .query(
      `SELECT * FROM card
       WHERE name = ? COLLATE NOCASE
          OR name LIKE ? || ' // %' COLLATE NOCASE
          OR name LIKE '% // ' || ? COLLATE NOCASE
       ORDER BY (json_extract(legalities, '$.commander') = 'legal') DESC,
                (name = ? COLLATE NOCASE) DESC,
                edhrec_rank IS NULL, edhrec_rank
       LIMIT 1`,
    )
    .get(clean, clean, clean, clean) as any
  return row ? parseCard(row) : null
}

export function cardById(oracleId: string): Card | null {
  const row = db.query("SELECT * FROM card WHERE oracle_id = ? LIMIT 1").get(oracleId) as any
  return row ? parseCard(row) : null
}

export function tagsFor(oracleIds: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const unique = [...new Set(oracleIds)]
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500)
    const placeholders = chunk.map(() => "?").join(",")
    const rows = db.query(`SELECT oracle_id, tag FROM card_tag WHERE oracle_id IN (${placeholders})`).all(...chunk) as any[]
    for (const r of rows) {
      const list = out.get(r.oracle_id) ?? []
      list.push(r.tag)
      out.set(r.oracle_id, list)
    }
  }
  return out
}

export function roleFor(card: Card, tags: string[]): Role {
  if (card.is_land) return "land"
  const set = new Set(tags)
  if (ROLE_TAGS.wipe.some((t) => set.has(t))) return "wipe"
  if (ROLE_TAGS.ramp.some((t) => set.has(t))) return "ramp"
  if (ROLE_TAGS.draw.some((t) => set.has(t))) return "draw"
  if (ROLE_TAGS.removal.some((t) => set.has(t))) return "removal"
  if (ROLE_TAGS.protection.some((t) => set.has(t))) return "protection"
  if (ROLE_TAGS.tutor.some((t) => set.has(t))) return "tutor"
  if (ROLE_TAGS.recursion.some((t) => set.has(t))) return "recursion"
  if (ROLE_TAGS.wincon.some((t) => set.has(t))) return "wincon"
  if (ROLE_TAGS.synergy.some((t) => set.has(t))) return "synergy"
  return "flex"
}

function identityClause(identity: string[]) {
  if (identity.length === 0) {
    return "AND json_array_length(card.color_identity) = 0"
  }
  const placeholders = identity.map(() => "?").join(",")
  return `AND NOT EXISTS (SELECT 1 FROM json_each(card.color_identity) WHERE value NOT IN (${placeholders}))`
}

export function fitsColorIdentity(card: { color_identity: string[] }, commander: { color_identity: string[] }): boolean {
  return card.color_identity.every((color) => commander.color_identity.includes(color))
}

function baseWhere(commander: Card, settings: DeckSettings) {
  const clauses: string[] = ["card.oracle_id != ?", "card.is_one_win = 0"]
  const params: any[] = [commander.oracle_id]
  if (!settings.allowBanned) clauses.push("COALESCE(json_extract(card.legalities, '$.commander'), 'legal') != 'banned'")
  if (!settings.allowIllegal) clauses.push("json_extract(card.legalities, '$.commander') = 'legal'")
  const id = identityClause(commander.color_identity)
  clauses.push(id.replace(/^AND\s+/, ""))
  params.push(...commander.color_identity)
  return { sql: clauses.join(" AND "), params }
}

function queryPool(commander: Card, settings: DeckSettings, tagList: string[], limit: number, lands = false): Card[] {
  const base = baseWhere(commander, settings)
  if (lands) {
    const rows = db
      .query(
        `SELECT * FROM card WHERE card.is_land = 1 AND ${base.sql} ORDER BY card.edhrec_rank IS NULL, card.edhrec_rank LIMIT ?`,
      )
      .all(...base.params, limit) as any[]
    return rows.map(parseCard)
  }
  const placeholders = tagList.map(() => "?").join(",")
  const rows = db
    .query(
      `SELECT card.*, GROUP_CONCAT(ct.tag) AS matched_tags
       FROM card
       JOIN card_tag ct ON ct.oracle_id = card.oracle_id
       WHERE ct.tag IN (${placeholders}) AND ${base.sql}
       GROUP BY card.oracle_id
       ORDER BY card.edhrec_rank IS NULL, card.edhrec_rank
       LIMIT ?`,
    )
    .all(...tagList, ...base.params, limit) as any[]
  return rows.map((r) => {
    const c = parseCard(r)
    c.tags = String(r.matched_tags ?? "").split(",").filter(Boolean)
    return c
  })
}

export interface VisionMatch {
  /** Der Vision-Satz, aus dem die Karte abgeleitet wurde. */
  label: string
  tags: string[]
  snippet: string | null
}

export interface Candidate {
  card: Card
  role: Role
  tags: string[]
  /** Automatischer Effekt-Suchtreffer aus der Deck-Vision. */
  vision?: VisionMatch
}

export function buildPool(commander: Card, settings: DeckSettings): Candidate[] {
  const map = new Map<string, Candidate>()
  const add = (cards: Card[], forcedRole?: Role) => {
    for (const c of cards) {
      if (map.has(c.oracle_id)) continue
      const tags = c.tags ?? []
      map.set(c.oracle_id, { card: c, role: forcedRole ?? roleFor(c, tags), tags })
    }
  }

  add(queryPool(commander, settings, [], 70, true))
  add(queryPool(commander, settings, ROLE_TAGS.ramp, 45))
  add(queryPool(commander, settings, ROLE_TAGS.draw, 40))
  add(queryPool(commander, settings, ROLE_TAGS.removal, 45))
  add(queryPool(commander, settings, ROLE_TAGS.wipe, 20))
  add(queryPool(commander, settings, ROLE_TAGS.protection, 25))
  add(queryPool(commander, settings, ROLE_TAGS.tutor, 20))
  add(queryPool(commander, settings, ROLE_TAGS.recursion, 20))
  add(queryPool(commander, settings, ROLE_TAGS.wincon, 35))
  add(queryPool(commander, settings, ROLE_TAGS.synergy, 45))
  add(queryPool(commander, settings, ROLE_TAGS.counter, 20))

  const goodstuff = db
    .query(
      `SELECT * FROM card WHERE card.is_land = 0 AND ${baseWhere(commander, settings).sql}
       ORDER BY card.edhrec_rank IS NULL, card.edhrec_rank LIMIT 80`,
    )
    .all(...baseWhere(commander, settings).params) as any[]
  add(goodstuff.map(parseCard))

  return [...map.values()]
}

function bracketQuotas(bracket: BracketId) {
  const b = BRACKETS.find((x) => x.id === bracket) ?? BRACKETS[0]
  return b.quotas as Record<string, number>
}

function basicCard(name: string): Card | null {
  return cardByName(name)
}

export function makeDeckCard(card: Card, role: Role, reason: string, tags: string[]): DeckCard {
  return {
    oracle_id: card.oracle_id,
    name: card.name,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    colors: card.colors,
    color_identity: card.color_identity,
    image_uris: card.image_uris,
    edhrec_rank: card.edhrec_rank,
    is_game_changer: card.is_game_changer,
    is_one_win: card.is_one_win,
    produced_mana: card.produced_mana,
    legalities: card.legalities,
    role,
    category: role,
    reason,
    printing_id: null,
    art_url: null,
    artist: null,
    quantity: 1,
    is_commander: false,
    tags,
  }
}

function deckTotal(map: Map<string, DeckCard>): number {
  let total = 0
  for (const c of map.values()) total += c.quantity
  return total
}

function roleTotal(map: Map<string, DeckCard>, role: Role): number {
  let total = 0
  for (const c of map.values()) if (c.role === role) total += c.quantity
  return total
}

function addBasic(map: Map<string, DeckCard>, name: string, quantity: number): number {
  const basic = basicCard(name)
  if (!basic || quantity <= 0) return 0
  const room = 99 - deckTotal(map)
  const add = Math.min(quantity, room)
  if (add <= 0) return 0
  const existing = map.get(basic.oracle_id)
  if (existing) existing.quantity += add
  else map.set(basic.oracle_id, makeDeckCard(basic, "land", `Basic-Land für ${basic.name}.`, []))
  return add
}

function basicNames(commander: Card): string[] {
  const names = commander.color_identity.map((c) => BASIC_BY_COLOR[c]).filter(Boolean)
  return names.length ? names : ["Wastes"]
}

function landCards(commander: Card, pool: Candidate[], quota: number): DeckCard[] {
  const lands = pool.filter((c) => c.card.is_land).map((c) => c.card)
  const nonBasicQuota = Math.max(0, Math.min(lands.length, Math.round(quota * 0.62)))
  const picked: DeckCard[] = []
  const used = new Set<string>()
  for (const land of lands) {
    if (picked.length >= nonBasicQuota) break
    if (!land.name || used.has(land.oracle_id)) continue
    used.add(land.oracle_id)
    picked.push(makeDeckCard(land, "land", "Nichtbasic-Land für Farben und Utility.", []))
  }
  const remaining = quota - picked.length
  const basics = basicNames(commander)
  const per = Math.floor(remaining / basics.length)
  let rest = remaining - per * basics.length
  for (const name of basics) {
    const basic = basicCard(name)
    if (!basic) continue
    const qty = per + (rest > 0 ? 1 : 0)
    if (rest > 0) rest--
    if (qty > 0) picked.push({ ...makeDeckCard(basic, "land", `Basic-Land für ${basic.name}.`, []), quantity: qty })
  }
  return picked
}

export function deterministicBuild(commander: Card, settings: DeckSettings, bracket: BracketId, pool: Candidate[]): DeckCard[] {
  const quotas = bracketQuotas(bracket)
  const chosen = new Map<string, DeckCard>()

  const addCard = (c: Card, role: Role, reason: string, tags: string[]) => {
    if (deckTotal(chosen) >= 99) return false
    if (chosen.has(c.oracle_id)) return false
    chosen.set(c.oracle_id, makeDeckCard(c, role, reason, tags))
    return true
  }

  for (const l of landCards(commander, pool, quotas.land ?? 36)) {
    const existing = chosen.get(l.oracle_id)
    if (existing) existing.quantity += l.quantity
    else chosen.set(l.oracle_id, l)
  }

  const roleOrder: Role[] = ["ramp", "draw", "removal", "wipe", "protection", "tutor", "recursion", "wincon", "synergy"]
  for (const role of roleOrder) {
    const target = quotas[role] ?? 0
    let need = target - roleTotal(chosen, role)
    const candidates = pool
      .filter((p) => p.role === role && !chosen.has(p.card.oracle_id))
      .sort((a, b) => Number(Boolean(b.vision)) - Number(Boolean(a.vision)))
    for (const cand of candidates) {
      if (need <= 0) break
      if (addCard(cand.card, role, ROLE_REASONS[role] ?? ROLE_REASONS.flex, cand.tags)) need--
    }
  }

  let flexNeed = (quotas.flex ?? 0) - roleTotal(chosen, "flex")
  const flexCandidates = pool
    .filter((p) => !chosen.has(p.card.oracle_id) && !p.card.is_land)
    .sort((a, b) => Number(Boolean(b.vision)) - Number(Boolean(a.vision)) || (a.card.edhrec_rank ?? 999999) - (b.card.edhrec_rank ?? 999999))
  for (const cand of flexCandidates) {
    if (flexNeed <= 0) break
    if (addCard(cand.card, cand.role, ROLE_REASONS[cand.role] ?? ROLE_REASONS.flex, cand.tags)) flexNeed--
  }

  const basics = basicNames(commander)
  let i = 0
  while (deckTotal(chosen) < 99 && basics.length) {
    const name = basics[i++ % basics.length]
    if (addBasic(chosen, name, 1) === 0) break
  }

  return [...chosen.values()]
}

export function repairBuild(
  aiCards: Array<{ name: string; role?: string; reason?: string }>,
  commander: Card,
  settings: DeckSettings,
  bracket: BracketId,
  pool: Candidate[],
): DeckCard[] {
  const quotas = bracketQuotas(bracket)
  const chosen = new Map<string, DeckCard>()
  const poolById = new Map(pool.map((p) => [p.card.oracle_id, p]))

  const allowed = (c: Card) => {
    if (c.oracle_id === commander.oracle_id) return false
    if (c.is_one_win) return false
    if (!settings.allowBanned && c.legalities.commander === "banned") return false
    if (!settings.allowIllegal && c.legalities.commander !== "legal") return false
    if (!fitsColorIdentity(c, commander)) return false
    return true
  }

  for (const item of aiCards) {
    const c = cardByName(item.name)
    if (!c || !allowed(c)) continue
    const p = poolById.get(c.oracle_id)
    const tags = p?.tags ?? []
    const role = (item.role as Role) || roleFor(c, tags)
    const normalizedRole: Role = ["land", "ramp", "draw", "removal", "wipe", "protection", "tutor", "recursion", "wincon", "synergy", "flex"].includes(role)
      ? role
      : "flex"
    if (c.is_land && /^(Plains|Island|Swamp|Mountain|Forest|Wastes)$/.test(c.name)) {
      const existing = chosen.get(c.oracle_id)
      if (existing) existing.quantity++
      else chosen.set(c.oracle_id, makeDeckCard(c, "land", item.reason || ROLE_REASONS.land, tags))
      continue
    }
    if (chosen.has(c.oracle_id)) continue
    if (deckTotal(chosen) >= 99) break
    chosen.set(c.oracle_id, makeDeckCard(c, normalizedRole, item.reason || ROLE_REASONS[normalizedRole] || ROLE_REASONS.flex, tags))
  }

  let landNeed = (quotas.land ?? 36) - roleTotal(chosen, "land")
  if (landNeed > 0) {
    const lands = pool.filter((p) => p.card.is_land && !chosen.has(p.card.oracle_id))
    for (const l of lands) {
      if (landNeed <= 0) break
      chosen.set(l.card.oracle_id, makeDeckCard(l.card, "land", ROLE_REASONS.land, l.tags))
      landNeed--
    }
  }
  const basics = basicNames(commander)
  let bi = 0
  while (roleTotal(chosen, "land") < (quotas.land ?? 36) && deckTotal(chosen) < 99 && basics.length) {
    if (addBasic(chosen, basics[bi++ % basics.length], 1) === 0) break
  }

  for (const role of ["ramp", "draw", "removal", "wipe", "protection", "tutor", "recursion", "wincon", "synergy"] as Role[]) {
    const target = quotas[role] ?? 0
    let need = target - roleTotal(chosen, role)
    if (need <= 0) continue
    const candidates = pool
      .filter((p) => p.role === role && !chosen.has(p.card.oracle_id))
      .sort((a, b) => Number(Boolean(b.vision)) - Number(Boolean(a.vision)))
    for (const cand of candidates) {
      if (need <= 0 || deckTotal(chosen) >= 99) break
      chosen.set(cand.card.oracle_id, makeDeckCard(cand.card, role, ROLE_REASONS[role], cand.tags))
      need--
    }
  }

  while (deckTotal(chosen) > 99) {
    const removable = [...chosen.values()]
      .filter((c) => c.role !== "land")
      .sort((a, b) => {
        const order: Record<string, number> = { flex: 0, synergy: 1, wincon: 2, recursion: 3, tutor: 4, protection: 5, wipe: 6, removal: 7, draw: 8, ramp: 9 }
        return (order[a.role] ?? 0) - (order[b.role] ?? 0) || b.cmc - a.cmc
      })
    if (removable.length) {
      chosen.delete(removable[0].oracle_id)
      continue
    }
    const basic = [...chosen.values()].find((c) => c.role === "land" && c.quantity > 1)
    if (basic) {
      basic.quantity--
      continue
    }
    break
  }

  if (deckTotal(chosen) < 99) {
    let i = 0
    while (deckTotal(chosen) < 99 && basics.length) {
      if (addBasic(chosen, basics[i++ % basics.length], 1) === 0) break
    }
    const rest = pool.filter((p) => !chosen.has(p.card.oracle_id) && !p.card.is_land)
    for (const p of rest) {
      if (deckTotal(chosen) >= 99) break
      chosen.set(p.card.oracle_id, makeDeckCard(p.card, p.role, ROLE_REASONS[p.role] ?? ROLE_REASONS.flex, p.tags))
    }
  }

  return [...chosen.values()]
}

function isFastManaCard(card: { tags?: string[]; cmc: number }) {
  return (card.tags ?? []).includes("adds-multiple-mana") && card.cmc <= 2
}

export function tuneToBracket(cards: DeckCard[], target: BracketId, pool: Candidate[], settings: DeckSettings, commander: Card): DeckCard[] {
  const budget = HOUSE_BUDGET[target]
  const list = cards.slice()
  const used = new Set(list.map((c) => c.oracle_id))

  const allowedCard = (c: Card) => {
    if (c.oracle_id === commander.oracle_id) return false
    if (c.is_one_win) return false
    if (!settings.allowBanned && c.legalities.commander === "banned") return false
    if (!settings.allowIllegal && c.legalities.commander !== "legal") return false
    if (!fitsColorIdentity(c, commander)) return false
    return true
  }

  const addBasic = (name: string) => {
    const basic = basicCard(name)
    if (!basic) return
    const existing = list.find((c) => c.oracle_id === basic.oracle_id)
    if (existing) existing.quantity++
    else list.push(makeDeckCard(basic, "land", "Füllt die Manabase, nachdem eine Power-Karte weichen musste.", []))
    used.add(basic.oracle_id)
  }

  const replace = (removed: DeckCard, avoid: (candidate: Candidate) => boolean) => {
    const index = list.findIndex((c) => c.oracle_id === removed.oracle_id)
    if (index < 0) return
    if (removed.quantity > 1) {
      removed.quantity--
      return
    }
    list.splice(index, 1)
    used.delete(removed.oracle_id)
    const sameRole = pool
      .filter((p) => p.role === removed.role && !used.has(p.card.oracle_id) && allowedCard(p.card) && !avoid(p))
      .filter((p) => (removed.role === "land" ? p.card.is_land : !p.card.is_land))
      .sort((a, b) => (a.card.edhrec_rank ?? 999999) - (b.card.edhrec_rank ?? 999999))
    const fallback = pool
      .filter((p) => p.role !== "land" && !used.has(p.card.oracle_id) && allowedCard(p.card) && !avoid(p))
      .sort((a, b) => (a.card.edhrec_rank ?? 999999) - (b.card.edhrec_rank ?? 999999))
    const pick = sameRole[0] ?? fallback[0]
    if (pick) {
      list.push(makeDeckCard(pick.card, pick.role, ROLE_REASONS[pick.role] ?? ROLE_REASONS.flex, pick.tags))
      used.add(pick.card.oracle_id)
    } else {
      addBasic(basicNames(commander)[0] ?? "Wastes")
    }
  }

  const reduce = (predicate: (card: DeckCard) => boolean, keep: number, avoid: (candidate: Candidate) => boolean) => {
    let matches = list.filter(predicate).sort((a, b) => (b.edhrec_rank ?? 999999) - (a.edhrec_rank ?? 999999))
    let over = matches.length - keep
    for (const card of matches) {
      if (over <= 0) break
      replace(card, avoid)
      over--
    }
  }

  const gcKeep = settings.maxGameChangers != null ? Math.min(budget.gc, settings.maxGameChangers) : budget.gc
  const tutorKeep = settings.maxTutors != null ? Math.min(budget.tutors, settings.maxTutors) : budget.tutors
  const extraKeep = settings.maxExtraTurns != null ? Math.min(budget.extraTurns, settings.maxExtraTurns) : budget.extraTurns
  reduce((c) => c.is_game_changer, gcKeep, (p) => p.card.is_game_changer)
  reduce((c) => isFastManaCard(c), budget.fastMana, (p) => isFastManaCard(p.card))
  reduce((c) => c.role === "tutor", tutorKeep, (p) => p.role === "tutor")
  reduce((c) => c.tags.includes("extra-turn"), extraKeep, (p) => p.tags.includes("extra-turn"))
  if (!budget.massLandDenial || !settings.allowMassLandDenial) {
    reduce((c) => c.tags.includes("mass-land-denial"), 0, (p) => p.tags.includes("mass-land-denial"))
  }

  while (list.reduce((n, c) => n + c.quantity, 0) < 99) addBasic(basicNames(commander)[0] ?? "Wastes")
  while (list.reduce((n, c) => n + c.quantity, 0) > 99) {
    const removable = list
      .filter((c) => c.role !== "land")
      .sort((a, b) => (a.role === "flex" ? -1 : 0) - (b.role === "flex" ? -1 : 0) || b.cmc - a.cmc)[0]
    if (!removable) break
    list.splice(list.indexOf(removable), 1)
    used.delete(removable.oracle_id)
  }

  return list
}

function countPips(manaCost: string | null): Record<string, number> {
  const out: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
  if (!manaCost) return out
  for (const m of manaCost.matchAll(/\{([^}]+)\}/g)) {
    const sym = m[1].toUpperCase()
    for (const color of ["W", "U", "B", "R", "G", "C"]) {
      if (sym.includes(color)) out[color]++
    }
  }
  return out
}

function landSources(card: DeckCard): string[] {
  const out = new Set<string>()
  for (const m of card.produced_mana ?? []) {
    if (["W", "U", "B", "R", "G"].includes(m)) out.add(m)
  }
  const name = card.name
  if (/^Plains$/.test(name) || /\bPlains\b/.test(card.type_line)) out.add("W")
  if (/^Island$/.test(name) || /\bIsland\b/.test(card.type_line)) out.add("U")
  if (/^Swamp$/.test(name) || /\bSwamp\b/.test(card.type_line)) out.add("B")
  if (/^Mountain$/.test(name) || /\bMountain\b/.test(card.type_line)) out.add("R")
  if (/^Forest$/.test(name) || /\bForest\b/.test(card.type_line)) out.add("G")
  const text = `${card.type_line} ${card.oracle_text ?? ""}`
  for (const [color, word] of [
    ["W", "white"],
    ["U", "blue"],
    ["B", "black"],
    ["R", "red"],
    ["G", "green"],
  ] as const) {
    if (new RegExp(`\\b${word}\\b`, "i").test(text)) out.add(color)
  }
  for (const color of ["W", "U", "B", "R", "G"]) {
    if (new RegExp(`\\{${color}\\}`).test(text)) out.add(color)
  }
  return [...out]
}

export function analyzeDeck(commander: Card, cards: DeckCard[], settings: DeckSettings, requestedBracket: BracketId): DeckAnalysis {
  const all = [makeDeckCard(commander, "commander", ROLE_REASONS.commander, []), ...cards]
  const counts: Record<string, number> = {}
  for (const c of all) counts[c.role] = (counts[c.role] ?? 0) + c.quantity
  const total = all.reduce((n, c) => n + c.quantity, 0)
  const lands = counts.land ?? 0
  const nonLands = total - lands
  const curveBins = [
    { label: "0–1", min: 0, max: 1, count: 0 },
    { label: "2", min: 2, max: 2, count: 0 },
    { label: "3", min: 3, max: 3, count: 0 },
    { label: "4", min: 4, max: 4, count: 0 },
    { label: "5", min: 5, max: 5, count: 0 },
    { label: "6", min: 6, max: 6, count: 0 },
    { label: "7+", min: 7, max: 99, count: 0 },
  ]
  for (const c of all) {
    if (c.role === "land" || c.role === "commander") continue
    for (const b of curveBins) if (c.cmc >= b.min && c.cmc <= b.max) b.count += c.quantity
  }
  const nonLandCards = all.filter((c) => c.role !== "land")
  const averageMv = nonLandCards.length ? nonLandCards.reduce((n, c) => n + c.cmc * c.quantity, 0) / nonLandCards.length : 0
  const pips: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
  for (const c of nonLandCards) {
    const p = countPips(c.mana_cost)
    for (const k of Object.keys(pips)) pips[k] += p[k]
  }
  const sources: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
  for (const c of all) {
    if (c.role !== "land") continue
    const s = landSources(c)
    for (const color of s) if (sources[color] !== undefined) sources[color]++
  }

  const gc = all.filter((c) => c.is_game_changer).length
  const oneWin = all.filter((c) => c.is_one_win).length
  const tutors = counts.tutor ?? 0
  const extraTurns = all.filter((c) => c.tags.includes("extra-turn")).length
  const massLandDenial = all.filter((c) => c.tags.includes("mass-land-denial")).length
  const fastMana = all.filter((c) => c.tags.includes("adds-multiple-mana") && c.cmc <= 2).length
  const interaction = (counts.removal ?? 0) + (counts.wipe ?? 0)
  const wincons = counts.wincon ?? 0

  let bracket: BracketId = 3
  const reasons: string[] = []
  if (gc > 3) {
    bracket = 4
    reasons.push(`${gc} Game Changers. B3 erlaubt nur drei, B4 hat hier ein Hausbudget von acht.`)
  }
  if (tutors > 4) {
    bracket = 4
    reasons.push(`${tutors} Tutoren ziehen das Deck in Richtung optimiert.`)
  }
  if (extraTurns > 1) {
    bracket = 4
    reasons.push(`${extraTurns} Extra-Zug-Effekte.`)
  }
  if (massLandDenial > 0) {
    bracket = 4
    reasons.push("Mass Land Denial ist enthalten.")
  }
  if (fastMana >= 4) {
    bracket = 4
    reasons.push(`${fastMana} Karten mit mehrfachem Mana für höchstens 2 Mana.`)
  }
  if (gc > 8 || tutors > 8 || extraTurns > 3 || fastMana >= 8 || (wincons >= 4 && averageMv <= 2.5)) {
    bracket = 5
    reasons.push("Mehr als acht Game Changers, sehr viele schnelle Manaquellen oder eine Kurve, die das B4-Hausbudget sprengt.")
  }
  if (reasons.length === 0) {
    reasons.push("Keine Game-Changer-Schwemme, wenige Tutoren, keine Extra-Zug-Kette.")
  }
  if (bracket < requestedBracket) {
    reasons.push(`Der Auditor sieht eher B${bracket}; du hast B${requestedBracket} gewählt. Die Quoten richten sich nach deiner Wahl.`)
  }
  if (bracket > requestedBracket) {
    reasons.push(`Der Auditor sieht B${bracket}, also höher als die gewählte B${requestedBracket}.`)
  }

  const report: BracketReport = {
    bracket,
    label: BRACKETS.find((b) => b.id === bracket)?.name ?? `B${bracket}`,
    confidence: reasons.length >= 3 ? "hoch" : reasons.length === 2 ? "mittel" : "niedrig",
    reasons,
    signals: { gameChangers: gc, tutors, extraTurns, massLandDenial, fastMana, interaction, wincons, averageMv: Number(averageMv.toFixed(2)) },
  }

  const warnings: DeckAnalysis["warnings"] = []
  if (settings.enforceDeckSize && total !== 100) warnings.push({ level: "error", text: `Das Deck hat ${total} Karten, nicht 100.` })
  if (settings.enforceSingleton) {
    const names = new Map<string, number>()
    for (const c of cards) names.set(c.name, (names.get(c.name) ?? 0) + c.quantity)
    const dupes = [...names.entries()].filter(([name, n]) => n > 1 && !/^(Plains|Island|Swamp|Mountain|Forest|Wastes)$/.test(name))
    if (dupes.length) warnings.push({ level: "error", text: `Mehrfach enthalten: ${dupes.map(([n]) => n).join(", ")}` })
  }
  const badIdentity = cards.filter((c) => !fitsColorIdentity(c, commander))
  if (badIdentity.length) {
    warnings.push({ level: "error", text: `Farbidentität verletzt: ${badIdentity.slice(0, 6).map((c) => c.name).join(", ")}` })
  }
  if (oneWin > 0) warnings.push({ level: "warn", text: `${oneWin} 1-Win-Karte(n) im Deck. 1-Win-Karten sind ausgeschlossen; entferne sie.` })
  if (!settings.allowIllegal) {
    if (commander.legalities.commander !== "legal") {
      warnings.push({ level: "error", text: `${commander.name} ist nicht offiziell Commander-legal. Mit 0 Rule ist das erlaubt, mit Legalitätsprüfung nicht.` })
    }
    const illegal = cards.filter((c) => c.legalities.commander !== "legal")
    if (illegal.length) warnings.push({ level: "warn", text: `Nicht offiziell legal: ${illegal.slice(0, 6).map((c) => c.name).join(", ")}` })
  }
  if (!settings.allowBanned) {
    const banned = cards.filter((c) => c.legalities.commander === "banned")
    if (banned.length) warnings.push({ level: "warn", text: `Gebannt: ${banned.slice(0, 6).map((c) => c.name).join(", ")}` })
  }
  if (settings.maxGameChangers != null && gc > settings.maxGameChangers) warnings.push({ level: "warn", text: `${gc} Game Changers, Limit ${settings.maxGameChangers}.` })
  if (settings.maxTutors != null && tutors > settings.maxTutors) warnings.push({ level: "warn", text: `${tutors} Tutoren, Limit ${settings.maxTutors}.` })
  if (settings.maxExtraTurns != null && extraTurns > settings.maxExtraTurns) warnings.push({ level: "warn", text: `${extraTurns} Extra-Züge, Limit ${settings.maxExtraTurns}.` })
  if (!settings.allowMassLandDenial && massLandDenial > 0) warnings.push({ level: "warn", text: "Mass Land Denial enthalten, Schalter ist aus." })
  const budget = HOUSE_BUDGET[requestedBracket]
  if (gc > budget.gc) warnings.push({ level: "warn", text: `Hausbudget B${requestedBracket}: ${gc} Game Changers, empfohlen höchstens ${budget.gc}.` })
  if (fastMana > budget.fastMana) warnings.push({ level: "warn", text: `Hausbudget B${requestedBracket}: ${fastMana} Fast-Mana-Karten, empfohlen höchstens ${budget.fastMana}.` })
  if (tutors > budget.tutors) warnings.push({ level: "warn", text: `Hausbudget B${requestedBracket}: ${tutors} Tutoren, empfohlen höchstens ${budget.tutors}.` })
  if (extraTurns > budget.extraTurns) warnings.push({ level: "warn", text: `Hausbudget B${requestedBracket}: ${extraTurns} Extra-Züge, empfohlen höchstens ${budget.extraTurns}.` })
  if (!budget.massLandDenial && massLandDenial > 0) warnings.push({ level: "warn", text: `Hausbudget B${requestedBracket}: Mass Land Denial ist nicht vorgesehen.` })
  if ((counts.removal ?? 0) < 6) warnings.push({ level: "warn", text: "Wenig Removal. In einer Fünferrunde antwortet der Tisch sonst zu oft zuerst." })
  if ((counts.draw ?? 0) < 6) warnings.push({ level: "warn", text: "Wenig Kartenvorteil. Das Deck läuft nach dem ersten Wipe leer." })
  if ((counts.wincon ?? 0) === 0) warnings.push({ level: "warn", text: "Keine klare Wincon erkannt. Die Engine kann das Deck nicht auf einen Sieg planen." })
  if (lands < 30) warnings.push({ level: "warn", text: `Nur ${lands} Länder. Bei 100 Karten ist das sehr knapp.` })

  const goldfish = simulateGoldfish(commander, cards)
  return { total, lands, nonLands, counts, curve: curveBins.map(({ label, count }) => ({ label, count })), averageMv: Number(averageMv.toFixed(2)), pips, sources, bracket: report, warnings, goldfish }
}

function simulateGoldfish(commander: Card, cards: DeckCard[]) {
  const iterations = 1500
  const libraryBase: DeckCard[] = []
  for (const c of cards) for (let i = 0; i < c.quantity; i++) libraryBase.push(c)
  if (libraryBase.length === 0) {
    return { averageCommanderTurn: null, missedLandDropRate: 0, averageLandsByTurn4: 0, colorScrewRate: 0 }
  }
  let commanderTurnSum = 0
  let commanderTurnCount = 0
  let missedLandDrops = 0
  let landDropChecks = 0
  let landsByTurn4 = 0
  let colorScrew = 0
  const colorRe = /\{([WUBRGC])\}/g

  for (let iter = 0; iter < iterations; iter++) {
    const library = [...libraryBase]
    for (let i = library.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[library[i], library[j]] = [library[j], library[i]]
    }
    let hand = library.splice(0, 7)
    const landCount = (h: DeckCard[]) => h.filter((c) => c.role === "land").length
    if (landCount(hand) < 2 || landCount(hand) > 5) {
      library.push(...hand)
      for (let i = library.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[library[i], library[j]] = [library[j], library[i]]
      }
      hand = library.splice(0, 7)
      if (hand.length) library.push(hand.pop()!)
    }
    let lands = 0
    let commanderTurn: number | null = null
    let sources = new Set<string>()
    for (let turn = 1; turn <= 8; turn++) {
      if (turn > 1 && library.length) hand.push(library.pop()!)
      const land = hand.find((c) => c.role === "land")
      if (land && lands < 6) {
        hand = hand.filter((c) => c !== land)
        lands++
        for (const source of landSources(land)) sources.add(source)
      } else if (turn <= 4 && lands < 4) {
        missedLandDrops++
      }
      if (turn <= 4) {
        landDropChecks++
        if (turn === 4) landsByTurn4 += lands
      }
      if (commanderTurn == null && turn >= 3 && lands >= Math.min(6, commander.cmc)) commanderTurn = turn
      if (turn === 5) {
        const colored = hand.filter((c) => c.role !== "land" && c.mana_cost)
        for (const c of colored) {
          for (const m of c.mana_cost!.matchAll(colorRe)) {
            if (!sources.has(m[1]) && m[1] !== "C") {
              colorScrew++
              break
            }
          }
        }
      }
    }
    if (commanderTurn != null) {
      commanderTurnSum += commanderTurn
      commanderTurnCount++
    }
  }
  return {
    averageCommanderTurn: commanderTurnCount ? Number((commanderTurnSum / commanderTurnCount).toFixed(1)) : null,
    missedLandDropRate: landDropChecks ? Number((missedLandDrops / landDropChecks).toFixed(2)) : 0,
    averageLandsByTurn4: Number((landsByTurn4 / iterations).toFixed(1)),
    colorScrewRate: Number((colorScrew / (iterations * 5)).toFixed(2)),
  }
}

export function defaultSettings(): DeckSettings {
  return { ...DEFAULT_SETTINGS }
}
