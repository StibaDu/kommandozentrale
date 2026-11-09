import { BRACKETS } from "./rules-seed"
import {
  HOUSE_BUDGET,
  analyzeDeck,
  buildPool,
  cardById,
  cardByName,
  fitsColorIdentity,
  makeDeckCard,
  roleFor,
  tagsFor,
  type Candidate,
} from "./engine"
import type { BracketId, Card, DeckAnalysis, DeckCard, DeckSettings, Role } from "./types"

export interface DoctorCard {
  oracle_id: string
  name: string
  mana_cost: string | null
  cmc: number
  type_line: string
  role: Role
  edhrec_rank: number | null
  is_game_changer: boolean
  is_one_win: boolean
  tags: string[]
}

export interface DoctorNeed {
  role: Role
  label: string
  current: number
  target: number
  deficit: number
}

export interface DoctorBudgetIssue {
  kind: "gc" | "tutors" | "extraTurns" | "fastMana" | "massLandDenial"
  label: string
  current: number
  allowed: number
}

export interface DoctorProposal {
  id: string
  cut: DoctorCard | null
  add: DoctorCard | null
  need: string
  roleLabel: string
  reason: string
  before: number
  after: number
}

export interface DoctorProjection {
  total: number
  counts: Record<string, number>
  bracket: BracketId
  label: string
  warnings: string[]
}

export interface DoctorResult {
  diagnosis: {
    total: number
    bracket: BracketId
    needs: DoctorNeed[]
    overBudget: DoctorBudgetIssue[]
    notes: string[]
  }
  proposals: DoctorProposal[]
  projected: DoctorProjection | null
}

const ROLE_LABEL: Record<string, string> = {
  land: "Länder",
  ramp: "Ramp",
  draw: "Kartenvorteil",
  removal: "Removal",
  wipe: "Wipes",
  protection: "Schutz",
  tutor: "Tutoren",
  recursion: "Rekursion",
  wincon: "Wincons",
  synergy: "Synergie",
  flex: "Flex",
  commander: "Command Zone",
}

const CORE_ROLES: Role[] = ["land", "ramp", "draw", "removal", "wipe", "protection", "wincon", "recursion", "tutor"]
const ROLE_PRIORITY: Record<string, number> = { land: 0, ramp: 1, draw: 2, removal: 3, wipe: 4, protection: 5, wincon: 6, recursion: 7, tutor: 8 }
const BASIC_BY_COLOR: Record<string, string> = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest" }
const BASIC_NAMES = new Set(["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"])

function isBasic(name: string) {
  return BASIC_NAMES.has(name)
}

function fromDeckCard(card: DeckCard): DoctorCard {
  return {
    oracle_id: card.oracle_id,
    name: card.name,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    type_line: card.type_line,
    role: card.role,
    edhrec_rank: card.edhrec_rank,
    is_game_changer: card.is_game_changer,
    is_one_win: card.is_one_win,
    tags: card.tags,
  }
}

function fromCandidate(candidate: Candidate): DoctorCard {
  return {
    oracle_id: candidate.card.oracle_id,
    name: candidate.card.name,
    mana_cost: candidate.card.mana_cost,
    cmc: candidate.card.cmc,
    type_line: candidate.card.type_line,
    role: candidate.role,
    edhrec_rank: candidate.card.edhrec_rank,
    is_game_changer: candidate.card.is_game_changer,
    is_one_win: candidate.card.is_one_win,
    tags: candidate.tags,
  }
}

function rankScore(rank: number | null): number {
  if (rank == null) return 5
  if (rank <= 500) return -14
  if (rank <= 1500) return -6
  if (rank <= 3000) return 0
  if (rank <= 6000) return 3
  if (rank <= 10000) return 6
  return 8
}

function quotasFor(bracket: BracketId): Record<string, number> {
  const info = BRACKETS.find((b) => b.id === bracket) ?? BRACKETS[0]
  return info.quotas as Record<string, number>
}

function minLimit(budget: number, setting: number | null): number {
  return setting == null ? budget : Math.min(budget, setting)
}

function issueFor(
  kind: DoctorBudgetIssue["kind"],
  label: string,
  current: number,
  allowed: number,
): DoctorBudgetIssue | null {
  return current > allowed ? { kind, label, current, allowed } : null
}

export function doctorDeck(
  input: {
    commander: Card
    cards: DeckCard[]
    settings: DeckSettings
    bracket: BracketId
    podSize: number
  },
  fingerprint: string,
  maxProposals = 8,
): DoctorResult {
  const { commander, cards, settings, bracket } = input
  const analysis = analyzeDeck(commander, cards, settings, bracket)
  const quotas = quotasFor(bracket)
  const budget = HOUSE_BUDGET[bracket]
  const maxGc = minLimit(budget.gc, settings.maxGameChangers)
  const maxTutors = minLimit(budget.tutors, settings.maxTutors)
  const maxExtraTurns = minLimit(budget.extraTurns, settings.maxExtraTurns)
  const maxFastMana = budget.fastMana
  const maxMassLandDenial = budget.massLandDenial && settings.allowMassLandDenial ? 99 : 0

  const signals = analysis.bracket.signals as Record<string, number | string | boolean>
  const metrics = {
    gc: Number(signals.gameChangers ?? 0),
    tutors: Number(signals.tutors ?? 0),
    extraTurns: Number(signals.extraTurns ?? 0),
    fastMana: Number(signals.fastMana ?? 0),
    massLandDenial: Number(signals.massLandDenial ?? 0),
  }

  const needs: DoctorNeed[] = CORE_ROLES.map((role) => {
    const current = analysis.counts[role] ?? 0
    const target = quotas[role] ?? 0
    return { role, label: ROLE_LABEL[role] ?? role, current, target, deficit: Math.max(0, target - current) }
  })
    .filter((need) => need.deficit > 0)
    .sort((a, b) => b.deficit - a.deficit || (ROLE_PRIORITY[a.role] ?? 9) - (ROLE_PRIORITY[b.role] ?? 9))

  function issuesNow(): DoctorBudgetIssue[] {
    return [
      issueFor("gc", "Game Changers", metrics.gc, maxGc),
      issueFor("tutors", "Tutoren", metrics.tutors, maxTutors),
      issueFor("extraTurns", "Extra-Züge", metrics.extraTurns, maxExtraTurns),
      issueFor("fastMana", "Fast Mana", metrics.fastMana, maxFastMana),
      issueFor("massLandDenial", "Mass Land Denial", metrics.massLandDenial, maxMassLandDenial),
    ]
      .filter((issue): issue is DoctorBudgetIssue => Boolean(issue))
      .sort((a, b) => b.current - b.allowed - (a.current - a.allowed))
  }

  const overBudget = issuesNow()
  const notes: string[] = []
  if (analysis.total < 100) notes.push(`Das Deck ist ein Entwurf: Es fehlen ${100 - analysis.total} Karten bis 100.`)
  if (analysis.total > 100) notes.push(`Das Deck ist ${analysis.total - 100} Karten zu groß. Der Doctor schneidet zuerst.`)
  const illegal = cards.filter((c) => c.legalities.commander !== "legal")
  if (illegal.length) notes.push(`${illegal.length} Karte(n) im Bestand sind nicht offiziell Commander-legal. Der Doctor schlägt nur legale Karten vor.`)
  const offColor = cards.filter((card) => !fitsColorIdentity(card, commander))
  if (offColor.length) notes.push(`${offColor.length} Karte(n) verletzen die Farbidentität des Commanders. Der Doctor schlägt keine Karten außerhalb der Identität vor.`)
  const oneWin = cards.filter((c) => c.is_one_win)
  if (oneWin.length) notes.push(`${oneWin.length} 1-Win-Karte(n) im Bestand. 1-Win-Karten sind dauerhaft ausgeschlossen; der Doctor schlägt keine neuen vor.`)
  if (commander.is_game_changer) notes.push("Der Commander ist selbst ein Game Changer und zählt ins Budget. Er kann nicht geschnitten werden.")
  if (needs.length === 0 && overBudget.length === 0 && analysis.total === 100) notes.push("Keine offensichtliche Rollen- oder Budgetlücke. Die Vorschläge wären nur Feinschliff.")

  if (needs.length === 0 && overBudget.length === 0 && analysis.total === 100) {
    return { diagnosis: { total: analysis.total, bracket, needs, overBudget, notes }, proposals: [], projected: null }
  }

  const pool = buildPool(commander, settings).filter(
    (candidate) => candidate.card.legalities.commander === "legal" && !candidate.card.is_one_win,
  )

  const working = new Map<string, DeckCard>()
  for (const card of cards) working.set(card.oracle_id, { ...card, tags: [...card.tags] })
  const counts: Record<string, number> = { ...analysis.counts }
  let total = analysis.total
  const usedAdds = new Set<string>()
  const removedCards = new Set<string>()
  const blockedNeeds = new Set<string>()
  const blockedBudget = new Set<string>()
  const proposals: DoctorProposal[] = []
  const landCap = Math.max(1, Math.round(maxProposals * ((quotas.land ?? 36) / 100)))
  let landAdds = 0

  function currentCount(role: string) {
    return counts[role] ?? 0
  }

  function biggestNeed(): DoctorNeed | null {
    return CORE_ROLES.map((role) => {
      const current = currentCount(role)
      const target = quotas[role] ?? 0
      return { role, label: ROLE_LABEL[role] ?? role, current, target, deficit: Math.max(0, target - current) }
    })
      .filter((need) => need.deficit > 0 && !blockedNeeds.has(need.role))
      .filter((need) => !(need.role === "land" && landAdds >= landCap))
      .sort((a, b) => b.deficit - a.deficit || (ROLE_PRIORITY[a.role] ?? 9) - (ROLE_PRIORITY[b.role] ?? 9))[0] ?? null
  }

  function cutScore(card: DeckCard, reason: DoctorBudgetIssue["kind"] | null): number {
    let score = 0
    if (reason === "gc" && card.is_game_changer) score += 120
    if (reason === "tutors" && card.role === "tutor") score += 110
    if (reason === "extraTurns" && card.tags.includes("extra-turn")) score += 110
    if (reason === "fastMana" && card.tags.includes("adds-multiple-mana") && card.cmc <= 2) score += 100
    if (reason === "massLandDenial" && card.tags.includes("mass-land-denial")) score += 120
    const roleCount = currentCount(card.role)
    const target = quotas[card.role] ?? 0
    if (roleCount > target) score += Math.min(3, roleCount - target) * 8
    if (roleCount < target) score -= 28
    if (card.role === "flex") score += 12
    if (card.role === "land") score -= 38
    if (card.role === "land" && roleCount > target + 1) score += 30
    if (card.role === "synergy") score -= 4
    if (card.role === "wincon" && roleCount <= target) score -= 18
    if (card.role === "protection" && roleCount <= target) score -= 14
    if (card.cmc >= 6) score += 6
    if (card.cmc >= 8) score += 6
    score += rankScore(card.edhrec_rank)
    if (isBasic(card.name)) score -= 18
    if (card.quantity > 1) score -= 8
    if (!reason && card.is_game_changer) score -= 18
    if (!reason && card.tags.includes("extra-turn")) score -= 15
    if (!reason && card.tags.includes("mass-land-denial")) score -= 15
    return score
  }

  function pickCut(reason: DoctorBudgetIssue["kind"] | null): DeckCard | null {
    const candidates = [...working.values()].filter((card) => {
      if (card.oracle_id === commander.oracle_id) return false
      if (usedAdds.has(card.oracle_id)) return false
      if (reason === "gc" && !card.is_game_changer) return false
      if (reason === "tutors" && card.role !== "tutor") return false
      if (reason === "extraTurns" && !card.tags.includes("extra-turn")) return false
      if (reason === "fastMana" && !(card.tags.includes("adds-multiple-mana") && card.cmc <= 2)) return false
      if (reason === "massLandDenial" && !card.tags.includes("mass-land-denial")) return false
      if (!reason && isBasic(card.name) && currentCount("land") <= (quotas.land ?? 36) + 1) return false
      return true
    })
    candidates.sort((a, b) => cutScore(b, reason) - cutScore(a, reason))
    return candidates[0] ?? null
  }

  function budgetAllows(candidate: Candidate): boolean {
    if (candidate.tags.includes("mass-land-denial")) return false
    if (candidate.card.is_game_changer && metrics.gc + 1 > maxGc) return false
    if ((candidate.role === "tutor" || candidate.tags.some((tag) => tag.startsWith("tutor-"))) && metrics.tutors + 1 > maxTutors) return false
    if (candidate.tags.includes("extra-turn") && metrics.extraTurns + 1 > maxExtraTurns) return false
    if (candidate.tags.includes("adds-multiple-mana") && candidate.card.cmc <= 2 && metrics.fastMana + 1 > maxFastMana) return false
    return true
  }

  function addScore(candidate: Candidate, need: Role | "fill"): number {
    let score = 0
    if (need === "land" && candidate.card.is_land) score += 65
    if (need === "land" && candidate.card.produced_mana.some((color) => commander.color_identity.includes(color))) score += 7
    if (need !== "land" && need !== "fill" && candidate.role === need && !candidate.card.is_land) score += 65
    if (need === "fill") {
      const roleCount = currentCount(candidate.role)
      const target = quotas[candidate.role] ?? 0
      if (roleCount < target) score += 11
      if (candidate.role === "flex") score += 3
    }
    score += Math.max(-16, 28 - Math.log10((candidate.card.edhrec_rank ?? 20000) + 1) * 7)
    if (candidate.card.cmc <= 3) score += 8
    else if (candidate.card.cmc >= 6) score -= 10
    if (candidate.card.is_game_changer) score += 4
    if (candidate.tags.includes("commander-identity-matters")) score += 2
    if (candidate.tags.includes("synergy-commander")) score += 2
    if (isBasic(candidate.card.name)) score -= 8
    return score
  }

  function pickAdd(need: Role | "fill"): Candidate | null {
    const candidates = pool.filter((candidate) => {
      const inDeck = working.has(candidate.card.oracle_id)
      if (inDeck && !(need === "land" && isBasic(candidate.card.name))) return false
      if (usedAdds.has(candidate.card.oracle_id)) return false
      if (removedCards.has(candidate.card.oracle_id)) return false
      if (candidate.card.is_one_win) return false
      if (candidate.card.legalities.commander !== "legal") return false
      return true
    })
    const tagMap = tagsFor(candidates.map((candidate) => candidate.card.oracle_id))
    const enriched: Candidate[] = candidates.map((candidate) => {
      const tags = tagMap.get(candidate.card.oracle_id) ?? candidate.tags
      return {
        card: candidate.card,
        role: candidate.card.is_land ? "land" : roleFor(candidate.card, tags),
        tags,
      }
    })
    enriched.sort((a, b) => addScore(b, need) - addScore(a, need))
    for (const candidate of enriched) {
      if (!budgetAllows(candidate)) continue
      if (need === "land") {
        if (!candidate.card.is_land) continue
      } else {
        if (candidate.card.is_land) continue
        if (need !== "fill" && candidate.role !== need) continue
      }
      return candidate
    }
    return null
  }

  function basicCandidate(need: Role | "fill"): Candidate | null {
    if (need !== "land") return null
    const colors = commander.color_identity.filter((color) => BASIC_BY_COLOR[color])
    const color = colors
      .slice()
      .sort((a, b) => {
        const deficitA = (analysis.pips[a] ?? 0) - (analysis.sources[a] ?? 0)
        const deficitB = (analysis.pips[b] ?? 0) - (analysis.sources[b] ?? 0)
        return deficitB - deficitA
      })[0]
    const name = color ? BASIC_BY_COLOR[color] : "Wastes"
    const card = cardByName(name)
    if (!card || removedCards.has(card.oracle_id)) return null
    return { card, role: "land", tags: [] }
  }

  function adjustMetrics(card: { is_game_changer: boolean; is_one_win: boolean; cmc: number; tags?: string[] }, direction: 1 | -1) {
    if (card.is_game_changer) metrics.gc = Math.max(0, metrics.gc + direction)
    if (card.is_one_win) return
    const tags = card.tags
    if (tags?.includes("extra-turn")) metrics.extraTurns = Math.max(0, metrics.extraTurns + direction)
    if (tags?.includes("adds-multiple-mana") && card.cmc <= 2) metrics.fastMana = Math.max(0, metrics.fastMana + direction)
    if (tags?.includes("mass-land-denial")) metrics.massLandDenial = Math.max(0, metrics.massLandDenial + direction)
  }

  function removeWorking(card: DeckCard): DeckCard {
    const current = working.get(card.oracle_id)!
    removedCards.add(card.oracle_id)
    counts[card.role] = Math.max(0, currentCount(card.role) - 1)
    if (current.role === "tutor") metrics.tutors = Math.max(0, metrics.tutors - 1)
    total -= 1
    if (current.quantity > 1) {
      current.quantity -= 1
    } else {
      working.delete(card.oracle_id)
      adjustMetrics(current, -1)
    }
    return current
  }

  function addWorking(card: Card, role: Role, tags: string[]): DeckCard {
    const existing = working.get(card.oracle_id)
    counts[role] = currentCount(role) + 1
    if (role === "tutor") metrics.tutors += 1
    total += 1
    if (existing) {
      existing.quantity += 1
      return existing
    }
    const next = makeDeckCard(card, role, "Deck-Doctor: Vorschlag.", tags)
    working.set(card.oracle_id, next)
    adjustMetrics({ ...card, tags }, 1)
    return next
  }

  function proposal(
    kind: "over" | "budget" | "need" | "fill",
    cutCard: DeckCard | null,
    addCandidate: Candidate | null,
    issue: DoctorBudgetIssue | null,
    need: DoctorNeed | null,
  ): DoctorProposal {
    const addRole = addCandidate?.role ?? cutCard?.role ?? "flex"
    const before = currentCount(addRole) + (cutCard && cutCard.role === addRole ? 1 : 0)
    const after = addCandidate ? before + 1 : before - 1
    const roleLabel = ROLE_LABEL[addRole] ?? addRole
    let reason = ""
    if (kind === "over" && cutCard) {
      reason = `Das Deck hat ${analysis.total} Karten. ${cutCard.name} ist der schwächste Kandidat zum Kürzen.`
    } else if (kind === "budget" && cutCard && issue) {
      const replacement = addCandidate ? ` ${addCandidate.card.name} ersetzt sie, ohne das Budget weiter zu belasten.` : ""
      reason = `Das B${bracket}-Budget erlaubt ${issue.label} ${issue.allowed}; aktuell sind es ${issue.current}. ${cutCard.name} sprengt das Budget.${replacement}`
    } else if (kind === "need" && need && addCandidate) {
      reason = `Für ${need.label} fehlen ${need.deficit}. ${addCandidate.card.name} ist der beste legale Kandidat im Pool.`
    } else if (kind === "fill" && addCandidate) {
      reason = `Das Deck ist noch nicht voll. ${addCandidate.card.name} schließt die Lücke, ohne eine Rolle zu überladen.`
    } else {
      reason = "Vorschlag für das Deck."
    }
    return {
      id: `${fingerprint}:${proposals.length}:${cutCard?.oracle_id ?? "none"}:${addCandidate?.card.oracle_id ?? "none"}`,
      cut: cutCard ? fromDeckCard(cutCard) : null,
      add: addCandidate ? fromCandidate(addCandidate) : null,
      need: issue ? `Budget: ${issue.label}` : need ? need.label : kind === "over" ? "Deckgröße" : "Lücke füllen",
      roleLabel,
      reason,
      before,
      after,
    }
  }

  // 1. A deck above 100 cards gets cut down first.
  while (total > 100 && proposals.length < maxProposals) {
    const cut = pickCut(null)
    if (!cut) break
    const before = currentCount(cut.role)
    removeWorking(cut)
    proposals.push(proposal("over", cut, null, null, null))
    proposals[proposals.length - 1].before = before
    proposals[proposals.length - 1].after = currentCount(cut.role)
  }

  // 2. Remove cards that break the chosen bracket's house budget.
  while (proposals.length < maxProposals) {
    const issue = issuesNow().find((item) => !blockedBudget.has(item.kind))
    if (!issue) break
    const cut = pickCut(issue.kind)
    if (!cut) {
      blockedBudget.add(issue.kind)
      notes.push(`Für ${issue.label} wurde kein Kandidat zum Schneiden gefunden.`)
      continue
    }
    let add: Candidate | null = null
    if (total >= 100) {
      const need = biggestNeed()
      add = need ? pickAdd(need.role) : null
      if (!add) add = pickAdd("fill")
    }
    const before = currentCount(add?.role ?? cut.role)
    removeWorking(cut)
    if (add) {
      addWorking(add.card, add.role, add.tags)
      usedAdds.add(add.card.oracle_id)
      if (add.role === "land") landAdds++
    }
    proposals.push(proposal("budget", cut, add, issue, null))
    proposals[proposals.length - 1].before = before
    proposals[proposals.length - 1].after = currentCount(add?.role ?? cut.role)
  }

  // 3. Fill the biggest role deficits.
  while (proposals.length < maxProposals) {
    const need = biggestNeed()
    if (!need) break
    let add = pickAdd(need.role) ?? basicCandidate(need.role)
    if (!add) {
      blockedNeeds.add(need.role)
      notes.push(`Für ${need.label} wurde kein legaler Kandidat im Pool gefunden.`)
      continue
    }
    if (total > 100) break
    const cut = total >= 100 ? pickCut(null) : null
    if (total >= 100 && !cut) {
      blockedNeeds.add(need.role)
      notes.push(`Für ${need.label} fehlt ein Kandidat zum Tauschen.`)
      continue
    }
    const before = currentCount(add.role)
    if (cut) removeWorking(cut)
    addWorking(add.card, add.role, add.tags)
    usedAdds.add(add.card.oracle_id)
    if (add.role === "land") landAdds++
    proposals.push(proposal("need", cut, add, null, need))
    proposals[proposals.length - 1].before = before
    proposals[proposals.length - 1].after = currentCount(add.role)
  }

  // 4. If the deck is still short, add value without pretending it fills a role.
  while (total < 100 && proposals.length < maxProposals) {
    const add = pickAdd("fill")
    if (!add) break
    const before = currentCount(add.role)
    addWorking(add.card, add.role, add.tags)
    usedAdds.add(add.card.oracle_id)
    if (add.role === "land") landAdds++
    proposals.push(proposal("fill", null, add, null, null))
    proposals[proposals.length - 1].before = before
    proposals[proposals.length - 1].after = currentCount(add.role)
  }

  if (landAdds >= landCap && (counts.land ?? 0) < (quotas.land ?? 36)) notes.push(`Länder: ${landAdds} Ergänzungen in diesem Lauf. Beim nächsten Doctor-Lauf schlägt er weitere Länder vor.`)
  if (total > 100) notes.push(`Nach ${proposals.length} Vorschlägen sind noch ${total - 100} Karten zu viel. Erhöhe die Zahl der Vorschläge oder kürze manuell.`)
  if (total < 100) notes.push(`Nach ${proposals.length} Vorschlägen fehlen noch ${100 - total} Karten.`)
  if (proposals.length === maxProposals) notes.push(`Die Vorschlagsliste ist bei ${maxProposals} gedeckelt. Prüfe nach dem Anwenden erneut.`)

  let projected: DoctorProjection | null = null
  if (proposals.length > 0) {
    const projectedMap = new Map<string, DeckCard>()
    for (const card of cards) projectedMap.set(card.oracle_id, { ...card, tags: [...card.tags] })
    for (const item of proposals) {
      if (item.cut) {
        const card = projectedMap.get(item.cut.oracle_id)
        if (card) {
          if (card.quantity > 1) card.quantity -= 1
          else projectedMap.delete(item.cut.oracle_id)
        }
      }
      if (item.add) {
        const existing = projectedMap.get(item.add.oracle_id)
        if (existing) {
          existing.quantity += 1
        } else {
          const card = cardById(item.add.oracle_id)
          if (card) {
            const tags = item.add.tags
            const role = item.add.role
            projectedMap.set(card.oracle_id, makeDeckCard(card, role, "Deck-Doctor: Vorschau.", tags))
          }
        }
      }
    }
    const projectedCards = [...projectedMap.values()]
    const nextAnalysis: DeckAnalysis = analyzeDeck(commander, projectedCards, settings, bracket)
    projected = {
      total: nextAnalysis.total,
      counts: nextAnalysis.counts,
      bracket: nextAnalysis.bracket.bracket,
      label: nextAnalysis.bracket.label,
      warnings: nextAnalysis.warnings.map((warning) => warning.text).slice(0, 4),
    }
  }

  return {
    diagnosis: {
      total: analysis.total,
      bracket,
      needs,
      overBudget,
      notes,
    },
    proposals,
    projected,
  }
}
