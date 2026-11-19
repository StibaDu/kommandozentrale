import { callOpencodeDetailed } from "./ai"
import {
  bracketQuotas,
  cardByNameExact,
  fitsColorIdentity,
  HOUSE_BUDGET,
  makeDeckCard,
  roleFor,
  tagsFor,
  type Candidate,
} from "./engine"
import { simulateDeck, type SimulationReport, type SimulationTheme } from "./simulation"
import type { BracketId, Card, DeckCard, DeckSettings, Role } from "./types"

/**
 * Nach dem Build: Simulation -> KI-Doctor -> validierte Swaps -> Simulation.
 * Die KI darf nur Karten aus dem Kandidatenpool hinzufügen und nur Karten aus
 * dem Deck schneiden. Theme-Quote, 99 Karten und Bracket-Budget bleiben hart.
 */

export interface DeckSwap {
  cut: string
  add: string
  reason: string
  fixes: string[]
}

export interface ChatDeckSwap extends DeckSwap {
  id?: string
}

export interface ChatSwapResult {
  cards: DeckCard[]
  applied: ChatDeckSwap[]
  rejected: Array<{ swap: ChatDeckSwap; reason: string }>
}

export interface RejectedSwap {
  swap: DeckSwap
  reason: string
}

export interface ImprovementResult {
  cards: DeckCard[]
  before: SimulationReport
  after: SimulationReport
  applied: DeckSwap[]
  rejected: RejectedSwap[]
  assessment: string
  sessionID: string | null
}

export interface ImprovementInput {
  commander: Card
  cards: DeckCard[]
  settings: DeckSettings
  bracket: BracketId
  podSize: number
  brief: string
  pool: Candidate[]
  theme: SimulationTheme | null
}

const BASIC_LAND = /^(Plains|Island|Swamp|Mountain|Forest|Wastes)$/
const ESSENTIAL_ROLES: Role[] = ["ramp", "draw", "removal", "wipe", "protection", "tutor", "recursion", "wincon"]

function compactDeckCard(card: DeckCard, themeIds: Set<string>): string {
  const quantity = card.quantity > 1 ? `${card.quantity}x ` : ""
  const tags = card.tags.filter((tag) => !["activated-ability", "triggered-ability"].includes(tag)).slice(0, 6).join(",")
  return `${quantity}${card.name} | Rolle ${card.role} | CMC ${card.cmc} | ${tags || "—"}${themeIds.has(card.oracle_id) ? " | [Thema]" : ""}`
}

function compactCandidate(candidate: Candidate): string {
  const tags = candidate.tags.filter((tag) => !["activated-ability", "triggered-ability"].includes(tag)).slice(0, 6).join(",")
  const text = (candidate.card.oracle_text_all ?? "").replace(/\s+/g, " ").slice(0, 90)
  return `${candidate.card.name} | ${candidate.role} | CMC ${candidate.card.cmc} | ${tags || "—"}${candidate.theme ? " | [Thema]" : ""} | ${text}`
}

function buildImprovementPrompt(input: ImprovementInput, report: SimulationReport, candidates: Candidate[]): string {
  const themeIds = new Set(input.theme?.ids ?? [])
  const themeLine = input.theme ? `${input.theme.label} (Ziel ${input.theme.target})` : "keine erkannte Mechanik"
  const reportJson = JSON.stringify(
    {
      score: report.score,
      theme: report.theme,
      metrics: report.metrics,
      opening: report.opening,
      scenarios: report.scenarios,
      deadCards: report.deadCards,
      weaknesses: report.weaknesses,
      strengths: report.strengths,
    },
    null,
    2,
  )
  return `DU BIST DER DECK-DOCTOR.
Das Deck ist gebaut. Die Simulation hat Schwächen und tote Karten gefunden. Verbessere das Deck mit konkreten Swaps, ohne die Deckidentität zu zerstören.

### Auftrag
Commander: ${input.commander.name} (${input.commander.color_identity.join("") || "farblos"})
Bracket: ${input.bracket}, Pod: ${input.podSize}
Deck-Vision: ${input.brief.slice(0, 1200) || "—"}
Erkanntes Theme: ${themeLine}

### Simulation
${reportJson}

### Deck (99 Karten, Name | Rolle | CMC | Tags)
${input.cards.map((card) => compactDeckCard(card, themeIds)).join("\n")}

### Kandidaten (nur diese dürfen hinzugefügt werden)
${candidates.map(compactCandidate).join("\n")}

### Regeln
- Schlage 0 bis 8 Swaps vor: {"cut":"Exakter Deckname","add":"Exakter Kandidatenname","reason":"Deutsch","fixes":["Szenario/Schwäche"]}.
- Cut nur tote Karten, generische Flex-Karten, klare Rollenlücken oder Karten, die ein Szenario nicht lösen.
- Add nur aus der Kandidatenliste. Keine erfundenen Karten. Keine Karte doppelt.
- Schneide keine Länder. Halte die Rollen mindestens auf Quote, außer du ersetzt dieselbe Rolle.
- Halte die Theme-Quote (mindestens ${input.theme?.target ?? 0} Theme-Karten) und die 99 Karten.
- Bracket/Budget nicht überschreiten; keine generischen Bracket-Staples als Selbstzweck.
- Jeder Swap muss eine konkrete Schwäche oder ein Szenario adressieren.
- Antworte ausschließlich mit JSON:
{"assessment":"Kurze deutsche Gesamtbewertung","swaps":[{"cut":"...","add":"...","reason":"...","fixes":["Boardwipe"]}]}`
}

interface ParsedImprovement {
  assessment: string
  swaps: DeckSwap[]
}

function parseImprovement(text: string): ParsedImprovement {
  const body = text.replace(/```(?:json)?/gi, "").trim()
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error("Kein JSON in der Doctor-Antwort")
  const parsed = JSON.parse(body.slice(start, end + 1)) as any
  const swaps = Array.isArray(parsed?.swaps)
    ? parsed.swaps
        .map((item: any) => ({
          cut: String(item?.cut ?? "").trim(),
          add: String(item?.add ?? "").trim(),
          reason: String(item?.reason ?? "").trim().slice(0, 500),
          fixes: Array.isArray(item?.fixes) ? item.fixes.map(String).slice(0, 4) : [],
        }))
        .filter((swap: DeckSwap) => swap.cut && swap.add)
        .slice(0, 8)
    : []
  return { assessment: String(parsed?.assessment ?? "").trim().slice(0, 1500), swaps }
}

function themeCountOf(cards: DeckCard[], themeIds: Set<string>): number {
  return cards.reduce((sum, card) => sum + (themeIds.has(card.oracle_id) ? card.quantity : 0), 0)
}

function roleCountOf(cards: DeckCard[], role: Role): number {
  return cards.reduce((sum, card) => sum + (card.role === role ? card.quantity : 0), 0)
}

function budgetOk(cards: DeckCard[], settings: DeckSettings, bracket: BracketId): boolean {
  const budget = HOUSE_BUDGET[bracket]
  const gcKeep = settings.maxGameChangers != null ? Math.min(budget.gc, settings.maxGameChangers) : budget.gc
  const tutorKeep = settings.maxTutors != null ? Math.min(budget.tutors, settings.maxTutors) : budget.tutors
  const extraKeep = settings.maxExtraTurns != null ? Math.min(budget.extraTurns, settings.maxExtraTurns) : budget.extraTurns
  const total = (predicate: (card: DeckCard) => boolean) =>
    cards.reduce((sum, card) => sum + (predicate(card) ? card.quantity : 0), 0)
  const gc = total((card) => card.is_game_changer)
  const tutors = total((card) => card.role === "tutor")
  const extraTurns = total((card) => card.tags.includes("extra-turn"))
  const fastMana = total((card) => card.tags.includes("adds-multiple-mana") && card.cmc <= 2)
  const massLandDenial = total((card) => card.tags.includes("mass-land-denial"))
  if (gc > gcKeep || tutors > tutorKeep || extraTurns > extraKeep || fastMana > budget.fastMana) return false
  if ((!budget.massLandDenial || !settings.allowMassLandDenial) && massLandDenial > 0) return false
  return true
}

interface SwapContext {
  commander: Card
  settings: DeckSettings
  bracket: BracketId
  theme: SimulationTheme | null
}

function applyOneSwap(
  list: DeckCard[],
  swap: DeckSwap,
  context: SwapContext,
  candidateByName: Map<string, Candidate>,
): { ok: true; list: DeckCard[] } | { ok: false; reason: string } {
  const cutIndex = list.findIndex((card) => card.name.toLowerCase() === swap.cut.toLowerCase())
  if (cutIndex < 0) return { ok: false, reason: `Cut-Karte nicht im Deck: ${swap.cut}` }
  const cut = list[cutIndex]
  if (
    cut.role === "land" ||
    BASIC_LAND.test(cut.name) ||
    (cut.type_line ?? "").toLowerCase().includes("land")
  ) {
    return { ok: false, reason: "Länder werden nicht geschnitten" }
  }
  const candidate = candidateByName.get(swap.add.toLowerCase())
  if (!candidate) return { ok: false, reason: `Add-Karte nicht gefunden: ${swap.add}` }
  if (list.some((card) => card.oracle_id === candidate.card.oracle_id)) {
    return { ok: false, reason: `${candidate.card.name} ist bereits im Deck` }
  }
  const card = candidate.card
  if (card.oracle_id === context.commander.oracle_id || card.is_one_win) return { ok: false, reason: "Ungültige Add-Karte" }
  if (!context.settings.allowIllegal && card.legalities.commander !== "legal") return { ok: false, reason: "Add-Karte ist nicht Commander-legal" }
  if (!context.settings.allowBanned && card.legalities.commander === "banned") return { ok: false, reason: "Add-Karte ist gebannt" }
  if (!fitsColorIdentity(card, context.commander)) return { ok: false, reason: "Add-Karte verletzt die Farbidentität" }

  const quotas = bracketQuotas(context.bracket) as Record<string, number>
  if (ESSENTIAL_ROLES.includes(cut.role)) {
    const current = roleCountOf(list, cut.role)
    const sameRole = candidate.role === cut.role
    if (!sameRole && current - 1 < (quotas[cut.role] ?? 0)) {
      return { ok: false, reason: `Rolle ${cut.role} würde unter die Quote fallen` }
    }
  }

  const themeIds = new Set(context.theme?.ids ?? [])
  const cutTheme = themeIds.has(cut.oracle_id)
  const addTheme = themeIds.has(card.oracle_id)
  if (cutTheme && !addTheme && context.theme && themeCountOf(list, themeIds) - 1 < context.theme.target) {
    return { ok: false, reason: "Theme-Quote würde brechen" }
  }

  const next = list.slice()
  if (cut.quantity > 1) {
    next[cutIndex] = { ...cut, quantity: cut.quantity - 1 }
  } else {
    next.splice(cutIndex, 1)
  }
  next.push(makeDeckCard(card, candidate.role, `KI-Vorschlag: ${swap.reason || "Chat"}`.slice(0, 500), candidate.tags))
  if (next.reduce((sum, item) => sum + item.quantity, 0) !== 99) {
    return { ok: false, reason: "Swap würde nicht 99 Karten ergeben" }
  }
  if (!budgetOk(next, context.settings, context.bracket)) {
    return { ok: false, reason: "Swap würde Bracket-/Hausbudget überschreiten" }
  }
  return { ok: true, list: next }
}

function applySwaps(
  cards: DeckCard[],
  swaps: DeckSwap[],
  input: ImprovementInput,
  candidateByName: Map<string, Candidate>,
): { cards: DeckCard[]; applied: DeckSwap[]; rejected: RejectedSwap[] } {
  let list = cards.slice()
  const applied: DeckSwap[] = []
  const rejected: RejectedSwap[] = []
  for (const swap of swaps) {
    const result = applyOneSwap(list, swap, input, candidateByName)
    if (result.ok) {
      list = result.list
      applied.push(swap)
    } else {
      rejected.push({ swap, reason: result.reason })
    }
  }
  return { cards: list, applied, rejected }
}

export function applyChatDeckSwaps(input: {
  commander: Card
  cards: DeckCard[]
  settings: DeckSettings
  bracket: BracketId
  theme: SimulationTheme | null
  swaps: ChatDeckSwap[]
}): ChatSwapResult {
  const candidateByName = new Map<string, Candidate>()
  for (const swap of input.swaps) {
    const card = cardByNameExact(swap.add)
    if (!card) continue
    const tags = tagsFor([card.oracle_id]).get(card.oracle_id) ?? []
    candidateByName.set(card.name.toLowerCase(), {
      card,
      role: roleFor(card, tags),
      tags,
      theme: input.theme?.ids.includes(card.oracle_id) ? { label: input.theme.label } : undefined,
    })
  }
  let list = input.cards.slice()
  const applied: ChatDeckSwap[] = []
  const rejected: Array<{ swap: ChatDeckSwap; reason: string }> = []
  for (const swap of input.swaps) {
    const result = applyOneSwap(list, swap, input, candidateByName)
    if (result.ok) {
      list = result.list
      applied.push(swap)
    } else {
      rejected.push({ swap, reason: result.reason })
    }
  }
  return { cards: list, applied, rejected }
}

function candidateList(input: ImprovementInput): Candidate[] {
  const inDeck = new Set(input.cards.map((card) => card.oracle_id))
  const seen = new Set<string>()
  return input.pool
    .filter((candidate) => {
      const card = candidate.card
      if (inDeck.has(card.oracle_id) || seen.has(card.oracle_id)) return false
      seen.add(card.oracle_id)
      if (card.oracle_id === input.commander.oracle_id || card.is_one_win) return false
      if (!input.settings.allowIllegal && card.legalities.commander !== "legal") return false
      if (!input.settings.allowBanned && card.legalities.commander === "banned") return false
      return fitsColorIdentity(card, input.commander)
    })
    .sort((a, b) => {
      const theme = Number(Boolean(b.theme)) - Number(Boolean(a.theme))
      if (theme !== 0) return theme
      return (a.card.edhrec_rank ?? 999999) - (b.card.edhrec_rank ?? 999999)
    })
    .slice(0, 140)
}

function deterministicFallback(
  input: ImprovementInput,
  before: SimulationReport,
  candidateByName: Map<string, Candidate>,
): { cards: DeckCard[]; applied: DeckSwap[]; rejected: RejectedSwap[] } {
  let list = input.cards.slice()
  const applied: DeckSwap[] = []
  const rejected: RejectedSwap[] = []
  const candidates = [...candidateByName.values()]
  const used = new Set(list.map((card) => card.oracle_id))

  const tryCut = (cutName: string, role: Role | null, reason: string) => {
    const cut = list.find((card) => card.name.toLowerCase() === cutName.toLowerCase())
    if (!cut) return
    const candidate = candidates.find(
      (entry) =>
        !used.has(entry.card.oracle_id) &&
        (entry.role === (role ?? cut.role) || entry.theme) &&
        entry.card.oracle_id !== cut.oracle_id,
    )
    if (!candidate) return
    const swap: DeckSwap = {
      cut: cut.name,
      add: candidate.card.name,
      reason,
      fixes: [reason],
    }
    const result = applyOneSwap(list, swap, input, candidateByName)
    if (result.ok) {
      list = result.list
      used.add(candidate.card.oracle_id)
      applied.push(swap)
    } else {
      rejected.push({ swap, reason: result.reason })
    }
  }

  for (const dead of before.deadCards.slice(0, 3)) {
    tryCut(dead.name, null, `Tote Karte ersetzen: ${dead.reason}`)
    if (applied.length >= 3) break
  }
  if (!applied.length) {
    const weakness = before.weaknesses.find((entry) => entry.severity === "high")
    if (weakness?.id === "few-interaction") {
      const flex = list.find((card) => card.role === "flex" || card.role === "synergy")
      if (flex) tryCut(flex.name, "removal", "Mehr Interaktion gegen schnelle Tische")
    } else if (weakness?.id === "few-draw") {
      const flex = list.find((card) => card.role === "flex" || card.role === "synergy")
      if (flex) tryCut(flex.name, "draw", "Mehr Kartenvorteil gegen lange Partien")
    }
  }
  return { cards: list, applied, rejected }
}

export async function improveDeck(input: ImprovementInput): Promise<ImprovementResult> {
  const before = simulateDeck(input.commander, input.cards, input.settings, input.bracket, input.theme)
  const candidates = candidateList(input)
  const candidateByName = new Map(candidates.map((candidate) => [candidate.card.name.toLowerCase(), candidate]))
  let current = input.cards.slice()
  let applied: DeckSwap[] = []
  let rejected: RejectedSwap[] = []
  let assessment = ""
  let sessionID: string | null = null

  try {
    const prompt = buildImprovementPrompt(input, before, candidates)
    const reply = await callOpencodeDetailed(prompt, 180000)
    sessionID = reply.sessionID
    const proposal = parseImprovement(reply.text)
    assessment = proposal.assessment
    const result = applySwaps(current, proposal.swaps, input, candidateByName)
    if (result.applied.length) {
      const after = simulateDeck(input.commander, result.cards, input.settings, input.bracket, input.theme)
      const highBefore = before.weaknesses.filter((weakness) => weakness.severity === "high").length
      const highAfter = after.weaknesses.filter((weakness) => weakness.severity === "high").length
      if (after.score < before.score - 2 && highAfter >= highBefore) {
        rejected = [
          ...result.rejected,
          ...result.applied.map((swap) => ({ swap, reason: "Simulation nach dem Swap schlechter; Änderung verworfen" })),
        ]
      } else {
        current = result.cards
        applied = result.applied
        rejected = result.rejected
      }
    } else {
      rejected = result.rejected
    }
  } catch (error) {
    assessment = `KI-Doctor nicht verfügbar (${error instanceof Error ? error.message : String(error)}). Die Engine prüft tote Karten deterministisch.`
    const fallback = deterministicFallback(input, before, candidateByName)
    const after = simulateDeck(input.commander, fallback.cards, input.settings, input.bracket, input.theme)
    if (fallback.applied.length && after.score >= before.score) {
      current = fallback.cards
      applied = fallback.applied
      rejected = fallback.rejected
    } else {
      rejected = [
        ...fallback.rejected,
        ...fallback.applied.map((swap) => ({ swap, reason: "Fallback-Swap ohne Verbesserung; verworfen" })),
      ]
    }
  }

  const after = simulateDeck(input.commander, current, input.settings, input.bracket, input.theme)
  return { cards: current, before, after, applied, rejected, assessment, sessionID }
}
