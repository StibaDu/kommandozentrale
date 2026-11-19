import { db, stateGet, stateSet } from "../src/db"
import { searchMpcFillBatch, type ArtOption } from "../src/lib/scryfall"

/**
 * Importiert alle MPCFill-Arts mit Tag "NSFW" in die lokale Datenbank.
 *
 * MPCFill ist rate-limitiert; die Suche läuft in Batches und ist resumierbar.
 * Bereits geprüfte Namen stehen in `mpcfill_query`, die Arts in `mpcfill_art`.
 *
 *   bun run ingest:mpcfill              # alle offenen Namen prüfen
 *   bun run ingest:mpcfill -- --limit 200
 *   bun run ingest:mpcfill -- --reset   # Fortschritt + Arts löschen
 *   bun run ingest:mpcfill -- --status
 */

const args = process.argv.slice(2)
const hasFlag = (flag: string) => args.includes(flag)
const flagValue = (flag: string) => {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

interface Target {
  oracle_id: string
  face: "front" | "back"
}

function parseFaces(raw: unknown): Array<{ name?: string }> {
  if (!raw) return []
  try {
    const value = JSON.parse(String(raw))
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`
}

function buildTargets(): Map<string, Target[]> {
  const targets = new Map<string, Target[]>()
  const add = (name: string | undefined, oracleId: string, face: "front" | "back") => {
    const clean = String(name ?? "").trim()
    if (!clean) return
    const key = clean.toLowerCase()
    const list = targets.get(key) ?? []
    if (!list.some((target) => target.oracle_id === oracleId && target.face === face)) {
      list.push({ oracle_id: oracleId, face })
      targets.set(key, list)
    }
  }
  const rows = db.query("SELECT oracle_id, name, card_faces FROM card").all() as any[]
  for (const row of rows) {
    const oracleId = String(row.oracle_id)
    add(row.name, oracleId, "front")
    const faces = parseFaces(row.card_faces)
    add(faces[0]?.name, oracleId, "front")
    add(faces[1]?.name, oracleId, "back")
  }
  return targets
}

const targets = buildTargets()

if (hasFlag("--help")) {
  console.log(`MPCFill-NSFW-Import

  bun run ingest:mpcfill [Optionen]

  --status            Nur Status zeigen
  --reset             mpcfill_art und mpcfill_query leeren
  --limit <n>         Nur n offene Namen prüfen
  --batch <n>         Namen pro MPCFill-Request (Default 100)
  --delay <ms>        Pause zwischen Batches (Default 1000)
  --quiet             Nur jede 10. Batch melden
  --help              Diese Hilfe`)
  process.exit(0)
}

if (hasFlag("--reset")) {
  db.exec("DELETE FROM mpcfill_art; DELETE FROM mpcfill_query;")
  stateSet("mpcfill_nsfw_synced_at", "")
  console.log("mpcfill_art und mpcfill_query geleert.")
}

if (hasFlag("--status")) {
  const artCount = db.query("SELECT COUNT(*) AS n FROM mpcfill_art WHERE nsfw = 1").get() as any
  const checkedCount = db.query("SELECT COUNT(*) AS n FROM mpcfill_query").get() as any
  console.log(
    JSON.stringify(
      {
        names: targets.size,
        checked: Number(checkedCount?.n ?? 0),
        nsfwArts: Number(artCount?.n ?? 0),
        syncedAt: stateGet("mpcfill_nsfw_synced_at") || null,
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

const batchSize = Math.max(1, Number(flagValue("--batch") ?? 100))
const delayMs = Math.max(0, Number(flagValue("--delay") ?? 1000))
const limit = Number(flagValue("--limit") ?? 0)
const quiet = hasFlag("--quiet")

const checked = new Set(
  (db.query("SELECT name FROM mpcfill_query").all() as any[]).map((row) => String(row.name)),
)
let pending = [...targets.keys()].filter((name) => !checked.has(name)).sort()
if (limit > 0) pending = pending.slice(0, limit)

if (!pending.length) {
  console.log("Nichts zu tun. Alle Namen sind bereits geprüft.")
  process.exit(0)
}

const artUpsert = db.query(
  `INSERT INTO mpcfill_art(
     identifier, card_name, oracle_id, face, tags_json, language, dpi,
     source_name, nsfw, image_url, thumbnail_url, updated_at
   ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
   ON CONFLICT(identifier) DO UPDATE SET
     card_name = excluded.card_name,
     oracle_id = excluded.oracle_id,
     face = excluded.face,
     tags_json = excluded.tags_json,
     language = excluded.language,
     dpi = excluded.dpi,
     source_name = excluded.source_name,
     nsfw = excluded.nsfw,
     image_url = excluded.image_url,
     thumbnail_url = excluded.thumbnail_url,
     updated_at = excluded.updated_at`,
)
const queryUpsert = db.query(
  `INSERT INTO mpcfill_query(name, checked_at, nsfw_count)
   VALUES (?,?,?)
   ON CONFLICT(name) DO UPDATE SET checked_at = excluded.checked_at, nsfw_count = excluded.nsfw_count`,
)

console.log(
  `${targets.size} Namen · ${checked.size} geprüft · ${pending.length} offen · Batch ${batchSize}`,
)

const started = Date.now()
let processed = 0
let found = 0

for (let offset = 0; offset < pending.length; offset += batchSize) {
  const batch = pending.slice(offset, offset + batchSize)
  let result: Map<string, ArtOption[]>
  try {
    result = await searchMpcFillBatch(batch, {
      includesTags: ["NSFW"],
      excludesTags: [],
      maxIdsPerName: 500,
    })
  } catch (error) {
    console.error(
      `\nAbbruch bei ${processed}/${pending.length}: ${error instanceof Error ? error.message : String(error)}`,
    )
    console.error("Der Fortschritt ist gespeichert; einfach erneut starten.")
    process.exit(1)
  }

  const now = new Date().toISOString()
  const tx = db.transaction((names: string[]) => {
    for (const name of names) {
      const arts = result.get(name) ?? []
      const target = targets.get(name)?.[0]
      let count = 0
      if (target) {
        for (const art of arts) {
          const isNsfw = (art.tags ?? []).some((tag) => /nsfw/i.test(String(tag)))
          if (!isNsfw) continue
          const identifier = art.id.replace(/^mpcfill:/, "")
          artUpsert.run(
            identifier,
            art.name,
            target.oracle_id,
            target.face,
            JSON.stringify(art.tags ?? []),
            art.lang ?? null,
            art.dpi ?? null,
            art.note ?? null,
            1,
            art.imageUrl,
            art.thumbnailUrl,
            now,
          )
          count++
        }
      }
      queryUpsert.run(name, now, count)
      found += count
    }
  })
  tx(batch)

  processed += batch.length
  const elapsed = Date.now() - started
  const perName = elapsed / processed
  const eta = perName * (pending.length - processed)
  if (!quiet || offset === 0 || offset % (batchSize * 10) === 0 || offset + batchSize >= pending.length) {
    console.log(
      `[${processed}/${pending.length}] ${((processed / pending.length) * 100).toFixed(1)}% · ` +
        `${found} NSFW-Arts · ${Math.round(perName)} ms/Name · ETA ${formatDuration(eta)}`,
    )
  }
  if (delayMs > 0) await Bun.sleep(delayMs)
}

const syncedAt = new Date().toISOString()
stateSet("mpcfill_nsfw_synced_at", syncedAt)
const artCount = db.query("SELECT COUNT(*) AS n FROM mpcfill_art WHERE nsfw = 1").get() as any
console.log(`Fertig: ${found} neue NSFW-Arts · ${Number(artCount?.n ?? 0)} in der Datenbank · ${syncedAt}`)
