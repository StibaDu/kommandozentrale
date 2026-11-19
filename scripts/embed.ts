import { createHash } from "node:crypto"
import { db, stateSet } from "../src/db"
import {
  EMBED_MODEL,
  embedTexts,
  embeddingStatus,
  ensureOllama,
  normalizeVector,
} from "../src/lib/embeddings"

/**
 * Baut den Vektorindex über alle Karten.
 *
 *   bun run embed                 # fehlende/geänderte Karten einbetten
 *   bun run embed -- --force      # alles neu einbetten
 *   bun run embed -- --status     # nur Status zeigen
 *
 * Der Text pro Karte enthält Name, Typ, Mana, Oracle-Text, Keywords und die
 * Scryfall-Tags. Damit treffen deutsche Strategie-Anfragen auch Karten, deren
 * Oracle-Text das gesuchte Wort nicht wörtlich enthält.
 */

const args = process.argv.slice(2)
const hasFlag = (flag: string) => args.includes(flag)
const flagValue = (flag: string) => {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function usage() {
  console.log(`Vektorindex für alle Magic-Karten.

  bun run embed [Optionen]

  --status            Nur den aktuellen Status ausgeben
  --force             Alle Karten neu einbetten
  --keep-models       Vektoren anderer Modelle nicht löschen
  --model <name>      Embedding-Modell (Default: ${EMBED_MODEL})
  --batch <n>         Texte pro Ollama-Anfrage (Default: 8)
  --concurrency <n>   Parallele Ollama-Anfragen (Default: 32)
  --limit <n>         Nur die ersten n Karten einbetten (zum Testen)
  --help              Diese Hilfe`)
}

interface CardRow {
  oracle_id: string
  name: string
  mana_cost: string | null
  type_line: string | null
  oracle_text_all: string | null
  keywords: string | null
}

interface PendingCard {
  oracle_id: string
  text: string
  hash: string
}

function parseList(raw: string | null): string[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) ? value.map((entry) => String(entry)) : []
  } catch {
    return []
  }
}

function cardText(card: CardRow, tags: string[]): string {
  const parts: string[] = [card.name]
  if (card.mana_cost) parts.push(`Mana: ${card.mana_cost}`)
  if (card.type_line) parts.push(card.type_line)
  if (card.oracle_text_all) parts.push(card.oracle_text_all)
  const keywords = parseList(card.keywords)
  if (keywords.length) parts.push(`Keywords: ${keywords.join(", ")}`)
  if (tags.length) parts.push(`Tags: ${[...new Set(tags)].sort().slice(0, 40).join(", ")}`)
  return parts.join("\n").slice(0, 8000)
}

function hashText(text: string): string {
  return createHash("sha1").update(text).digest("hex")
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`
}

async function main() {
  const model = flagValue("--model") ?? EMBED_MODEL
  if (hasFlag("--help")) {
    usage()
    return
  }

  if (hasFlag("--status")) {
    console.log(JSON.stringify(embeddingStatus(model), null, 2))
    return
  }

  const force = hasFlag("--force")
  const keepModels = hasFlag("--keep-models")
  const batchSize = Math.max(1, Number(flagValue("--batch") ?? 8))
  const concurrency = Math.max(1, Number(flagValue("--concurrency") ?? 32))
  const limit = Number(flagValue("--limit") ?? 0)

  await ensureOllama()

  const cards = db
    .query("SELECT oracle_id, name, mana_cost, type_line, oracle_text_all, keywords FROM card ORDER BY oracle_id")
    .all() as CardRow[]
  if (!cards.length) {
    console.error("Keine Karten in der Datenbank. Zuerst `bun run ingest` ausführen.")
    process.exit(1)
  }

  const tagRows = db.query("SELECT oracle_id, tag FROM card_tag").all() as Array<{ oracle_id: string; tag: string }>
  const tagMap = new Map<string, string[]>()
  for (const row of tagRows) {
    const list = tagMap.get(row.oracle_id) ?? []
    list.push(row.tag)
    tagMap.set(row.oracle_id, list)
  }

  const existing = new Map<string, string>()
  for (const row of db.query("SELECT oracle_id, text_hash FROM card_embedding WHERE model = ?").all(model) as any[]) {
    existing.set(String(row.oracle_id), String(row.text_hash))
  }

  const selected = limit > 0 ? cards.slice(0, limit) : cards
  const pending: PendingCard[] = []
  let unchanged = 0
  for (const card of selected) {
    const text = cardText(card, tagMap.get(card.oracle_id) ?? [])
    const hash = hashText(text)
    if (!force && existing.get(card.oracle_id) === hash) {
      unchanged++
      continue
    }
    pending.push({ oracle_id: card.oracle_id, text, hash })
  }

  console.log(
    `${selected.length} Karten · ${unchanged} unverändert · ${pending.length} neu einbetten · Modell ${model}`,
  )
  if (!pending.length) {
    finish(model, keepModels)
    return
  }

  const upsert = db.query(
    `INSERT INTO card_embedding(oracle_id, model, dim, vector, text_hash, updated_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(oracle_id) DO UPDATE SET
       model = excluded.model,
       dim = excluded.dim,
       vector = excluded.vector,
       text_hash = excluded.text_hash,
       updated_at = excluded.updated_at`,
  )

  const chunkSize = batchSize * concurrency
  const startedAt = Date.now()
  let processed = 0
  let dim = 0

  for (let offset = 0; offset < pending.length; offset += chunkSize) {
    const slice = pending.slice(offset, offset + chunkSize)
    const vectors = await embedTexts(
      slice.map((card) => card.text),
      { model, batchSize, concurrency },
    )
    const now = new Date().toISOString()
    const tx = db.transaction((rows: Array<{ card: PendingCard; vector: Float32Array }>) => {
      for (const row of rows) {
        const vector = normalizeVector(row.vector)
        if (!dim) dim = vector.length
        upsert.run(
          row.card.oracle_id,
          model,
          vector.length,
          new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength),
          row.card.hash,
          now,
        )
      }
    })
    tx(slice.map((card, index) => ({ card, vector: vectors[index] })))
    processed += slice.length
    const elapsed = Date.now() - startedAt
    const perCard = elapsed / processed
    const eta = perCard * (pending.length - processed)
    const pct = ((processed / pending.length) * 100).toFixed(1)
    console.log(
      `[${processed}/${pending.length}] ${pct}% · ${Math.round(perCard)} ms/Karte · ETA ${formatDuration(eta)} · ${dim} Dimensionen`,
    )
  }

  finish(model, keepModels)
}

function finish(model: string, keepModels: boolean) {
  db.query("DELETE FROM card_embedding WHERE oracle_id NOT IN (SELECT oracle_id FROM card)").run()
  if (!keepModels) db.query("DELETE FROM card_embedding WHERE model != ?").run(model)
  const status = embeddingStatus(model)
  const now = new Date().toISOString()
  stateSet("embeddings_model", model)
  stateSet("embeddings_dim", String(status.dim ?? ""))
  stateSet("embeddings_count", String(status.count))
  stateSet("embeddings_updated_at", now)
  console.log(`Fertig: ${status.count}/${status.total} Karten · ${status.dim ?? "?"} Dimensionen · ${status.model}`)
  if (status.count < status.total) {
    console.log(`Es fehlen noch ${status.total - status.count} Karten. Erneut \`bun run embed\` ausführen.`)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  console.error("Läuft Ollama? Sonst: ollama serve — und Modell prüfen: ollama pull " + EMBED_MODEL)
  process.exit(1)
})
