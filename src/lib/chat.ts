import { AI_MODEL, callOpencodeDetailed } from "./ai"
import type { DeckSwap } from "./improve"
import type { BracketId, Card, DeckCard } from "./types"

export interface DeckChatMessage {
  role: "user" | "assistant"
  content: string
  created_at?: string
}

export interface DeckChatContext {
  name: string
  commander: Card | null
  cards: DeckCard[]
  bracket: BracketId
  pod_size?: number
  brief?: string
  primer?: string | null
  analysis?: any
  simulation?: any
}

function deckLine(card: DeckCard): string {
  const quantity = card.quantity > 1 ? `${card.quantity}x ` : ""
  const tags = card.tags.filter((tag) => !["activated-ability", "triggered-ability"].includes(tag)).slice(0, 6).join(",")
  return `${quantity}${card.name} | ${card.role} | MV ${card.cmc} | ${tags || "—"}`
}

export function buildDeckChatPrompt(deck: DeckChatContext, question: string, history: DeckChatMessage[]): string {
  const counts = deck.analysis?.counts ?? {}
  const warnings = (deck.analysis?.warnings ?? []).map((warning: any) => warning.text).slice(0, 6)
  const goldfish = deck.analysis?.goldfish
  const simulation = deck.simulation
    ? JSON.stringify(
        {
          score: deck.simulation.score,
          theme: deck.simulation.theme,
          metrics: deck.simulation.metrics,
          opening: deck.simulation.opening,
          weaknesses: deck.simulation.weaknesses,
          deadCards: deck.simulation.deadCards,
          scenarios: deck.simulation.scenarios,
          improvement: deck.simulation.improvement
            ? {
                beforeScore: deck.simulation.improvement.beforeScore,
                afterScore: deck.simulation.improvement.afterScore,
                applied: deck.simulation.improvement.applied,
                assessment: deck.simulation.improvement.assessment,
              }
            : null,
        },
        null,
        2,
      )
    : "Noch keine Simulation vorhanden."
  const historyText = history
    .slice(-12)
    .map((message) => `${message.role === "user" ? "Nutzer" : "KI"}: ${message.content.slice(0, 1400)}`)
    .join("\n\n")
  const commander = deck.commander
  return `Du bist der Deck-Berater der Kommandozentrale, einer privaten Commander-Runde.
Du sprichst direkt mit dem Besitzer eines fertig gebauten Decks und kennst den aktuellen Stand.

### Deck
Name: ${deck.name}
Commander: ${commander?.name ?? "unbekannt"} (${commander?.color_identity?.join("") || "farblos"})
Bracket: B${deck.bracket}, Pod: ${deck.pod_size ?? 4} Spieler
Deck-Vision: ${(deck.brief ?? "").slice(0, 1500) || "—"}
Commander-Text: ${(commander?.oracle_text_all ?? "").replace(/\s+/g, " ").slice(0, 700) || "—"}

### Analyse
Karten: ${deck.analysis?.total ?? deck.cards.length + 1}
Länder: ${counts.land ?? 0}, Ramp: ${counts.ramp ?? 0}, Draw: ${counts.draw ?? 0}, Removal: ${counts.removal ?? 0}, Wipes: ${counts.wipe ?? 0}, Schutz: ${counts.protection ?? 0}, Tutoren: ${counts.tutor ?? 0}, Rekursion: ${counts.recursion ?? 0}, Wincons: ${counts.wincon ?? 0}
Durchschnittlicher Manawert: ${deck.analysis?.averageMv ?? "—"}
Goldfish: Commander im Schnitt ${goldfish?.averageCommanderTurn ?? "—"}, verpasste Land-Drops ${goldfish ? Math.round(goldfish.missedLandDropRate * 100) : "—"} %, Farb-Screw ${goldfish ? Math.round(goldfish.colorScrewRate * 100) : "—"} %
Warnungen: ${warnings.join(" | ") || "keine"}

### Simulation
${simulation}

### Primer-Auszug
${(deck.primer ?? "").slice(0, 2800) || "Kein Primer vorhanden."}

### Deckliste (99 Karten)
${deck.cards.map(deckLine).join("\n") || "Noch keine Karten."}

### Bisheriger Chat
${historyText || "Noch kein Chat."}

### Aktuelle Nachricht
${question}

### Regeln
- Antworte auf Deutsch in Markdown, konkret und knapp; höchstens 450 Wörter, außer der Nutzer verlangt ausdrücklich mehr.
- Nenne nur echte Magic-Karten. Erfinde keine Karten, Regeln, Preise oder Turnierdaten.
- Setze jeden Kartennamen im answer in Backticks (Beispiel: \"Kartenname\"), damit er im Chat anklickbar ist.
- Vorschläge müssen zur Farbidentität des Commanders passen; keine 1-Win-Karten empfehlen.
- Unterscheide klar zwischen Karten, die im Deck sind, und Vorschlägen. Behandle die Deckliste als aktuell.
- Stütze dich auf Analyse, Simulation und Primer. Wenn Daten fehlen, sage das.
- Du änderst nichts am Deck. Wenn der Nutzer eine Änderung will, schlage konkrete Swaps vor; der Nutzer kann sie unter dem Chat übernehmen.
- Keine Floskeln, keine Wiederholung der Deckliste, kein Marketing.

### Ausgabeformat
Antworte ausschließlich mit einem JSON-Objekt, ohne Text außerhalb:
{"answer":"Deine Antwort auf Deutsch in Markdown.","swaps":[{"cut":"Exakter Kartenname aus dem Deck","add":"Exakter Kartenname","reason":"Warum dieser Tausch?","fixes":["Schwäche/Szenario"]}]}
- answer: die eigentliche Chat-Antwort. Erkläre die Vorschläge hier kurz; sie werden dem Nutzer zusätzlich unter dem Chat angezeigt.
- swaps: 0 bis 6 Vorschläge. Jeder Vorschlag ist ein 1:1-Tausch. Wenn keine Änderung sinnvoll ist, nutze [].
- cut muss exakt in der aktuellen Deckliste stehen. add muss eine echte, farbidentische Karte sein. Schneide keine Länder. Keine 1-Win-Karten.
- Erfinde keine Karten und keine Swaps nur um des Vorschlagens willen.`
}

export function parseDeckChatReply(text: string): { answer: string; swaps: DeckSwap[] } {
  const raw = text.trim()
  try {
    const body = raw.replace(/```(?:json)?/gi, "").trim()
    const start = body.indexOf("{")
    const end = body.lastIndexOf("}")
    if (start < 0 || end <= start) throw new Error("Kein JSON")
    const parsed = JSON.parse(body.slice(start, end + 1)) as any
    const answer = typeof parsed?.answer === "string" ? parsed.answer.trim() : ""
    const source = Array.isArray(parsed?.swaps) ? parsed.swaps : Array.isArray(parsed?.changes) ? parsed.changes : []
    const swaps = source
      .map((item: any) => ({
        cut: String(item?.cut ?? "").trim(),
        add: String(item?.add ?? "").trim(),
        reason: String(item?.reason ?? "").trim().slice(0, 700),
        fixes: Array.isArray(item?.fixes) ? item.fixes.map(String).slice(0, 4) : [],
      }))
      .filter((swap: DeckSwap) => swap.cut && swap.add)
      .slice(0, 6)
    if (answer) return { answer, swaps }
    if (swaps.length) return { answer: "Ich schlage folgende Änderungen vor.", swaps }
  } catch {
  }
  return { answer: raw, swaps: [] }
}

export async function askDeckChat(deck: DeckChatContext, question: string, history: DeckChatMessage[]) {
  const prompt = buildDeckChatPrompt(deck, question, history)
  const reply = await callOpencodeDetailed(prompt, 180000)
  const parsed = parseDeckChatReply(reply.text)
  if (!parsed.answer) throw new Error("Die KI lieferte keine Antwort.")
  return {
    text: parsed.answer,
    swaps: parsed.swaps,
    sessionID: reply.sessionID,
    model: AI_MODEL,
    promptTokensEstimate: Math.ceil(prompt.length / 4),
  }
}
