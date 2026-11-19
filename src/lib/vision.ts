import { effectProfile, searchStructured, semanticSearchMany } from "./cardsearch"
import { roleFor, tagsFor, type Candidate, type VisionMatch } from "./engine"
import type { Card, DeckSettings } from "./types"

/**
 * Deck-Vision → Effekt-Suche → Kandidatenpool.
 *
 * Die Vision ist Freitext. `effectProfile` zieht die Glossar-Treffer heraus
 * (englische Oracle-Begriffe + Scryfall-Tags); pro Satz/Teilsatz wird
 * gesucht. Die Treffer landen mit `vision`-Marker im Pool, damit der
 * Deckbauer sie bevorzugt und der Prompt erklären kann, warum sie da sind.
 */

export interface VisionSpec {
  /** Der Satz/Teilsatz, aus dem die Suche abgeleitet wurde. */
  label: string
  terms: string[]
  tags: string[]
  cues: string[]
}

const CLAUSE_SPLIT =
  /(?<=[.!?;:])\s+|,\s+|\s+(?:und|aber|sowie|oder|dass|weil|wenn)\s+|\n+/i

/** "keine Extra-Turns" ist ein Wunsch *gegen* eine Karte — daraus darf
 *  keine positive Effekt-Suche werden. */
const NEGATION = /\b(kein\w*|ohne|nicht|verzicht\w*)\b/i

const BASIC_LAND = /^(Plains|Island|Swamp|Mountain|Forest|Wastes)$/

function clampLabel(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim()
  return clean.length > 90 ? `${clean.slice(0, 88).trimEnd()}…` : clean
}

export function visionSpecs(brief: string): VisionSpec[] {
  const text = String(brief ?? "").replace(/\u0000/g, "").trim()
  if (text.length < 8) return []

  const parts = text
    .split(CLAUSE_SPLIT)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4)
  // Eine Vision kann ein einziger langer Satz sein; dann zählt der ganze Text.
  if (parts.length < 2) parts.push(text)

  const specs: VisionSpec[] = []
  const seen = new Set<string>()
  for (const part of parts) {
    if (NEGATION.test(part)) continue
    const profile = effectProfile(part)
    if (!profile.terms.length && !profile.tags.length) continue
    const key = `${[...profile.terms].sort().join("|")}#${[...profile.tags].sort().join("|")}`
    if (seen.has(key)) continue
    seen.add(key)
    specs.push({
      label: clampLabel(part),
      terms: profile.terms,
      tags: profile.tags,
      cues: profile.cues,
    })
    if (specs.length >= 8) break
  }
  return specs
}

export interface VisionCandidate extends Candidate {
  vision: VisionMatch
}

/**
 * Sucht zu jedem Vision-Spec Karten und verpackt sie als Pool-Kandidaten.
 * Filtert Farbidentität, Legalität und 1-Win-Karten; Basics bleiben draußen.
 */
export function visionCandidates(
  brief: string,
  commander: Card,
  settings: DeckSettings,
  { perSpec = 10, maxTotal = 40 }: { perSpec?: number; maxTotal?: number } = {},
): VisionCandidate[] {
  const specs = visionSpecs(brief)
  if (!specs.length) return []

  const found = new Map<string, VisionCandidate>()
  for (const spec of specs) {
    let hits
    try {
      hits = searchStructured(
        { terms: spec.terms, tags: spec.tags },
        {
          colorIdentity: commander.color_identity,
          commanderLegal: !settings.allowIllegal,
          limit: perSpec,
        },
      )
    } catch {
      continue
    }

    for (const hit of hits) {
      if (hit.card.oracle_id === commander.oracle_id || hit.card.is_one_win) continue
      if (BASIC_LAND.test(hit.card.name)) continue
      if (!settings.allowBanned && hit.card.legalities.commander === "banned") continue
      if (!settings.allowIllegal && hit.card.legalities.commander !== "legal") continue

      const existing = found.get(hit.card.oracle_id)
      if (existing) {
        for (const tag of hit.match.tags) {
          if (!existing.vision.tags.includes(tag)) existing.vision.tags.push(tag)
        }
        continue
      }

      const tags = [...new Set(hit.match.tags)]
      found.set(hit.card.oracle_id, {
        card: hit.card,
        role: roleFor(hit.card, tags),
        tags,
        vision: {
          label: spec.label,
          tags: [...tags],
          snippet: hit.match.snippet,
        },
      })
      if (found.size >= maxTotal) return [...found.values()]
    }
  }
  return [...found.values()]
}

/**
 * Hängt die Vision-Treffer an den normalen Pool. Karten, die schon drin
 * sind, werden nur markiert — so tauchen sie nicht doppelt auf, werden
 * aber im Prompt bevorzugt.
 */
export function mergeVision(pool: Candidate[], vision: Candidate[]): Candidate[] {
  if (!vision.length) return pool
  const merged = [...pool]
  const byId = new Map(merged.map((candidate) => [candidate.card.oracle_id, candidate]))
  for (const hit of vision) {
    const existing = byId.get(hit.card.oracle_id)
    if (existing) {
      existing.vision = hit.vision
      if (hit.theme) existing.theme = hit.theme
      continue
    }
    merged.push(hit)
    byId.set(hit.card.oracle_id, hit)
  }
  return merged
}

/**
 * Semantischer Retriever für die Deck-Vision und den Commander-Plan.
 *
 * Die lexikalische Effekt-Suche (oben) versteht nur Begriffe aus dem Glossar
 * und Scryfall-Tags. Der Vektorindex findet zusätzlich Karten, deren Text
 * dieselbe Mechanik umschreibt, ohne das Stichwort zu nennen — und er läuft
 * auch dann, wenn die Vision nur vage bleibt. Der Commander-Text ist immer
 * eine eigene Query, damit auch ohne Vision synergistische Karten im Pool
 * landen.
 */
export async function visionVectorCandidates(
  brief: string,
  commander: Card,
  settings: DeckSettings,
  { perSpec = 10, maxTotal = 40, includeCommander = true }: { perSpec?: number; maxTotal?: number; includeCommander?: boolean } = {},
): Promise<VisionCandidate[]> {
  const specs = visionSpecs(brief)
  const commanderBaseName = commander.name.split(",")[0].trim().toLowerCase()
  const queries: Array<{ label: string; text: string }> = []
  for (const spec of specs) queries.push({ label: spec.label, text: spec.label })
  if (!specs.length && String(brief ?? "").trim().length >= 8) {
    const label = clampLabel(brief)
    queries.push({ label, text: String(brief).trim().slice(0, 2000) })
  }
  if (includeCommander) {
    // Den Namen aus dem Oracle-Text entfernen: Sonst zieht die Suche Karten
    // mit demselben Namen (z. B. andere Korvold-Varianten) statt Karten mit
    // derselben Mechanik. Tags beschreiben die Strategie zusätzlich.
    const commanderTags = tagsFor([commander.oracle_id]).get(commander.oracle_id) ?? []
    const oracle = (commander.oracle_text_all ?? "").split(commander.name).join("this creature")
    const commanderText = [
      commander.type_line,
      oracle,
      commander.keywords.length ? commander.keywords.join(", ") : "",
      commanderTags.length ? `Tags: ${commanderTags.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(". ")
      .slice(0, 4000)
    if (commanderText) queries.push({ label: `Commander-Strategie: ${commander.name}`, text: commanderText })
  }
  if (!queries.length) return []

  let resultSets
  try {
    resultSets = await semanticSearchMany(
      queries.map((query) => query.text),
      {
        colorIdentity: commander.color_identity,
        commanderLegal: !settings.allowIllegal,
        excludeBasicLands: true,
      },
      perSpec,
    )
  } catch {
    // Kein Index, Ollama aus: Die lexikalische Suche bleibt die Grundlage.
    return []
  }

  const found = new Map<string, VisionCandidate>()
  for (let index = 0; index < queries.length; index++) {
    for (const hit of resultSets[index] ?? []) {
      if (hit.card.oracle_id === commander.oracle_id || hit.card.is_one_win) continue
      const cardBaseName = hit.card.name.split(",")[0].trim().toLowerCase()
      if (commanderBaseName.length >= 5 && cardBaseName.includes(commanderBaseName)) continue
      if (!settings.allowBanned && hit.card.legalities.commander === "banned") continue
      if (!settings.allowIllegal && hit.card.legalities.commander !== "legal") continue

      const existing = found.get(hit.card.oracle_id)
      if (existing) {
        for (const tag of hit.match.tags) {
          if (!existing.vision.tags.includes(tag)) existing.vision.tags.push(tag)
        }
        continue
      }

      const tags = [...new Set(hit.match.tags)]
      found.set(hit.card.oracle_id, {
        card: hit.card,
        role: roleFor(hit.card, tags),
        tags,
        vision: {
          label: queries[index].label,
          tags: [...tags],
          snippet: hit.match.snippet,
        },
      })
      if (found.size >= maxTotal) return [...found.values()]
    }
  }
  return [...found.values()]
}

/** Führt lexikalische und semantische Vision-Treffer zusammen. Der erste
 *  Treffer (lexikalisch) behält sein erklärbares Label. */
export function combineVision(...lists: VisionCandidate[][]): VisionCandidate[] {
  const out = new Map<string, VisionCandidate>()
  for (const list of lists) {
    for (const candidate of list) {
      const existing = out.get(candidate.card.oracle_id)
      if (existing) {
        for (const tag of candidate.vision.tags) {
          if (!existing.vision.tags.includes(tag)) existing.vision.tags.push(tag)
        }
        continue
      }
      out.set(candidate.card.oracle_id, candidate)
    }
  }
  return [...out.values()]
}
