import { cardById, fitsColorIdentity } from "./engine"
import { detectThemes, themeCandidates } from "./themes"
import { visionVectorCandidates, type VisionCandidate } from "./vision"
import type { BracketId, Card, DeckSettings } from "./types"

/**
 * Aus der Vision + semantischen/mechanischen Treffern eine ganze Deck-Idee
 * bauen: Commander, Schlüsselkarten, Synergie-Cluster, Wincons, Risiken.
 * Die Karten stammen ausschließlich aus der lokalen DB und dem Theme-/Vektor-
 * Retriever; das Modell darf nur den Commander und die Begründung liefern.
 */

export interface DeckIdeaKeyCard {
  name: string
  role: string
  why: string
}

export interface DeckIdea {
  title: string
  themes: string[]
  strategy: string
  keyCards: DeckIdeaKeyCard[]
  synergies: string[]
  wincons: string[]
  risks: string
}

const SYNERGY_TAGS = new Set([
  "gives-shadow",
  "gains-shadow",
  "synergy-shadow",
  "shadow-counter",
  "evasion",
  "gives-evasion",
  "unblockable",
  "gives-unblockable",
  "death-trigger",
  "sacrifice-outlet-creature",
  "sacrifice-outlet-land",
  "free-sacrifice-outlet",
  "repeatable-creature-tokens",
  "draw-engine",
  "repeatable-pure-draw",
  "repeatable-card-advantage",
  "reanimate-creature",
  "mass-reanimation",
  "spellslinger",
  "landfall",
  "counters-matter",
  "repeatable-pp-counters",
  "gains-pp-counters",
  "equipment",
  "aura",
  "treasure",
  "repeatable-treasures",
  "mill",
  "discard-outlet",
  "wheel",
  "blink",
  "flicker",
  "etb",
  "attack-trigger",
  "combat-damage-trigger",
  "lifegain",
  "drain-life",
  "proliferate",
  "overrun",
  "alternate-win-condition",
])

const SYNERGY_LABELS: Record<string, string> = {
  "gives-shadow": "Verleiht Shadow",
  "gains-shadow": "Erhält Shadow",
  "synergy-shadow": "Shadow-Synergie",
  "shadow-counter": "Shadow-Marken",
  evasion: "Evasion",
  "gives-evasion": "Verleiht Evasion",
  unblockable: "Unblockbar",
  "gives-unblockable": "Verleiht Unblockbar",
  "death-trigger": "Todesauslöser",
  "sacrifice-outlet-creature": "Kreaturen opfern",
  "sacrifice-outlet-land": "Länder opfern",
  "free-sacrifice-outlet": "Kostenloses Opfer-Outlet",
  "repeatable-creature-tokens": "Wiederholbare Token",
  "draw-engine": "Draw-Engine",
  "repeatable-pure-draw": "Wiederholbares Ziehen",
  "repeatable-card-advantage": "Wiederholbarer Kartenvorteil",
  "reanimate-creature": "Reanimation",
  "mass-reanimation": "Massen-Reanimation",
  spellslinger: "Zauberschleuder",
  landfall: "Landfall",
  "counters-matter": "Marken-Thema",
  "repeatable-pp-counters": "Wiederholbare +1/+1-Marken",
  "gains-pp-counters": "Erhält +1/+1-Marken",
  equipment: "Ausrüstung",
  aura: "Auren",
  treasure: "Schätze",
  "repeatable-treasures": "Wiederholbare Schätze",
  mill: "Mill",
  "discard-outlet": "Abwerfen",
  wheel: "Wheels",
  blink: "Blink",
  flicker: "Flackern",
  etb: "ETB-Effekte",
  "attack-trigger": "Angriffsauslöser",
  "combat-damage-trigger": "Kampfschadens-Auslöser",
  lifegain: "Lebensgewinn",
  "drain-life": "Leben absaugen",
  proliferate: "Proliferate",
  overrun: "Überrennen",
  "alternate-win-condition": "Alternative Wincon",
}

const THEME_RISKS: Record<string, string> = {
  Shadow: "Shadow ist fragil: Boardwipes und Karten mit Shadow blocken die Kerneinheit. Schutz, Rekursion und genug Interaktion einplanen.",
  "Friedhof / Reanimation": "Friedhofshass kann den Plan komplett abschalten; ein zweiter Wincon und Exil-Schutz sind Pflicht.",
  Spielsteine: "Boardwipes treffen die Token-Engine hart; Anthems und Rekursion als Backup einplanen.",
  Artefakte: "Massen-Artefaktentfernung ist das größte Risiko; nicht alles auf ein einziges Artefakt legen.",
  Verzauberungen: "Massen-Verzauberungsentfernung und Aura-Hate sind das größte Risiko; Rekursion einplanen.",
  Zaubersprüche: "Ohne ausreichend billige Sprüche fällt die Engine auseinander; das Deck braucht genug Card-Draw.",
  Voltron: "Der Commander ist das Ziel; Opfer-, Exil- und Kontrollzauber können den Plan stoppen.",
  Landfall: "Landzerstörung und zu wenige Land-Drops bremsen die Engine; genug Ramp und Landsucher spielen.",
  Mill: "Friedhofshass und Karten, die den Friedhof zurückmischen, kontern den Plan.",
  Lebensgewinn: "Alternativer Commander-Schaden und Infekt umgehen Lebenspunkte; Interaktion einplanen.",
  Aggro: "Boardwipes und Lifegain verlangsamen den Plan; Reach/Evasion und Reach-Proofing einplanen.",
}

function fallbackRisk(themes: string[]): string {
  const specific = themes.map((label) => THEME_RISKS[label]).filter(Boolean)
  return specific.length
    ? specific.join(" ")
    : "Das Deck braucht eine stabile Manabase, genug Interaktion und einen klaren Plan gegen Boardwipes."
}

function whyFor(hit: VisionCandidate): string {
  if (hit.theme) return `Thema ${hit.theme.label}`
  if (hit.vision?.tags?.length) return hit.vision.tags.slice(0, 2).join(", ")
  return `Rolle ${hit.role}`
}

export async function buildDeckIdea(
  commander: Card,
  brief: string,
  settings: DeckSettings,
  bracket: BracketId,
  reason = "",
): Promise<DeckIdea> {
  const themes = detectThemes(brief)
  const themeHits = themeCandidates(brief, commander, settings, { perTheme: 80, maxTotal: 120 })
  let vectorHits: VisionCandidate[] = []
  try {
    vectorHits = await visionVectorCandidates(brief, commander, settings, { perSpec: 5, maxTotal: 15 })
  } catch {
    // Ohne Vektorindex bleibt die mechanische Suche.
  }

  const merged = new Map<string, VisionCandidate>()
  for (const hit of [...themeHits, ...vectorHits]) {
    if (hit.card.oracle_id === commander.oracle_id || hit.card.is_one_win) continue
    if (!fitsColorIdentity(hit.card, commander)) continue
    if (!settings.allowIllegal && hit.card.legalities.commander !== "legal") continue
    if (!settings.allowBanned && hit.card.legalities.commander === "banned") continue
    if (!merged.has(hit.card.oracle_id)) merged.set(hit.card.oracle_id, hit)
  }
  const all = [...merged.values()].sort(
    (a, b) => (a.card.edhrec_rank ?? 999999) - (b.card.edhrec_rank ?? 999999),
  )

  const keyCards = all.slice(0, 12).map((hit) => ({
    name: hit.card.name,
    role: hit.role,
    why: whyFor(hit),
  }))

  const tagCards = new Map<string, string[]>()
  for (const hit of all.slice(0, 40)) {
    for (const tag of hit.tags) {
      if (!SYNERGY_TAGS.has(tag)) continue
      const names = tagCards.get(tag) ?? []
      if (!names.includes(hit.card.name)) names.push(hit.card.name)
      tagCards.set(tag, names)
    }
  }
  const synergies = [...tagCards.entries()]
    .filter(([, names]) => names.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 4)
    .map(([tag, names]) => `${SYNERGY_LABELS[tag] ?? tag}: ${names.slice(0, 4).join(", ")}`)

  const wincons = all
    .filter(
      (hit) =>
        hit.role === "wincon" ||
        hit.tags.some((tag) =>
          ["overrun", "drain-life", "alternate-win-condition", "opponent-loses-life", "extra-turn"].includes(tag),
        ),
    )
    .slice(0, 4)
    .map((hit) => hit.card.name)
  if (!wincons.length) wincons.push(`Commander-Schaden mit ${commander.name}`)

  const themeLabels = themes.map((theme) => theme.label)
  const title = `${commander.name}: ${themeLabels.join(" + ") || "Deck-Idee"}`
  const strategy =
    reason.trim() ||
    `${commander.name} als ${themeLabels.join(" + ") || "strategisches"} Deck: ${keyCards
      .slice(0, 3)
      .map((card) => card.name)
      .join(", ")} bilden den Kern; die Engine füllt Rollen, Manabase und Bracket-Grenzen.`

  return {
    title,
    themes: themeLabels,
    strategy,
    keyCards,
    synergies,
    wincons,
    risks: fallbackRisk(themeLabels),
  }
}
