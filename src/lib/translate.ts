export interface ComboTextInput {
  id: string
  description: string
  produces: string[]
  easyPrerequisites: string
  notablePrerequisites: string
  cardNames: string[]
}

export interface ComboTextTranslation {
  id: string
  description: string
  produces: string[]
  easyPrerequisites: string
  notablePrerequisites: string
}

const OLLAMA_URL = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, "")
const MODEL = process.env.OLLAMA_TRANSLATE_MODEL?.trim() || null
let resolvedModel: string | null = MODEL

const MAX_BATCH = 5

function clean(value: unknown, max = 2400): string {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, max)
}

function cleanList(value: unknown, maxItems = 20, max = 240): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => clean(entry, max))
    .filter(Boolean)
    .slice(0, maxItems)
}

function polish(value: string): string {
  return value
    .replace(/\bGib ([^.]+?) Lebensverknüpfung\b/g, "Verleihe $1 Lebensverknüpfung")
    .replace(/\bGib ([^.]+?) Todesberührung\b/g, "Verleihe $1 Todesberührung")
    .replace(/Unendliche Lebenspunktengewinn-Trigger/g, "Unendliche Lebensgewinn-Trigger")
    .replace(/Unendliche Lebenspunktengewinn/g, "Unendlicher Lebensgewinn")
    .replace(/Unendliche Lebenspunktegewinnungs-Trigger/g, "Unendliche Lebensgewinn-Trigger")
    .replace(/Unendliche Lebenspunktegewinnung/g, "Unendlicher Lebensgewinn")
    .replace(/Lebenspunktengewinn-Trigger/g, "Lebensgewinn-Trigger")
    .replace(/Lebenspunktengewinn/g, "Lebensgewinn")
    .replace(/Lebenspunktegewinnungs-Trigger/g, "Lebensgewinn-Trigger")
    .replace(/Lebenspunktegewinnung/g, "Lebensgewinn")
    .replace(/Ziel-Gegner/g, "Gegner deiner Wahl")
}

function normalize(entry: ComboTextInput): ComboTextInput {
  return {
    id: clean(entry.id, 80),
    description: clean(entry.description),
    produces: cleanList(entry.produces),
    easyPrerequisites: clean(entry.easyPrerequisites, 1200),
    notablePrerequisites: clean(entry.notablePrerequisites, 1200),
    cardNames: cleanList(entry.cardNames, 30, 120),
  }
}

async function ollamaTags(): Promise<Response> {
  try {
    return await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) })
  } catch (err) {
    const code = (err as { code?: string })?.code
    if (code !== "ECONNREFUSED" && !String(err).includes("ECONNREFUSED")) throw err
    try {
      Bun.spawn(["ollama", "serve"], { stdout: "ignore", stderr: "ignore", env: process.env })
    } catch {
      throw err
    }
    await Bun.sleep(2500)
    return fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) })
  }
}

async function resolveModel(): Promise<string> {
  if (resolvedModel) return resolvedModel
  const res = await ollamaTags()
  if (!res.ok) throw new Error(`Ollama tags ${res.status}`)
  const body = (await res.json()) as { models?: Array<{ name?: string; model?: string }> }
  const names = (body.models ?? []).map((model) => String(model.name ?? model.model ?? "")).filter(Boolean)
  if (names.length === 0) throw new Error("Kein lokales Übersetzungsmodell gefunden.")
  const preferred = names.find((name) => /gemma|qwen|llama|mistral/i.test(name)) ?? names[0]
  resolvedModel = preferred
  return preferred
}

function parseTranslations(raw: string): any[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim()
  const parsed = JSON.parse(cleaned)
  if (Array.isArray(parsed)) return parsed
  if (Array.isArray(parsed?.translations)) return parsed.translations
  if (Array.isArray(parsed?.items)) return parsed.items
  return []
}

async function translateBatch(entries: ComboTextInput[]): Promise<ComboTextTranslation[]> {
  const model = await resolveModel()
  const prompt = [
    "Du bist ein deutscher Magic: The Gathering-Redakteur.",
    "Übersetze die folgenden Combo-Beschreibungen natürlich und präzise ins Deutsche.",
    "",
    "Regeln:",
    "- Kartennamen bleiben exakt in der englischen Schreibweise. Übersetze sie niemals.",
    "- Manasymbole, Zahlen, Lebenspunkte, Schadenshöhen und Schrittverweise bleiben exakt.",
    "- Nutze offizielle deutsche Magic-Begriffe: lifelink = Lebensverknüpfung, deathtouch = Todesberührung, trample = Trampelschaden, haste = Eile, flash = Aufblitzen, hexproof = Fluchsicher, indestructible = unzerstörbar, graveyard = Friedhof, battlefield = Schlachtfeld, library = Bibliothek, exile = Exil, sacrifice = opfern, draw = ziehen, discard = abwerfen, trigger = auslösen, activate = aktivieren, cast = wirken, target = Ziel, opponent = Gegner, counter = Marke (bei +1/+1) bzw. neutralisieren (bei Zaubersprüchen), token = Spielstein.",
    "- Übersetze auch produces und prerequisites. Lass keine Informationen weg und erfinde keine hinzu.",
    "- Antworte ausschließlich mit gültigem JSON, ohne Erklärung und ohne Codezäune.",
    "",
    'Format: {"translations":[{"id":"...","description":"...","produces":["..."],"easyPrerequisites":"...","notablePrerequisites":"..."}]}',
    "",
    "Daten:",
    JSON.stringify(
      entries.map((entry) => ({
        id: entry.id,
        description: entry.description,
        produces: entry.produces,
        easyPrerequisites: entry.easyPrerequisites,
        notablePrerequisites: entry.notablePrerequisites,
        cardNames: entry.cardNames,
      })),
    ),
  ].join("\n")

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: "json",
      options: { temperature: 0.1, num_ctx: 16384 },
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Ollama ${res.status}: ${body.slice(0, 200)}`)
  }
  const body = (await res.json()) as { response?: string }
  if (!body.response) throw new Error("Das Übersetzungsmodell lieferte keine Antwort.")
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const out: ComboTextTranslation[] = []
  for (const row of parseTranslations(body.response)) {
    const id = clean(row?.id, 80)
    const source = byId.get(id)
    if (!source) continue
    const description = polish(clean(row?.description))
    if (!description) continue
    out.push({
      id,
      description,
      produces: cleanList(row?.produces).map(polish),
      easyPrerequisites: polish(clean(row?.easyPrerequisites, 1200)),
      notablePrerequisites: polish(clean(row?.notablePrerequisites, 1200)),
    })
  }
  return out
}

export async function translateComboTexts(entries: ComboTextInput[]): Promise<ComboTextTranslation[]> {
  const cleanEntries = entries.map(normalize).filter((entry) => entry.id && entry.description)
  const out: ComboTextTranslation[] = []
  for (let index = 0; index < cleanEntries.length; index += MAX_BATCH) {
    const batch = cleanEntries.slice(index, index + MAX_BATCH)
    out.push(...(await translateBatch(batch)))
  }
  return out
}
