import { gunzipSync } from "node:zlib"
import { db, stateSet } from "./db"
import { ROOT } from "./lib/paths"
import { BRACKETS, FORMAT_RULES } from "./lib/rules-seed"

const UA = "Kommandozentrale/0.1 (private Commander deck workshop)"
const HEADERS = { "User-Agent": UA, Accept: "application/json" }
const DATA = `${ROOT}/data/cache`

async function download(url: string, path: string) {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  await Bun.write(path, buf)
  return buf
}

async function bulkUri(type: string) {
  const res = await fetch("https://api.scryfall.com/bulk-data", { headers: HEADERS })
  if (!res.ok) throw new Error(`bulk-data ${res.status}`)
  const body = (await res.json()) as { data: Array<{ type: string; jsonl_download_uri: string; updated_at: string }> }
  const found = body.data.find((d) => d.type === type)
  if (!found) throw new Error(`bulk type ${type} not found`)
  return found
}

function seedRules() {
  const bracketStmt = db.prepare(
    "INSERT INTO bracket(id,name,tagline,description,gc_limit,expected_turns,quota_json) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,tagline=excluded.tagline,description=excluded.description,gc_limit=excluded.gc_limit,expected_turns=excluded.expected_turns,quota_json=excluded.quota_json",
  )
  for (const b of BRACKETS) {
    bracketStmt.run(b.id, b.name, b.tagline, b.description, b.gc_limit, b.expected_turns, JSON.stringify(b.quotas))
  }
  const ruleStmt = db.prepare(
    "INSERT INTO format_rule(id,category,title,body,citation,sort) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET category=excluded.category,title=excluded.title,body=excluded.body,citation=excluded.citation,sort=excluded.sort",
  )
  for (const r of FORMAT_RULES) ruleStmt.run(r.id, r.category, r.title, r.body, r.citation, r.sort)
  stateSet("rules_seeded_at", new Date().toISOString())
  console.log(`Regeln: ${FORMAT_RULES.length} Formatregeln, ${BRACKETS.length} Brackets`)
}

async function importCards() {
  const bulk = await bulkUri("oracle_cards")
  console.log(`Scryfall Bulk: ${bulk.jsonl_download_uri} (${bulk.updated_at})`)
  const gz = await download(bulk.jsonl_download_uri, `${DATA}/oracle_cards.jsonl.gz`)
  const text = gunzipSync(gz).toString("utf8")
  const lines = text.split("\n").filter(Boolean)
  console.log(`Karten: ${lines.length} Zeilen, parsing…`)

  const insert = db.prepare(`
    INSERT OR REPLACE INTO card (
      oracle_id,name,mana_cost,cmc,type_line,oracle_text,oracle_text_all,colors,color_identity,
      keywords,legalities,edhrec_rank,image_uris,card_faces,layout,set_code,collector_number,
      rarity,power,toughness,loyalty,defense,produced_mana,is_game_changer,is_one_win,is_land,
      is_creature,is_legendary,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `)
  const fts = db.prepare("INSERT INTO card_fts(oracle_id,name,type_line,oracle_text_all) VALUES (?,?,?,?)")

  db.exec("DELETE FROM card_fts; DELETE FROM card;")
  let count = 0
  const tx = db.transaction((rows: string[]) => {
    for (const line of rows) {
      let c: any
      try {
        c = JSON.parse(line)
      } catch {
        continue
      }
      if (!c.oracle_id) continue
      const faces = Array.isArray(c.card_faces) ? c.card_faces : []
      const textAll = [c.oracle_text, ...faces.map((f: any) => f.oracle_text)].filter(Boolean).join("\n")
      const isOneWin = /\byou win the game\b/i.test(textAll) ? 1 : 0
      const typeLine = c.type_line ?? ""
      const img = c.image_uris ?? faces[0]?.image_uris ?? null
      insert.run(
        c.oracle_id,
        c.name,
        c.mana_cost ?? null,
        Number(c.cmc ?? 0),
        typeLine,
        c.oracle_text ?? null,
        textAll,
        JSON.stringify(c.colors ?? []),
        JSON.stringify(c.color_identity ?? []),
        JSON.stringify(c.keywords ?? []),
        JSON.stringify(c.legalities ?? {}),
        c.edhrec_rank ?? null,
        img ? JSON.stringify(img) : null,
        faces.length ? JSON.stringify(faces) : null,
        c.layout ?? null,
        c.set ?? null,
        c.collector_number ?? null,
        c.rarity ?? null,
        c.power ?? null,
        c.toughness ?? null,
        c.loyalty ?? null,
        c.defense ?? null,
        JSON.stringify(c.produced_mana ?? []),
        c.is_game_changer ? 1 : 0,
        isOneWin,
        /\bLand\b/.test(typeLine) ? 1 : 0,
        /\bCreature\b/.test(typeLine) ? 1 : 0,
        /\bLegendary\b/.test(typeLine) ? 1 : 0,
        new Date().toISOString(),
      )
      fts.run(c.oracle_id, c.name, typeLine, textAll)
      count++
    }
  })
  tx(lines)
  stateSet("cards_imported_at", new Date().toISOString())
  stateSet("cards_bulk_updated_at", bulk.updated_at)
  console.log(`Karten: ${count} importiert`)
}

async function importTags() {
  const bulk = await bulkUri("oracle_tags")
  const gz = await download(bulk.jsonl_download_uri, `${DATA}/oracle_tags.jsonl.gz`)
  const text = gunzipSync(gz).toString("utf8")
  const lines = text.split("\n").filter(Boolean)
  console.log(`Tags: ${lines.length} Tag-Objekte, parsing…`)
  const insert = db.prepare("INSERT OR IGNORE INTO card_tag(oracle_id,tag,weight) VALUES (?,?,?)")
  db.exec("DELETE FROM card_tag;")
  let count = 0
  const tx = db.transaction((rows: string[]) => {
    for (const line of rows) {
      let t: any
      try {
        t = JSON.parse(line)
      } catch {
        continue
      }
      const tag = t.slug
      if (!tag || !Array.isArray(t.taggings)) continue
      for (const tagging of t.taggings) {
        if (!tagging.oracle_id) continue
        insert.run(tagging.oracle_id, tag, tagging.weight ?? null)
        count++
      }
    }
  })
  tx(lines)
  stateSet("tags_imported_at", new Date().toISOString())
  console.log(`Tags: ${count} Kartenzuordnungen`)
}

async function markGameChangers() {
  const res = await fetch("https://api.scryfall.com/cards/search?q=is%3Agamechanger&per_page=175&unique=cards", { headers: HEADERS })
  if (!res.ok) throw new Error(`gamechanger ${res.status}`)
  const body = (await res.json()) as { data: Array<{ oracle_id: string; name: string }> }
  db.exec("UPDATE card SET is_game_changer = 0")
  const update = db.prepare("UPDATE card SET is_game_changer = 1 WHERE oracle_id = ?")
  const tx = db.transaction((cards: Array<{ oracle_id: string }>) => {
    for (const c of cards) update.run(c.oracle_id)
  })
  tx(body.data)
  stateSet("game_changers_at", new Date().toISOString())
  console.log(`Game Changers: ${body.data.length} markiert`)
}

async function importRulings() {
  const bulk = await bulkUri("rulings")
  const gz = await download(bulk.jsonl_download_uri, `${DATA}/rulings.jsonl.gz`)
  const text = gunzipSync(gz).toString("utf8")
  const lines = text.split("\n").filter(Boolean)
  const insert = db.prepare("INSERT INTO ruling(oracle_id,source,published_at,comment) VALUES (?,?,?,?)")
  db.exec("DELETE FROM ruling;")
  let count = 0
  const tx = db.transaction((rows: string[]) => {
    for (const line of rows) {
      let r: any
      try {
        r = JSON.parse(line)
      } catch {
        continue
      }
      if (!r.oracle_id) continue
      insert.run(r.oracle_id, r.source ?? null, r.published_at ?? null, r.comment ?? "")
      count++
    }
  })
  tx(lines)
  console.log(`Rulings: ${count} importiert`)
}

function parseCR(text: string, version: string) {
  const lines = text.replace(/\r/g, "").split("\n")
  const rules: Array<{ number: string; parent: string | null; depth: number; text: string }> = []
  let current: { number: string; parent: string | null; depth: number; text: string } | null = null
  let glossaryStart = -1
  let started = false
  const ruleRe = /^(\d{3}\.\d+[a-z]?)[.]?\s+(.*)$/
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!started && /^100\.1\./.test(line)) started = true
    if (!started) continue
    if (/^Glossary\s*$/i.test(line.trim())) {
      if (current) rules.push(current)
      current = null
      glossaryStart = i
      break
    }
    const m = ruleRe.exec(line)
    if (m) {
      if (current) rules.push(current)
      const number = m[1]
      let parent: string | null = null
      if (/[a-z]$/.test(number)) parent = number.slice(0, -1)
      else if (number.includes(".")) parent = number.slice(0, number.lastIndexOf("."))
      const depth = (number.match(/\./g)?.length ?? 0) + (/[a-z]$/.test(number) ? 1 : 0)
      current = { number, parent, depth, text: m[2].trim() }
    } else if (current) {
      const trimmed = line.trim()
      if (trimmed.length > 0) current.text += `\n${trimmed}`
    }
  }
  if (current) rules.push(current)

  const glossary = glossaryStart >= 0 ? lines.slice(glossaryStart + 1).join("\n").trim() : ""
  return { rules, glossary }
}

async function importCR() {
  const version = "2026-09-25"
  const url = "https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt"
  const buf = await download(url, `${DATA}/MagicCompRules-20260925.txt`)
  const text = new TextDecoder().decode(buf)
  const { rules, glossary } = parseCR(text, version)
  console.log(`CR: ${rules.length} Regeln, Glossar ${glossary.length} Zeichen`)

  const insert = db.prepare("INSERT OR REPLACE INTO cr_rule(version,number,parent,depth,text,is_example) VALUES (?,?,?,?,?,0)")
  const fts = db.prepare("INSERT INTO cr_fts(version,number,text) VALUES (?,?,?)")
  db.exec("DELETE FROM cr_fts; DELETE FROM cr_rule;")
  const tx = db.transaction((rows: typeof rules) => {
    for (const r of rows) {
      insert.run(version, r.number, r.parent, r.depth, r.text)
      fts.run(version, r.number, r.text)
    }
  })
  tx(rules)
  db.query("INSERT OR REPLACE INTO cr_version(version,effective_date,source_url,imported_at) VALUES (?,?,?,?)").run(
    version,
    "2026-09-25",
    url,
    new Date().toISOString(),
  )
  db.query("INSERT OR REPLACE INTO cr_glossary(version,term,definition) VALUES (?,?,?)").run(version, "Glossar", glossary)
  stateSet("cr_version", version)
  console.log(`CR: ${rules.length} Regeln importiert`)
}

async function main() {
  const started = Date.now()
  seedRules()
  await importCards()
  await importTags()
  await markGameChangers()
  await importRulings()
  await importCR()
  console.log(`Fertig in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  const counts = db
    .query("SELECT (SELECT COUNT(*) FROM card) AS cards, (SELECT COUNT(*) FROM card_tag) AS tags, (SELECT COUNT(*) FROM cr_rule) AS rules, (SELECT COUNT(*) FROM ruling) AS rulings")
    .get() as any
  console.log(counts)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
