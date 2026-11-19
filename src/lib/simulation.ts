import { analyzeDeck } from "./engine"
import type { BracketId, Card, DeckCard, DeckSettings } from "./types"

/**
 * Leichte Deck-Simulation nach dem Build.
 *
 * Keine vollständige MTG-Engine: Goldfish/Eröffnungshände, Rollenabdeckung,
 * Theme-Dichte, typische Angriffs-Szenarien und tote Karten. Die Ergebnisse
 * gehen als Diagnose an die KI, die konkrete Swaps vorschlagen darf.
 */

export interface SimulationTheme {
  label: string
  ids: string[]
  target: number
}

export interface SimulationDeadCard {
  name: string
  role: string
  cmc: number
  reason: string
}

export interface SimulationWeakness {
  id: string
  severity: "high" | "medium" | "low"
  title: string
  text: string
  fixes: string[]
}

export interface SimulationScenario {
  name: string
  risk: "hoch" | "mittel" | "niedrig"
  text: string
}

export interface SimulationMetrics {
  themeLabel: string | null
  themeCount: number
  themeTarget: number
  themeCoverage: number
  lands: number
  ramp: number
  draw: number
  removal: number
  wipes: number
  protection: number
  tutors: number
  recursion: number
  wincons: number
  interaction: number
  averageMv: number
  missedLandDropRate: number
  colorScrewRate: number
  averageCommanderTurn: number | null
  averageLandsByTurn4: number
}

export interface SimulationReport {
  createdAt: string
  deckUpdatedAt?: string
  score: number
  runs: number
  theme: { label: string; count: number; target: number; coverage: number } | null
  metrics: SimulationMetrics
  opening: {
    hands: number
    keepablePct: number
    averageLands: number
    themeInHandPct: number
    noPlayPct: number
  }
  scenarios: SimulationScenario[]
  deadCards: SimulationDeadCard[]
  weaknesses: SimulationWeakness[]
  strengths: string[]
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function deckSeed(cards: DeckCard[]): number {
  let hash = 2166136261
  for (const card of cards) {
    const text = `${card.oracle_id}:${card.quantity}`
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  }
  return hash >>> 0
}

function shuffle<T>(list: T[], random: () => number): void {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
}

const BASIC_LAND = /^(Plains|Island|Swamp|Mountain|Forest|Wastes)$/

export function simulateDeck(
  commander: Card,
  cards: DeckCard[],
  settings: DeckSettings,
  bracket: BracketId,
  themeInput: SimulationTheme | null = null,
): SimulationReport {
  const analysis = analyzeDeck(commander, cards, settings, bracket)
  const counts = analysis.counts
  const lands = counts.land ?? 0
  const ramp = counts.ramp ?? 0
  const draw = counts.draw ?? 0
  const removal = counts.removal ?? 0
  const wipes = counts.wipe ?? 0
  const protection = counts.protection ?? 0
  const tutors = counts.tutor ?? 0
  const recursion = counts.recursion ?? 0
  const wincons = counts.wincon ?? 0
  const interaction = removal + wipes + (counts.counter ?? 0)
  const creatures = cards.reduce(
    (sum, card) => sum + ((card.type_line ?? "").toLowerCase().includes("creature") ? card.quantity : 0),
    0,
  )
  const themeIds = new Set(themeInput?.ids ?? [])
  const themeCards = cards.filter((card) => themeIds.has(card.oracle_id))
  const themeCount = themeCards.reduce((sum, card) => sum + card.quantity, 0)
  const themeTarget = themeInput?.target ?? 0
  const themeCoverage = themeTarget ? themeCount / themeTarget : 0

  // Eröffnungshände: keepable nach Länderzahl, Theme-Dichte, kein früher Spielzug.
  const libraryBase: DeckCard[] = []
  for (const card of cards) for (let i = 0; i < card.quantity; i++) libraryBase.push(card)
  const random = mulberry32(deckSeed(cards))
  const handRuns = 900
  let keepable = 0
  let themeInHandCount = 0
  let noPlay = 0
  let handLandsTotal = 0
  for (let run = 0; run < handRuns; run++) {
    const library = [...libraryBase]
    shuffle(library, random)
    let hand = library.splice(0, 7)
    const landCount = (cardsInHand: DeckCard[]) => cardsInHand.filter((card) => card.role === "land").length
    if (landCount(hand) < 2 || landCount(hand) > 5) {
      library.push(...hand)
      shuffle(library, random)
      hand = library.splice(0, 7)
      if (hand.length) library.push(hand.pop()!)
    }
    const handLands = landCount(hand)
    if (handLands >= 2 && handLands <= 5 && hand.length > 0) {
      keepable++
      handLandsTotal += handLands
      if (hand.some((card) => themeIds.has(card.oracle_id))) themeInHandCount++
      const hasEarlyPlay = hand.some(
        (card) => card.role !== "land" && card.cmc <= 2 && card.role !== "commander",
      )
      if (!hasEarlyPlay) noPlay++
    }
  }

  const weaknesses: SimulationWeakness[] = []
  const addWeakness = (
    id: string,
    severity: SimulationWeakness["severity"],
    title: string,
    text: string,
    fixes: string[] = [],
  ) => {
    if (weaknesses.some((weakness) => weakness.id === id)) return
    weaknesses.push({ id, severity, title, text, fixes })
  }

  if (analysis.goldfish.missedLandDropRate > 0.15) {
    addWeakness(
      "mana-missed-drops",
      "high",
      "Mana stolpert",
      `In ${Math.round(analysis.goldfish.missedLandDropRate * 100)} % der frühen Züge fehlt ein Land-Drop.`,
      ["Mehr Länder oder günstige Ramp/Kartenselektion"],
    )
  } else if (analysis.goldfish.missedLandDropRate > 0.08) {
    addWeakness(
      "mana-missed-drops",
      "medium",
      "Mana etwas unruhig",
      `Die Land-Drop-Quote ist brauchbar, aber nicht stabil (${Math.round(analysis.goldfish.missedLandDropRate * 100)} % verpasst).`,
      ["1–2 Länder oder günstige Ramp"],
    )
  }
  if (analysis.goldfish.colorScrewRate > 0.2) {
    addWeakness(
      "mana-color-screw",
      "high",
      "Farb-Screw",
      `Die Manabase deckt farbintensive Karten zu selten ab (${Math.round(analysis.goldfish.colorScrewRate * 100)} % Farb-Screw).`,
      ["Mehr Farbquellen, Duals oder farblose Alternativen"],
    )
  }
  if (lands < 34) {
    addWeakness(
      "few-lands",
      lands < 31 ? "high" : "medium",
      "Zu wenige Länder",
      `${lands} Länder sind für 99 Karten knapp.`,
      ["Länder erhöhen", "Günstige Ramp-Karten"],
    )
  }
  if (lands > 40) {
    addWeakness("many-lands", "low", "Viele Länder", `${lands} Länder können zu Flood führen.`, ["Utility-Länder oder Kartenziehen"])
  }
  if (ramp < 8) {
    addWeakness("few-ramp", "medium", "Wenig Ramp", `Nur ${ramp} Ramp-Karten; der Commander und teure Theme-Karten kommen spät.`, ["2–4 Ramp-Karten"])
  }
  if (ramp > 18) {
    addWeakness("many-ramp", "low", "Sehr viel Ramp", `${ramp} Ramp-Karten können Plätze für Interaktion kosten.`, ["Ramp kürzen"])
  }
  if (draw < 8) {
    addWeakness("few-draw", "medium", "Wenig Kartenvorteil", `Nur ${draw} Draw-Karten; nach einem Boardwipe läuft das Deck leer.`, ["Draw-Engine oder Cantrips"])
  }
  if (interaction < 10) {
    addWeakness(
      "few-interaction",
      interaction < 7 ? "high" : "medium",
      "Zu wenig Interaktion",
      `Nur ${interaction} Removal/Wipe/Counter; der Tisch kann den Plan ungestört aufbauen.`,
      ["Spot-Removal", "Wipes oder Gegenzauber"],
    )
  }
  if (protection < 3 && creatures >= 25) {
    addWeakness(
      "boardwipe-vulnerable",
      "high",
      "Boardwipe-anfällig",
      `${creatures} Kreaturen, aber nur ${protection} Schutz-Karten.`,
      ["Schutz/Indestructible", "Rekursion"],
    )
  }
  if (wincons < 2) {
    addWeakness(
      "few-wincons",
      "medium",
      "Zu wenige Wincons",
      `Nur ${wincons} klare Wincon; nach Entfernung bleibt oft kein Weg zum Sieg.`,
      ["Zweite Wincon oder Commander-Schaden-Plan"],
    )
  }
  if (analysis.averageMv > 3.8 && ramp < 10) {
    addWeakness(
      "expensive-curve",
      "medium",
      "Teure Kurve",
      `Durchschnittliche Manakosten ${analysis.averageMv}; ohne genug Ramp bleibt das Deck hinter dem Tisch.`,
      ["Kurve senken", "Mehr Ramp"],
    )
  }
  if (themeTarget > 0 && themeCount < themeTarget) {
    addWeakness(
      "theme-low",
      "high",
      "Theme zu dünn",
      `${themeCount}/${themeTarget} ${themeInput?.label ?? "Theme"}-Karten; die Deckidentität verwässert.`,
      ["Mehr Theme-Karten", "Weniger generische Flex-Karten"],
    )
  }
  if (themeTarget > 0 && themeCount / Math.max(1, 99 - lands) < 0.25) {
    addWeakness(
      "theme-diluted",
      "medium",
      "Theme verwässert",
      `Nur ${Math.round((themeCount / Math.max(1, 99 - lands)) * 100)} % der Nicht-Länder tragen das Theme.`,
      ["Theme-Dichte erhöhen"],
    )
  }

  for (const [index, warning] of analysis.warnings.entries()) {
    const id = `warning-${index}`
    if (weaknesses.some((weakness) => weakness.text === warning.text)) continue
    weaknesses.push({
      id,
      severity: warning.level === "error" ? "high" : "medium",
      title: warning.level === "error" ? "Regel-/Deckfehler" : "Deck-Warnung",
      text: warning.text,
      fixes: [],
    })
  }

  // Tote Karten: keine Rolle, kein Theme-Bezug, keine relevante Tag-Funktion.
  const deadCards: SimulationDeadCard[] = []
  const impactfulTag =
    /^(counterspell|removal|hate-|protection|prevent-|extra-|tutor|wincon|recursion|reanimate|adds-|ramp|draw|mill|discard|surveil|sacrifice|death-trigger|blood-artist|drain-life|untap|stax|null-rod)/i
  for (const card of cards) {
    if (card.role === "land" || BASIC_LAND.test(card.name)) continue
    if (themeIds.has(card.oracle_id)) continue
    const weakRole = card.role === "flex" || card.role === "synergy"
    if (!weakRole) continue
    if (card.tags.some((tag) => impactfulTag.test(tag))) continue
    const noTags = card.tags.length === 0
    const highCmc = card.cmc >= 5
    const lowRank = (card.edhrec_rank ?? 999999) > 5000
    if (highCmc || noTags || lowRank) {
      const reason = highCmc
        ? `CMC ${card.cmc}, keine Rolle und kein Theme-Bezug`
        : noTags
          ? "Keine Tags, keine Rolle und kein Theme-Bezug"
          : "Keine Rolle/Theme und außerhalb der häufigsten Karten"
      deadCards.push({ name: card.name, role: card.role, cmc: card.cmc, reason })
    }
  }

  // Enabler/Payoff-Ungleichgewicht als typische tote Engine-Teile.
  const tagCount = (tags: string[]) =>
    cards.reduce((sum, card) => sum + (card.tags.some((tag) => tags.includes(tag)) ? card.quantity : 0), 0)
  const outletCount = tagCount(["sacrifice-outlet-creature", "free-sacrifice-outlet", "sacrifice-outlet-land"])
  const payoffCount = tagCount(["death-trigger", "blood-artist", "drain-life"])
  if (outletCount > payoffCount + 2) {
    const extra = cards
      .filter((card) => !themeIds.has(card.oracle_id) && card.tags.some((tag) => ["sacrifice-outlet-creature", "free-sacrifice-outlet"].includes(tag)))
      .sort((a, b) => (b.edhrec_rank ?? 0) - (a.edhrec_rank ?? 0))[0]
    if (extra) {
      deadCards.push({ name: extra.name, role: extra.role, cmc: extra.cmc, reason: "Opfer-Outlet ohne ausreichende Payoffs" })
    }
  }
  const graveEnablers = tagCount(["mill", "discard-outlet", "self-mill", "surveil"])
  const gravePayoffs = tagCount(["reanimate-creature", "castable-from-graveyard", "regrowth-any", "mass-reanimation"])
  if (graveEnablers > gravePayoffs + 2) {
    const extra = cards
      .filter((card) => !themeIds.has(card.oracle_id) && card.tags.some((tag) => ["mill", "discard-outlet", "self-mill"].includes(tag)))
      .sort((a, b) => (b.edhrec_rank ?? 0) - (a.edhrec_rank ?? 0))[0]
    if (extra) {
      deadCards.push({ name: extra.name, role: extra.role, cmc: extra.cmc, reason: "Friedhof-Enabler ohne genug Payoffs" })
    }
  }
  const uniqueDead = [...new Map(deadCards.map((card) => [card.name, card])).values()]
    .sort((a, b) => b.cmc - a.cmc)
    .slice(0, 8)

  const scenarios: SimulationScenario[] = []
  const boardwipeRisk: SimulationScenario["risk"] =
    creatures >= 30 && protection + recursion < 4
      ? "hoch"
      : creatures >= 25 && protection < 4
        ? "mittel"
        : "niedrig"
  scenarios.push({
    name: "Boardwipe",
    risk: boardwipeRisk,
    text:
      boardwipeRisk === "niedrig"
        ? `${creatures} Kreaturen, ${protection + recursion} Schutz/Rekursionskarten: verkraftbar.`
        : `${creatures} Kreaturen treffen ${protection + recursion} Schutz/Rekursionskarten; ein Wipe kann den Plan stark bremsen.`,
  })
  const graveyardTheme =
    themeInput?.label?.toLowerCase().includes("friedhof") ||
    tagCount(["reanimate-creature", "mass-reanimation"]) >= 4
  scenarios.push({
    name: "Friedhofshass",
    risk: graveyardTheme ? (tagCount(["reanimate-creature", "regrowth-any"]) >= 5 ? "hoch" : "mittel") : "niedrig",
    text: graveyardTheme
      ? "Der Plan nutzt den Friedhof; Exil-/Friedhofshass kann zentrale Karten abschalten."
      : "Der Friedhof ist kein zentraler Plan; Friedhofshass trifft nur einzelne Karten.",
  })
  scenarios.push({
    name: "Schnelle Combos",
    risk: interaction < 7 ? "hoch" : interaction < 11 ? "mittel" : "niedrig",
    text: `${interaction} Interaktionskarten gegen schnelle gegnerische Linien.`,
  })
  scenarios.push({
    name: "Commander-Entfernung",
    risk: protection + recursion < 4 ? "hoch" : protection + recursion < 7 ? "mittel" : "niedrig",
    text: `${protection} Schutz- und ${recursion} Rekursionskarten für den Commander.`,
  })
  scenarios.push({
    name: "Mana-Screw",
    risk:
      analysis.goldfish.missedLandDropRate > 0.15 || analysis.goldfish.colorScrewRate > 0.2
        ? "hoch"
        : analysis.goldfish.missedLandDropRate > 0.08
          ? "mittel"
          : "niedrig",
    text: `${Math.round(analysis.goldfish.missedLandDropRate * 100)} % verpasste Land-Drops, ${Math.round(analysis.goldfish.colorScrewRate * 100)} % Farb-Screw.`,
  })

  const strengths: string[] = []
  if (themeTarget > 0) strengths.push(`${themeCount}/${themeTarget} ${themeInput?.label ?? "Theme"}-Karten`)
  if (analysis.goldfish.missedLandDropRate <= 0.08 && analysis.goldfish.colorScrewRate <= 0.1) strengths.push("stabile Manabase")
  if (interaction >= 12) strengths.push(`${interaction} Interaktionskarten`)
  if (draw >= 10) strengths.push(`${draw} Kartenvorteil-Karten`)
  if (protection >= 4) strengths.push(`${protection} Schutz-Karten`)
  if (wincons >= 3) strengths.push(`${wincons} Wincons`)
  if (!strengths.length) strengths.push("Solide Grundstruktur; die Simulation sucht gezielt Verbesserungen.")

  let penalty = 0
  for (const weakness of weaknesses) penalty += weakness.severity === "high" ? 12 : weakness.severity === "medium" ? 6 : 2
  penalty += Math.min(10, uniqueDead.length * 2)
  const themeBonus = themeTarget ? Math.min(10, themeCoverage * 10) : 0
  const manaBonus = clamp(10 - analysis.goldfish.missedLandDropRate * 40 - analysis.goldfish.colorScrewRate * 20, 0, 10)
  const interactionBonus = Math.min(10, interaction / 2)
  const drawBonus = Math.min(5, draw / 2)
  const winBonus = Math.min(5, wincons * 2)
  const score = Math.round(clamp(55 + themeBonus + manaBonus + interactionBonus + drawBonus + winBonus - penalty, 0, 100))

  return {
    createdAt: new Date().toISOString(),
    score,
    runs: 1500,
    theme: themeTarget
      ? { label: themeInput?.label ?? "Theme", count: themeCount, target: themeTarget, coverage: Number(themeCoverage.toFixed(2)) }
      : null,
    metrics: {
      themeLabel: themeInput?.label ?? null,
      themeCount,
      themeTarget,
      themeCoverage: Number(themeCoverage.toFixed(2)),
      lands,
      ramp,
      draw,
      removal,
      wipes,
      protection,
      tutors,
      recursion,
      wincons,
      interaction,
      averageMv: analysis.averageMv,
      missedLandDropRate: analysis.goldfish.missedLandDropRate,
      colorScrewRate: analysis.goldfish.colorScrewRate,
      averageCommanderTurn: analysis.goldfish.averageCommanderTurn,
      averageLandsByTurn4: analysis.goldfish.averageLandsByTurn4,
    },
    opening: {
      hands: handRuns,
      keepablePct: Number(((keepable / handRuns) * 100).toFixed(1)),
      averageLands: keepable ? Number((handLandsTotal / keepable).toFixed(1)) : 0,
      themeInHandPct: keepable ? Number(((themeInHandCount / keepable) * 100).toFixed(1)) : 0,
      noPlayPct: keepable ? Number(((noPlay / keepable) * 100).toFixed(1)) : 0,
    },
    scenarios,
    deadCards: uniqueDead,
    weaknesses: weaknesses.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 }
      return order[a.severity] - order[b.severity]
    }),
    strengths,
  }
}
