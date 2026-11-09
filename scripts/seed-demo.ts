import { db } from "../src/db"
import { analyzeDeck, buildPool, cardByName, deterministicBuild, tuneToBracket } from "../src/lib/engine"
import { DEFAULT_SETTINGS } from "../src/lib/types"

const existing = db.query("SELECT COUNT(*) AS n FROM deck").get() as { n: number }
if (existing.n > 0) {
  console.log(`Es gibt bereits ${existing.n} Deck(s). seed:demo überspringt den Import.`)
  process.exit(0)
}

const commander = cardByName("Uugguu, the Omniplasm")
if (!commander) {
  console.error("Uugguu, the Omniplasm nicht gefunden. Zuerst bun run ingest.")
  process.exit(1)
}

const settings = { ...DEFAULT_SETTINGS }
const pool = buildPool(commander, settings)
const cards = tuneToBracket(deterministicBuild(commander, settings, 4, pool), 4, pool, settings, commander)
const id = crypto.randomUUID()
const now = new Date().toISOString()
const admin = db.query("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1").get() as any

const primer = `## Idee

Uugguu, the Omniplasm ist ein 2/2 für {B}{G}{U}, der von sich aus nichts tut. Das Deck erzeugt Tode und verwertet sie. Jede andere Nicht-Token-Ooze, die stirbt, wird zu zwei 2/2-Kopien; die Kopien sind das Material, nicht der Sieg. Die Drain- und Opfer-Payoffs machen aus dem Material Schaden.

## Command Zone

Uugguu sieht nur Nicht-Token-Ooze. Die Kopien, die er erzeugt, sind Token und triggern ihn nicht selbst. Er ist ein Payoff, kein Plan. Ihn blind am Zug zwei zu wirken ist meistens falsch; besser ist ein Zug mit Opfer-Outlet und einem zweiten Ooze.

## Plan

Das Deck spielt drei Achsen: Ooze-Material, Opfer-Outlets und Drain. Maskwood Nexus und Roaming Throne machen aus dem Team Oozes. Ashnod's Altar, Phyrexian Altar und Carrion Feeder sind die Outlets. Blood Artist, Zulaport Cutthroat, Mirkwood Bats und Syr Konrad sind die Payoffs. In einer Fünferrunde trifft jeder Drain vier Gegner.

## Regelklarstellung

Die Kopien sind Token, keine Karten. Sie sind 2/2 und nicht legendär. Sterben sie, gehen sie in den Friedhof, nicht auf die Hand. Uugguu triggert nur, wenn eine andere Nicht-Token-Ooze stirbt.

## Salzpaket

Das Deck kann mit Opferketten lange Züge machen. Mass Land Denial ist nicht enthalten. Die Runde sollte wissen, dass die Drain-Payoffs auch ohne Commander weiterlaufen.

## Pilotierung

Mulligan auf zwei bis vier Länder und ein Opfer-Outlet. Halte Uugguu nicht automatisch, wenn die Manabase ihn nicht trägt. Spiele zuerst die Engine, dann den Commander.`

db.query(
  "INSERT INTO deck(id,name,commander_oracle_id,commander_name,bracket,pod_size,settings_json,primer,status,created_at,updated_at,owner_user_id,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
).run(id, "Uugguu – Schleimkopie-Maschine", commander.oracle_id, commander.name, 4, 5, JSON.stringify(settings), primer, "ready", now, now, admin?.id ?? null, "group")

const order: Record<string, number> = { land: 0, ramp: 1, draw: 2, removal: 3, wipe: 4, protection: 5, tutor: 6, recursion: 7, wincon: 8, synergy: 9, flex: 10 }
const insert = db.prepare(
  "INSERT INTO deck_card(deck_id,oracle_id,quantity,category,role,reason,printing_id,art_url,artist,sort_order,is_commander) VALUES (?,?,?,?,?,?,?,?,?,?,0)",
)
const tx = db.transaction(() => {
  cards
    .slice()
    .sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9) || a.cmc - b.cmc)
    .forEach((card, i) => {
      insert.run(id, card.oracle_id, Math.max(1, card.quantity), card.category, card.role, card.reason, null, null, null, i)
    })
})
tx()

const analysis = analyzeDeck(commander, cards, settings, 4)
console.log(`Demo-Deck angelegt: ${id}`)
console.log(`Karten: ${analysis.total} inklusive Commander, Bracket-Audit B${analysis.bracket.bracket}`)
console.log("Starte die App mit bun run start.")
