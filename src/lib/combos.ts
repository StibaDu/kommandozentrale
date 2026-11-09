export interface ComboCard {
  name: string
  quantity: number
  mustBeCommander: boolean
}

export interface ComboVariant {
  id: string
  description: string
  cards: ComboCard[]
  produces: string[]
  requires: string[]
  identity: string
  manaNeeded: string
  easyPrerequisites: string
  notablePrerequisites: string
  bracketTag: string
  popularity: number | null
  salt: number | null
  variantCount: number
}

export interface ComboLookup {
  fetchedAt: string
  identity: string
  included: ComboVariant[]
  almostIncluded: ComboVariant[]
  includedByChangingCommanders: ComboVariant[]
}

function variant(raw: any): ComboVariant {
  return {
    id: String(raw?.id ?? ""),
    description: String(raw?.description ?? ""),
    cards: (Array.isArray(raw?.uses) ? raw.uses : []).map((use: any) => ({
      name: String(use?.card?.name ?? "Unbekannt"),
      quantity: Number(use?.quantity ?? 1),
      mustBeCommander: Boolean(use?.mustBeCommander),
    })),
    produces: (Array.isArray(raw?.produces) ? raw.produces : [])
      .map((entry: any) => String(entry?.feature?.name ?? ""))
      .filter(Boolean),
    requires: (Array.isArray(raw?.requires) ? raw.requires : [])
      .map((entry: any) => String(entry?.template?.name ?? ""))
      .filter(Boolean),
    identity: String(raw?.identity ?? ""),
    manaNeeded: String(raw?.manaNeeded ?? ""),
    easyPrerequisites: String(raw?.easyPrerequisites ?? ""),
    notablePrerequisites: String(raw?.notablePrerequisites ?? ""),
    bracketTag: String(raw?.bracketTag ?? ""),
    popularity: raw?.popularity == null ? null : Number(raw.popularity),
    salt: raw?.salt == null ? null : Number(raw.salt),
    variantCount: Number(raw?.variantCount ?? 1),
  }
}

function sorted(raw: any): ComboVariant[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(variant)
    .filter((entry) => entry.id && entry.description)
    .sort((a, b) => (b.popularity ?? -1) - (a.popularity ?? -1) || a.description.localeCompare(b.description))
}

export async function findCombos(commanderName: string, cardNames: string[]): Promise<ComboLookup> {
  const response = await fetch("https://backend.commanderspellbook.com/find-my-combos?limit=100", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Kommandozentrale/1.0 (private Commander deck workshop)",
      Accept: "application/json",
    },
    body: JSON.stringify({
      commanders: [{ card: commanderName, quantity: 1 }],
      main: [...new Set(cardNames)].map((card) => ({ card, quantity: 1 })),
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`Commander Spellbook antwortet mit ${response.status}.`)
  const body = (await response.json()) as any
  const results = body?.results ?? body ?? {}
  return {
    fetchedAt: new Date().toISOString(),
    identity: String(results.identity ?? ""),
    included: sorted(results.included),
    almostIncluded: sorted(results.almostIncluded),
    includedByChangingCommanders: sorted(results.includedByChangingCommanders),
  }
}
