export {}
const base = process.env.BASE_URL ?? "http://localhost:4173"
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
if (!smokePassword) {
  console.error("Setze KZ_SMOKE_PASSWORD (und optional KZ_SMOKE_USER, BASE_URL).")
  process.exit(1)
}
const loginRes = await apiFetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: smokeUser, password: smokePassword }),
})
if (!loginRes.ok) {
  console.error(`Login fehlgeschlagen: ${loginRes.status}`)
  process.exit(1)
}

const commanderName = Bun.argv[2] ?? "Uugguu, the Omniplasm"
const bracket = Number(Bun.argv[3] ?? 4) as 3 | 4 | 5

const meta = (await (await apiFetch(`${base}/api/meta`)).json()) as any
const deck = (await (
  await apiFetch(`${base}/api/decks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commanderName,
      bracket,
      podSize: 5,
      settings: meta.settings,
    }),
  })
).json()) as any

console.log(`Deck ${deck.id} für ${commanderName}, Ziel B${bracket}`)
const run = (await (await apiFetch(`${base}/api/decks/${deck.id}/build`, { method: "POST" })).json()) as any
for (let i = 0; i < 240; i++) {
  await Bun.sleep(2000)
  const status = (await (await apiFetch(`${base}/api/builds/${run.runId}`)).json()) as any
  if (status.status === "done" || status.status === "error") {
    const result = (await (await apiFetch(`${base}/api/decks/${deck.id}`)).json()) as any
    if (status.status === "error") {
      console.error("Build fehlgeschlagen:", status.error)
      process.exit(1)
    }
    const a = result.analysis
    const gc = result.cards.filter((c: any) => c.is_game_changer).length
    const fast = result.cards.filter((c: any) => (c.tags ?? []).includes("adds-multiple-mana") && c.cmc <= 2).length
    const oneWin = result.cards.filter((c: any) => c.is_one_win).length
    console.log(
      JSON.stringify(
        {
          deck: result.name,
          cards: a.total,
          requested: bracket,
          audit: a.bracket.bracket,
          confidence: a.bracket.confidence,
          reasons: a.bracket.reasons,
          warnings: a.warnings,
          gameChangers: gc,
          fastMana: fast,
          oneWin,
          goldfish: a.goldfish,
          primerChars: result.primer?.length ?? 0,
          provider: status.provider,
          model: status.model,
        },
        null,
        2,
      ),
    )
    process.exit(0)
  }
}
console.error("Timeout.")
process.exit(1)
