import { mkdirSync } from "node:fs"
import { ROOT } from "./paths"

const CACHE_DIR = `${ROOT}/data/cache/http`
mkdirSync(CACHE_DIR, { recursive: true })

const UA = "Kommandozentrale/0.1 (private Commander deck workshop)"
const ACCEPT = "application/json"
let lastRequest = 0

function cacheKey(url: string) {
  let h = 0
  for (let i = 0; i < url.length; i++) h = (Math.imul(31, h) + url.charCodeAt(i)) | 0
  return `${CACHE_DIR}/${Math.abs(h).toString(16)}.json`
}

async function politeDelay() {
  const wait = 120 - (Date.now() - lastRequest)
  if (wait > 0) await Bun.sleep(wait)
  lastRequest = Date.now()
}

export async function scryfallJson<T>(url: string, ttlMs = 1000 * 60 * 60 * 24): Promise<T> {
  const path = cacheKey(url)
  const file = Bun.file(path)
  if (await file.exists()) {
    const stat = await file.stat()
    if (Date.now() - stat.mtimeMs < ttlMs) {
      try {
        return (await file.json()) as T
      } catch {
        // fall through to network
      }
    }
  }
  await politeDelay()
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: ACCEPT } })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Scryfall ${res.status}: ${body.slice(0, 180)}`)
  }
  const data = (await res.json()) as T
  await Bun.write(path, JSON.stringify(data))
  return data
}

export async function scryfallRaw(url: string): Promise<Response> {
  await politeDelay()
  return fetch(url, { headers: { "User-Agent": UA, Accept: ACCEPT } })
}

export interface ScryfallCard {
  object: string
  id: string
  oracle_id?: string
  name: string
  lang?: string
  released_at?: string
  printed_name?: string
  printed_text?: string
  mana_cost?: string
  cmc?: number
  type_line?: string
  oracle_text?: string
  colors?: string[]
  color_identity?: string[]
  keywords?: string[]
  legalities?: Record<string, string>
  edhrec_rank?: number
  image_uris?: Record<string, string>
  card_faces?: Array<{
    name?: string
    printed_name?: string
    mana_cost?: string
    type_line?: string
    oracle_text?: string
    printed_text?: string
    power?: string
    toughness?: string
    image_uris?: Record<string, string>
  }>
  layout?: string
  set?: string
  set_name?: string
  collector_number?: string
  rarity?: string
  power?: string
  toughness?: string
  loyalty?: string
  defense?: string
  produced_mana?: string[]
  frame?: string
  border_color?: string
  full_art?: boolean
  textless?: boolean
  promo?: boolean
  variation?: boolean
  artist?: string
  prices?: Record<string, string | null>
}

export async function searchCards(q: string, limit = 12) {
  const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=cards&order=edhrec&per_page=${limit}`
  try {
    const data = await scryfallJson<{ data: ScryfallCard[] }>(url, 1000 * 60 * 60 * 6)
    return data.data
  } catch (err) {
    if (String(err).includes("404")) return []
    throw err
  }
}

export async function getPrintings(name: string) {
  const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`!"${name}"`)}&unique=prints&order=released&per_page=175`
  try {
    const data = await scryfallJson<{ data: ScryfallCard[] }>(url, 1000 * 60 * 60 * 24)
    return data.data
  } catch (err) {
    if (String(err).includes("404")) return []
    throw err
  }
}

export async function getRulings(oracleId: string) {
  const url = `https://api.scryfall.com/cards/${oracleId}/rulings?per_page=175`
  try {
    const data = await scryfallJson<{ data: Array<{ source: string; published_at: string; comment: string }> }>(url, 1000 * 60 * 60 * 24 * 7)
    return data.data
  } catch (err) {
    if (String(err).includes("404")) return []
    throw err
  }
}

export interface GermanCardFace {
  name: string
  oracle_text: string | null
  type_line: string | null
}

export interface GermanCardText {
  name: string
  oracle_text: string | null
  card_faces: GermanCardFace[] | null
  set_code: string | null
  set_name: string | null
  collector_number: string | null
}

export async function getGermanCardText(oracleId: string): Promise<GermanCardText | null> {
  const query = encodeURIComponent(`oracleid:${oracleId} lang:de`)
  const url = `https://api.scryfall.com/cards/search?q=${query}&unique=prints&order=released&dir=desc&per_page=12`
  try {
    const data = await scryfallJson<{ data: ScryfallCard[] }>(url, 1000 * 60 * 60 * 24 * 30)
    const usable = data.data.filter((card) => Boolean(card.printed_name?.trim() || card.printed_text?.trim() || card.card_faces?.some((face) => face.printed_name?.trim() || face.printed_text?.trim())))
    const pick = usable[0]
    if (!pick) return null
    const faces = (pick.card_faces ?? [])
      .map((face) => ({
        name: face.printed_name?.trim() || face.name?.trim() || "Unbekannte Seite",
        oracle_text: face.printed_text?.trim() || null,
        type_line: face.type_line?.trim() || null,
      }))
      .filter((face) => face.oracle_text || face.name)
    return {
      name: pick.printed_name?.trim() || pick.name,
      oracle_text: pick.printed_text?.trim() || null,
      card_faces: faces.length ? faces : null,
      set_code: pick.set ?? null,
      set_name: pick.set_name ?? null,
      collector_number: pick.collector_number ?? null,
    }
  } catch (err) {
    if (String(err).includes("404")) return null
    throw err
  }
}

let mpcSources: Array<{ pk: number; name: string }> | null = null

async function getMpcSources() {
  if (mpcSources) return mpcSources
  const res = await fetch("https://mpcfill.com/2/sources/", { headers: { Accept: "application/json" } })
  if (!res.ok) throw new Error(`MPCFill sources ${res.status}`)
  const body = (await res.json()) as { results: Record<string, { pk: number; name: string }> }
  mpcSources = Object.values(body.results)
  return mpcSources
}

export interface ArtOption {
  source: "scryfall" | "mpcfill" | "upload"
  id: string
  name: string
  imageUrl: string
  thumbnailUrl: string
  artist?: string
  setCode?: string
  setName?: string
  collectorNumber?: string
  lang?: string
  dpi?: number
  tags?: string[]
  note?: string
}

export async function getMpcFillArt(name: string): Promise<ArtOption[]> {
  const sources = await getMpcSources()
  const res = await fetch("https://mpcfill.com/2/editorSearch/", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
    body: JSON.stringify({
      searchSettings: {
        searchTypeSettings: { fuzzySearch: false, filterCardbacks: false },
        sourceSettings: { sources: sources.map((s) => [s.pk, true]) },
        filterSettings: { minimumDPI: 0, maximumDPI: 1500, maximumSize: 60, languages: [], includesTags: [], excludesTags: [] },
      },
      queries: [{ query: name.toLowerCase(), cardType: "CARD" }],
    }),
  })
  if (!res.ok) throw new Error(`MPCFill search ${res.status}`)
  const body = (await res.json()) as { results: Record<string, Record<string, string[]>> }
  const ids = body.results[name.toLowerCase()]?.CARD ?? []
  if (ids.length === 0) return []
  const idsShort = ids.slice(0, 60)
  const cardsRes = await fetch("https://mpcfill.com/2/cards/", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
    body: JSON.stringify({ cardIdentifiers: idsShort }),
  })
  if (!cardsRes.ok) throw new Error(`MPCFill cards ${cardsRes.status}`)
  const cardsBody = (await cardsRes.json()) as {
    results: Record<
      string,
      {
        identifier: string
        name: string
        dpi: number
        language: string
        tags: string[]
        source_name?: string
      }
    >
  }
  return idsShort.flatMap((id) => {
    const c = cardsBody.results[id]
    if (!c) return []
    const url = `https://drive.google.com/thumbnail?id=${encodeURIComponent(c.identifier)}&sz=w1200`
    return [
      {
        source: "mpcfill" as const,
        id: `mpcfill:${c.identifier}`,
        name: c.name,
        imageUrl: url,
        thumbnailUrl: url.replace("w1200", "w400"),
        dpi: c.dpi,
        lang: c.language,
        tags: c.tags,
        note: c.source_name,
      },
    ]
  })
}

export function scryfallArt(card: ScryfallCard): string {
  const top = card.image_uris?.normal ?? card.image_uris?.large
  if (top) return top
  const face = card.card_faces?.[0]?.image_uris
  return face?.normal ?? face?.large ?? ""
}

export function scryfallCrop(card: ScryfallCard): string {
  const top = card.image_uris?.art_crop
  if (top) return top
  const face = card.card_faces?.[0]?.image_uris
  return face?.art_crop ?? ""
}
