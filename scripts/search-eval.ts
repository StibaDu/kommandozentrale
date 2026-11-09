import { searchCards } from "../src/lib/cardsearch"

/**
 * Offline-Eval für die Effekt-Suche. Braucht keinen Server, nur die DB.
 *   bun run scripts/search-eval.ts
 */

type Case = { q: string; expect: string[]; note?: string }

const CASES: Case[] = [
  { q: "boardwipe", expect: ["Wrath of God", "Damnation", "Blasphemous Act", "Toxic Deluge", "Cyclonic Rift"] },
  { q: "Länder zerstören", expect: ["Armageddon", "Ravages of War", "Catastrophe", "Fall of the Thran", "Ruination", "Obliterate"] },
  { q: "Tutor für Kreaturen", expect: ["Worldly Tutor", "Sylvan Tutor", "Eladamri's Call", "Green Sun's Zenith", "Chord of Calling", "Finale of Devastation"] },
  { q: "Karten ziehen", expect: ["Rhystic Study", "Mystic Remora", "Sylvan Library", "Night's Whisper", "Harmonize", "Brainstorm", "Ponder"] },
  { q: "Mana beschleunigen", expect: ["Sol Ring", "Arcane Signet", "Rampant Growth", "Cultivate", "Birds of Paradise", "Fellwar Stone", "Chromatic Lantern"] },
  { q: "Friedhof verbannen", expect: ["Bojuka Bog", "Rest in Peace", "Leyline of the Void", "Tormod's Crypt", "Deathrite Shaman", "Scavenging Ooze"] },
  { q: "Kreatur übernehmen", expect: ["Control Magic", "Mind Control", "Act of Treason", "Threaten", "Treachery", "Order of Succession", "Insurrection"] },
  { q: "Karten ziehen wenn eine Kreatur stirbt", expect: ["Midnight Reaper", "Grim Haruspex", "Moldervine Reclamation", "Skullclamp", "Liliana, Dreadhorde General", "Solemn Simulacrum"] },
  { q: "Kreaturen opfern für Mana", expect: ["Phyrexian Altar", "Ashnod's Altar", "Culling the Weak", "Dark Ritual", "Burnt Offering", "Warren Soultrader"] },
  { q: "Verzauberungen zerstören", expect: ["Back to Nature", "Seal of Cleansing", "Nature's Claim", "Return to Nature", "Hull Breach", "Feed the Swarm", "Austere Command"] },
  { q: "Gegner opfert eine Kreatur", expect: ["Grave Pact", "Dictate of Erebos", "Butcher of Malakir", "Plaguecrafter", "Fleshbag Marauder", "Sheoldred's Edict"] },
  { q: "Gegenzauber", expect: ["Counterspell", "Negate", "Swan Song", "Force of Will", "Mana Drain", "An Offer You Can't Refuse"] },
  { q: "Reanimieren", expect: ["Reanimate", "Animate Dead", "Necromancy", "Victimize", "Persist", "Living Death"] },
  { q: "Länder ins Spiel bringen", expect: ["Rampant Growth", "Cultivate", "Kodama's Reach", "Farseek", "Nature's Lore", "Evolving Wilds"] },
  { q: "Extrazug", expect: ["Time Warp", "Temporal Manipulation", "Nexus of Fate", "Capture of Jingzhou", "Walk the Aeons", "Final Fortune"] },
  { q: "Karten suchen", expect: ["Demonic Tutor", "Vampiric Tutor", "Mystical Tutor", "Worldly Tutor", "Diabolic Tutor", "Fabricate"] },
  { q: "Gegner wirft Karten ab", expect: ["Duress", "Thoughtseize", "Hymn to Tourach", "Liliana of the Veil", "Mind Rot", "Windfall", "Syphon Mind"] },
  { q: "Schaden an alle Kreaturen", expect: ["Pyroclasm", "Anger of the Gods", "Blasphemous Act", "Toxic Deluge", "Wrath of God", "Damnation"] },
]

function norm(name: string): string {
  return name
    .toLowerCase()
    .split(" // ")[0]
    .replace(/[’‘]/g, "'")
    .trim()
}

function recall(expect: string[], found: string[], k: number): { hit: number; total: number; missing: string[] } {
  const top = new Set(found.slice(0, k).map(norm))
  const missing: string[] = []
  let hit = 0
  for (const name of expect) {
    if (top.has(norm(name))) hit += 1
    else missing.push(name)
  }
  return { hit, total: expect.length, missing }
}

const LIMIT = 10
let sum5 = 0
let sum10 = 0
let cases = 0

for (const testCase of CASES) {
  const started = performance.now()
  const hits = searchCards(testCase.q, { limit: LIMIT, commanderLegal: true })
  const took = performance.now() - started
  const names = hits.map((h) => h.card.name)
  const r5 = recall(testCase.expect, names, 5)
  const r10 = recall(testCase.expect, names, 10)
  sum5 += r5.hit / r5.total
  sum10 += r10.hit / r10.total
  cases += 1
  const pct = (r: { hit: number; total: number }) => `${Math.round((r.hit / r.total) * 100)}%`
  console.log(`\n${testCase.q}  —  @5 ${pct(r5)}  @10 ${pct(r10)}  (${took.toFixed(0)} ms)`)
  console.log(`  top: ${names.slice(0, 5).join(" | ")}`)
  if (r10.missing.length) console.log(`  fehlt@10: ${r10.missing.join(", ")}`)
}

console.log(
  `\nGesamt: recall@5 ${Math.round((sum5 / cases) * 100)}%, recall@10 ${Math.round((sum10 / cases) * 100)}% über ${cases} Queries`,
)
