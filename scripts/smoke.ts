import { analyzeDeck, buildPool, cardByName, deterministicBuild, tuneToBracket } from "../src/lib/engine"
import { DEFAULT_SETTINGS } from "../src/lib/types"
import { getMpcFillArt, getPrintings } from "../src/lib/scryfall"
import { parseDeckList } from "../src/lib/import"

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`)
  if (!ok) failures++
}

const base = process.env.KZ_BASE ?? "http://localhost:4173"
let sessionCookie = ""

async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (sessionCookie) headers.set("Cookie", sessionCookie)
  const res = await fetch(url, { ...init, headers })
  const setCookie = res.headers.get("set-cookie")
  if (setCookie) sessionCookie = setCookie.split(";")[0]
  return res
}

const smokeUser = process.env.KZ_SMOKE_USER ?? "sebastian"
const smokePassword = process.env.KZ_SMOKE_PASSWORD ?? ""
let authRes: Response
if (smokePassword) {
  authRes = await apiFetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: smokeUser, password: smokePassword }),
  })
} else {
  const profilesRes = await apiFetch(`${base}/api/auth/profiles`)
  const profiles = profilesRes.ok ? ((await profilesRes.json()) as any[]) : []
  const profile = profiles.find((item) => item.username === smokeUser)
    ?? profiles.find((item) => item.display_name === smokeUser)
    ?? (profiles.length === 1 ? profiles[0] : null)
  if (!profile) {
    console.error(`Kein Profil für den Smoke-Test gefunden. Setze KZ_SMOKE_USER oder KZ_SMOKE_PASSWORD.`)
    process.exit(1)
  }
  authRes = await apiFetch(`${base}/api/auth/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: profile.id }),
  })
}
if (!authRes.ok) {
  console.error(`Anmeldung für den Smoke-Test fehlgeschlagen: ${authRes.status}`)
  process.exit(1)
}

const counts = (await (await apiFetch(`${base}/api/meta`)).json()) as any
check("Karten importiert", counts.counts.cards > 30000, String(counts.counts.cards))
check("CR-Regeln importiert", counts.counts.rules > 3000, String(counts.counts.rules))
check("Rulings importiert", counts.counts.rulings > 50000, String(counts.counts.rulings))
check("Brackets vorhanden", counts.brackets.length === 3)
check("Modell gesetzt", String(counts.model).includes("deepseek-v4.1-flash"), counts.model)
check("Kein 1-Win-Schalter", !counts.settingLabels?.some((item: any) => item.key === "allowOneWin"))
check("Kein Farbidentitäts-Schalter", !counts.settingLabels?.some((item: any) => item.key === "enforceColorIdentity"))

const search = (await (await apiFetch(`${base}/api/cards/search?q=Uugguu`)).json()) as any[]
check("Commander-Suche", search.some((c) => c.name === "Uugguu, the Omniplasm"))

const rules = (await (await apiFetch(`${base}/api/rules/search?q=903.4`)).json()) as any
check("CR-Suche 903.4", rules.cr.length > 0)
const format = (await (await apiFetch(`${base}/api/rules/search?q=`)).json()) as any
check("Commander-Regeln", format.format.length >= 20, String(format.format.length))

const commander = cardByName("Uugguu, the Omniplasm")
check("Karte in DB", Boolean(commander))
if (commander) {
  const pool = buildPool(commander, { ...DEFAULT_SETTINGS })
  check("Kandidatenpool", pool.length > 200, String(pool.length))
  check("Pool bleibt in der Farbidentität", pool.every((candidate) => candidate.card.color_identity.every((color) => commander.color_identity.includes(color))))
  const legacyPool = buildPool(commander, { ...DEFAULT_SETTINGS, allowOneWin: true } as any)
  check("1-Win bleibt gesperrt", legacyPool.every((candidate) => !candidate.card.is_one_win))
  const cards = tuneToBracket(deterministicBuild(commander, { ...DEFAULT_SETTINGS }, 4, pool), 4, pool, { ...DEFAULT_SETTINGS }, commander)
  const total = cards.reduce((n, c) => n + c.quantity, 0) + 1
  check("Engine baut 100 Karten", total === 100, String(total))
  check("Keine 1-Win-Karte", cards.every((c) => !c.is_one_win))
  const analysis = analyzeDeck(commander, cards, { ...DEFAULT_SETTINGS }, 4)
  check("Analyse liefert Rollen", analysis.lands > 0 && (analysis.counts.removal ?? 0) > 0)
  check("Bracket-Audit", [3, 4, 5].includes(analysis.bracket.bracket), `B${analysis.bracket.bracket}`)
}

const parsed = parseDeckList("Commander\n1 Uugguu, the Omniplasm\n\nDeck\n1x Sol Ring\n12 Island")
check("Decklisten-Parser", parsed.entries.length === 3 && parsed.commanderName === "Uugguu, the Omniplasm" && parsed.entries[2].quantity === 12)

const decksBefore = (await (await apiFetch(`${base}/api/decks`)).json()) as any[]
let importedId: string | null = null
try {
  const importRes = await apiFetch(`${base}/api/decks/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Smoke-Import",
      list: "Commander\n1 Uugguu, the Omniplasm\n\nDeck\n1 Sol Ring\n1 Arcane Signet\n1 Approach of the Second Sun\n1 Swords to Plowshares\n1 Nichtexistierende Karte",
      bracket: 4,
      podSize: 5,
      settings: { ...DEFAULT_SETTINGS },
    }),
  })
  const imported = (await importRes.json()) as any
  importedId = imported.deck?.id ?? null
  check("Import-API", importRes.ok && imported.report?.total === 3, String(imported.report?.total))
  check("Import unbekannte Karte", imported.report?.unknown?.length === 1)
  check("Import überspringt 1-Win", imported.report?.skipped?.some((item: any) => item.reason === "1-Win-Karte"))
  check("Import überspringt Farbbruch", imported.report?.skipped?.some((item: any) => item.reason === "Farbidentität"))
  check("Import Rollen", imported.deck?.analysis?.counts?.ramp >= 2, String(imported.deck?.analysis?.counts?.ramp))
  check("Teil-Import ist Entwurf", imported.deck?.status === "draft", String(imported.deck?.status))
  check("Import wartet auf Speichern", imported.deck?.saved_at === null)
  if (importedId) {
    const oneWinRes = await apiFetch(`${base}/api/decks/${importedId}/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Approach of the Second Sun" }),
    })
    check("1-Win manuell gesperrt", oneWinRes.status === 400, String(oneWinRes.status))
    const colorRes = await apiFetch(`${base}/api/decks/${importedId}/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Lightning Bolt" }),
    })
    check("Farbbruch manuell gesperrt", colorRes.status === 400, String(colorRes.status))
    const doctorRes = await apiFetch(`${base}/api/decks/${importedId}/doctor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxProposals: 4 }),
    })
    const doctor = (await doctorRes.json()) as any
    check("Deck-Doctor Vorschläge", doctorRes.ok && doctor.proposals?.length > 0, String(doctor.proposals?.length ?? 0))
    const firstId = doctor.proposals?.[0]?.id
    if (firstId) {
      const applyRes = await apiFetch(`${base}/api/decks/${importedId}/doctor/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalIds: [firstId], maxProposals: 4 }),
      })
      const applied = (await applyRes.json()) as any
      check("Deck-Doctor anwenden", applyRes.ok && Boolean(applied.revisionId) && applied.deck?.analysis?.total === 4, String(applied.deck?.analysis?.total))
      const historyRes = await apiFetch(`${base}/api/decks/${importedId}/revisions`)
      const history = (await historyRes.json()) as any
      check(
        "Verlauf zeigt Revision",
        historyRes.ok && history.revisions?.length === 1 && history.revisions[0].id === applied.revisionId,
        String(history.revisions?.length ?? 0),
      )
      if (applied.revisionId) {
        const restoreRes = await apiFetch(`${base}/api/decks/${importedId}/revisions/${applied.revisionId}/restore`, { method: "POST" })
        const restored = (await restoreRes.json()) as any
        check("Deck-Doctor rückgängig", restoreRes.ok && restored.deck?.analysis?.total === 3, String(restored.deck?.analysis?.total))
        const afterRes = await apiFetch(`${base}/api/decks/${importedId}/revisions`)
        const after = (await afterRes.json()) as any
        check(
          "Wiederherstellung gesichert",
          afterRes.ok && after.revisions?.length === 2 && after.revisions[0].label === "Vor Wiederherstellung",
          String(after.revisions?.length ?? 0),
        )
      }
    }
  }
} finally {
  if (importedId) await apiFetch(`${base}/api/decks/${importedId}`, { method: "DELETE" })
}

let gameId: string | null = null
try {
  const gameRes = await apiFetch(`${base}/api/games`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playedAt: "2026-11-03",
      podSize: 5,
      winnerDeckId: decksBefore[0]?.id ?? null,
      turns: 7,
      fun: 4,
      salt: 2,
      notes: "Smoke-Test",
    }),
  })
  const game = (await gameRes.json()) as any
  gameId = game.id ?? null
  check("Spiel protokolliert", gameRes.ok && game.turns === 7 && game.fun === 4)
} finally {
  if (gameId) await apiFetch(`${base}/api/games/${gameId}`, { method: "DELETE" })
}

if (commander) {
  const printings = await getPrintings(commander.name)
  check("Scryfall-Printings", printings.length > 0, String(printings.length))
  const arts = await getMpcFillArt(commander.name)
  check("MPCFill-Arts", arts.length > 0, String(arts.length))
}

console.log(failures === 0 ? "Smoke-Test bestanden." : `${failures} Check(s) fehlgeschlagen.`)
process.exit(failures === 0 ? 0 : 1)
