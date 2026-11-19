import { mkdirSync } from "node:fs"
import { join } from "node:path"
import {
  artSource,
  buildDeckArtList,
  buildDeckArtTsv,
  buildDeckList,
  deckExportFilename,
  enrichDeckBacks,
  exportDir,
  findDeckExport,
  type ArtSource,
} from "../src/lib/export"

/**
 * Schreibt drei Dateien für ein Deck:
 *   <slug>.txt        reine Deckliste
 *   <slug>-arts.txt   Deckliste mit Quelle, Art-ID, Artist und URL
 *   <slug>-arts.tsv   maschinenlesbare Liste (auch für die Druck-App)
 *
 *   bun run export:deck <deck-id-oder-name>
 */

const target = process.argv.slice(2).join(" ").trim()
if (!target) {
  console.error("Aufruf: bun run export:deck <deck-id-oder-name>")
  process.exit(1)
}

const deck = findDeckExport(target)
if (!deck) {
  console.error(`Kein Deck gefunden für "${target}".`)
  process.exit(1)
}

await enrichDeckBacks(deck)

const dir = exportDir()
mkdirSync(dir, { recursive: true })

const files: Array<{ name: string; content: string }> = [
  { name: deckExportFilename(deck, "", "txt"), content: buildDeckList(deck) },
  { name: deckExportFilename(deck, "arts", "txt"), content: buildDeckArtList(deck) },
  { name: deckExportFilename(deck, "arts", "tsv"), content: buildDeckArtTsv(deck) },
]

for (const file of files) {
  const path = join(dir, file.name)
  await Bun.write(path, `${file.content}\n`)
  console.log(path)
}

const counts = new Map<ArtSource, number>()
for (const card of [deck.commander, ...deck.cards, ...deck.maybeboard].filter(Boolean)) {
  const source = artSource(card!)
  counts.set(source, (counts.get(source) ?? 0) + 1)
}
console.log(
  `\n${deck.name}: ${deck.cards.reduce((sum, card) => sum + card.quantity, 0) + 1} Karten · ` +
    `Arts: ${[...counts.entries()].map(([source, count]) => `${source} ${count}`).join(", ")}`,
)
