import { Hono, type Context } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { serveStatic, upgradeWebSocket, websocket } from "hono/bun"
import { execFileSync } from "node:child_process"
import { createHash, randomBytes, randomInt } from "node:crypto"
import QRCode from "qrcode"
import { hostname, networkInterfaces } from "node:os"
import { db } from "./db"
import { ROOT } from "./lib/paths"
import {
  analyzeDeck,
  buildPool,
  cardById,
  cardByName,
  cardByNameExact,
  deterministicBuild,
  fitsColorIdentity,
  makeDeckCard,
  parseCard,
  repairBuild,
  roleFor,
  tagsFor,
  tuneToBracket,
} from "./lib/engine"
import { AI_CANDIDATE_LIMIT, AI_MODEL, aiBuild, aiSuggestCommanders, callOpencodeDetailed, interpretCardQuery, type CommanderCandidate } from "./lib/ai"
import { babyzillaCost, babyzillaStats } from "./lib/babyzilla"
import { findCombos } from "./lib/combos"
import { POD_COUNTER_MAX, POD_STATUSES, isPodCounterKey, isPodStatusKey } from "./lib/pod-counters"
import { BRACKETS } from "./lib/rules-seed"
import { isSkippedSection, parseDeckList, type ParsedEntry } from "./lib/import"
import { doctorDeck } from "./lib/doctor"
import { DEFAULT_SETTINGS, SETTING_LABELS, type BracketId, type Card, type DeckCard, type DeckSettings, type Role } from "./lib/types"
import { getGermanCardText, getMpcFillArt, getPrintings, getRulings, scryfallCrop, scryfallArt, scryfallJson } from "./lib/scryfall"
import { searchCards, searchStructured, ftsMatchForTerm, type SearchHit, type SearchMode, type SearchOptions } from "./lib/cardsearch"
import { mergeVision, visionCandidates, visionSpecs } from "./lib/vision"
import { translateComboTexts, type ComboTextInput } from "./lib/translate"

const PORT = Number(process.env.PORT ?? 4173)
const BRIEF_MAX = 2000
const SESSION_COOKIE = "kz_session"
const SESSION_DAYS = 365
const PASSWORDLESS_HASH = "!"
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const DEFAULT_FRIEND_INVITES = ["Dennis", "Ingo", "Bamdad", "Nima"]
const AVATAR_COLORS = ["#a4552f", "#1f3d33", "#2d5547", "#7d3d22", "#c39a3e", "#8f2f2f"]

type AuthUser = {
  id: string
  username: string
  display_name: string
  role: "admin" | "member"
  avatar_color: string
}

type AppEnv = { Variables: { user: AuthUser } }

const app = new Hono<AppEnv>()

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function publicUser(row: any): AuthUser {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role === "admin" ? "admin" : "member",
    avatar_color: row.avatar_color ?? AVATAR_COLORS[0],
  }
}

function currentUser(c: Context<AppEnv>): AuthUser | null {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return null
  const row = db
    .query(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? LIMIT 1`,
    )
    .get(sha256(token), new Date().toISOString()) as any
  return row ? publicUser(row) : null
}

function authUser(c: Context<AppEnv>): AuthUser {
  return c.get("user") as AuthUser
}

function createSession(c: Context<AppEnv>, userId: string) {
  const token = randomBytes(32).toString("base64url")
  const now = new Date()
  const expires = new Date(now.getTime() + SESSION_DAYS * 864e5)
  db.query("INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at,user_agent) VALUES (?,?,?,?,?,?)").run(
    crypto.randomUUID(),
    userId,
    sha256(token),
    expires.toISOString(),
    now.toISOString(),
    (c.req.header("user-agent") ?? "").slice(0, 300) || null,
  )
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
    secure: c.req.header("x-forwarded-proto") === "https",
  })
}

function clearSession(c: Context<AppEnv>) {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) db.query("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token))
  deleteCookie(c, SESSION_COOKIE, { path: "/" })
}

function normalizeUsername(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 24)
}

function validPassword(value: unknown): string | null {
  const password = String(value ?? "")
  return password.length >= 8 && password.length <= 200 ? password : null
}

function displayName(value: unknown, fallback = ""): string {
  return String(value ?? fallback).trim().slice(0, 40) || fallback
}

function uniqueUsername(value: unknown): string {
  const raw = normalizeUsername(value).slice(0, 20)
  const base = raw.length >= 3 ? raw : "spieler"
  let candidate = base
  let suffix = 2
  while (db.query("SELECT 1 FROM users WHERE username = ?").get(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

function colorFor(seed: string): string {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

function makeInviteCode(): string {
  let code = ""
  for (let i = 0; i < 6; i += 1) code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]
  return `KZ-${code}`
}

function createInvite(label: string | null, createdBy: string | null, maxUses = 1, days = 30) {
  let code = makeInviteCode()
  while (db.query("SELECT 1 FROM invites WHERE code = ?").get(code)) code = makeInviteCode()
  const id = crypto.randomUUID()
  const now = new Date()
  const expires = days > 0 ? new Date(now.getTime() + days * 864e5).toISOString() : null
  db.query("INSERT INTO invites(id,code,label,created_by,created_at,expires_at,max_uses,uses) VALUES (?,?,?,?,?,?,?,0)").run(
    id,
    code,
    label,
    createdBy,
    now.toISOString(),
    expires,
    Math.max(1, Math.min(100, maxUses)),
  )
  return { id, code, label, created_at: now.toISOString(), expires_at: expires, max_uses: maxUses, uses: 0 }
}

function userCount(): number {
  return Number((db.query("SELECT COUNT(*) AS count FROM users").get() as any)?.count ?? 0)
}

function canEditDeck(c: Context<AppEnv>, deckId: string): boolean {
  const row = db.query("SELECT owner_user_id FROM deck WHERE id = ?").get(deckId) as any
  if (!row) return false
  const user = authUser(c)
  return user.role === "admin" || row.owner_user_id === user.id
}

const loginAttempts = new Map<string, { count: number; resetAt: number }>()

function loginAllowed(key: string): boolean {
  const now = Date.now()
  const entry = loginAttempts.get(key)
  if (!entry || entry.resetAt < now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60_000 })
    return true
  }
  entry.count += 1
  return entry.count <= 10
}

type NetworkInfo = {
  lanUrl: string | null
  mdnsUrl: string | null
  ipUrl: string | null
  publicUrl: string | null
  tailscaleUrl: string | null
  tailscaleAvailable: boolean
  port: number
}

let networkCache: { at: number; value: NetworkInfo } | null = null
let tailscaleCache: { at: number; available: boolean; active: boolean; url: string | null } | null = null

function lanAddress(): string | null {
  const entries = Object.entries(networkInterfaces())
  const preferred = ["en0", "en1", "en2", "eth0", "wlan0"]
  const ordered = [
    ...entries.filter(([name]) => preferred.includes(name)),
    ...entries.filter(([name]) => !preferred.includes(name)),
  ]
  const candidates: string[] = []
  for (const [, addresses] of ordered) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) continue
      if (address.address.startsWith("169.254.")) continue
      if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address.address)) continue
      candidates.push(address.address)
    }
  }
  const privateAddress = candidates.find((address) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address))
  return privateAddress ?? candidates[0] ?? null
}

function mdnsHostname(): string | null {
  let raw = ""
  try {
    raw = execFileSync("scutil", ["--get", "LocalHostName"], {
      encoding: "utf8",
      timeout: 800,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    raw = hostname().split(".")[0]
  }
  const slug = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.local(domain)?$/i, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
  return slug ? `${slug}.local` : null
}

function tailscaleInfo(): { available: boolean; active: boolean; url: string | null } {
  if (tailscaleCache && Date.now() - tailscaleCache.at < 3_000) return tailscaleCache
  try {
    const raw = execFileSync("tailscale", ["status", "--json"], {
      encoding: "utf8",
      timeout: 1200,
      stdio: ["ignore", "pipe", "ignore"],
    })
    const data = JSON.parse(raw) as any
    const active = data?.BackendState === "Running"
    const dnsName = String(data?.Self?.DNSName ?? "").replace(/\.$/, "")
    const ips: string[] = Array.isArray(data?.Self?.TailscaleIPs) ? data.Self.TailscaleIPs.map((ip: unknown) => String(ip)) : []
    const ipv4 = ips.find((ip) => ip.includes("."))
    const url = active && (dnsName || ipv4) ? `http://${dnsName || ipv4}:${PORT}` : null
    const value = { available: true, active, url }
    tailscaleCache = { at: Date.now(), ...value }
    return value
  } catch {
    const value = { available: false, active: false, url: null }
    tailscaleCache = { at: Date.now(), ...value }
    return value
  }
}

function networkInfo(): NetworkInfo {
  if (networkCache && Date.now() - networkCache.at < 1_000) return networkCache.value
  const ip = lanAddress()
  const mdns = mdnsHostname()
  const publicUrl = process.env.PUBLIC_URL?.trim().replace(/\/+$/, "") || null
  const tailscale = tailscaleInfo()
  const value: NetworkInfo = {
    lanUrl: publicUrl ?? (mdns ? `http://${mdns}:${PORT}` : ip ? `http://${ip}:${PORT}` : null),
    mdnsUrl: mdns ? `http://${mdns}:${PORT}` : null,
    ipUrl: ip ? `http://${ip}:${PORT}` : null,
    publicUrl,
    tailscaleUrl: tailscale.url,
    tailscaleAvailable: tailscale.available,
    port: PORT,
  }
  networkCache = { at: Date.now(), value }
  return value
}

function publicBaseUrl(c: Context<AppEnv>): string {
  const info = networkInfo()
  if (info.publicUrl) return info.publicUrl
  const forwardedProto = c.req.header("x-forwarded-proto")
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? `127.0.0.1:${PORT}`
  const localHost = host.startsWith("127.") || host.startsWith("localhost")
  if (!localHost) return `${forwardedProto ?? "http"}://${host}`
  return info.mdnsUrl ?? info.ipUrl ?? `http://${host}`
}

const POD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const podRooms = new Map<string, Set<any>>()

type PodPlayerState = {
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

type PodState = {
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

function makePodCode(): string {
  let code = ""
  for (let i = 0; i < 6; i += 1) code += POD_ALPHABET[randomInt(POD_ALPHABET.length)]
  return code
}

function loadPod(code: string): PodState | null {
  const session = db
    .query(
      `SELECT s.*, u.display_name AS host_name
       FROM pod_session s LEFT JOIN users u ON u.id = s.host_user_id
       WHERE s.code = ? COLLATE NOCASE LIMIT 1`,
    )
    .get(code.toUpperCase()) as any
  if (!session) return null
  const rows = db
    .query(
      `SELECT p.*, u.display_name, u.avatar_color, d.name AS deck_name, d.commander_name
       FROM pod_player p
       LEFT JOIN users u ON u.id = p.user_id
       LEFT JOIN deck d ON d.id = p.deck_id
       WHERE p.session_id = ? ORDER BY p.seat`,
    )
    .all(session.id) as any[]
  return {
    id: session.id,
    code: session.code,
    name: session.name,
    host_user_id: session.host_user_id,
    host_name: session.host_name ?? "Unbekannt",
    status: session.status,
    version: Number(session.version ?? 0),
    created_at: session.created_at,
    updated_at: session.updated_at,
    players: rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      display_name: row.display_name ?? "Gast",
      avatar_color: row.avatar_color ?? AVATAR_COLORS[0],
      seat: Number(row.seat),
      deck_id: row.deck_id ?? null,
      deck_name: row.deck_name ?? null,
      commander_name: row.commander_name ?? null,
      life: Number(row.life ?? 40),
      poison: Number(row.poison ?? 0),
      commander_damage: parseJsonObject(row.commander_damage_json),
      counters: parseJsonObject(row.counters_json),
      statuses: parseJsonObject(row.statuses_json),
      eliminated: Boolean(row.eliminated),
    })),
  }
}

function parseJsonObject(value: unknown): Record<string, any> {
  if (typeof value !== "string" || !value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function podSnapshot(sessionId: string) {
  const rows = db
    .query(
      "SELECT id, life, poison, commander_damage_json, counters_json, statuses_json, eliminated FROM pod_player WHERE session_id = ? ORDER BY seat",
    )
    .all(sessionId) as any[]
  return rows.map((row) => ({
    id: row.id,
    life: Number(row.life),
    poison: Number(row.poison),
    commander_damage_json: row.commander_damage_json ?? "{}",
    counters_json: row.counters_json ?? "{}",
    statuses_json: row.statuses_json ?? "{}",
    eliminated: Number(row.eliminated ?? 0),
  }))
}

function applyPodSnapshot(sessionId: string, snapshot: any[]) {
  const now = new Date().toISOString()
  for (const row of snapshot) {
    db.query(
      "UPDATE pod_player SET life = ?, poison = ?, commander_damage_json = ?, counters_json = ?, statuses_json = ?, eliminated = ?, updated_at = ? WHERE id = ? AND session_id = ?",
    ).run(
      Number(row.life ?? 40),
      Number(row.poison ?? 0),
      row.commander_damage_json ?? "{}",
      row.counters_json ?? "{}",
      row.statuses_json ?? "{}",
      Number(row.eliminated ?? 0),
      now,
      row.id,
      sessionId,
    )
  }
}

function podVersion(sessionId: string) {
  const now = new Date().toISOString()
  db.query("UPDATE pod_session SET version = version + 1, updated_at = ? WHERE id = ?").run(now, sessionId)
  return Number((db.query("SELECT version FROM pod_session WHERE id = ?").get(sessionId) as any)?.version ?? 0)
}

function recordPodEvent(sessionId: string, actorUserId: string, kind: string, before: any[], after: any[]) {
  db.query("INSERT INTO pod_event(id,session_id,actor_user_id,kind,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?)").run(
    crypto.randomUUID(),
    sessionId,
    actorUserId,
    kind,
    JSON.stringify(before),
    JSON.stringify(after),
    new Date().toISOString(),
  )
}

function broadcastPod(code: string) {
  const room = podRooms.get(code.toUpperCase())
  if (!room || room.size === 0) return
  const state = loadPod(code)
  if (!state) return
  const message = JSON.stringify({ type: "state", state })
  for (const socket of room) {
    try {
      socket.send(message)
    } catch {
      room.delete(socket)
    }
  }
}

function podSessionForUser(code: string, userId: string) {
  const state = loadPod(code)
  if (!state) return null
  const player = state.players.find((row) => row.user_id === userId)
  if (!player && state.host_user_id !== userId) return null
  return { state, player }
}

function proposalLimit(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(1, Math.min(12, Math.round(number))) : 8
}

function cleanSettings(input: any): DeckSettings {
  const settings = { ...DEFAULT_SETTINGS, ...(input ?? {}) } as DeckSettings & { allowOneWin?: unknown; enforceColorIdentity?: unknown }
  delete settings.allowOneWin
  delete settings.enforceColorIdentity
  return settings
}

function settingsFor(row: any): DeckSettings {
  return cleanSettings(row?.settings_json ? JSON.parse(row.settings_json) : {})
}

function deckBrief(value: unknown): string {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, BRIEF_MAX)
}

type CommanderSuggestionPayload = {
  oracle_id: string
  name: string
  mana_cost: string | null
  type_line: string
  color_identity: string[]
  image_uris: any
  edhrec_rank: number | null
  reason: string
}

const COMMANDER_STOPWORDS = new Set(
  (
    "aber auch damit dann das dass dein deine deiner dem den der des die dies doch durch ein eine einem einen einer eines fuer für gegen gerne haben hat ich im in ist keine mit nicht noch oder ohne sehr sich sie sind soll sollen ueber über und vom von vor was wenn werden wie wird zu zum zur the and with that this from into deck karten spielen spielt bauen baut commander vision mehr viele wenige frueh früh runde grosse große grossen grosser kleinen kleine guten gut gute sowie als auf aus bei beim bin bis da dabei dafuer dafür dagegen daher darum davon dazu denn deshalb dieser dieses dort du einfach etwas euch euer eure gibt hier hin hinter ihr ihre ihren ihrer kann koennen können man mich mir muss muessen müssen nach neben nur ob schon sein seine seit so solche um uns unser unsere unter viel weiter welche wer wieder wir wo zwischen"
  ).split(/\s+/),
)

const COMMANDER_THEME_HINTS: Record<string, string[]> = {
  drache: ["dragon"],
  drachen: ["dragon"],
  dragon: ["dragon"],
  zombie: ["zombie"],
  zombies: ["zombie"],
  elf: ["elf"],
  elfen: ["elf"],
  goblin: ["goblin"],
  goblins: ["goblin"],
  gremlin: ["gremlin"],
  gremlins: ["gremlin"],
  artefakt: ["artifact"],
  artefakte: ["artifact"],
  artifact: ["artifact"],
  token: ["token"],
  tokens: ["token"],
  reanimator: ["graveyard", "return", "reanimate"],
  wiederbeleben: ["graveyard", "return"],
  friedhof: ["graveyard"],
  graveyard: ["graveyard"],
  opfer: ["sacrifice"],
  opfern: ["sacrifice"],
  aristokraten: ["sacrifice", "aristocrat"],
  lebensgewinn: ["lifegain"],
  lifegain: ["lifegain"],
  zauberspruch: ["instant", "sorcery"],
  zaubersprueche: ["instant", "sorcery"],
  zaubersprüche: ["instant", "sorcery"],
  spellslinger: ["instant", "sorcery"],
  counter: ["counter"],
  marken: ["counter"],
  landfall: ["landfall"],
  laender: ["land"],
  länder: ["land"],
  blink: ["blink", "exile"],
  exil: ["exile"],
  mill: ["mill"],
  muehle: ["mill"],
  mühle: ["mill"],
  equipment: ["equipment"],
  ausruestung: ["equipment"],
  ausrüstung: ["equipment"],
  aura: ["aura"],
  auren: ["aura"],
  verzauberung: ["enchantment"],
  verzauberungen: ["enchantment"],
  enchantment: ["enchantment"],
  schatz: ["treasure"],
  schaetze: ["treasure"],
  schätze: ["treasure"],
  treasure: ["treasure"],
  clue: ["clue"],
  food: ["food"],
  fahrzeug: ["vehicle"],
  fahrzeuge: ["vehicle"],
  dinosaurier: ["dinosaur"],
  vampire: ["vampire"],
  vampir: ["vampire"],
  werwolf: ["werewolf"],
  werwoelfe: ["werewolf"],
  werwölfe: ["werewolf"],
  katze: ["cat"],
  katzen: ["cat"],
  eichhoernchen: ["squirrel"],
  eichhörnchen: ["squirrel"],
  spinne: ["spider"],
  spinnen: ["spider"],
  pirat: ["pirate"],
  piraten: ["pirate"],
  engel: ["angel"],
  daemon: ["demon"],
  dämon: ["demon"],
  daemonen: ["demon"],
  dämonen: ["demon"],
  hexe: ["warlock"],
  hexen: ["warlock"],
  zauberer: ["wizard"],
  krieger: ["warrior"],
  soldat: ["soldier"],
  soldaten: ["soldier"],
  meervolk: ["merfolk"],
  riese: ["giant"],
  baum: ["treefolk"],
  pilz: ["fungus"],
  skelett: ["skeleton"],
  geist: ["spirit"],
  mensch: ["human"],
  menschen: ["human"],
  ork: ["orc"],
  orks: ["orc"],
  elementar: ["elemental"],
  elementare: ["elemental"],
  schlange: ["snake"],
  schlangen: ["snake"],
}

function commanderSearchTerms(brief: string): string[] {
  const out = new Set<string>()
  const words = brief.toLowerCase().match(/[a-zäöüß0-9/+]{4,}/g) ?? []
  for (const raw of words) {
    const word = raw.replace(/^[-/+]+|[-/+]+$/g, "")
    if (word.length < 4 || COMMANDER_STOPWORDS.has(word)) continue
    out.add(word)
    for (const hint of COMMANDER_THEME_HINTS[word] ?? []) out.add(hint)
  }
  return [...out].slice(0, 18)
}

function commanderCandidates(brief: string): CommanderCandidate[] {
  const map = new Map<string, Card>()
  const add = (rows: any[]) => {
    for (const row of rows) {
      const card = parseCard(row)
      if (!map.has(card.oracle_id)) map.set(card.oracle_id, card)
    }
  }
  const base =
    "is_legendary = 1 AND is_creature = 1 AND json_extract(legalities, '$.commander') = 'legal' AND is_one_win = 0"

  add(
    db
      .query(`SELECT * FROM card WHERE ${base} ORDER BY edhrec_rank IS NULL, edhrec_rank LIMIT 200`)
      .all() as any[],
  )

  const terms = commanderSearchTerms(brief)
  for (const term of terms) {
    const clean = term.replace(/[%_]/g, "")
    if (!clean) continue
    const pattern = `%${clean}%`
    add(
      db
        .query(
          `SELECT * FROM card WHERE ${base}
             AND (name LIKE ? COLLATE NOCASE OR type_line LIKE ? COLLATE NOCASE OR oracle_text_all LIKE ? COLLATE NOCASE)
           ORDER BY edhrec_rank IS NULL, edhrec_rank LIMIT 6`,
        )
        .all(pattern, pattern, pattern) as any[],
    )
    add(
      db
        .query(
          `SELECT c.* FROM card c JOIN card_tag t ON t.oracle_id = c.oracle_id
           WHERE c.is_legendary = 1 AND c.is_creature = 1
             AND json_extract(c.legalities, '$.commander') = 'legal'
             AND c.is_one_win = 0 AND t.tag LIKE ? COLLATE NOCASE
           GROUP BY c.oracle_id
           ORDER BY c.edhrec_rank IS NULL, c.edhrec_rank LIMIT 6`,
        )
        .all(pattern) as any[],
    )
    // Deutsche Begriffe gegen den englischen Oracle-Text: derselbe Suchkern
    // wie im Deck-Editor, damit "Länder opfern" nicht ins Leere läuft.
    const fts = ftsMatchForTerm(clean)
    if (fts) {
      add(
        db
          .query(
            `SELECT card.* FROM card_fts JOIN card ON card.oracle_id = card_fts.oracle_id
             WHERE card_fts MATCH ? AND ${base}
             ORDER BY card.edhrec_rank IS NULL, card.edhrec_rank LIMIT 6`,
          )
          .all(fts) as any[],
      )
    }
  }

  // Effekt-Suche über die ganze Vision: mehrere Begriffe + Scryfall-Tags
  // statt nur einzelner Wörter. Damit findet "Länder opfern und daraus
  // Mana ziehen" auch Commanders, deren Oracle-Text die Wörter nicht
  // wörtlich enthält, aber den passenden Tag trägt.
  for (const spec of visionSpecs(brief)) {
    try {
      const hits = searchStructured(
        { terms: spec.terms, tags: spec.tags },
        { legendaryCommander: true, commanderLegal: true, limit: 8 },
      )
      for (const hit of hits) {
        if (!map.has(hit.card.oracle_id)) map.set(hit.card.oracle_id, hit.card)
      }
    } catch {
      // Ein kaputter Spec darf die Commander-Suche nicht stoppen.
    }
  }

  const cards = [...map.values()].slice(0, 300)
  const tagMap = tagsFor(cards.map((card) => card.oracle_id))
  return cards.map((card) => ({ card, tags: tagMap.get(card.oracle_id) ?? [] }))
}

function commanderSuggestion(card: Card, reason: string): CommanderSuggestionPayload {
  return {
    oracle_id: card.oracle_id,
    name: card.name,
    mana_cost: card.mana_cost,
    type_line: card.type_line,
    color_identity: card.color_identity,
    image_uris: card.image_uris,
    edhrec_rank: card.edhrec_rank,
    reason: reason.replace(/\s+/g, " ").trim().slice(0, 700),
  }
}

function fallbackCommanderSuggestions(brief: string, candidates: CommanderCandidate[]): CommanderSuggestionPayload[] {
  const terms = commanderSearchTerms(brief)
  const scored = candidates
    .map((candidate) => {
      const card = candidate.card
      const hay = `${card.name} ${card.type_line} ${card.oracle_text_all ?? ""} ${candidate.tags.join(" ")}`.toLowerCase()
      let score = 0
      for (const term of terms) {
        if (hay.includes(term)) score += card.name.toLowerCase().includes(term) ? 7 : 3
      }
      if (card.edhrec_rank != null) score += Math.max(0, 8 - Math.log10(card.edhrec_rank + 10) * 2.5)
      return { card, tags: candidate.tags, score }
    })
    .sort((a, b) => b.score - a.score || (a.card.edhrec_rank ?? 999999) - (b.card.edhrec_rank ?? 999999))

  return scored.slice(0, 3).map(({ card, tags }) => {
    const hay = `${card.name} ${card.type_line} ${card.oracle_text_all ?? ""} ${tags.join(" ")}`.toLowerCase()
    const matches = terms.filter((term) => hay.includes(term)).slice(0, 3)
    const reason = matches.length
      ? `Passt zu ${matches.join(", ")}. ${card.name} gibt der Vision einen klaren Plan, ohne den Kartenpool zu verlassen. Prüfe im Builder, ob Tempo und Bracket zu deiner Runde passen.`
      : `${card.name} ist eine solide Basis für diese Vision. Die Auswahl stützt sich auf Karten-Tags und EDHREC-Daten; prüfe die endgültige Richtung im Builder.`
    return commanderSuggestion(card, reason)
  })
}

function mapAiCommanderSuggestions(
  candidates: CommanderCandidate[],
  suggestions: Array<{ name: string; reason: string }>,
): CommanderSuggestionPayload[] {
  const byName = new Map(candidates.map((candidate) => [candidate.card.name.toLowerCase(), candidate.card]))
  const seen = new Set<string>()
  const out: CommanderSuggestionPayload[] = []
  for (const suggestion of suggestions) {
    const card = byName.get(suggestion.name.toLowerCase())
    if (!card || seen.has(card.oracle_id)) continue
    seen.add(card.oracle_id)
    const reason =
      suggestion.reason ||
      `${card.name} passt zu deiner Vision und gibt dem Deck einen klaren Plan. Prüfe im Builder, ob Tempo und Bracket zu deiner Runde passen.`
    out.push(commanderSuggestion(card, reason))
    if (out.length === 3) break
  }
  return out
}

function loadDeck(id: string) {
  const d = db.query("SELECT * FROM deck WHERE id = ?").get(id) as any
  if (!d) return null
  const baseCommander = d.commander_oracle_id ? cardById(d.commander_oracle_id) : null
  const commander = baseCommander
    ? {
        ...baseCommander,
        printing_id: d.commander_printing_id ?? null,
        art_url: d.commander_art_url ?? null,
        artist: d.commander_artist ?? null,
      }
    : null
  const rows = db
    .query(
      `SELECT c.*, dc.role, dc.category, dc.reason, dc.printing_id, dc.art_url, dc.artist, dc.quantity, dc.sort_order, dc.board
       FROM deck_card dc JOIN card c ON c.oracle_id = dc.oracle_id
       WHERE dc.deck_id = ?
       ORDER BY CASE WHEN dc.board = 'maybeboard' THEN 1 ELSE 0 END, dc.sort_order`,
    )
    .all(id) as any[]
  const tagMap = tagsFor(rows.map((r) => r.oracle_id))
  const allCards: DeckCard[] = rows.map((r) => ({
    ...parseCard(r),
    role: (r.role ?? "flex") as Role,
    category: r.category ?? r.role ?? "flex",
    reason: r.reason ?? "",
    printing_id: r.printing_id ?? null,
    art_url: r.art_url ?? null,
    artist: r.artist ?? null,
    quantity: Number(r.quantity ?? 1),
    is_commander: false,
    tags: tagMap.get(r.oracle_id) ?? [],
    board: r.board === "maybeboard" ? "maybeboard" : "main",
  }))
  const cards = allCards.filter((card) => card.board !== "maybeboard")
  const maybeboard = allCards.filter((card) => card.board === "maybeboard")
  const settings = settingsFor(d)
  const bracket = Number(d.bracket ?? 3) as BracketId
  const analysis = commander ? analyzeDeck(commander, cards, settings, bracket) : null
  const owner = d.owner_user_id
    ? (db.query("SELECT display_name, avatar_color FROM users WHERE id = ?").get(d.owner_user_id) as any)
    : null
  return {
    id: d.id,
    name: d.name,
    commander_oracle_id: d.commander_oracle_id,
    commander_name: d.commander_name,
    commander,
    bracket,
    pod_size: Number(d.pod_size ?? 4),
    settings,
    brief: d.brief ?? "",
    primer: d.primer,
    status: d.status,
    saved_at: d.saved_at ?? null,
    created_at: d.created_at,
    updated_at: d.updated_at,
    owner_user_id: d.owner_user_id ?? null,
    owner_name: owner?.display_name ?? null,
    owner_color: owner?.avatar_color ?? null,
    visibility: d.visibility ?? "group",
    cards,
    maybeboard,
    analysis,
  }
}

function saveDeckCards(deckId: string, cards: DeckCard[]) {
  const existing = db.query("SELECT oracle_id, printing_id, art_url, artist FROM deck_card WHERE deck_id = ?").all(deckId) as any[]
  const artByOracle = new Map(existing.map((e) => [e.oracle_id, e]))
  const del = db.prepare("DELETE FROM deck_card WHERE deck_id = ? AND board = 'main'")
  const insert = db.prepare(
    "INSERT INTO deck_card(deck_id,oracle_id,quantity,category,role,reason,printing_id,art_url,artist,sort_order,is_commander) VALUES (?,?,?,?,?,?,?,?,?,?,0)",
  )
  const order: Record<string, number> = { land: 0, ramp: 1, draw: 2, removal: 3, wipe: 4, protection: 5, tutor: 6, recursion: 7, wincon: 8, synergy: 9, flex: 10 }
  const tx = db.transaction(() => {
    del.run(deckId)
    const maybeboardDelete = db.prepare("DELETE FROM deck_card WHERE deck_id = ? AND board = 'maybeboard' AND oracle_id = ?")
    for (const card of cards) maybeboardDelete.run(deckId, card.oracle_id)
    cards
      .slice()
      .sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9) || a.cmc - b.cmc)
      .forEach((c, i) => {
        const old = artByOracle.get(c.oracle_id)
        insert.run(
          deckId,
          c.oracle_id,
          Math.max(1, c.quantity),
          c.category,
          c.role,
          c.reason,
          c.printing_id ?? old?.printing_id ?? null,
          c.art_url ?? old?.art_url ?? null,
          c.artist ?? old?.artist ?? null,
          i,
        )
      })
  })
  tx()
}

function snapshotDeck(deckId: string, label: string): string | null {
  const deck = loadDeck(deckId)
  if (!deck || deck.cards.length === 0) return null
  const revisionId = crypto.randomUUID()
  const snapshot = deck.cards.map((card) => ({
    oracle_id: card.oracle_id,
    quantity: card.quantity,
    role: card.role,
    category: card.category,
    reason: card.reason,
    printing_id: card.printing_id,
    art_url: card.art_url,
    artist: card.artist,
  }))
  db.query("INSERT INTO deck_revision(id, deck_id, created_at, label, cards_json) VALUES (?,?,?,?,?)").run(
    revisionId,
    deckId,
    new Date().toISOString(),
    label,
    JSON.stringify(snapshot),
  )
  db.query(
    "DELETE FROM deck_revision WHERE deck_id = ? AND id NOT IN (SELECT id FROM deck_revision WHERE deck_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10)",
  ).run(deckId, deckId)
  return revisionId
}

function primerFallback(commander: any, cards: DeckCard[], bracket: BracketId, podSize: number) {
  const counts: Record<string, number> = {}
  for (const c of cards) counts[c.role] = (counts[c.role] ?? 0) + c.quantity
  const b = BRACKETS.find((x) => x.id === bracket)
  return `## Idee

${commander.name} ist der Fixpunkt des Decks. ${commander.oracle_text_all ?? ""}

## Command Zone

Der Commander beginnt in der Command Zone und zählt in die 100 Karten. Er kostet jedes Mal {2} mehr, wenn du ihn erneut wirkst.

## Plan

Das Deck ist auf Bracket ${bracket} (${b?.name ?? "?"}) und einen Tisch mit ${podSize} Spielern ausgelegt. Die Engine hat ${counts.land ?? 0} Länder, ${counts.ramp ?? 0} Ramp, ${counts.draw ?? 0} Kartenvorteil und ${counts.removal ?? 0} Removal eingeplant. Die Wincons sind ${counts.wincon ?? 0} Karten, die das Spiel tatsächlich beenden können.

## Regelklarstellung

1-Win-Karten sind dauerhaft ausgeschlossen. Bei 0 Rule bleiben illegale Karten erlaubt; die App markiert sie nur. Die Farbidentität des Commanders bleibt immer Pflicht. Prüfe vor dem Spiel, welche Hausregeln heute gelten.

## Salzpaket

Mass Land Denial, Extra-Züge und Tutoren sind die üblichen Auslöser. Der Bracket-Audit zeigt, was das Deck nach oben zieht. Wenn die Runde genervt reagiert, ist das kein Regelproblem, sondern ein Pod-Problem.

## Pilotierung

Mulligan auf zwei bis vier Länder und einen Plan. Halte den Commander nicht automatisch in der Hand, wenn die Manabase ihn nicht trägt. Spiele zuerst die Karte, die den Plan voranbringt, nicht die, die am meisten kostet.`
}

function doctorExplanationPrompt(deck: any, diagnosis: any, proposals: any[]): string {
  const counts = deck.analysis?.counts ?? {}
  const needs = (diagnosis.needs ?? [])
    .map((need: any) => `${need.label}: ${need.current}/${need.target}`)
    .join(", ")
  const budget = (diagnosis.overBudget ?? [])
    .map((issue: any) => `${issue.label}: ${issue.current} (erlaubt ${issue.allowed})`)
    .join(", ")
  const swaps = proposals
    .map((proposal, index) => {
      const cut = proposal.cut ? `${proposal.cut.name} (${proposal.cut.role}, MV ${proposal.cut.cmc})` : "freier Platz"
      const add = proposal.add ? `${proposal.add.name} (${proposal.add.role}, MV ${proposal.add.cmc})` : "nur schneiden"
      return `${index + 1}. ${cut} -> ${add}\n   Bedarf: ${proposal.need} (${proposal.before} -> ${proposal.after})\n   Engine-Grund: ${proposal.reason}`
    })
    .join("\n")
  return `Du bist der Deckarzt der Kommandozentrale, einer privaten Commander-Runde.

Deine Aufgabe: Erkläre die folgenden Engine-Vorschläge für das Deck "${deck.name}".
Du darfst KEINE Karten auswählen, KEINE neuen Karten vorschlagen und die Vorschläge NICHT verändern.
Nenne nur Karten, die im Deck oder in den Vorschlägen vorkommen. Erfinde keine Karten und keine Regeln.

Commander: ${deck.commander?.name ?? deck.commander_name}
Bracket: B${deck.bracket}, Pod: ${deck.pod_size} Spieler
Karten: ${diagnosis.total}
Rollen: Länder ${counts.land ?? 0}, Ramp ${counts.ramp ?? 0}, Draw ${counts.draw ?? 0}, Removal ${counts.removal ?? 0}, Wipes ${counts.wipe ?? 0}, Schutz ${counts.protection ?? 0}, Tutoren ${counts.tutor ?? 0}, Rekursion ${counts.recursion ?? 0}, Wincons ${counts.wincon ?? 0}
Offene Bedarfe: ${needs || "keine"}
Budget-Probleme: ${budget || "keine"}
Notizen der Engine: ${(diagnosis.notes ?? []).join(" ") || "keine"}

Vorschläge:
${swaps}

Schreibe auf Deutsch in Markdown, höchstens 450 Wörter:
## Kurzbild
Was das Deck gerade braucht und warum diese Richtung sinnvoll ist.
## Die Swaps
Erkläre die wichtigsten Vorschläge einzeln. Was gewinnt das Deck, was verliert es?
## Risiken
Wo kann ein Swap das Deck schwächen? Nenne konkrete Karten und Situationen.
## Reihenfolge
Welche zwei bis drei Swaps zuerst? Was sollte man danach im nächsten Doctor-Lauf prüfen?

Keine Floskeln, keine Wiederholung der Tabelle, kein Marketing.`
}

async function recordAiCost(table: "build_run" | "explain_run", runId: string, sessionID: string | null) {
  try {
    const cost = await babyzillaCost(sessionID)
    if (!cost) return
    db.query(`UPDATE ${table} SET prompt_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cost_usd = ? WHERE id = ?`).run(
      cost.promptTokens,
      cost.outputTokens,
      cost.cacheReadTokens,
      cost.costUsd,
      runId,
    )
  } catch {
    // Telemetrie ist optional; ein fehlendes Babyzilla darf den Lauf nicht kippen.
  }
}

async function runDoctorExplanation(
  runId: string,
  deckId: string,
  proposalHash: string,
  diagnosis: any,
  proposals: any[],
) {
  const update = (status: string, message: string, error?: string, explanationId?: string) =>
    db
      .query("UPDATE explain_run SET status = ?, message = ?, error = ?, explanation_id = COALESCE(?, explanation_id), finished_at = ? WHERE id = ?")
      .run(status, message, error ?? null, explanationId ?? null, status === "done" || status === "error" ? new Date().toISOString() : null, runId)
  try {
    update("running", "Die KI liest Deck und Vorschläge.")
    const deck = loadDeck(deckId)
    if (!deck || !deck.commander) throw new Error("Deck oder Commander nicht gefunden.")
    const prompt = doctorExplanationPrompt(deck, diagnosis, proposals)
    update("running", "DeepSeek erklärt die Swaps.")
    const reply = await callOpencodeDetailed(prompt, 180000)
    const text = reply.text.trim()
    if (!text) throw new Error("Die KI lieferte keine Erklärung.")
    db.query("UPDATE explain_run SET session_id = ? WHERE id = ?").run(reply.sessionID, runId)
    const explanationId = crypto.randomUUID()
    db.query(
      "INSERT INTO deck_explanation(id,deck_id,deck_updated_at,proposal_hash,model,text,created_at) VALUES (?,?,?,?,?,?,?)",
    ).run(explanationId, deckId, deck.updated_at, proposalHash, AI_MODEL, text, new Date().toISOString())
    await recordAiCost("explain_run", runId, reply.sessionID)
    update("done", "Erklärung fertig.", undefined, explanationId)
  } catch (err) {
    update("error", "Erklärung fehlgeschlagen.", err instanceof Error ? err.message : String(err))
  }
}

async function runBuild(deckId: string, runId: string) {
  const isCancelled = () =>
    (db.query("SELECT status FROM build_run WHERE id = ?").get(runId) as any)?.status === "cancelled"
  const update = (status: string, message: string, error?: string) =>
    db.query("UPDATE build_run SET status = ?, message = ?, error = ? WHERE id = ? AND status <> 'cancelled'").run(
      status,
      message,
      error ?? null,
      runId,
    )
  try {
    if (isCancelled()) return
    update("running", "Commander und Kandidaten werden geladen.")
    const deck = loadDeck(deckId)
    if (!deck || !deck.commander) throw new Error("Deck oder Commander nicht gefunden.")
    const commander = deck.commander as any
    if (commander.is_one_win) throw new Error("Der Commander ist eine 1-Win-Karte. 1-Win-Karten sind ausgeschlossen.")
    const basePool = buildPool(commander, deck.settings)
    const visionHits = visionCandidates(deck.brief ?? "", commander, deck.settings)
    const pool = mergeVision(basePool, visionHits)
    if (pool.length < 80) throw new Error(`Zu wenige Kandidaten (${pool.length}). Ist der Scryfall-Import vollständig?`)
    db.query("UPDATE build_run SET candidate_count = ?, card_count = 1 WHERE id = ?").run(pool.length, runId)
    const visionNote = visionHits.length ? `, davon ${visionHits.length} Treffer aus der Deck-Vision` : ""
    update(
      "running",
      `DeepSeek V4.1 Flash prüft ${pool.length} Kandidaten${visionNote}; ${Math.min(pool.length, AI_CANDIDATE_LIMIT)} gehen in den Kontext.`,
    )
    let cards: DeckCard[]
    let primer = ""
    let name = ""
    let provider = "engine"
    let error: string | undefined
    let sessionID: string | null = null
    try {
      if (isCancelled()) return
      const ai = await aiBuild(commander, deck.bracket, deck.pod_size, deck.settings, pool, deck.brief)
      sessionID = ai.sessionID
      if (isCancelled()) {
        await recordAiCost("build_run", runId, sessionID)
        return
      }
      db.query("UPDATE build_run SET session_id = ?, candidate_count = ?, prompt_tokens_estimate = ?, card_count = ? WHERE id = ?").run(
        ai.sessionID,
        ai.candidateCount,
        ai.promptTokensEstimate,
        Math.min(100, ai.deck.cards.length + 1),
        runId,
      )
      update("running", `Deck wird validiert (${ai.candidateCount} Kandidaten im Kontext).`)
      cards = repairBuild(ai.deck.cards, commander, deck.settings, deck.bracket, pool)
      primer = ai.deck.primer
      name = ai.deck.name
      provider = "opencode"
      if (cards.length < 90) throw new Error(`KI lieferte nur ${cards.length} verwertbare Karten.`)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      update("running", "KI nicht verfügbar, die Engine baut deterministisch weiter.")
      cards = deterministicBuild(commander, deck.settings, deck.bracket, pool)
      name = `${commander.name} – ${BRACKETS.find((b) => b.id === deck.bracket)?.name ?? "Deck"}`
      primer = primerFallback(commander, cards, deck.bracket, deck.pod_size)
    }
    cards = tuneToBracket(cards, deck.bracket, pool, deck.settings, commander)
    if (cards.reduce((n, c) => n + c.quantity, 0) !== 99) {
      const fixed = repairBuild(cards.map((c) => ({ name: c.name, role: c.role, reason: c.reason })), commander, deck.settings, deck.bracket, pool)
      cards = fixed
    }
    cards = tuneToBracket(cards, deck.bracket, pool, deck.settings, commander)
    if (isCancelled()) {
      await recordAiCost("build_run", runId, sessionID)
      return
    }
    db.query("UPDATE build_run SET card_count = 100 WHERE id = ? AND status <> 'cancelled'").run(runId)
    saveDeckCards(deckId, cards)
    db.query("UPDATE deck SET name = ?, primer = ?, status = 'ready', updated_at = ? WHERE id = ?").run(
      name || `${commander.name} – Deck`,
      primer || primerFallback(commander, cards, deck.bracket, deck.pod_size),
      new Date().toISOString(),
      deckId,
    )
    if (error) db.query("UPDATE build_run SET error = ? WHERE id = ?").run(error, runId)
    await recordAiCost("build_run", runId, sessionID)
    db.query("UPDATE build_run SET status = 'done', message = ?, provider = ?, model = ?, card_count = 100, finished_at = ? WHERE id = ? AND status <> 'cancelled'").run(
      "Deck fertig.",
      provider,
      provider === "opencode" ? AI_MODEL : "engine",
      new Date().toISOString(),
      runId,
    )
  } catch (err) {
    if (isCancelled()) return
    const message = err instanceof Error ? err.message : String(err)
    db.query("UPDATE build_run SET status = 'error', message = ?, error = ?, finished_at = ? WHERE id = ? AND status <> 'cancelled'").run(
      "Build fehlgeschlagen.",
      message,
      new Date().toISOString(),
      runId,
    )
  }
}

app.use("/api/*", async (c, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
    const origin = c.req.header("origin")
    if (origin) {
      try {
        if (new URL(origin).host !== c.req.header("host")) return c.json({ error: "Ungültige Herkunft." }, 403)
      } catch {
        return c.json({ error: "Ungültige Herkunft." }, 403)
      }
    }
  }
  const path = c.req.path
  const publicAuth =
    path === "/api/auth/status" ||
    path === "/api/auth/me" ||
    path === "/api/auth/profiles" ||
    path === "/api/auth/select" ||
    path.startsWith("/api/auth/invite/") ||
    path === "/api/auth/bootstrap" ||
    path === "/api/auth/register" ||
    path === "/api/auth/login" ||
    path === "/api/auth/logout"
  if (publicAuth) return next()
  const user = currentUser(c)
  if (!user) return c.json({ error: "Bitte anmelden." }, 401)
  c.set("user", user)
  await next()
})

app.use("/api/admin/*", async (c, next) => {
  if (authUser(c).role !== "admin") return c.json({ error: "Nur Admins dürfen das." }, 403)
  await next()
})

app.get("/api/auth/status", (c) => c.json({ initialized: userCount() > 0, user: currentUser(c) }))

app.get("/api/auth/me", (c) => {
  const user = currentUser(c)
  return user ? c.json({ user }) : c.json({ error: "Nicht angemeldet." }, 401)
})

app.get("/api/auth/profiles", (c) => {
  const rows = db
    .query("SELECT id, username, display_name, role, avatar_color FROM users ORDER BY display_name COLLATE NOCASE")
    .all() as any[]
  return c.json(rows.map((row) => publicUser(row)))
})

app.post("/api/auth/select", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as any
  const id = String(body.userId ?? "")
  const row = id ? (db.query("SELECT * FROM users WHERE id = ?").get(id) as any) : null
  if (!row) return c.json({ error: "Profil nicht gefunden." }, 404)
  db.query("UPDATE users SET last_login_at = ? WHERE id = ?").run(new Date().toISOString(), row.id)
  createSession(c, row.id)
  return c.json({ user: publicUser(row) })
})

app.get("/api/auth/invite/:code", (c) => {
  const row = db.query("SELECT * FROM invites WHERE code = ? COLLATE NOCASE").get(c.req.param("code")) as any
  const valid = Boolean(row) && row.uses < row.max_uses && (!row.expires_at || row.expires_at > new Date().toISOString())
  return c.json({ valid, label: row?.label ?? null })
})

app.get("/api/auth/invite/:code/qr.svg", async (c) => {
  const code = c.req.param("code").trim().toUpperCase()
  const row = db.query("SELECT * FROM invites WHERE code = ? COLLATE NOCASE").get(code) as any
  const valid = Boolean(row) && row.uses < row.max_uses && (!row.expires_at || row.expires_at > new Date().toISOString())
  if (!valid) return c.json({ error: "Einladung nicht mehr verfügbar." }, 404)
  const table = (new URL(c.req.url).searchParams.get("table") ?? "").trim().toUpperCase()
  if (table && !loadPod(table)) return c.json({ error: "Tisch nicht gefunden." }, 404)
  const hash = `#invite=${encodeURIComponent(row.code)}${table ? `&table=${encodeURIComponent(table)}` : ""}`
  const url = `${publicBaseUrl(c)}/m${hash}`
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, width: 240, errorCorrectionLevel: "M" })
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
})

app.post("/api/auth/bootstrap", async (c) => {
  if (userCount() > 0) return c.json({ error: "Die Ersteinrichtung ist bereits abgeschlossen." }, 403)
  const body = (await c.req.json()) as any
  const name = displayName(body.displayName, "Sebastian")
  const username = uniqueUsername(name)
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  db.query("INSERT INTO users(id,username,display_name,password_hash,role,avatar_color,created_at) VALUES (?,?,?,?,?,?,?)").run(
    id,
    username,
    name,
    PASSWORDLESS_HASH,
    "admin",
    colorFor(username),
    now,
  )
  db.query("UPDATE deck SET owner_user_id = ? WHERE owner_user_id IS NULL").run(id)
  db.query("UPDATE game SET created_by = ? WHERE created_by IS NULL").run(id)
  const invites = DEFAULT_FRIEND_INVITES.map((label) => createInvite(label, id))
  createSession(c, id)
  return c.json({
    user: publicUser({ id, username, display_name: name, role: "admin", avatar_color: colorFor(username) }),
    invites,
  })
})

app.post("/api/auth/register", async (c) => {
  const body = (await c.req.json()) as any
  const code = String(body.inviteCode ?? "").trim()
  const invite = db.query("SELECT * FROM invites WHERE code = ? COLLATE NOCASE").get(code) as any
  const now = new Date().toISOString()
  if (!invite) return c.json({ error: "Einladungscode nicht gefunden." }, 400)
  if (invite.uses >= invite.max_uses) return c.json({ error: "Dieser Einladungscode ist schon benutzt." }, 400)
  if (invite.expires_at && invite.expires_at <= now) return c.json({ error: "Dieser Einladungscode ist abgelaufen." }, 400)
  const name = displayName(body.displayName, invite.label || "Spieler")
  const username = uniqueUsername(name)
  const id = crypto.randomUUID()
  db.query("INSERT INTO users(id,username,display_name,password_hash,role,avatar_color,created_at) VALUES (?,?,?,?,?,?,?)").run(
    id,
    username,
    name,
    PASSWORDLESS_HASH,
    "member",
    colorFor(username),
    now,
  )
  db.query("UPDATE invites SET uses = uses + 1 WHERE id = ?").run(invite.id)
  createSession(c, id)
  return c.json({ user: publicUser({ id, username, display_name: name, role: "member", avatar_color: colorFor(username) }) })
})

app.post("/api/auth/login", async (c) => {
  const body = (await c.req.json()) as any
  const username = normalizeUsername(body.username)
  const key = `${c.req.header("x-forwarded-for") ?? "local"}:${username}`
  if (!loginAllowed(key)) return c.json({ error: "Zu viele Login-Versuche. Bitte in 15 Minuten erneut." }, 429)
  const row = db.query("SELECT * FROM users WHERE username = ?").get(username) as any
  const password = String(body.password ?? "")
  const ok = row && row.password_hash !== PASSWORDLESS_HASH
    ? await Bun.password.verify(password, row.password_hash).catch(() => false)
    : false
  if (!ok) return c.json({ error: "Benutzername oder Passwort falsch." }, 401)
  loginAttempts.delete(key)
  db.query("UPDATE users SET last_login_at = ? WHERE id = ?").run(new Date().toISOString(), row.id)
  createSession(c, row.id)
  return c.json({ user: publicUser(row) })
})

app.post("/api/auth/logout", (c) => {
  clearSession(c)
  return c.json({ ok: true })
})

app.patch("/api/auth/profile", async (c) => {
  const user = authUser(c)
  const body = (await c.req.json()) as any
  const name = displayName(body.displayName, user.display_name)
  const requestedColor = String(body.avatarColor ?? "")
  const color = /^#[0-9a-f]{6}$/i.test(requestedColor) ? requestedColor : user.avatar_color
  db.query("UPDATE users SET display_name = ?, avatar_color = ? WHERE id = ?").run(name, color, user.id)
  return c.json({ user: { ...user, display_name: name, avatar_color: color } })
})

app.post("/api/auth/password", async (c) => {
  const user = authUser(c)
  const body = (await c.req.json()) as any
  const row = db.query("SELECT password_hash FROM users WHERE id = ?").get(user.id) as any
  if (!row || row.password_hash === PASSWORDLESS_HASH) {
    return c.json({ error: "Für dieses Profil ist kein Passwort gesetzt." }, 400)
  }
  const ok = await Bun.password.verify(String(body.currentPassword ?? ""), row.password_hash).catch(() => false)
  if (!ok) return c.json({ error: "Das aktuelle Passwort ist falsch." }, 400)
  const next = validPassword(body.newPassword)
  if (!next) return c.json({ error: "Das neue Passwort braucht mindestens 8 Zeichen." }, 400)
  db.query("UPDATE users SET password_hash = ? WHERE id = ?").run(
    await Bun.password.hash(next, { algorithm: "argon2id" }),
    user.id,
  )
  const token = getCookie(c, SESSION_COOKIE)
  if (token) db.query("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?").run(user.id, sha256(token))
  return c.json({ ok: true })
})

app.get("/api/users", (c) => {
  const rows = db
    .query("SELECT id, username, display_name, role, avatar_color, created_at, last_login_at FROM users ORDER BY display_name COLLATE NOCASE")
    .all() as any[]
  return c.json(rows)
})

app.get("/api/admin/invites", (c) => {
  const rows = db
    .query(
      `SELECT i.*, u.display_name AS created_by_name
       FROM invites i LEFT JOIN users u ON u.id = i.created_by
       ORDER BY i.created_at DESC`,
    )
    .all() as any[]
  const now = new Date().toISOString()
  return c.json(
    rows.map((row) => ({
      ...row,
      valid: row.uses < row.max_uses && (!row.expires_at || row.expires_at > now),
    })),
  )
})

app.post("/api/admin/invites", async (c) => {
  const body = (await c.req.json()) as any
  const label = displayName(body.label, "Einladung")
  const maxUses = Math.max(1, Math.min(100, Number(body.maxUses) || 1))
  const days = Math.max(0, Math.min(365, Number(body.expiresInDays ?? 30)))
  return c.json(createInvite(label, authUser(c).id, maxUses, days))
})

app.delete("/api/admin/invites/:id", (c) => {
  db.query("DELETE FROM invites WHERE id = ?").run(c.req.param("id"))
  return c.json({ ok: true })
})

app.get("/api/admin/users", (c) => {
  const rows = db
    .query("SELECT id, username, display_name, role, avatar_color, created_at, last_login_at FROM users ORDER BY created_at")
    .all()
  return c.json(rows)
})

app.get("/api/meta", (c) => {
  const counts = db
    .query(
      "SELECT (SELECT COUNT(*) FROM card) AS cards, (SELECT COUNT(*) FROM card_tag) AS tags, (SELECT COUNT(*) FROM cr_rule) AS rules, (SELECT COUNT(*) FROM ruling) AS rulings, (SELECT COUNT(*) FROM deck WHERE saved_at IS NOT NULL) AS decks, (SELECT COUNT(*) FROM game) AS games",
    )
    .get() as any
  return c.json({
    model: AI_MODEL,
    brackets: BRACKETS,
    settings: DEFAULT_SETTINGS,
    settingLabels: SETTING_LABELS,
    counts,
    crVersion: (db.query("SELECT version FROM cr_version ORDER BY imported_at DESC LIMIT 1").get() as any)?.version ?? null,
    network: networkInfo(),
  })
})

app.get("/api/network", (c) => c.json(networkInfo()))

app.get("/api/mobile/qr.svg", async (c) => {
  const requested = (c.req.query("url") ?? "").trim().slice(0, 2048)
  const target = /^https?:\/\//i.test(requested) ? requested : `${publicBaseUrl(c)}/m`
  const svg = await QRCode.toString(target, { type: "svg", margin: 1, width: 240, errorCorrectionLevel: "M" })
  return c.body(svg, 200, {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": "no-store",
  })
})

function cardSearchPayload(hit: SearchHit) {
  const card = hit.card
  return {
    oracle_id: card.oracle_id,
    name: card.name,
    mana_cost: card.mana_cost,
    type_line: card.type_line,
    color_identity: card.color_identity,
    image_uris: card.image_uris,
    legalities: card.legalities,
    is_game_changer: card.is_game_changer,
    is_one_win: card.is_one_win,
    edhrec_rank: card.edhrec_rank,
    matched: hit.match,
  }
}

function searchOptionsFrom(c: Context<AppEnv>, limit: number): SearchOptions {
  const colorRaw = c.req.query("color")
  const colorIdentity =
    colorRaw === undefined ? undefined : [...new Set((colorRaw.toUpperCase().match(/[WUBRG]/g) ?? []) as string[])]
  const modeRaw = c.req.query("mode") ?? "auto"
  const mode: SearchMode = modeRaw === "name" || modeRaw === "effect" ? modeRaw : "auto"
  return {
    mode,
    limit,
    colorIdentity,
    commanderLegal: c.req.query("legal") === "1",
  }
}

app.get("/api/cards/search", (c) => {
  const q = (c.req.query("q") ?? "").trim()
  const limit = Math.min(30, Math.max(1, Number(c.req.query("limit") ?? 16)))
  const opts = searchOptionsFrom(c, limit)
  if (!q) {
    const rows = db
      .query(
        "SELECT * FROM card WHERE is_legendary = 1 AND is_creature = 1 ORDER BY edhrec_rank IS NULL, edhrec_rank LIMIT ?",
      )
      .all(limit) as any[]
    return c.json(
      rows.map((r) => ({
        oracle_id: r.oracle_id,
        name: r.name,
        mana_cost: r.mana_cost,
        type_line: r.type_line,
        color_identity: JSON.parse(r.color_identity ?? "[]"),
        image_uris: r.image_uris ? JSON.parse(r.image_uris) : null,
        legalities: JSON.parse(r.legalities ?? "{}"),
        is_game_changer: Boolean(r.is_game_changer),
        is_one_win: Boolean(r.is_one_win),
        edhrec_rank: r.edhrec_rank,
        matched: null,
      })),
    )
  }
  return c.json(searchCards(q, opts).map(cardSearchPayload))
})

app.post("/api/cards/interpret", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as any
  const q = String(body.q ?? "").trim().slice(0, 300)
  if (q.length < 3) return c.json({ error: "Die Anfrage ist zu kurz." }, 400)

  const colorIdentity = Array.isArray(body.colorIdentity)
    ? [...new Set((body.colorIdentity as unknown[]).map((v) => String(v).toUpperCase()).filter((v) => /^[WUBRG]$/.test(v)))]
    : undefined
  const opts: SearchOptions = {
    colorIdentity,
    commanderLegal: Boolean(body.commanderLegal),
    limit: Math.min(30, Math.max(1, Number(body.limit ?? 18))),
  }
  const key = createHash("sha1")
    .update(JSON.stringify([q.toLowerCase(), colorIdentity ?? null, Boolean(opts.commanderLegal)]))
    .digest("hex")

  const cached = db.query("SELECT result_json FROM card_query_cache WHERE key = ?").get(key) as any
  if (cached) {
    try {
      const spec = JSON.parse(cached.result_json)
      return c.json({ interpreted: true, cached: true, spec, results: searchStructured(spec, opts).map(cardSearchPayload) })
    } catch {
      // kaputter Cache-Eintrag: neu interpretieren
    }
  }

  try {
    const spec = await interpretCardQuery(q)
    db.query(
      "INSERT INTO card_query_cache(key, result_json, created_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET result_json = excluded.result_json, created_at = excluded.created_at",
    ).run(key, JSON.stringify(spec), new Date().toISOString())
    db.query("DELETE FROM card_query_cache WHERE created_at < ?").run(new Date(Date.now() - 60 * 864e5).toISOString())
    return c.json({ interpreted: true, cached: false, spec, results: searchStructured(spec, opts).map(cardSearchPayload) })
  } catch (error) {
    return c.json({
      interpreted: false,
      spec: null,
      error: error instanceof Error ? error.message : String(error),
      results: searchCards(q, { ...opts, mode: "effect" }).map(cardSearchPayload),
    })
  }
})

app.post("/api/commanders/suggest", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as any
  const brief = deckBrief(body.brief)
  if (brief.length < 8) {
    return c.json({ error: "Schreib zuerst eine Deck-Vision mit ein paar Sätzen." }, 400)
  }
  const bracket = ([3, 4, 5].includes(Number(body.bracket)) ? Number(body.bracket) : 4) as BracketId
  const podSize = Math.max(3, Math.min(5, Number(body.podSize ?? 5)))
  const settings = cleanSettings(body.settings)
  const candidates = commanderCandidates(brief)
  if (candidates.length === 0) return c.json({ error: "Keine Commander-Kandidaten gefunden." }, 500)

  try {
    const result = await aiSuggestCommanders(brief, bracket, podSize, settings, candidates)
    const suggestions = mapAiCommanderSuggestions(candidates, result.suggestions)
    if (suggestions.length === 0) throw new Error("Die KI hat keinen gültigen Commander aus der Liste gewählt.")
    if (suggestions.length < 3) {
      const seen = new Set(suggestions.map((suggestion) => suggestion.oracle_id))
      for (const fallback of fallbackCommanderSuggestions(brief, candidates)) {
        if (suggestions.length >= 3) break
        if (seen.has(fallback.oracle_id)) continue
        suggestions.push(fallback)
      }
    }
    return c.json({ suggestions, provider: "opencode", note: null })
  } catch (error) {
    console.error("Commander suggestion failed:", error)
    const suggestions = fallbackCommanderSuggestions(brief, candidates)
    if (suggestions.length === 0) return c.json({ error: "Keine Commander-Kandidaten gefunden." }, 500)
    return c.json({
      suggestions,
      provider: "engine",
      note: "KI-Vorschlag war nicht verfügbar. Die Vorschläge sind nach Karten-Tags und EDHREC sortiert.",
    })
  }
})

app.get("/api/cards/:oracleId", (c) => {
  const card = cardById(c.req.param("oracleId"))
  if (!card) return c.json({ error: "Karte nicht gefunden." }, 404)
  const tags = [...(tagsFor([card.oracle_id]).get(card.oracle_id) ?? [])].sort()
  const rulings = db.query("SELECT source, published_at, comment FROM ruling WHERE oracle_id = ? ORDER BY published_at DESC LIMIT 8").all(card.oracle_id)
  return c.json({ card, tags, rulings })
})

app.get("/api/cards/:oracleId/german", async (c) => {
  const card = cardById(c.req.param("oracleId"))
  if (!card) return c.json({ error: "Karte nicht gefunden." }, 404)
  try {
    return c.json({ german: await getGermanCardText(card.oracle_id) })
  } catch (err) {
    return c.json({ german: null, error: err instanceof Error ? err.message : "Deutscher Kartentext nicht erreichbar." })
  }
})

app.get("/api/cards/:oracleId/printings", async (c) => {
  const card = cardById(c.req.param("oracleId"))
  if (!card) return c.json({ error: "Karte nicht gefunden." }, 404)
  try {
    const printings = await getPrintings(card.name)
    return c.json({
      printings: printings.map((p) => ({
        source: "scryfall",
        id: p.id,
        name: p.name,
        imageUrl: scryfallArt(p),
        thumbnailUrl: scryfallCrop(p),
        artist: p.artist,
        setCode: p.set,
        setName: p.set_name,
        collectorNumber: p.collector_number,
        lang: p.lang,
        note: [p.frame, p.border_color, p.full_art ? "full art" : null].filter(Boolean).join(", "),
      })),
    })
  } catch (err) {
    return c.json({ printings: [], error: String(err) })
  }
})

app.get("/api/cards/:oracleId/mpcfill", async (c) => {
  const card = cardById(c.req.param("oracleId"))
  if (!card) return c.json({ error: "Karte nicht gefunden." }, 404)
  try {
    const arts = await getMpcFillArt(card.name)
    return c.json({ arts })
  } catch (err) {
    return c.json({ arts: [], error: String(err) })
  }
})

app.get("/api/cards/:oracleId/rulings", async (c) => {
  const card = cardById(c.req.param("oracleId"))
  if (!card) return c.json({ error: "Karte nicht gefunden." }, 404)
  const local = db.query("SELECT source, published_at, comment FROM ruling WHERE oracle_id = ?").all(card.oracle_id)
  if (local.length) return c.json({ rulings: local })
  try {
    return c.json({ rulings: await getRulings(card.oracle_id) })
  } catch {
    return c.json({ rulings: [] })
  }
})

app.get("/api/art/image", async (c) => {
  const raw = c.req.query("url")
  if (!raw) return c.json({ error: "url fehlt" }, 400)
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return c.json({ error: "ungültige url" }, 400)
  }
  const allowed = ["cards.scryfall.io", "drive.google.com", "lh3.googleusercontent.com"]
  if (!allowed.includes(parsed.hostname)) return c.json({ error: "Host nicht erlaubt" }, 403)
  const res = await fetch(parsed.toString(), { headers: { "User-Agent": "Kommandozentrale/0.1" } })
  if (!res.ok) return c.json({ error: `Bild ${res.status}` }, 502)
  const buf = await res.arrayBuffer()
  return new Response(buf, {
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
      "Cache-Control": "public, max-age=604800",
    },
  })
})

app.get("/api/rules/search", (c) => {
  const q = (c.req.query("q") ?? "").trim()
  if (!q) {
    const format = db.query("SELECT * FROM format_rule ORDER BY sort LIMIT 40").all()
    return c.json({ format, cr: [] })
  }
  const format = db
    .query("SELECT * FROM format_rule WHERE title LIKE ? COLLATE NOCASE OR body LIKE ? COLLATE NOCASE ORDER BY sort LIMIT 12")
    .all(`%${q}%`, `%${q}%`)
  let cr: any[] = []
  const number = q.match(/^\d{3}(?:\.\d+)?[a-z]?$/)
  if (number) {
    cr = db.query("SELECT number, text FROM cr_rule WHERE number = ? LIMIT 10").all(q) as any[]
  } else {
    const safe = q.replace(/["*]/g, " ").trim()
    if (safe) {
      try {
        cr = db.query("SELECT number, text FROM cr_fts WHERE cr_fts MATCH ? ORDER BY rank LIMIT 12").all(`${safe}*`) as any[]
      } catch {
        cr = db.query("SELECT number, text FROM cr_rule WHERE text LIKE ? LIMIT 12").all(`%${q}%`) as any[]
      }
    }
  }
  return c.json({ format, cr })
})

app.get("/api/rules/:number", (c) => {
  const number = c.req.param("number")
  const rule = db.query("SELECT * FROM cr_rule WHERE number = ? LIMIT 1").get(number) as any
  if (!rule) return c.json({ error: "Regel nicht gefunden." }, 404)
  const parent = rule.parent ? db.query("SELECT * FROM cr_rule WHERE number = ? LIMIT 1").get(rule.parent) : null
  const children = db.query("SELECT * FROM cr_rule WHERE parent = ? ORDER BY number LIMIT 40").all(number)
  return c.json({ rule, parent, children })
})

app.get("/api/babyzilla", async (c) => {
  const stats = await babyzillaStats()
  const appUsage = db
    .query(
      `SELECT COUNT(*) AS calls,
              COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
              COALESCE(SUM(cost_usd), 0) AS cost_usd
       FROM (
         SELECT prompt_tokens, output_tokens, cache_read_tokens, cost_usd
         FROM build_run WHERE session_id IS NOT NULL
         UNION ALL
         SELECT prompt_tokens, output_tokens, cache_read_tokens, cost_usd
         FROM explain_run WHERE session_id IS NOT NULL
       )`,
    )
    .get() as any
  return c.json({
    available: Boolean(stats),
    stats,
    app: {
      calls: Number(appUsage?.calls ?? 0),
      promptTokens: Number(appUsage?.prompt_tokens ?? 0),
      outputTokens: Number(appUsage?.output_tokens ?? 0),
      cacheReadTokens: Number(appUsage?.cache_read_tokens ?? 0),
      costUsd: Number(appUsage?.cost_usd ?? 0),
    },
  })
})

app.get("/api/decks", (c) => {
  const rows = db
    .query(
      `SELECT d.*, u.display_name AS owner_name, u.avatar_color AS owner_color,
              (SELECT COALESCE(SUM(quantity),0) FROM deck_card dc WHERE dc.deck_id = d.id AND dc.board = 'main') + 1 AS card_count
       FROM deck d LEFT JOIN users u ON u.id = d.owner_user_id
       WHERE d.saved_at IS NOT NULL
       ORDER BY d.updated_at DESC`,
    )
    .all() as any[]
  return c.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      commander_name: r.commander_name,
      commander_oracle_id: r.commander_oracle_id,
      bracket: r.bracket,
      pod_size: r.pod_size,
      status: r.status,
      card_count: r.card_count,
      saved_at: r.saved_at ?? null,
      updated_at: r.updated_at,
      owner_user_id: r.owner_user_id ?? null,
      owner_name: r.owner_name ?? null,
      owner_color: r.owner_color ?? null,
      visibility: r.visibility ?? "group",
    })),
  )
})

app.post("/api/decks", async (c) => {
  const body = (await c.req.json()) as any
  const commander = body.commanderName ? cardByName(String(body.commanderName)) : null
  if (!commander) return c.json({ error: "Commander nicht gefunden." }, 400)
  if (commander.is_one_win) return c.json({ error: "Der Commander ist eine 1-Win-Karte. 1-Win-Karten sind in dieser Runde ausgeschlossen." }, 400)
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const bracket = ([3, 4, 5].includes(Number(body.bracket)) ? Number(body.bracket) : 4) as BracketId
  const settings = cleanSettings(body.settings)
  const brief = deckBrief(body.brief)
  db.query(
    "INSERT INTO deck(id,name,commander_oracle_id,commander_name,bracket,pod_size,settings_json,brief,primer,status,created_at,updated_at,owner_user_id,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    body.name || `${commander.name} – Entwurf`,
    commander.oracle_id,
    commander.name,
    bracket,
    Number(body.podSize ?? 4),
    JSON.stringify(settings),
    brief,
    null,
    "draft",
    now,
    now,
    authUser(c).id,
    "group",
  )
  return c.json(loadDeck(id))
})

app.post("/api/decks/import", async (c) => {
  const body = (await c.req.json()) as any
  const list = String(body.list ?? "")
  if (!list.trim()) return c.json({ error: "Die Deckliste ist leer." }, 400)

  const parsed = parseDeckList(list)
  if (parsed.entries.length === 0) return c.json({ error: "Keine Kartenzeilen erkannt. Unterstützt werden Zeilen wie „1 Sol Ring“ oder „1x Sol Ring“." }, 400)

  const bracket = ([3, 4, 5].includes(Number(body.bracket)) ? Number(body.bracket) : 4) as BracketId
  const pod = Math.max(3, Math.min(5, Number(body.podSize ?? 5)))
  const settings = cleanSettings(body.settings)
  const notes: string[] = []
  const unknown: string[] = []
  const skipped: Array<{ name: string; reason: string }> = []

  let commander: Card | null = body.commanderName ? cardByNameExact(String(body.commanderName)) : null
  if (body.commanderName && !commander) return c.json({ error: `Commander nicht gefunden: ${body.commanderName}` }, 400)
  if (!commander && parsed.commanderName) {
    commander = cardByNameExact(parsed.commanderName)
    if (!commander) return c.json({ error: `Commander aus der Liste nicht gefunden: ${parsed.commanderName}` }, 400)
    notes.push(`Commander aus dem Commander-Abschnitt erkannt: ${commander.name}.`)
  }

  const resolved: Array<{ entry: ParsedEntry; card: Card }> = []
  for (const entry of parsed.entries) {
    if (isSkippedSection(entry.section)) {
      skipped.push({ name: entry.name, reason: `Abschnitt ${entry.section}` })
      continue
    }
    const card = cardByNameExact(entry.name)
    if (!card) {
      if (!unknown.includes(entry.name)) unknown.push(entry.name)
      continue
    }
    resolved.push({ entry, card })
  }

  if (!commander) {
    const candidates = resolved.filter(({ card }) => card.is_legendary && (card.is_creature || /can be your commander/i.test(card.oracle_text_all ?? "")))
    const preferred = candidates.find(({ entry }) => entry.section === "commander")
    const picked = preferred ?? candidates[0]
    if (picked) {
      commander = picked.card
      notes.push(`Commander automatisch erkannt: ${commander.name}.`)
      if (candidates.length > 1) notes.push(`Mehrere Commander-Kandidaten gefunden; ${commander.name} wurde genommen. Partner-Decks bitte mit explizitem Commander importieren.`)
    }
  }

  if (!commander) return c.json({ error: "Kein Commander erkannt. Bitte einen Commander angeben.", unknown }, 400)
  const cmd = commander
  if (cmd.is_one_win) return c.json({ error: "Der Commander ist eine 1-Win-Karte. 1-Win-Karten sind in dieser Runde ausgeschlossen." }, 400)
  if (!settings.allowBanned && cmd.legalities.commander === "banned") notes.push("Der Commander steht auf der Banlist; mit 0 Rule ist das nur ein Hinweis.")
  if (!settings.allowIllegal && cmd.legalities.commander !== "legal") notes.push("Der Commander ist nicht offiziell Commander-legal; mit 0 Rule ist das nur ein Hinweis.")

  const tagMap = tagsFor(resolved.map(({ card }) => card.oracle_id))
  const byOracle = new Map<string, DeckCard>()
  for (const { entry, card } of resolved) {
    if (card.oracle_id === cmd.oracle_id) continue
    if (card.is_one_win) {
      skipped.push({ name: card.name, reason: "1-Win-Karte" })
      continue
    }
    if (!settings.allowBanned && card.legalities.commander === "banned") {
      skipped.push({ name: card.name, reason: "gebannt" })
      continue
    }
    if (!settings.allowIllegal && card.legalities.commander !== "legal") {
      skipped.push({ name: card.name, reason: "nicht offiziell legal" })
      continue
    }
    if (!fitsColorIdentity(card, cmd)) {
      skipped.push({ name: card.name, reason: "Farbidentität" })
      continue
    }
    const tags = tagMap.get(card.oracle_id) ?? []
    const role = roleFor(card, tags)
    const existing = byOracle.get(card.oracle_id)
    if (existing) {
      existing.quantity += entry.quantity
      notes.push(`Mehrfach in der Liste: ${card.name}, Mengen wurden addiert.`)
      continue
    }
    byOracle.set(card.oracle_id, {
      ...card,
      role,
      category: role,
      reason: "Importiert aus Deckliste.",
      printing_id: null,
      art_url: null,
      artist: null,
      quantity: entry.quantity,
      is_commander: false,
      tags,
    })
  }

  const cards = [...byOracle.values()]
  if (cards.length === 0) {
    return c.json({ error: "Keine Karten erkannt. Prüfe die Namen oder den Commander.", report: { unknown, skipped, notes } }, 400)
  }

  const total = cards.reduce((sum, card) => sum + card.quantity, 0) + 1
  if (total > 100) notes.push(`Das Deck hat ${total} Karten. Es wurde nichts automatisch geschnitten; die Analyse zeigt die Überzahl.`)
  if (total < 100) notes.push(`Das Deck hat ${total} Karten. Es fehlen ${100 - total} Karten bis zur vollen Deckgröße.`)
  if (unknown.length === 1) notes.push("1 Kartenname konnte nicht aufgelöst werden und wurde übersprungen.")
  if (unknown.length > 1) notes.push(`${unknown.length} Kartennamen konnten nicht aufgelöst werden und wurden übersprungen.`)
  if (skipped.length === 1) notes.push("1 Eintrag wurde nach den aktuellen Hausregeln übersprungen.")
  if (skipped.length > 1) notes.push(`${skipped.length} Einträge wurden nach den aktuellen Hausregeln übersprungen.`)

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const name = String(body.name ?? "").trim() || `${cmd.name} – Import`
  const primer = `> Importiert am ${new Date().toLocaleDateString("de-DE")}. Der Primer ist ein Startpunkt; mit „Neu bauen“ übernimmt der Agent.\n\n${primerFallback(cmd, cards, bracket, pod)}`
  const status = total === 100 ? "ready" : "draft"
  db.query(
    "INSERT INTO deck(id,name,commander_oracle_id,commander_name,bracket,pod_size,settings_json,primer,status,created_at,updated_at,owner_user_id,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(id, name, cmd.oracle_id, cmd.name, bracket, pod, JSON.stringify(settings), primer, status, now, now, authUser(c).id, "group")
  saveDeckCards(id, cards)
  const deck = loadDeck(id)
  return c.json({
    deck,
    report: {
      total,
      imported: total - 1,
      commander: cmd.name,
      unknown,
      skipped,
      notes,
    },
  })
})

app.get("/api/decks/:id/combos", async (c) => {
  const deck = loadDeck(c.req.param("id"))
  if (!deck || !deck.commander) return c.json({ error: "Deck nicht gefunden." }, 404)
  const cached = db
    .query("SELECT payload_json, fetched_at FROM combo_cache WHERE deck_id = ? AND deck_updated_at = ?")
    .get(deck.id, deck.updated_at) as any
  if (cached && c.req.query("refresh") !== "1") {
    try {
      return c.json({ ...JSON.parse(cached.payload_json), cached: true })
    } catch {
      // fall through to a fresh lookup
    }
  }
  try {
    const lookup = await findCombos(
      deck.commander.name,
      deck.cards.map((card) => card.name),
    )
    const payload = {
      ...lookup,
      source: "Commander Spellbook",
      sourceUrl: "https://commanderspellbook.com/find-my-combos/",
      cached: false,
    }
    db.query(
      "INSERT INTO combo_cache(deck_id,deck_updated_at,payload_json,fetched_at) VALUES (?,?,?,?) ON CONFLICT(deck_id,deck_updated_at) DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at",
    ).run(deck.id, deck.updated_at, JSON.stringify(payload), lookup.fetchedAt)
    return c.json(payload)
  } catch (err) {
    if (cached) {
      try {
        return c.json({
          ...JSON.parse(cached.payload_json),
          cached: true,
          warning: "Commander Spellbook ist gerade nicht erreichbar. Angezeigt wird der letzte Stand.",
        })
      } catch {
        // fall through
      }
    }
    return c.json(
      { error: err instanceof Error ? err.message : "Commander Spellbook ist nicht erreichbar." },
      502,
    )
  }
})

app.post("/api/combos/translate", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as any
  const raw = Array.isArray(body?.items) ? body.items.slice(0, 30) : []
  const seen = new Set<string>()
  const items: ComboTextInput[] = []
  for (const entry of raw) {
    const id = String(entry?.id ?? "").trim().slice(0, 80)
    const description = String(entry?.description ?? "").trim().slice(0, 2400)
    if (!id || !description || seen.has(id)) continue
    seen.add(id)
    items.push({
      id,
      description,
      produces: Array.isArray(entry?.produces) ? entry.produces.map((value: unknown) => String(value).slice(0, 240)).slice(0, 20) : [],
      easyPrerequisites: String(entry?.easyPrerequisites ?? "").trim().slice(0, 1200),
      notablePrerequisites: String(entry?.notablePrerequisites ?? "").trim().slice(0, 1200),
      cardNames: Array.isArray(entry?.cardNames) ? entry.cardNames.map((value: unknown) => String(value).slice(0, 120)).slice(0, 30) : [],
    })
  }

  const translations: Record<string, any> = {}
  const missing: ComboTextInput[] = []
  for (const item of items) {
    const row = db.query("SELECT payload_json FROM combo_translation WHERE variant_id = ?").get(item.id) as any
    if (row) {
      try {
        translations[item.id] = JSON.parse(row.payload_json)
        continue
      } catch {
        // fall through and retranslate
      }
    }
    missing.push(item)
  }

  let error: string | null = null
  if (missing.length > 0) {
    try {
      const fresh = await translateComboTexts(missing)
      const insert = db.prepare(
        "INSERT INTO combo_translation(variant_id,payload_json,fetched_at) VALUES (?,?,?) ON CONFLICT(variant_id) DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at",
      )
      for (const translation of fresh) {
        translations[translation.id] = translation
        insert.run(translation.id, JSON.stringify(translation), new Date().toISOString())
      }
    } catch (err) {
      console.error("Combo translation failed:", err)
      error = "Die lokale Übersetzung ist gerade nicht verfügbar."
    }
  }

  return c.json({ translations, error })
})

app.get("/api/decks/:id", (c) => {
  const deck = loadDeck(c.req.param("id"))
  return deck ? c.json(deck) : c.json({ error: "Deck nicht gefunden." }, 404)
})

app.post("/api/decks/:id/save", async (c) => {
  const id = c.req.param("id")
  const row = db.query("SELECT * FROM deck WHERE id = ?").get(id) as any
  if (!row) return c.json({ error: "Deck nicht gefunden." }, 404)
  if (!canEditDeck(c, id)) return c.json({ error: "Nur der Besitzer darf dieses Deck speichern." }, 403)
  const body = (await c.req.json().catch(() => ({}))) as any
  const user = authUser(c)
  const ownerId = String(body.ownerUserId ?? row.owner_user_id ?? user.id).trim()
  if (!ownerId) return c.json({ error: "Bitte ein Profil wählen." }, 400)
  if (ownerId !== user.id && user.role !== "admin") {
    return c.json({ error: "Nur Admins dürfen ein Deck einem anderen Profil zuordnen." }, 403)
  }
  const owner = db.query("SELECT id FROM users WHERE id = ?").get(ownerId)
  if (!owner) return c.json({ error: "Profil nicht gefunden." }, 400)
  const name = String(body.name ?? row.name).replace(/\u0000/g, "").trim().slice(0, 120) || row.name
  const now = new Date().toISOString()
  db.query("UPDATE deck SET name = ?, owner_user_id = ?, saved_at = COALESCE(saved_at, ?), updated_at = ? WHERE id = ?").run(
    name,
    ownerId,
    now,
    now,
    id,
  )
  return c.json(loadDeck(id))
})

app.post("/api/decks/:id/copy", (c) => {
  const id = c.req.param("id")
  const source = db.query("SELECT * FROM deck WHERE id = ?").get(id) as any
  if (!source) return c.json({ error: "Deck nicht gefunden." }, 404)
  const sourceCommander = db.query("SELECT is_one_win, color_identity FROM card WHERE oracle_id = ?").get(source.commander_oracle_id) as any
  if (sourceCommander?.is_one_win) return c.json({ error: "Der Commander ist eine 1-Win-Karte. 1-Win-Karten sind in dieser Runde ausgeschlossen." }, 400)
  const sourceIdentity: string[] = JSON.parse(sourceCommander?.color_identity ?? "[]")
  const identityFilter =
    sourceIdentity.length > 0
      ? `AND NOT EXISTS (SELECT 1 FROM json_each(c.color_identity) WHERE value NOT IN (${sourceIdentity.map(() => "?").join(",")}))`
      : "AND json_array_length(c.color_identity) = 0"
  const copyId = crypto.randomUUID()
  const now = new Date().toISOString()
  db.query(
    `INSERT INTO deck(id,name,commander_oracle_id,commander_name,commander_printing_id,commander_art_url,commander_artist,bracket,pod_size,settings_json,brief,primer,status,saved_at,created_at,updated_at,owner_user_id,visibility)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    copyId,
    `${source.name} – Kopie`,
    source.commander_oracle_id,
    source.commander_name,
    source.commander_printing_id ?? null,
    source.commander_art_url ?? null,
    source.commander_artist ?? null,
    source.bracket,
    source.pod_size,
    JSON.stringify(settingsFor(source)),
    source.brief ?? "",
    source.primer,
    source.status,
    now,
    now,
    now,
    authUser(c).id,
    "group",
  )
  db.query(
    `INSERT INTO deck_card(deck_id,oracle_id,quantity,category,role,reason,printing_id,art_url,artist,sort_order,is_commander,board)
     SELECT ?, dc.oracle_id, dc.quantity, dc.category, dc.role, dc.reason, dc.printing_id, dc.art_url, dc.artist, dc.sort_order, 0, dc.board
     FROM deck_card dc
     JOIN card c ON c.oracle_id = dc.oracle_id
     WHERE dc.deck_id = ? AND c.is_one_win = 0 ${identityFilter}`,
  ).run(copyId, id, ...sourceIdentity)
  return c.json(loadDeck(copyId))
})

app.patch("/api/decks/:id", async (c) => {
  const id = c.req.param("id")
  const existing = db.query("SELECT * FROM deck WHERE id = ?").get(id) as any
  if (!existing) return c.json({ error: "Deck nicht gefunden." }, 404)
  if (!canEditDeck(c, id)) return c.json({ error: "Nur der Besitzer darf dieses Deck ändern." }, 403)
  const body = (await c.req.json()) as any
  const settings = cleanSettings({ ...settingsFor(existing), ...(body.settings ?? {}) })
  const brief = body.brief === undefined ? (existing.brief ?? "") : deckBrief(body.brief)
  db.query("UPDATE deck SET name = ?, bracket = ?, pod_size = ?, settings_json = ?, brief = ?, primer = ?, updated_at = ? WHERE id = ?").run(
    body.name ?? existing.name,
    body.bracket ?? existing.bracket,
    body.podSize ?? existing.pod_size,
    JSON.stringify(settings),
    brief,
    body.primer ?? existing.primer,
    new Date().toISOString(),
    id,
  )
  return c.json(loadDeck(id))
})

app.delete("/api/decks/:id", (c) => {
  const id = c.req.param("id")
  const existing = db.query("SELECT 1 FROM deck WHERE id = ?").get(id)
  if (!existing) return c.json({ error: "Deck nicht gefunden." }, 404)
  if (!canEditDeck(c, id)) return c.json({ error: "Nur der Besitzer darf dieses Deck löschen." }, 403)
  db.query("DELETE FROM deck WHERE id = ?").run(id)
  return c.json({ ok: true })
})

app.post("/api/decks/:id/build", async (c) => {
  const id = c.req.param("id")
  const deck = db.query("SELECT * FROM deck WHERE id = ?").get(id) as any
  if (!deck) return c.json({ error: "Deck nicht gefunden." }, 404)
  if (!canEditDeck(c, id)) return c.json({ error: "Nur der Besitzer darf dieses Deck bauen." }, 403)
  const commander = db.query("SELECT is_one_win FROM card WHERE oracle_id = ?").get(deck.commander_oracle_id) as any
  if (commander?.is_one_win) return c.json({ error: "Der Commander ist eine 1-Win-Karte. 1-Win-Karten sind in dieser Runde ausgeschlossen." }, 400)
  const body = (await c.req.json().catch(() => ({}))) as any
  const brief = body.brief === undefined ? (deck.brief ?? "") : deckBrief(body.brief)
  if (body.brief !== undefined || String(deck.brief ?? "") !== brief) {
    db.query("UPDATE deck SET brief = ?, updated_at = ? WHERE id = ?").run(brief, new Date().toISOString(), id)
  }
  snapshotDeck(id, "Vor dem Bau")
  const runId = crypto.randomUUID()
  db.query("INSERT INTO build_run(id,deck_id,provider,model,status,message,started_at) VALUES (?,?,?,?,?,?,?)").run(
    runId,
    id,
    "opencode",
    AI_MODEL,
    "queued",
    "In der Warteschlange.",
    new Date().toISOString(),
  )
  void runBuild(id, runId)
  return c.json({ runId })
})

app.get("/api/builds/:id", (c) => {
  const row = db.query("SELECT * FROM build_run WHERE id = ?").get(c.req.param("id")) as any
  return row ? c.json(row) : c.json({ error: "Build nicht gefunden." }, 404)
})

app.post("/api/builds/:id/cancel", (c) => {
  const id = c.req.param("id")
  const row = db.query("SELECT status, deck_id FROM build_run WHERE id = ?").get(id) as any
  if (!row) return c.json({ error: "Build nicht gefunden." }, 404)
  if (!canEditDeck(c, row.deck_id)) return c.json({ error: "Nur der Besitzer darf diesen Build abbrechen." }, 403)
  if (row.status === "queued" || row.status === "running") {
    db.query("UPDATE build_run SET status = 'cancelled', message = ?, finished_at = ? WHERE id = ?").run(
      "Abgebrochen.",
      new Date().toISOString(),
      id,
    )
  }
  const current = db.query("SELECT status FROM build_run WHERE id = ?").get(id) as any
  return c.json({ ok: true, status: current?.status ?? row.status })
})

app.post("/api/decks/:id/cards", async (c) => {
  const id = c.req.param("id")
  const deck = loadDeck(id)
  if (!deck) return c.json({ error: "Deck nicht gefunden." }, 404)
  if (!canEditDeck(c, id)) return c.json({ error: "Nur der Besitzer darf dieses Deck ändern." }, 403)
  const body = (await c.req.json()) as any
  const card = cardByName(String(body.name ?? ""))
  if (!card) return c.json({ error: "Karte nicht gefunden." }, 404)
  if (card.is_one_win) return c.json({ error: "1-Win-Karten sind in dieser Runde ausgeschlossen." }, 400)
  if (deck.commander && !fitsColorIdentity(card, deck.commander)) return c.json({ error: "Die Karte verletzt die Farbidentität des Commanders." }, 400)
  if (card.oracle_id === deck.commander_oracle_id) return c.json({ error: "Der Commander ist bereits im Deck." }, 400)
  const board = body.board === "maybeboard" ? "maybeboard" : "main"
  const existing = db.query("SELECT * FROM deck_card WHERE deck_id = ? AND oracle_id = ?").get(id, card.oracle_id) as any
  if (existing) {
    if (board === "main" && existing.board === "maybeboard") {
      db.query("UPDATE deck_card SET board = 'main', sort_order = 999 WHERE deck_id = ? AND oracle_id = ?").run(id, card.oracle_id)
      db.query("UPDATE deck SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), id)
      return c.json(loadDeck(id))
    }
    if (existing.board === board && /^(Plains|Island|Swamp|Mountain|Forest|Wastes)$/.test(card.name)) {
      db.query("UPDATE deck_card SET quantity = quantity + 1 WHERE deck_id = ? AND oracle_id = ?").run(id, card.oracle_id)
      return c.json(loadDeck(id))
    }
    return c.json({ error: existing.board === "maybeboard" ? "Karte ist bereits im Maybeboard." : "Karte ist bereits im Deck." }, 400)
  }
  const tags = tagsFor([card.oracle_id]).get(card.oracle_id) ?? []
  const validRoles = ["land", "ramp", "draw", "removal", "wipe", "protection", "tutor", "recursion", "wincon", "synergy", "flex"]
  const role = (validRoles.includes(String(body.role ?? "")) ? String(body.role) : roleFor(card, tags)) as Role
  const category = String(body.category ?? "").trim().slice(0, 80) || role
  const reason = String(body.reason ?? "").trim().slice(0, 1200) || "Manuell hinzugefügt."
  db.query(
    `INSERT INTO deck_card(deck_id,oracle_id,quantity,category,role,reason,printing_id,art_url,artist,sort_order,is_commander,board)
     VALUES (?,?,?,?,?,?,?,?,?,?,0,?)`,
  ).run(
    id,
    card.oracle_id,
    1,
    category,
    role,
    reason,
    body.printingId ?? null,
    body.artUrl ?? null,
    body.artist ?? null,
    board === "main" ? 999 : 0,
    board,
  )
  db.query("UPDATE deck SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), id)
  return c.json(loadDeck(id))
})

app.patch("/api/decks/:id/cards/:oracleId", async (c) => {
  const id = c.req.param("id")
  const oracleId = c.req.param("oracleId")
  if (!canEditDeck(c, id)) return c.json({ error: "Nur der Besitzer darf dieses Deck ändern." }, 403)
  const row = db.query("SELECT * FROM deck_card WHERE deck_id = ? AND oracle_id = ?").get(id, oracleId) as any
  if (!row) return c.json({ error: "Karte nicht im Deck." }, 404)
  const body = (await c.req.json().catch(() => ({}))) as any
  const board = body.board === "maybeboard" ? "maybeboard" : "main"
  db.query("UPDATE deck_card SET board = ?, sort_order = ? WHERE deck_id = ? AND oracle_id = ?").run(
    board,
    board === "main" ? 999 : 0,
    id,
    oracleId,
  )
  db.query("UPDATE deck SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), id)
  return c.json(loadDeck(id))
})

app.delete("/api/decks/:id/cards/:oracleId", (c) => {
  const id = c.req.param("id")
  const oracleId = c.req.param("oracleId")
  if (!canEditDeck(c, id)) return c.json({ error: "Nur der Besitzer darf dieses Deck ändern." }, 403)
  const row = db.query("SELECT * FROM deck_card WHERE deck_id = ? AND oracle_id = ?").get(id, oracleId) as any
  if (!row) return c.json({ error: "Karte nicht im Deck." }, 404)
  if (row.quantity > 1) db.query("UPDATE deck_card SET quantity = quantity - 1 WHERE deck_id = ? AND oracle_id = ?").run(id, oracleId)
  else db.query("DELETE FROM deck_card WHERE deck_id = ? AND oracle_id = ?").run(id, oracleId)
  db.query("UPDATE deck SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), id)
  return c.json(loadDeck(id))
})

app.post("/api/decks/:id/swap", async (c) => {
  const id = c.req.param("id")
  const deck = loadDeck(id)
  if (!deck) return c.json({ error: "Deck nicht gefunden." }, 404)
  if (!canEditDeck(c, id)) return c.json({ error: "Nur der Besitzer darf dieses Deck ändern." }, 403)
  const body = (await c.req.json().catch(() => ({}))) as any
  const addName = String(body.addName ?? "").trim()
  const removeOracleId = String(body.removeOracleId ?? "").trim()
  if (!addName || !removeOracleId) return c.json({ error: "Karte zum Tauschen fehlt." }, 400)
  const add = cardByName(addName)
  if (!add) return c.json({ error: `Karte nicht gefunden: ${addName}` }, 404)
  if (add.is_one_win) return c.json({ error: "1-Win-Karten sind in dieser Runde ausgeschlossen." }, 400)
  if (deck.commander && !fitsColorIdentity(add, deck.commander)) return c.json({ error: "Die Karte verletzt die Farbidentität des Commanders." }, 400)
  if (add.oracle_id === deck.commander_oracle_id) return c.json({ error: "Der Commander kann nicht getauscht werden." }, 400)
  if (add.oracle_id === removeOracleId) return c.json({ error: "Dieselbe Karte kann nicht getauscht werden." }, 400)
  const remove = db.query("SELECT * FROM deck_card WHERE deck_id = ? AND oracle_id = ?").get(id, removeOracleId) as any
  if (!remove) return c.json({ error: "Zu schneidende Karte ist nicht im Deck." }, 404)
  if (remove.board !== "main") return c.json({ error: "Nur Hauptdeck-Karten können getauscht werden." }, 400)
  const existing = db.query("SELECT * FROM deck_card WHERE deck_id = ? AND oracle_id = ?").get(id, add.oracle_id) as any
  if (existing && existing.board === "main") return c.json({ error: "Die neue Karte ist bereits im Deck." }, 400)
  const tags = tagsFor([add.oracle_id]).get(add.oracle_id) ?? []
  const role = roleFor(add, tags)
  const tx = db.transaction(() => {
    if (existing?.board === "maybeboard") db.query("DELETE FROM deck_card WHERE deck_id = ? AND oracle_id = ?").run(id, add.oracle_id)
    if (remove.quantity > 1) db.query("UPDATE deck_card SET quantity = quantity - 1 WHERE deck_id = ? AND oracle_id = ?").run(id, removeOracleId)
    else db.query("DELETE FROM deck_card WHERE deck_id = ? AND oracle_id = ?").run(id, removeOracleId)
    db.query(
      `INSERT INTO deck_card(deck_id,oracle_id,quantity,category,role,reason,printing_id,art_url,artist,sort_order,is_commander,board)
       VALUES (?,?,?,?,?,?,?,?,?,?,0,'main')`,
    ).run(id, add.oracle_id, 1, role, role, "Für eine Fast-Combo getauscht.", null, null, null, 999)
    db.query("UPDATE deck SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), id)
  })
  tx()
  return c.json(loadDeck(id))
})

app.post("/api/decks/:id/cards/:oracleId/art", async (c) => {
  const id = c.req.param("id")
  const oracleId = c.req.param("oracleId")
  if (!canEditDeck(c, id)) return c.json({ error: "Nur der Besitzer darf dieses Deck ändern." }, 403)
  const body = (await c.req.json()) as any
  const deckRow = db.query("SELECT commander_oracle_id FROM deck WHERE id = ?").get(id) as any
  if (deckRow?.commander_oracle_id === oracleId) {
    db.query("UPDATE deck SET commander_printing_id = ?, commander_art_url = ?, commander_artist = ?, updated_at = ? WHERE id = ?").run(
      body.printingId ?? null,
      body.artUrl ?? null,
      body.artist ?? null,
      new Date().toISOString(),
      id,
    )
  } else {
    db.query("UPDATE deck_card SET printing_id = ?, art_url = ?, artist = ? WHERE deck_id = ? AND oracle_id = ?").run(
      body.printingId ?? null,
      body.artUrl ?? null,
      body.artist ?? null,
      id,
      oracleId,
    )
  }
  db.query("UPDATE deck SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), id)
  return c.json({ ok: true })
})

app.post("/api/decks/:id/doctor", async (c) => {
  const deck = loadDeck(c.req.param("id"))
  if (!deck || !deck.commander) return c.json({ error: "Deck nicht gefunden." }, 404)
  const body = (await c.req.json().catch(() => ({}))) as any
  const maxProposals = proposalLimit(body.maxProposals)
  return c.json(
    doctorDeck(
      {
        commander: deck.commander,
        cards: deck.cards,
        settings: deck.settings,
        bracket: deck.bracket,
        podSize: deck.pod_size,
      },
      deck.updated_at,
      maxProposals,
    ),
  )
})

app.post("/api/decks/:id/doctor/explain", async (c) => {
  const id = c.req.param("id")
  const deck = loadDeck(id)
  if (!deck || !deck.commander) return c.json({ error: "Deck nicht gefunden." }, 404)
  if (!canEditDeck(c, id)) return c.json({ error: "Nur der Besitzer kann eine KI-Erklärung starten." }, 403)
  const body = (await c.req.json().catch(() => ({}))) as any
  const maxProposals = proposalLimit(body.maxProposals)
  const current = doctorDeck(
    {
      commander: deck.commander,
      cards: deck.cards,
      settings: deck.settings,
      bracket: deck.bracket,
      podSize: deck.pod_size,
    },
    deck.updated_at,
    maxProposals,
  )
  const requestedIds: string[] = Array.isArray(body.proposalIds) ? body.proposalIds.map((value: unknown) => String(value)) : []
  const selected = requestedIds.length
    ? requestedIds.map((proposalId) => current.proposals.find((proposal) => proposal.id === proposalId))
    : current.proposals
  if (selected.some((proposal) => !proposal)) {
    return c.json({ error: "Die Vorschläge sind veraltet. Bitte den Doctor neu prüfen." }, 409)
  }
  if (selected.length === 0) return c.json({ error: "Es gibt keine Vorschläge zum Erklären." }, 400)
  const proposalHash = sha256(`${selected.map((proposal) => proposal!.id).sort().join("|")}|${maxProposals}`)
  const cached = db
    .query("SELECT * FROM deck_explanation WHERE deck_id = ? AND deck_updated_at = ? AND proposal_hash = ? LIMIT 1")
    .get(id, deck.updated_at, proposalHash) as any
  if (cached) return c.json({ cached: true, explanation: cached.text, model: cached.model })
  const runId = crypto.randomUUID()
  db.query("INSERT INTO explain_run(id,deck_id,status,message,started_at) VALUES (?,?,?,?,?)").run(
    runId,
    id,
    "queued",
    "In der Warteschlange.",
    new Date().toISOString(),
  )
  void runDoctorExplanation(runId, id, proposalHash, current.diagnosis, selected)
  return c.json({ runId, cached: false })
})

app.get("/api/explain/:id", (c) => {
  const row = db
    .query(
      `SELECT r.*, e.text, e.model
       FROM explain_run r LEFT JOIN deck_explanation e ON e.id = r.explanation_id
       WHERE r.id = ? LIMIT 1`,
    )
    .get(c.req.param("id")) as any
  if (!row) return c.json({ error: "Erklärung nicht gefunden." }, 404)
  return c.json({
    id: row.id,
    status: row.status,
    message: row.message,
    error: row.error,
    text: row.text ?? null,
    model: row.model ?? null,
  })
})

app.post("/api/decks/:id/doctor/apply", async (c) => {
  const id = c.req.param("id")
  const deck = loadDeck(id)
  if (!deck || !deck.commander) return c.json({ error: "Deck nicht gefunden." }, 404)
  if (!canEditDeck(c, id)) return c.json({ error: "Nur der Besitzer darf dieses Deck ändern." }, 403)
  const body = (await c.req.json().catch(() => ({}))) as any
  const proposalIds: string[] = Array.isArray(body.proposalIds) ? body.proposalIds.map((value: unknown) => String(value)) : []
  if (proposalIds.length === 0) return c.json({ error: "Keine Vorschläge ausgewählt." }, 400)
  const maxProposals = proposalLimit(body.maxProposals)

  const current = doctorDeck(
    {
      commander: deck.commander,
      cards: deck.cards,
      settings: deck.settings,
      bracket: deck.bracket,
      podSize: deck.pod_size,
    },
    deck.updated_at,
    maxProposals,
  )
  const byId = new Map(current.proposals.map((proposal) => [proposal.id, proposal]))
  const selected = proposalIds.map((proposalId) => byId.get(proposalId))
  if (selected.some((proposal) => !proposal)) {
    return c.json({ error: "Die Vorschläge sind veraltet. Bitte den Deck-Doctor neu prüfen.", code: "stale" }, 409)
  }

  const now = new Date().toISOString()
  const revisionId = crypto.randomUUID()
  const snapshot = deck.cards.map((card) => ({
    oracle_id: card.oracle_id,
    quantity: card.quantity,
    role: card.role,
    category: card.category,
    reason: card.reason,
    printing_id: card.printing_id,
    art_url: card.art_url,
    artist: card.artist,
  }))
  db.query("INSERT INTO deck_revision(id, deck_id, created_at, label, cards_json) VALUES (?,?,?,?,?)").run(
    revisionId,
    id,
    now,
    `Vor Deck-Doctor (${proposalIds.length} Änderungen)`,
    JSON.stringify(snapshot),
  )

  const cardMap = new Map(deck.cards.map((card) => [card.oracle_id, { ...card, tags: [...card.tags] }]))
  let applied = 0
  for (const proposal of selected) {
    if (!proposal) continue
    if (proposal.cut) {
      const cut = cardMap.get(proposal.cut.oracle_id)
      if (cut) {
        if (cut.quantity > 1) cut.quantity -= 1
        else cardMap.delete(cut.oracle_id)
      }
    }
    if (proposal.add) {
      const existing = cardMap.get(proposal.add.oracle_id)
      if (existing) {
        existing.quantity += 1
      } else {
        const card = cardById(proposal.add.oracle_id)
        if (card && card.oracle_id !== deck.commander_oracle_id) {
          const tags = tagsFor([card.oracle_id]).get(card.oracle_id) ?? []
          cardMap.set(card.oracle_id, makeDeckCard(card, proposal.add.role, `Deck-Doctor: ${proposal.need}.`, tags))
        }
      }
    }
    applied += 1
  }

  const cards = [...cardMap.values()]
  saveDeckCards(id, cards)
  const total = cards.reduce((sum, card) => sum + card.quantity, 0) + 1
  db.query("UPDATE deck SET updated_at = ?, status = ? WHERE id = ?").run(now, total === 100 ? "ready" : "draft", id)
  db.query(
    "DELETE FROM deck_revision WHERE deck_id = ? AND id NOT IN (SELECT id FROM deck_revision WHERE deck_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10)",
  ).run(id, id)
  return c.json({ deck: loadDeck(id), revisionId, applied })
})

app.post("/api/decks/:id/revisions/:revisionId/restore", (c) => {
  const id = c.req.param("id")
  const revisionId = c.req.param("revisionId")
  const deck = loadDeck(id)
  if (!deck) return c.json({ error: "Deck nicht gefunden." }, 404)
  if (!canEditDeck(c, id)) return c.json({ error: "Nur der Besitzer darf dieses Deck ändern." }, 403)
  if (deck.commander?.is_one_win) return c.json({ error: "Der Commander ist eine 1-Win-Karte. 1-Win-Karten sind in dieser Runde ausgeschlossen." }, 400)
  const revision = db.query("SELECT * FROM deck_revision WHERE id = ? AND deck_id = ?").get(revisionId, id) as any
  if (!revision) return c.json({ error: "Revision nicht gefunden." }, 404)
  let raw: any[] = []
  try {
    raw = JSON.parse(revision.cards_json)
  } catch {
    return c.json({ error: "Revision ist beschädigt." }, 400)
  }
  if (!Array.isArray(raw)) return c.json({ error: "Revision ist beschädigt." }, 400)
  const tagMap = tagsFor(raw.map((row) => String(row.oracle_id)))
  const cards: DeckCard[] = []
  for (const row of raw) {
    const card = cardById(String(row.oracle_id))
    if (!card || card.is_one_win) continue
    if (deck.commander && !fitsColorIdentity(card, deck.commander)) continue
    const tags = tagMap.get(card.oracle_id) ?? []
    const role = (row.role as Role) ?? roleFor(card, tags)
    const restored = makeDeckCard(card, role, row.reason ?? "Wiederhergestellt.", tags)
    cards.push({
      ...restored,
      category: row.category ?? role,
      quantity: Math.max(1, Number(row.quantity ?? 1)),
      printing_id: row.printing_id ?? null,
      art_url: row.art_url ?? null,
      artist: row.artist ?? null,
    })
  }
  const now = new Date().toISOString()
  const undoRevisionId = crypto.randomUUID()
  const snapshot = deck.cards.map((card) => ({
    oracle_id: card.oracle_id,
    quantity: card.quantity,
    role: card.role,
    category: card.category,
    reason: card.reason,
    printing_id: card.printing_id,
    art_url: card.art_url,
    artist: card.artist,
  }))
  db.query("INSERT INTO deck_revision(id, deck_id, created_at, label, cards_json) VALUES (?,?,?,?,?)").run(
    undoRevisionId,
    id,
    now,
    "Vor Wiederherstellung",
    JSON.stringify(snapshot),
  )

  saveDeckCards(id, cards)
  const total = cards.reduce((sum, card) => sum + card.quantity, 0) + 1
  db.query("UPDATE deck SET updated_at = ?, status = ? WHERE id = ?").run(now, total === 100 ? "ready" : "draft", id)
  db.query(
    "DELETE FROM deck_revision WHERE deck_id = ? AND id NOT IN (SELECT id FROM deck_revision WHERE deck_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10)",
  ).run(id, id)
  return c.json({ deck: loadDeck(id), revisionId: undoRevisionId })
})

app.get("/api/decks/:id/revisions", (c) => {
  const deck = loadDeck(c.req.param("id"))
  if (!deck) return c.json({ error: "Deck nicht gefunden." }, 404)

  const rows = db
    .query("SELECT id, created_at, label, cards_json FROM deck_revision WHERE deck_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10")
    .all(deck.id) as any[]

  const current = new Map<string, number>()
  for (const card of deck.cards) current.set(card.oracle_id, (current.get(card.oracle_id) ?? 0) + card.quantity)

  const snapshots = rows.map((row) => {
    let cards: any[] = []
    try {
      const parsed = JSON.parse(row.cards_json)
      cards = Array.isArray(parsed) ? parsed : []
    } catch {
      cards = []
    }
    const quantities = new Map<string, number>()
    for (const card of cards) {
      const oracleId = String(card.oracle_id)
      quantities.set(oracleId, (quantities.get(oracleId) ?? 0) + Math.max(1, Number(card.quantity ?? 1)))
    }
    return { row, cards, quantities }
  })

  const oracleIds = [
    ...new Set([
      ...deck.cards.map((card) => card.oracle_id),
      ...snapshots.flatMap(({ quantities }) => [...quantities.keys()]),
    ]),
  ]
  const names = new Map<string, string>()
  const cmc = new Map<string, number>()
  for (let i = 0; i < oracleIds.length; i += 500) {
    const chunk = oracleIds.slice(i, i + 500)
    const placeholders = chunk.map(() => "?").join(",")
    const found = db.query(`SELECT oracle_id, name, cmc FROM card WHERE oracle_id IN (${placeholders})`).all(...chunk) as any[]
    for (const card of found) {
      names.set(card.oracle_id, card.name)
      cmc.set(card.oracle_id, Number(card.cmc ?? 0))
    }
  }

  const roleLabels: Record<string, string> = {
    land: "Länder",
    ramp: "Ramp",
    draw: "Draw",
    removal: "Removal",
    wipe: "Wipes",
    protection: "Schutz",
    tutor: "Tutoren",
    recursion: "Rekursion",
    wincon: "Wincons",
    synergy: "Synergie",
    flex: "Flex",
  }
  const roleOrder = Object.keys(roleLabels)
  const currentRoleCounts = new Map<string, number>()
  for (const card of deck.cards) currentRoleCounts.set(card.role, (currentRoleCounts.get(card.role) ?? 0) + card.quantity)
  const currentNonLands = deck.cards.filter((card) => card.role !== "land")
  const currentAverageMv = currentNonLands.length
    ? currentNonLands.reduce((sum, card) => sum + card.cmc * card.quantity, 0) / currentNonLands.length
    : 0

  const revisions = snapshots.map(({ row, cards, quantities }) => {
    const added: Array<{ oracle_id: string; name: string; quantity: number }> = []
    const removed: Array<{ oracle_id: string; name: string; quantity: number }> = []

    for (const [oracleId, quantity] of current) {
      const before = quantities.get(oracleId) ?? 0
      if (quantity > before) {
        added.push({ oracle_id: oracleId, name: names.get(oracleId) ?? oracleId, quantity: quantity - before })
      }
    }
    for (const [oracleId, before] of quantities) {
      const quantity = current.get(oracleId) ?? 0
      if (before > quantity) {
        removed.push({ oracle_id: oracleId, name: names.get(oracleId) ?? oracleId, quantity: before - quantity })
      }
    }

    const beforeRoles = new Map<string, number>()
    let beforeNonLands = 0
    let beforeMvTotal = 0
    for (const card of cards) {
      const quantity = Math.max(1, Number(card.quantity ?? 1))
      const role = String(card.role ?? "flex")
      beforeRoles.set(role, (beforeRoles.get(role) ?? 0) + quantity)
      if (role !== "land") {
        beforeNonLands += quantity
        beforeMvTotal += (cmc.get(String(card.oracle_id)) ?? 0) * quantity
      }
    }
    const roleDelta = roleOrder
      .map((role) => ({
        role,
        label: roleLabels[role],
        before: beforeRoles.get(role) ?? 0,
        after: currentRoleCounts.get(role) ?? 0,
        delta: (currentRoleCounts.get(role) ?? 0) - (beforeRoles.get(role) ?? 0),
      }))
      .filter((entry) => entry.delta !== 0)

    return {
      id: row.id,
      created_at: row.created_at,
      label: row.label,
      total: cards.reduce((sum, card) => sum + Math.max(1, Number(card.quantity ?? 1)), 0) + 1,
      unique: cards.length,
      added: added.sort((a, b) => a.name.localeCompare(b.name, "de")),
      removed: removed.sort((a, b) => a.name.localeCompare(b.name, "de")),
      roleDelta,
      averageMvBefore: beforeNonLands ? Number((beforeMvTotal / beforeNonLands).toFixed(2)) : 0,
      averageMvAfter: Number(currentAverageMv.toFixed(2)),
    }
  })

  return c.json({ revisions })
})

app.get("/api/decks/:id/export", (c) => {
  const deck = loadDeck(c.req.param("id"))
  if (!deck) return c.json({ error: "Deck nicht gefunden." }, 404)
  const lines = [`1 ${deck.commander_name}`, ""]
  for (const card of deck.cards) lines.push(`${card.quantity} ${card.name}`)
  if (deck.maybeboard.length > 0) {
    lines.push("", "// Maybeboard")
    for (const card of deck.maybeboard) lines.push(`${card.quantity} ${card.name}`)
  }
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${deck.name.replace(/[^a-zA-Z0-9_-]+/g, "-")}.txt"`,
    },
  })
})

app.get("/api/pods/active", (c) => {
  const user = authUser(c)
  const rows = db
    .query(
      `SELECT s.code FROM pod_session s
       WHERE s.status = 'active'
         AND (s.host_user_id = ? OR EXISTS (SELECT 1 FROM pod_player p WHERE p.session_id = s.id AND p.user_id = ?))
       ORDER BY s.updated_at DESC LIMIT 20`,
    )
    .all(user.id, user.id) as any[]
  return c.json(rows.map((row) => loadPod(row.code)).filter(Boolean))
})

app.post("/api/pods", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as any
  const user = authUser(c)
  const deckId = body.deckId ? String(body.deckId) : null
  if (deckId && !db.query("SELECT 1 FROM deck WHERE id = ?").get(deckId)) return c.json({ error: "Deck nicht gefunden." }, 400)
  let code = makePodCode()
  while (db.query("SELECT 1 FROM pod_session WHERE code = ?").get(code)) code = makePodCode()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  db.query("INSERT INTO pod_session(id,code,name,host_user_id,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(
    id,
    code,
    displayName(body.name, `Tisch ${code}`),
    user.id,
    "active",
    0,
    now,
    now,
  )
  db.query("INSERT INTO pod_player(id,session_id,user_id,deck_id,seat,life,poison,commander_damage_json,eliminated,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
    crypto.randomUUID(),
    id,
    user.id,
    deckId,
    1,
    40,
    0,
    "{}",
    0,
    now,
    now,
  )
  return c.json(loadPod(code))
})

app.get("/api/pods/:code", (c) => {
  const state = loadPod(c.req.param("code"))
  return state ? c.json(state) : c.json({ error: "Pod nicht gefunden." }, 404)
})

app.get("/api/pods/:code/qr.svg", async (c) => {
  const state = loadPod(c.req.param("code"))
  if (!state) return c.json({ error: "Pod nicht gefunden." }, 404)
  const url = `${publicBaseUrl(c)}/m#table=${state.code}`
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, width: 240, errorCorrectionLevel: "M" })
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
})

app.post("/api/pods/:code/join", async (c) => {
  const code = c.req.param("code")
  const state = loadPod(code)
  if (!state) return c.json({ error: "Pod nicht gefunden." }, 404)
  if (state.status !== "active") return c.json({ error: "Dieser Pod ist schon beendet." }, 409)
  const user = authUser(c)
  const existing = state.players.find((row) => row.user_id === user.id)
  if (existing) return c.json(state)
  if (state.players.length >= 5) return c.json({ error: "Der Pod ist voll." }, 400)
  const body = (await c.req.json().catch(() => ({}))) as any
  const deckId = body.deckId ? String(body.deckId) : null
  if (deckId && !db.query("SELECT 1 FROM deck WHERE id = ?").get(deckId)) return c.json({ error: "Deck nicht gefunden." }, 400)
  const used = new Set(state.players.map((row) => row.seat))
  const seat = [1, 2, 3, 4, 5].find((value) => !used.has(value)) ?? 1
  const now = new Date().toISOString()
  db.query("INSERT INTO pod_player(id,session_id,user_id,deck_id,seat,life,poison,commander_damage_json,eliminated,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
    crypto.randomUUID(),
    state.id,
    user.id,
    deckId,
    seat,
    40,
    0,
    "{}",
    0,
    now,
    now,
  )
  podVersion(state.id)
  const next = loadPod(code)
  broadcastPod(code)
  return c.json(next)
})

function requirePodState(c: Context<AppEnv>, code: string) {
  const state = loadPod(code)
  if (!state) return null
  const user = authUser(c)
  if (state.host_user_id !== user.id && !state.players.some((row) => row.user_id === user.id)) return null
  return state
}

function podPlayerById(state: PodState, playerId: string) {
  return state.players.find((row) => row.id === playerId) ?? null
}

function podChange(c: Context<AppEnv>, code: string, kind: string, change: () => boolean) {
  const state = requirePodState(c, code)
  if (!state) return c.json({ error: "Kein Zugriff auf diesen Pod." }, 403)
  if (state.status !== "active") return c.json({ error: "Dieser Pod ist schon beendet." }, 409)
  const before = podSnapshot(state.id)
  if (!change()) return c.json({ error: "Änderung nicht möglich." }, 400)
  const after = podSnapshot(state.id)
  podVersion(state.id)
  recordPodEvent(state.id, authUser(c).id, kind, before, after)
  const next = loadPod(code)
  broadcastPod(code)
  return c.json(next)
}

app.post("/api/pods/:code/life", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as any
  const state = loadPod(c.req.param("code"))
  if (!state) return c.json({ error: "Pod nicht gefunden." }, 404)
  const player = podPlayerById(state, String(body.playerId ?? ""))
  if (!player) return c.json({ error: "Spieler nicht gefunden." }, 404)
  const delta = Math.max(-99, Math.min(99, Math.round(Number(body.delta) || 0)))
  return podChange(c, state.code, "life", () => {
    const ok = db
      .query("UPDATE pod_player SET life = MAX(0, MIN(999, life + ?)), updated_at = ? WHERE id = ? AND session_id = ?")
      .run(delta, new Date().toISOString(), player.id, state.id)
    return ok.changes > 0
  })
})

app.post("/api/pods/:code/poison", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as any
  const state = loadPod(c.req.param("code"))
  if (!state) return c.json({ error: "Pod nicht gefunden." }, 404)
  const player = podPlayerById(state, String(body.playerId ?? ""))
  if (!player) return c.json({ error: "Spieler nicht gefunden." }, 404)
  const delta = Math.max(-10, Math.min(10, Math.round(Number(body.delta) || 0)))
  return podChange(c, state.code, "poison", () => {
    const ok = db
      .query("UPDATE pod_player SET poison = MAX(0, MIN(10, poison + ?)), updated_at = ? WHERE id = ? AND session_id = ?")
      .run(delta, new Date().toISOString(), player.id, state.id)
    return ok.changes > 0
  })
})

app.post("/api/pods/:code/counter", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as any
  const state = loadPod(c.req.param("code"))
  if (!state) return c.json({ error: "Pod nicht gefunden." }, 404)
  const player = podPlayerById(state, String(body.playerId ?? ""))
  if (!player) return c.json({ error: "Spieler nicht gefunden." }, 404)
  const counter = String(body.counter ?? "")
  if (!isPodCounterKey(counter)) return c.json({ error: "Unbekannter Zähler." }, 400)
  const delta = Math.max(-99, Math.min(99, Math.round(Number(body.delta) || 0)))
  const counters = { ...player.counters }
  const next = Math.max(0, Math.min(POD_COUNTER_MAX, Number(counters[counter] ?? 0) + delta))
  if (next === 0) delete counters[counter]
  else counters[counter] = next
  return podChange(c, state.code, `counter:${counter}`, () => {
    const ok = db
      .query("UPDATE pod_player SET counters_json = ?, updated_at = ? WHERE id = ? AND session_id = ?")
      .run(JSON.stringify(counters), new Date().toISOString(), player.id, state.id)
    return ok.changes > 0
  })
})

app.post("/api/pods/:code/status", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as any
  const state = loadPod(c.req.param("code"))
  if (!state) return c.json({ error: "Pod nicht gefunden." }, 404)
  const player = podPlayerById(state, String(body.playerId ?? ""))
  if (!player) return c.json({ error: "Spieler nicht gefunden." }, 404)
  const status = String(body.status ?? "")
  if (!isPodStatusKey(status)) return c.json({ error: "Unbekannter Status." }, 400)
  const value = body.value === true || body.value === 1 || body.value === "1" || body.value === "true"
  const definition = POD_STATUSES.find((entry) => entry.key === status)
  return podChange(c, state.code, `status:${status}`, () => {
    const now = new Date().toISOString()
    let changed = false
    if (definition?.exclusive && value) {
      for (const other of state.players) {
        if (other.id === player.id) continue
        const statuses = { ...other.statuses }
        if (!statuses[status]) continue
        delete statuses[status]
        const cleared = db
          .query("UPDATE pod_player SET statuses_json = ?, updated_at = ? WHERE id = ? AND session_id = ?")
          .run(JSON.stringify(statuses), now, other.id, state.id)
        if (cleared.changes > 0) changed = true
      }
    }
    const statuses = { ...player.statuses }
    if (value) statuses[status] = true
    else delete statuses[status]
    const ok = db
      .query("UPDATE pod_player SET statuses_json = ?, updated_at = ? WHERE id = ? AND session_id = ?")
      .run(JSON.stringify(statuses), now, player.id, state.id)
    return changed || ok.changes > 0
  })
})

app.post("/api/pods/:code/commander", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as any
  const state = loadPod(c.req.param("code"))
  if (!state) return c.json({ error: "Pod nicht gefunden." }, 404)
  const player = podPlayerById(state, String(body.playerId ?? ""))
  const from = podPlayerById(state, String(body.fromPlayerId ?? ""))
  if (!player || !from) return c.json({ error: "Spieler nicht gefunden." }, 404)
  const delta = Math.max(-21, Math.min(21, Math.round(Number(body.delta) || 0)))
  const damage = { ...player.commander_damage }
  damage[from.id] = Math.max(0, Math.min(99, Number(damage[from.id] ?? 0) + delta))
  return podChange(c, state.code, "commander", () => {
    const ok = db
      .query("UPDATE pod_player SET commander_damage_json = ?, updated_at = ? WHERE id = ? AND session_id = ?")
      .run(JSON.stringify(damage), new Date().toISOString(), player.id, state.id)
    return ok.changes > 0
  })
})

app.post("/api/pods/:code/eliminate", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as any
  const state = loadPod(c.req.param("code"))
  if (!state) return c.json({ error: "Pod nicht gefunden." }, 404)
  const player = podPlayerById(state, String(body.playerId ?? ""))
  if (!player) return c.json({ error: "Spieler nicht gefunden." }, 404)
  const eliminated = body.eliminated ? 1 : 0
  return podChange(c, state.code, "eliminate", () => {
    const ok = db
      .query("UPDATE pod_player SET eliminated = ?, updated_at = ? WHERE id = ? AND session_id = ?")
      .run(eliminated, new Date().toISOString(), player.id, state.id)
    return ok.changes > 0
  })
})

app.post("/api/pods/:code/reset", (c) => {
  const state = loadPod(c.req.param("code"))
  if (!state) return c.json({ error: "Pod nicht gefunden." }, 404)
  const user = authUser(c)
  if (state.host_user_id !== user.id && user.role !== "admin") return c.json({ error: "Nur der Host darf den Tisch zurücksetzen." }, 403)
  if (state.status !== "active") return c.json({ error: "Dieser Pod ist schon beendet." }, 409)
  const before = podSnapshot(state.id)
  const now = new Date().toISOString()
  db.query(
    "UPDATE pod_player SET life = 40, poison = 0, commander_damage_json = '{}', counters_json = '{}', statuses_json = '{}', eliminated = 0, updated_at = ? WHERE session_id = ?",
  ).run(now, state.id)
  podVersion(state.id)
  recordPodEvent(state.id, user.id, "reset", before, podSnapshot(state.id))
  broadcastPod(state.code)
  return c.json(loadPod(state.code))
})

app.post("/api/pods/:code/undo", (c) => {
  const state = loadPod(c.req.param("code"))
  if (!state) return c.json({ error: "Pod nicht gefunden." }, 404)
  if (state.status !== "active") return c.json({ error: "Dieser Pod ist schon beendet." }, 409)
  const event = db
    .query("SELECT * FROM pod_event WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(state.id) as any
  if (!event) return c.json({ error: "Es gibt nichts zurückzunehmen." }, 400)
  // Jeder am Tisch darf die letzte Änderung zurücknehmen; der Undo-Stack ist serverseitig.
  applyPodSnapshot(state.id, JSON.parse(event.before_json))
  db.query("DELETE FROM pod_event WHERE id = ?").run(event.id)
  podVersion(state.id)
  broadcastPod(state.code)
  return c.json(loadPod(state.code))
})

app.post("/api/pods/:code/finish", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as any
  const state = loadPod(c.req.param("code"))
  if (!state) return c.json({ error: "Pod nicht gefunden." }, 404)
  const user = authUser(c)
  if (state.host_user_id !== user.id && user.role !== "admin") return c.json({ error: "Nur der Host darf den Tisch beenden." }, 403)
  if (state.status !== "active") return c.json({ error: "Dieser Pod ist schon beendet." }, 409)
  const winner = body.winnerPlayerId
    ? podPlayerById(state, String(body.winnerPlayerId))
    : [...state.players].sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || b.life - a.life)[0]
  const winnerDeckId = winner?.deck_id ?? null
  const intOr = (value: unknown, min: number, max: number, fallback: number | null = null) => {
    if (value === "" || value == null) return fallback
    const number = Number(value)
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
  }
  const turns = intOr(body.turns, 0, 99)
  const fun = intOr(body.fun, 1, 5)
  const salt = intOr(body.salt, 1, 5)
  const gameId = crypto.randomUUID()
  const now = new Date().toISOString()
  db.query(
    "INSERT INTO game(id,played_at,pod_size,winner_deck_id,turns,notes,fun,salt,created_by,pod_session_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(
    gameId,
    now,
    state.players.length,
    winnerDeckId,
    turns,
    String(body.notes ?? "").slice(0, 2000),
    fun,
    salt,
    user.id,
    state.id,
  )
  for (const player of state.players) {
    db.query(
      "INSERT INTO game_participant(id,game_id,user_id,deck_id,seat,starting_life,ending_life,eliminated,is_winner,commander_damage_json,poison,counters_json,statuses_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      crypto.randomUUID(),
      gameId,
      player.user_id,
      player.deck_id,
      player.seat,
      40,
      player.life,
      player.eliminated ? 1 : 0,
      winner?.id === player.id ? 1 : 0,
      JSON.stringify(player.commander_damage),
      player.poison,
      JSON.stringify(player.counters),
      JSON.stringify(player.statuses),
    )
  }
  db.query("UPDATE pod_session SET status = 'finished', finished_at = ?, game_id = ?, updated_at = ? WHERE id = ?").run(
    now,
    gameId,
    now,
    state.id,
  )
  broadcastPod(state.code)
  return c.json({ state: loadPod(state.code), gameId })
})

app.get(
  "/api/pods/:code/ws",
  upgradeWebSocket((c) => {
    const code = (c.req.param("code") ?? "").toUpperCase()
    let opened = false
    return {
      onOpen(_event: any, ws: any) {
        const state = loadPod(code)
        if (!state) {
          ws.close(4404, "Pod nicht gefunden")
          return
        }
        opened = true
        const room = podRooms.get(code) ?? new Set<any>()
        room.add(ws)
        podRooms.set(code, room)
        ws.send(JSON.stringify({ type: "state", state }))
      },
      onClose(_event: any, ws: any) {
        if (!opened) return
        const room = podRooms.get(code)
        room?.delete(ws)
        if (room && room.size === 0) podRooms.delete(code)
      },
      onMessage(event: any, ws: any) {
        if (event.data === "ping") ws.send(JSON.stringify({ type: "pong" }))
      },
    }
  }),
)

function statsForUser(userId: string) {
  const totals = db
    .query(
      `SELECT COUNT(*) AS games,
              COALESCE(SUM(p.is_winner), 0) AS wins,
              AVG(g.turns) AS avg_turns,
              AVG(COALESCE(p.fun, g.fun)) AS avg_fun,
              AVG(COALESCE(p.salt, g.salt)) AS avg_salt
       FROM game_participant p JOIN game g ON g.id = p.game_id
       WHERE p.user_id = ?`,
    )
    .get(userId) as any
  const byDeck = db
    .query(
      `SELECT p.deck_id, d.name AS deck_name, d.commander_name,
              COUNT(*) AS games, COALESCE(SUM(p.is_winner), 0) AS wins
       FROM game_participant p
       LEFT JOIN deck d ON d.id = p.deck_id
       WHERE p.user_id = ?
       GROUP BY p.deck_id
       ORDER BY games DESC, wins DESC`,
    )
    .all(userId) as any[]
  const recent = db
    .query(
      `SELECT g.id, g.played_at, g.turns, g.fun, g.salt,
              p.deck_id, d.name AS deck_name, d.commander_name,
              p.is_winner, p.ending_life, p.eliminated
       FROM game_participant p
       JOIN game g ON g.id = p.game_id
       LEFT JOIN deck d ON d.id = p.deck_id
       WHERE p.user_id = ?
       ORDER BY g.played_at DESC LIMIT 10`,
    )
    .all(userId) as any[]
  const games = Number(totals?.games ?? 0)
  const wins = Number(totals?.wins ?? 0)
  return {
    totals: {
      games,
      wins,
      winrate: games ? Math.round((wins / games) * 100) : 0,
      avgTurns: totals?.avg_turns == null ? null : Math.round(Number(totals.avg_turns) * 10) / 10,
      avgFun: totals?.avg_fun == null ? null : Math.round(Number(totals.avg_fun) * 10) / 10,
      avgSalt: totals?.avg_salt == null ? null : Math.round(Number(totals.avg_salt) * 10) / 10,
    },
    byDeck: byDeck.map((row) => ({ ...row, games: Number(row.games), wins: Number(row.wins) })),
    recent,
  }
}

app.get("/api/stats/me", (c) => c.json(statsForUser(authUser(c).id)))

app.get("/api/stats/pod", (c) => {
  const rows = db
    .query(
      `SELECT u.id, u.display_name, u.username, u.avatar_color,
              COUNT(p.game_id) AS games, COALESCE(SUM(p.is_winner), 0) AS wins
       FROM users u LEFT JOIN game_participant p ON p.user_id = u.id
       GROUP BY u.id ORDER BY wins DESC, games DESC, u.display_name COLLATE NOCASE`,
    )
    .all() as any[]
  return c.json(
    rows.map((row) => {
      const games = Number(row.games ?? 0)
      const wins = Number(row.wins ?? 0)
      return { ...row, games, wins, winrate: games ? Math.round((wins / games) * 100) : 0 }
    }),
  )
})

app.get("/api/games", (c) => {
  const rows = db
    .query(
      `SELECT g.*, d.name AS winner_name, d.commander_name AS winner_commander,
              u.display_name AS created_by_name
       FROM game g
       LEFT JOIN deck d ON d.id = g.winner_deck_id
       LEFT JOIN users u ON u.id = g.created_by
       ORDER BY g.played_at DESC, g.rowid DESC LIMIT 200`,
    )
    .all()
  return c.json(rows)
})

app.post("/api/games", async (c) => {
  const body = (await c.req.json()) as any
  const winnerDeckId = body.winnerDeckId ? String(body.winnerDeckId) : null
  if (winnerDeckId) {
    const deck = db.query("SELECT 1 FROM deck WHERE id = ?").get(winnerDeckId)
    if (!deck) return c.json({ error: "Siegerdeck nicht gefunden." }, 400)
  }
  const rawDate = String(body.playedAt ?? "").trim()
  const parsedDate = rawDate ? new Date(rawDate.length === 10 ? `${rawDate}T12:00:00` : rawDate) : new Date()
  if (Number.isNaN(parsedDate.getTime())) return c.json({ error: "Ungültiges Datum." }, 400)
  const intOr = (value: unknown, min: number, max: number, fallback: number | null = null) => {
    if (value === "" || value == null) return fallback
    const number = Number(value)
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
  }
  const turns = intOr(body.turns, 0, 99)
  const fun = intOr(body.fun, 1, 5)
  const salt = intOr(body.salt, 1, 5)
  const podSize = intOr(body.podSize, 3, 5, 4) ?? 4
  const id = crypto.randomUUID()
  db.query("INSERT INTO game(id,played_at,pod_size,winner_deck_id,turns,notes,fun,salt,created_by) VALUES (?,?,?,?,?,?,?,?,?)").run(
    id,
    parsedDate.toISOString(),
    podSize,
    winnerDeckId,
    turns,
    String(body.notes ?? "").slice(0, 2000),
    fun,
    salt,
    authUser(c).id,
  )
  if (winnerDeckId) {
    const winnerDeck = db.query("SELECT owner_user_id FROM deck WHERE id = ?").get(winnerDeckId) as any
    db.query(
      "INSERT INTO game_participant(id,game_id,user_id,deck_id,seat,starting_life,ending_life,eliminated,is_winner,commander_damage_json,poison,fun,salt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      crypto.randomUUID(),
      id,
      winnerDeck?.owner_user_id ?? null,
      winnerDeckId,
      1,
      40,
      null,
      0,
      1,
      "{}",
      0,
      fun,
      salt,
    )
  }
  const row = db
    .query(
      `SELECT g.*, d.name AS winner_name, d.commander_name AS winner_commander,
              u.display_name AS created_by_name
       FROM game g
       LEFT JOIN deck d ON d.id = g.winner_deck_id
       LEFT JOIN users u ON u.id = g.created_by
       WHERE g.id = ?`,
    )
    .get(id)
  return c.json(row)
})

app.delete("/api/games/:id", (c) => {
  const id = c.req.param("id")
  const row = db.query("SELECT created_by FROM game WHERE id = ?").get(id) as any
  if (!row) return c.json({ error: "Spiel nicht gefunden." }, 404)
  const user = authUser(c)
  if (user.role !== "admin" && row.created_by !== user.id) return c.json({ error: "Nur der Eintragende darf dieses Spiel löschen." }, 403)
  db.query("DELETE FROM game WHERE id = ?").run(id)
  return c.json({ ok: true })
})

app.use("/*", async (c, next) => {
  await next()
  if (
    c.req.path === "/" ||
    c.req.path === "/index.html" ||
    c.req.path === "/main.js" ||
    c.req.path === "/m" ||
    c.req.path === "/mobile.html" ||
    c.req.path === "/mobile.js" ||
    c.req.path === "/mobile.css" ||
    c.req.path === "/styles.css"
  ) {
    c.res.headers.set("Cache-Control", "no-store")
  }
})

app.get("/", async (c) => c.html(await Bun.file(`${ROOT}/public/index.html`).text()))
app.get("/m", async (c) => c.html(await Bun.file(`${ROOT}/public/mobile.html`).text()))
app.get("/mobile", (c) => c.redirect("/m"))
app.use("/*", serveStatic({ root: `${ROOT}/public` }))

export default {
  port: PORT,
  hostname: process.env.HOST ?? "0.0.0.0",
  fetch: app.fetch,
  websocket,
}
