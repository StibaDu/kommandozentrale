export interface NetworkInfo {
  lanUrl: string | null
  mdnsUrl: string | null
  ipUrl: string | null
  publicUrl: string | null
  tailscaleUrl: string | null
  tailscaleAvailable: boolean
  port: number
}

export interface Meta {
  model: string
  brackets: Array<{
    id: 3 | 4 | 5
    name: string
    tagline: string
    description: string
    gc_limit: number | null
    expected_turns: string
    quotas: Record<string, number>
  }>
  settings: Record<string, unknown>
  settingLabels: Array<{ key: string; label: string; hint: string; kind: "bool" | "number" }>
  counts: { cards: number; tags: number; rules: number; rulings: number; decks: number; games: number }
  crVersion: string | null
  network: NetworkInfo
}

export interface CommanderSuggestion {
  oracle_id: string
  name: string
  mana_cost: string | null
  type_line: string
  color_identity: string[]
  image_uris: Record<string, string> | null
  edhrec_rank: number | null
  reason: string
}

export interface CommanderSuggestionResponse {
  suggestions: CommanderSuggestion[]
  provider: "opencode" | "engine"
  note: string | null
}

export interface AuthUser {
  id: string
  username: string
  display_name: string
  role: "admin" | "member"
  avatar_color: string
}

export interface Profile extends AuthUser {
  created_at?: string
  last_login_at?: string | null
}

export interface Invite {
  id: string
  code: string
  label: string | null
  created_by?: string | null
  created_at: string
  expires_at: string | null
  max_uses: number
  uses: number
  created_by_name?: string | null
  valid?: boolean
}

export interface DeckSummary {
  id: string
  name: string
  commander_name: string
  commander_oracle_id: string
  bracket: 3 | 4 | 5
  pod_size: number
  status: string
  card_count: number
  saved_at: string | null
  updated_at: string
  owner_user_id: string | null
  owner_name: string | null
  owner_color: string | null
  visibility: string
}

export interface Deck {
  id: string
  name: string
  commander_oracle_id: string
  commander_name: string
  commander: {
    oracle_id: string
    name: string
    mana_cost: string | null
    cmc: number
    type_line: string
    oracle_text: string | null
    oracle_text_all: string | null
    colors: string[]
    color_identity: string[]
    image_uris: Record<string, string> | null
    card_faces?: Array<{ image_uris?: Record<string, string> | null }> | null
    power: string | null
    toughness: string | null
    edhrec_rank: number | null
    produced_mana: string[]
    is_game_changer: boolean
    is_one_win: boolean
    legalities: Record<string, string>
    printing_id: string | null
    art_url: string | null
    artist: string | null
  }
  bracket: 3 | 4 | 5
  pod_size: number
  settings: Record<string, any>
  brief: string
  primer: string | null
  status: string
  saved_at: string | null
  created_at: string
  updated_at: string
  owner_user_id: string | null
  owner_name: string | null
  owner_color: string | null
  visibility: string
  cards: Array<{
    oracle_id: string
    name: string
    mana_cost: string | null
    cmc: number
    type_line: string
    oracle_text: string | null
    colors: string[]
    color_identity: string[]
    image_uris: Record<string, string> | null
    card_faces?: Array<{ image_uris?: Record<string, string> | null }> | null
    edhrec_rank: number | null
    legalities: Record<string, string>
    is_game_changer: boolean
    is_one_win: boolean
    produced_mana: string[]
    is_commander: boolean
    role: string
    category: string
    reason: string
    printing_id: string | null
    art_url: string | null
    artist: string | null
    quantity: number
    tags: string[]
    board?: "main" | "maybeboard"
  }>
  maybeboard: Deck["cards"]
  analysis: {
    total: number
    lands: number
    nonLands: number
    counts: Record<string, number>
    curve: Array<{ label: string; count: number }>
    averageMv: number
    pips: Record<string, number>
    sources: Record<string, number>
    bracket: {
      bracket: 3 | 4 | 5
      label: string
      confidence: string
      reasons: string[]
      signals: Record<string, number | string | boolean>
    }
    warnings: Array<{ level: "error" | "warn" | "info"; text: string }>
    goldfish: {
      averageCommanderTurn: number | null
      missedLandDropRate: number
      averageLandsByTurn4: number
      colorScrewRate: number
    }
  } | null
}

export interface BuildRun {
  id: string
  deck_id: string
  status: "queued" | "running" | "done" | "error" | "cancelled"
  message: string | null
  error: string | null
  provider: string | null
  model: string | null
  session_id?: string | null
  candidate_count?: number | null
  card_count?: number | null
  prompt_tokens_estimate?: number | null
  prompt_tokens?: number | null
  output_tokens?: number | null
  cache_read_tokens?: number | null
  cost_usd?: number | null
}

export interface BabyzillaInfo {
  available: boolean
  stats: {
    root: string
    sessions: number
    rawTokens: number
    packTokens: number
    savedPct: number
    requests: {
      sessions: number
      requests: number
      before: number
      after: number
      savedPct: number
    }
    library: { projects: number; modules: number }
  } | null
  app: {
    calls: number
    promptTokens: number
    outputTokens: number
    cacheReadTokens: number
    costUsd: number
  }
}

export interface GameRecord {
  id: string
  played_at: string
  pod_size: number
  winner_deck_id: string | null
  winner_name: string | null
  winner_commander: string | null
  turns: number | null
  notes: string | null
  fun: number | null
  salt: number | null
  created_by: string | null
  created_by_name: string | null
}

export interface ImportReport {
  total: number
  imported: number
  commander: string
  unknown: string[]
  skipped: Array<{ name: string; reason: string }>
  notes: string[]
}

export interface DeckComboCard {
  name: string
  quantity: number
  mustBeCommander: boolean
}

export interface DeckComboVariant {
  id: string
  description: string
  cards: DeckComboCard[]
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

export interface DeckComboResult {
  fetchedAt: string
  identity: string
  included: DeckComboVariant[]
  almostIncluded: DeckComboVariant[]
  includedByChangingCommanders: DeckComboVariant[]
  source: string
  sourceUrl: string
  cached: boolean
  warning?: string
}

export interface ComboTextInput {
  id: string
  description: string
  produces: string[]
  easyPrerequisites: string
  notablePrerequisites: string
  cardNames: string[]
}

export interface ComboTranslation {
  id: string
  description: string
  produces: string[]
  easyPrerequisites: string
  notablePrerequisites: string
}

export interface GermanCardFace {
  name: string
  oracle_text: string | null
  type_line: string | null
}

export interface GermanCardText {
  name: string
  oracle_text: string | null
  card_faces: GermanCardFace[] | null
  set_code: string | null
  set_name: string | null
  collector_number: string | null
}

export interface DoctorCard {
  oracle_id: string
  name: string
  mana_cost: string | null
  cmc: number
  type_line: string
  role: string
  edhrec_rank: number | null
  is_game_changer: boolean
  is_one_win: boolean
  tags: string[]
}

export interface DoctorNeed {
  role: string
  label: string
  current: number
  target: number
  deficit: number
}

export interface DoctorBudgetIssue {
  kind: string
  label: string
  current: number
  allowed: number
}

export interface DoctorProposal {
  id: string
  cut: DoctorCard | null
  add: DoctorCard | null
  need: string
  roleLabel: string
  reason: string
  before: number
  after: number
}

export interface DoctorProjection {
  total: number
  counts: Record<string, number>
  bracket: 3 | 4 | 5
  label: string
  warnings: string[]
}

export interface DoctorResult {
  diagnosis: {
    total: number
    bracket: 3 | 4 | 5
    needs: DoctorNeed[]
    overBudget: DoctorBudgetIssue[]
    notes: string[]
  }
  proposals: DoctorProposal[]
  projected: DoctorProjection | null
}

export interface DeckRevisionCard {
  oracle_id: string
  name: string
  quantity: number
}

export interface DeckRevision {
  id: string
  created_at: string
  label: string
  total: number
  unique: number
  added: DeckRevisionCard[]
  removed: DeckRevisionCard[]
  roleDelta: Array<{ role: string; label: string; before: number; after: number; delta: number }>
  averageMvBefore: number
  averageMvAfter: number
}

export interface PodPlayerState {
  id: string
  user_id: string
  display_name: string
  avatar_color: string
  seat: number
  deck_id: string | null
  deck_name: string | null
  commander_name: string | null
  life: number
  poison: number
  commander_damage: Record<string, number>
  counters: Record<string, number>
  statuses: Record<string, boolean>
  eliminated: boolean
}

export interface PodState {
  id: string
  code: string
  name: string | null
  host_user_id: string
  host_name: string
  status: string
  version: number
  created_at: string
  updated_at: string
  players: PodPlayerState[]
}

export interface StatsTotals {
  games: number
  wins: number
  winrate: number
  avgTurns: number | null
  avgFun: number | null
  avgSalt: number | null
}

export interface StatsDeck {
  deck_id: string | null
  deck_name: string | null
  commander_name: string | null
  games: number
  wins: number
}

export interface StatsRecent {
  id: string
  played_at: string
  turns: number | null
  fun: number | null
  salt: number | null
  deck_id: string | null
  deck_name: string | null
  commander_name: string | null
  is_winner: number
  ending_life: number | null
  eliminated: number
}

export interface MyStats {
  totals: StatsTotals
  byDeck: StatsDeck[]
  recent: StatsRecent[]
}

export interface PodStanding {
  id: string
  display_name: string
  username: string
  avatar_color: string
  games: number
  wins: number
  winrate: number
}

export interface DoctorExplanation {
  id: string
  status: "queued" | "running" | "done" | "error"
  message: string | null
  error: string | null
  text: string | null
  model: string | null
}

export interface ArtOption {
  source: "scryfall" | "mpcfill" | "upload"
  id: string
  name: string
  imageUrl: string
  thumbnailUrl: string
  artist?: string
  setCode?: string
  setName?: string
  collectorNumber?: string
  lang?: string
  dpi?: number
  tags?: string[]
  note?: string
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const text = await res.text()
  let body: any = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("kz:unauthorized"))
    throw new ApiError(body?.error ?? body ?? `HTTP ${res.status}`, res.status)
  }
  return body as T
}

export const api = {
  authStatus: () => req<{ initialized: boolean; user: AuthUser | null }>("/api/auth/status"),
  profiles: () => req<AuthUser[]>("/api/auth/profiles"),
  selectProfile: (userId: string) =>
    req<{ user: AuthUser }>("/api/auth/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    }),
  login: (username: string, password: string) =>
    req<{ user: AuthUser }>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }),
  register: (body: { inviteCode: string; displayName: string }) =>
    req<{ user: AuthUser }>("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  bootstrap: (body: { displayName: string }) =>
    req<{ user: AuthUser; invites: Invite[] }>("/api/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  logout: () => req<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  updateProfile: (body: { displayName: string; avatarColor: string }) =>
    req<{ user: AuthUser }>("/api/auth/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    req<{ ok: boolean }>("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  inviteInfo: (code: string) => req<{ valid: boolean; label: string | null }>(`/api/auth/invite/${encodeURIComponent(code)}`),
  users: () => req<Profile[]>("/api/users"),
  invites: () => req<Invite[]>("/api/admin/invites"),
  createInvite: (body: { label: string; maxUses?: number; expiresInDays?: number }) =>
    req<Invite>("/api/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  deleteInvite: (id: string) => req<{ ok: boolean }>(`/api/admin/invites/${id}`, { method: "DELETE" }),
  adminUsers: () => req<Profile[]>("/api/admin/users"),
  copyDeck: (id: string) => req<Deck>(`/api/decks/${id}/copy`, { method: "POST" }),
  meta: () => req<Meta>("/api/meta"),
  network: () => req<NetworkInfo>("/api/network"),
  suggestCommanders: (body: { brief: string; bracket: 3 | 4 | 5; podSize: number; settings: Record<string, unknown> }) =>
    req<CommanderSuggestionResponse>("/api/commanders/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  babyzilla: () => req<BabyzillaInfo>("/api/babyzilla"),
  decks: () => req<DeckSummary[]>("/api/decks"),
  deck: (id: string) => req<Deck>(`/api/decks/${id}`),
  deckCombos: (id: string, refresh = false) => req<DeckComboResult>(`/api/decks/${id}/combos${refresh ? "?refresh=1" : ""}`),
  search: (q: string, opts: { mode?: "auto" | "name" | "effect"; color?: string[]; legal?: boolean; limit?: number } = {}) => {
    const params = new URLSearchParams()
    params.set("q", q)
    params.set("limit", String(opts.limit ?? 18))
    if (opts.mode) params.set("mode", opts.mode)
    if (opts.color) params.set("color", opts.color.join(""))
    if (opts.legal) params.set("legal", "1")
    return req<any[]>(`/api/cards/search?${params.toString()}`)
  },
  interpret: (body: { q: string; colorIdentity?: string[]; commanderLegal?: boolean }) =>
    req<{ interpreted: boolean; cached: boolean; spec: { terms: string[]; tags: string[] } | null; results: any[]; error?: string }>(
      "/api/cards/interpret",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
  createDeck: (body: { commanderName: string; bracket: 3 | 4 | 5; podSize: number; settings: Record<string, unknown>; brief?: string; name?: string }) =>
    req<Deck>("/api/decks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  patchDeck: (id: string, body: Record<string, unknown>) =>
    req<Deck>(`/api/decks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  saveDeck: (id: string, body: { name?: string; ownerUserId?: string }) =>
    req<Deck>(`/api/decks/${id}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  deleteDeck: (id: string) => req<{ ok: boolean }>(`/api/decks/${id}`, { method: "DELETE" }),
  build: (id: string, brief?: string) =>
    req<{ runId: string }>(`/api/decks/${id}/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(brief === undefined ? {} : { brief }),
    }),
  buildStatus: (runId: string) => req<BuildRun>(`/api/builds/${runId}`),
  cancelBuild: (runId: string) =>
    req<{ ok: boolean; status: string }>(`/api/builds/${runId}/cancel`, { method: "POST" }),
  games: () => req<GameRecord[]>("/api/games"),
  createGame: (body: {
    playedAt?: string
    podSize: number
    winnerDeckId?: string | null
    turns?: number | null
    notes?: string
    fun?: number | null
    salt?: number | null
  }) =>
    req<GameRecord>("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  deleteGame: (id: string) => req<{ ok: boolean }>(`/api/games/${id}`, { method: "DELETE" }),
  importDeck: (body: {
    name?: string
    commanderName?: string
    list: string
    bracket: 3 | 4 | 5
    podSize: number
    settings: Record<string, unknown>
  }) =>
    req<{ deck: Deck; report: ImportReport }>("/api/decks/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  printings: (oracleId: string) => req<{ printings: ArtOption[]; error?: string }>(`/api/cards/${oracleId}/printings`),
  mpcfill: (oracleId: string) => req<{ arts: ArtOption[]; error?: string }>(`/api/cards/${oracleId}/mpcfill`),
  card: (oracleId: string) => req<{ card: any; tags: string[]; rulings: any[] }>(`/api/cards/${oracleId}`),
  germanCard: (oracleId: string) => req<{ german: GermanCardText | null; error?: string }>(`/api/cards/${oracleId}/german`),
  translateCombos: (items: ComboTextInput[]) =>
    req<{ translations: Record<string, ComboTranslation>; error: string | null }>("/api/combos/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    }),
  doctor: (id: string, maxProposals = 8) =>
    req<DoctorResult>(`/api/decks/${id}/doctor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxProposals }),
    }),
  explainDoctor: (id: string, proposalIds: string[], maxProposals = 8) =>
    req<{ cached: boolean; explanation?: string; model?: string; runId?: string }>(`/api/decks/${id}/doctor/explain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalIds, maxProposals }),
    }),
  explainStatus: (runId: string) => req<DoctorExplanation>(`/api/explain/${runId}`),
  applyDoctor: (id: string, proposalIds: string[], maxProposals = 8) =>
    req<{ deck: Deck; revisionId: string; applied: number }>(`/api/decks/${id}/doctor/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalIds, maxProposals }),
    }),
  statsMe: () => req<MyStats>("/api/stats/me"),
  statsPod: () => req<PodStanding[]>("/api/stats/pod"),
  activePods: () => req<PodState[]>("/api/pods/active"),
  createPod: (body: { name?: string; deckId?: string | null }) =>
    req<PodState>("/api/pods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  pod: (code: string) => req<PodState>(`/api/pods/${encodeURIComponent(code)}`),
  joinPod: (code: string, deckId?: string | null) =>
    req<PodState>(`/api/pods/${encodeURIComponent(code)}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deckId: deckId ?? null }),
    }),
  podLife: (code: string, playerId: string, delta: number) =>
    req<PodState>(`/api/pods/${encodeURIComponent(code)}/life`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, delta }),
    }),
  podPoison: (code: string, playerId: string, delta: number) =>
    req<PodState>(`/api/pods/${encodeURIComponent(code)}/poison`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, delta }),
    }),
  podCounter: (code: string, playerId: string, counter: string, delta: number) =>
    req<PodState>(`/api/pods/${encodeURIComponent(code)}/counter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, counter, delta }),
    }),
  podStatus: (code: string, playerId: string, status: string, value: boolean) =>
    req<PodState>(`/api/pods/${encodeURIComponent(code)}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, status, value }),
    }),
  podCommander: (code: string, playerId: string, fromPlayerId: string, delta: number) =>
    req<PodState>(`/api/pods/${encodeURIComponent(code)}/commander`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, fromPlayerId, delta }),
    }),
  podEliminate: (code: string, playerId: string, eliminated: boolean) =>
    req<PodState>(`/api/pods/${encodeURIComponent(code)}/eliminate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, eliminated }),
    }),
  podReset: (code: string) => req<PodState>(`/api/pods/${encodeURIComponent(code)}/reset`, { method: "POST" }),
  podUndo: (code: string) => req<PodState>(`/api/pods/${encodeURIComponent(code)}/undo`, { method: "POST" }),
  podFinish: (code: string, body: { winnerPlayerId?: string | null; turns?: number | null; fun?: number | null; salt?: number | null; notes?: string }) =>
    req<{ state: PodState; gameId: string }>(`/api/pods/${encodeURIComponent(code)}/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  revisions: (id: string) => req<{ revisions: DeckRevision[] }>(`/api/decks/${id}/revisions`),
  restoreRevision: (id: string, revisionId: string) =>
    req<{ deck: Deck; revisionId: string }>(`/api/decks/${id}/revisions/${revisionId}/restore`, {
      method: "POST",
    }),
  addCard: (
    deckId: string,
    name: string,
    options: {
      board?: "main" | "maybeboard"
      role?: string
      category?: string
      reason?: string
      printingId?: string | null
      artUrl?: string | null
      artist?: string | null
    } = {},
  ) =>
    req<Deck>(`/api/decks/${deckId}/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, ...options }),
    }),
  moveCard: (deckId: string, oracleId: string, board: "main" | "maybeboard") =>
    req<Deck>(`/api/decks/${deckId}/cards/${oracleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board }),
    }),
  swapCard: (deckId: string, addName: string, removeOracleId: string) =>
    req<Deck>(`/api/decks/${deckId}/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addName, removeOracleId }),
    }),
  removeCard: (deckId: string, oracleId: string) => req<Deck>(`/api/decks/${deckId}/cards/${oracleId}`, { method: "DELETE" }),
  setArt: (deckId: string, oracleId: string, body: { printingId?: string | null; artUrl?: string | null; artist?: string | null }) =>
    req<{ ok: boolean }>(`/api/decks/${deckId}/cards/${oracleId}/art`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  rules: (q: string) => req<{ format: any[]; cr: any[] }>(`/api/rules/search?q=${encodeURIComponent(q)}`),
  rule: (number: string) => req<{ rule: any; parent: any; children: any[] }>(`/api/rules/${number}`),
}
