export type EntryContext = {
  invite: string | null
  table: string | null
}

function params(raw: string): URLSearchParams {
  return new URLSearchParams(raw.replace(/^[#?]/, ""))
}

export function parseEntryContext(
  hash = typeof window === "undefined" ? "" : window.location.hash,
  search = typeof window === "undefined" ? "" : window.location.search,
): EntryContext {
  const hashParams = params(hash)
  const searchParams = params(search)
  const invite = (searchParams.get("invite") ?? hashParams.get("invite") ?? "").trim().toUpperCase()
  const table = (searchParams.get("table") ?? hashParams.get("table") ?? "").trim().toUpperCase()
  return { invite: invite || null, table: table || null }
}
