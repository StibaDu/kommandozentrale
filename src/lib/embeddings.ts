import { db } from "../db"

/**
 * Karten-Embeddings über Ollama.
 *
 * Die Vektoren liegen als normierte Float32-BLOBs in `card_embedding`. Für die
 * Suche wird der gesamte Index einmal in den Speicher geladen; 39k × 1024
 * Floats sind rund 160 MB und damit für diese Einzelplatz-App vertretbar.
 *
 * Modell: bge-m3 (multilingual, 1024 Dimensionen). Deutsche Anfragen landen
 * damit im selben Raum wie der englische Oracle-Text.
 */

export const EMBED_MODEL = process.env.KZ_EMBED_MODEL?.trim() || "bge-m3"
export const EMBED_DIM = Number(process.env.KZ_EMBED_DIM ?? 1024)
const OLLAMA_URL = (process.env.KZ_OLLAMA_URL ?? process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, "")

let ollamaReady = false

export async function ensureOllama(): Promise<void> {
  if (ollamaReady) return
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) })
    if (res.ok) {
      ollamaReady = true
      return
    }
  } catch {
    // nicht erreichbar — unten starten
  }
  try {
    Bun.spawn([Bun.which("ollama") ?? "ollama", "serve"], { stdout: "ignore", stderr: "ignore", env: process.env })
  } catch {
    // Wenn Ollama fehlt, scheitert der Ping unten mit einer klaren Meldung.
  }
  for (let i = 0; i < 40; i++) {
    await Bun.sleep(500)
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) {
        ollamaReady = true
        return
      }
    } catch {
      // weiter warten
    }
  }
  throw new Error(`Ollama ist unter ${OLLAMA_URL} nicht erreichbar.`)
}

export interface EmbedOptions {
  model?: string
  batchSize?: number
  concurrency?: number
  keepAlive?: string
}

function chunk<T>(list: T[], size: number): Array<{ start: number; items: T[] }> {
  const out: Array<{ start: number; items: T[] }> = []
  for (let i = 0; i < list.length; i += size) out.push({ start: i, items: list.slice(i, i + size) })
  return out
}

async function embedBatchRaw(texts: string[], model: string, keepAlive: string): Promise<Float32Array[]> {
  let res: Response
  try {
    res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: texts, truncate: true, keep_alive: keepAlive }),
      signal: AbortSignal.timeout(900_000),
    })
  } catch (err) {
    throw new Error(`Ollama nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Ollama embed ${res.status}: ${body.slice(0, 200)}`)
  }
  const payload = (await res.json()) as { embeddings?: number[][] }
  const vectors = payload.embeddings
  if (!Array.isArray(vectors) || vectors.length !== texts.length) {
    throw new Error(`Ollama lieferte ${vectors?.length ?? 0} statt ${texts.length} Embeddings.`)
  }
  return vectors.map((vector) => Float32Array.from(vector))
}

async function embedBatch(texts: string[], model: string, keepAlive: string): Promise<Float32Array[]> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await embedBatchRaw(texts, model, keepAlive)
    } catch (err) {
      lastError = err
      await Bun.sleep(750 * (attempt + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export function normalizeVector(vector: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < vector.length; i++) sum += vector[i] * vector[i]
  const norm = Math.sqrt(sum)
  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) vector[i] /= norm
  }
  return vector
}

/** Batch-Embeddings mit begrenzter Parallelität (Ollama verarbeitet mehrere
 *  Anfragen gleichzeitig deutlich schneller als eine große Anfrage). */
export async function embedTexts(texts: string[], opts: EmbedOptions = {}): Promise<Float32Array[]> {
  if (!texts.length) return []
  await ensureOllama()
  const model = opts.model ?? EMBED_MODEL
  const batchSize = Math.max(1, opts.batchSize ?? 8)
  const concurrency = Math.max(1, opts.concurrency ?? 8)
  const keepAlive = opts.keepAlive ?? "1h"
  const batches = chunk(texts, batchSize)
  const out: Float32Array[] = new Array(texts.length)
  let cursor = 0

  async function worker() {
    while (cursor < batches.length) {
      const index = cursor++
      const batch = batches[index]
      const vectors = await embedBatch(batch.items, model, keepAlive)
      for (let i = 0; i < vectors.length; i++) out[batch.start + i] = vectors[i]
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, () => worker()))
  return out
}

const queryCache = new Map<string, Float32Array>()
const QUERY_CACHE_MAX = 500

export async function embedQuery(text: string, model = EMBED_MODEL): Promise<Float32Array> {
  const key = `${model}\u0000${text.trim().toLowerCase()}`
  const cached = queryCache.get(key)
  if (cached) return cached
  const [vector] = await embedTexts([text], { model, batchSize: 1, concurrency: 1 })
  const normalized = normalizeVector(vector)
  if (queryCache.size >= QUERY_CACHE_MAX) queryCache.clear()
  queryCache.set(key, normalized)
  return normalized
}

export interface EmbeddingStatus {
  model: string
  ready: boolean
  count: number
  total: number
  dim: number | null
  updatedAt: string | null
}

export function embeddingStatus(model = EMBED_MODEL): EmbeddingStatus {
  const totalRow = db.query("SELECT COUNT(*) AS n FROM card").get() as any
  const row = db
    .query("SELECT COUNT(*) AS count, MIN(dim) AS dim, MAX(updated_at) AS updatedAt FROM card_embedding WHERE model = ?")
    .get(model) as any
  const count = Number(row?.count ?? 0)
  return {
    model,
    ready: count > 0,
    count,
    total: Number(totalRow?.n ?? 0),
    dim: row?.dim == null ? null : Number(row.dim),
    updatedAt: row?.updatedAt ?? null,
  }
}

interface VectorIndex {
  model: string
  dim: number
  ids: string[]
  vectors: Float32Array
}

let vectorIndex: VectorIndex | null = null
let vectorSignature: string | null = null

function indexSignature(model: string): string {
  const status = embeddingStatus(model)
  return `${model}:${status.count}:${status.dim}:${status.updatedAt}`
}

export function invalidateVectorIndex() {
  vectorIndex = null
  vectorSignature = null
}

/** Lädt alle Vektoren eines Modells in einen zusammenhängenden Float32Array. */
export function loadVectorIndex(model = EMBED_MODEL): VectorIndex | null {
  const signature = indexSignature(model)
  if (vectorIndex && vectorSignature === signature) return vectorIndex

  const rows = db
    .query("SELECT oracle_id, dim, vector FROM card_embedding WHERE model = ? ORDER BY oracle_id")
    .all(model) as any[]
  if (!rows.length) {
    vectorIndex = null
    vectorSignature = signature
    return null
  }

  let dim = 0
  for (const row of rows) {
    if (Number(row.dim) > 0) {
      dim = Number(row.dim)
      break
    }
  }
  if (!dim) return null

  const ids: string[] = []
  const vectors = new Float32Array(rows.length * dim)
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (Number(row.dim) !== dim) continue
    const blob = row.vector as Uint8Array
    if (!blob || blob.byteLength < dim * 4) continue
    const slot = ids.length * dim
    new Uint8Array(vectors.buffer, slot * 4, dim * 4).set(blob.subarray(0, dim * 4))
    ids.push(String(row.oracle_id))
    rows[i] = null
  }

  vectorIndex = { model, dim, ids, vectors: ids.length * dim === vectors.length ? vectors : vectors.slice(0, ids.length * dim) }
  vectorSignature = signature
  return vectorIndex
}

export function vectorIndexInfo(model = EMBED_MODEL): { ready: boolean; count: number; dim: number | null } {
  const index = loadVectorIndex(model)
  return { ready: Boolean(index), count: index?.ids.length ?? 0, dim: index?.dim ?? null }
}
