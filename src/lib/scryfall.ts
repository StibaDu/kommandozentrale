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
  printed_type_line?: string
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
    printed_type_line?: string
    mana_cost?: string
    type_line?: string
    oracle_text?: string
    printed_text?: string
    power?: string
    toughness?: string
    artist?: string
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
  type_line: string | null
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
          type_line: face.printed_type_line?.trim() || face.type_line?.trim() || null,
        }))
        .filter((face) => face.oracle_text || face.name)
      return {
        name: pick.printed_name?.trim() || pick.name,
        oracle_text: pick.printed_text?.trim() || null,
        type_line: pick.printed_type_line?.trim() || pick.type_line?.trim() || null,
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

export interface MpcFillSearchOptions {
  includesTags?: string[]
  excludesTags?: string[]
  /** Obergrenze pro Kartennamen (Default 500; die Live-Suche nutzt 60). */
  maxIdsPerName?: number
  fuzzy?: boolean
}

async function mpcFetch(url: string, init: RequestInit, attempts = 6): Promise<Response> {
  let last: Response | null = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    let res: Response
    try {
      res = await fetch(url, init)
    } catch (err) {
      if (attempt === attempts - 1) throw err
      await Bun.sleep(1000 * (attempt + 1))
      continue
    }
    if (res.status !== 429 && res.status < 500) return res
    last = res
    const retryAfter = Number(res.headers.get("retry-after"))
    const wait = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(60_000, 5_000 * 2 ** attempt)
    await res.text().catch(() => "")
    if (attempt < attempts - 1) await Bun.sleep(wait)
  }
  return last ?? new Response(null, { status: 429 })
}

function mpcArtOption(card: any): ArtOption {
  const url = `https://drive.google.com/thumbnail?id=${encodeURIComponent(card.identifier)}&sz=w1200`
  return {
    source: "mpcfill",
    id: `mpcfill:${card.identifier}`,
    name: card.name,
    imageUrl: url,
    thumbnailUrl: url.replace("w1200", "w400"),
    dpi: card.dpi,
    lang: card.language,
    tags: Array.isArray(card.tags) ? card.tags : [],
    note: card.source_name,
  }
}

async function fetchMpcCards(ids: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>()
  for (let index = 0; index < ids.length; index += 500) {
    const chunk = ids.slice(index, index + 500)
    const res = await mpcFetch("https://mpcfill.com/2/cards/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
      body: JSON.stringify({ cardIdentifiers: chunk }),
    })
    if (!res.ok) throw new Error(`MPCFill cards ${res.status}`)
    const body = (await res.json()) as { results?: Record<string, any> }
    for (const [identifier, card] of Object.entries(body.results ?? {})) {
      out.set(identifier, card)
    }
  }
  return out
}

/**
 * Batch-Suche über mehrere Kartennamen in einem Request. `includesTags:["NSFW"]`
 * liefert nur die NSFW-Arts; Retry/Backoff fängt MPCFills Cloudflare-429 ab.
 */
export async function searchMpcFillBatch(
  names: string[],
  options: MpcFillSearchOptions = {},
): Promise<Map<string, ArtOption[]>> {
  const clean = [...new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean))]
  if (!clean.length) return new Map()

  const sources = await getMpcSources()
  const payload = {
    searchSettings: {
      searchTypeSettings: { fuzzySearch: options.fuzzy ?? false, filterCardbacks: false },
      sourceSettings: { sources: sources.map((source) => [source.pk, true]) },
      filterSettings: {
        minimumDPI: 0,
        maximumDPI: 1500,
        maximumSize: 60,
        languages: [],
        includesTags: options.includesTags ?? [],
        excludesTags: options.excludesTags ?? [],
      },
    },
    queries: clean.map((query) => ({ query, cardType: "CARD" })),
  }

  const res = await mpcFetch("https://mpcfill.com/2/editorSearch/", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`MPCFill search ${res.status}`)
  const body = (await res.json()) as { results?: Record<string, Record<string, string[]>> }

  const perName = new Map<string, string[]>()
  const allIds = new Set<string>()
  for (const [rawName, value] of Object.entries(body.results ?? {})) {
    const ids = Array.isArray(value?.CARD) ? value.CARD.map(String) : []
    const limited = ids.slice(0, options.maxIdsPerName ?? 500)
    perName.set(rawName.toLowerCase(), limited)
    for (const id of limited) allIds.add(id)
  }

  const cards = await fetchMpcCards([...allIds])
  const out = new Map<string, ArtOption[]>()
  for (const name of clean) {
    const arts = (perName.get(name) ?? [])
      .map((id) => cards.get(id))
      .filter(Boolean)
      .map((card) => mpcArtOption(card))
    out.set(name, arts)
  }
  return out
}

export async function getMpcFillArt(name: string): Promise<ArtOption[]> {
  const result = await searchMpcFillBatch([name], { maxIdsPerName: 60 })
  return result.get(name.trim().toLowerCase()) ?? []
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

export function scryfallBackArt(card: ScryfallCard): string {
  const face = card.card_faces?.[1]?.image_uris
  return face?.normal ?? face?.large ?? ""
}

export function scryfallBackCrop(card: ScryfallCard): string {
  const face = card.card_faces?.[1]?.image_uris
  return face?.art_crop ?? ""
}
