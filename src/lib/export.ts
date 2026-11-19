import { db } from "../db"
import { scryfallJson } from "./scryfall"
import { ROOT } from "./paths"

/**
 * Deck-Export mit Art-Auswahl.
 *
 * Die Druck-App bekommt eine reine Namensliste; für die Proxy-Produktion ist
 * zusätzlich die gewählte Art wichtig. Eine Art ist entweder ein MPCFill-
 * Community-Art (Drive-Datei), ein Scryfall-Printing oder eine freie URL.
 *
 * Doppelseitige Karten liefern zusätzlich eine Rückseiten-Zeile. Sie wird
 * getrennt exportiert (100 Karten + X Rückseiten), damit die Druck-App beide
 * Bilder exakt so rendert, wie sie in der Kommandozentrale gewählt wurden.
 */

export interface ExportFace {
  name: string
  image_uris: Record<string, string> | null
}

export interface ExportCard {
  name: string
  quantity: number
  printing_id: string | null
  art_url: string | null
  artist: string | null
  back_printing_id: string | null
  back_art_url: string | null
  back_artist: string | null
  board: string
  faces: ExportFace[]
}

export interface ExportDeck {
  id: string
  name: string
  commander_name: string
  commander: ExportCard | null
  cards: ExportCard[]
  maybeboard: ExportCard[]
}

export type ArtSource = "mpcfill" | "scryfall" | "custom" | "none"

function parseFaces(raw: unknown): ExportFace[] {
  if (!raw) return []
  try {
    const value = JSON.parse(String(raw))
    if (!Array.isArray(value)) return []
    return value.map((face: any) => ({
      name: String(face?.name ?? ""),
      image_uris: face?.image_uris && typeof face.image_uris === "object" ? face.image_uris : null,
    }))
  } catch {
    return []
  }
}

function toCard(row: any): ExportCard {
  return {
    name: String(row.name),
    quantity: Math.max(1, Number(row.quantity ?? 1)),
    printing_id: row.printing_id ?? null,
    art_url: row.art_url ?? null,
    artist: row.artist ?? null,
    back_printing_id: row.back_printing_id ?? null,
    back_art_url: row.back_art_url ?? null,
    back_artist: row.back_artist ?? null,
    board: row.board === "maybeboard" ? "maybeboard" : row.board === "back" ? "back" : "main",
    faces: parseFaces(row.card_faces),
  }
}

export function loadDeckExport(deckId: string): ExportDeck | null {
  const d = db.query("SELECT * FROM deck WHERE id = ?").get(deckId) as any
  if (!d) return null
  const commanderBase = d.commander_oracle_id
    ? (db.query("SELECT name, card_faces FROM card WHERE oracle_id = ?").get(d.commander_oracle_id) as any)
    : null
  const rows = db
    .query(
      `SELECT c.name, c.card_faces, dc.quantity, dc.printing_id, dc.art_url, dc.artist,
              dc.back_printing_id, dc.back_art_url, dc.back_artist, dc.board
       FROM deck_card dc JOIN card c ON c.oracle_id = dc.oracle_id
       WHERE dc.deck_id = ?
       ORDER BY CASE WHEN dc.board = 'maybeboard' THEN 1 ELSE 0 END, dc.sort_order, c.name COLLATE NOCASE`,
    )
    .all(deckId) as any[]

  const commanderName = String(d.commander_name || commanderBase?.name || "")
  const commander: ExportCard | null = commanderName
    ? {
        name: String(commanderBase?.name ?? commanderName),
        quantity: 1,
        printing_id: d.commander_printing_id ?? null,
        art_url: d.commander_art_url ?? null,
        artist: d.commander_artist ?? null,
        back_printing_id: d.commander_back_printing_id ?? null,
        back_art_url: d.commander_back_art_url ?? null,
        back_artist: d.commander_back_artist ?? null,
        board: "commander",
        faces: parseFaces(commanderBase?.card_faces),
      }
    : null

  const all = rows.map(toCard)
  return {
    id: d.id,
    name: String(d.name ?? commanderName ?? "Deck"),
    commander_name: commanderName,
    commander,
    cards: all.filter((card) => card.board !== "maybeboard" && card.board !== "back"),
    maybeboard: all.filter((card) => card.board === "maybeboard"),
  }
}

export function findDeckExport(target: string): ExportDeck | null {
  const direct = loadDeckExport(target)
  if (direct) return direct
  const row = db
    .query("SELECT id FROM deck WHERE name LIKE ? COLLATE NOCASE ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 1")
    .get(`%${target}%`) as any
  return row ? loadDeckExport(row.id) : null
}

export function artSource(card: Pick<ExportCard, "printing_id" | "art_url">): ArtSource {
  if (String(card.printing_id ?? "").startsWith("mpcfill:")) return "mpcfill"
  if (card.art_url && /(^|\/\/)([^/]*\.)?scryfall\.io\//i.test(card.art_url)) return "scryfall"
  if (card.art_url) return "custom"
  return "none"
}

/** MPCFill-Drive-ID bzw. Scryfall-Printing-ID. Leer bei freier URL. */
export function artId(card: Pick<ExportCard, "printing_id" | "art_url">): string {
  const source = artSource(card)
  if (source === "mpcfill") return String(card.printing_id).slice("mpcfill:".length)
  if (source === "scryfall") return String(card.printing_id ?? "")
  return ""
}

function artLabel(card: ExportCard): string {
  const source = artSource(card)
  const id = artId(card)
  if (source === "mpcfill") return `MPCFill ${id}`
  if (source === "scryfall") return id ? `Scryfall ${id}` : "Scryfall (URL)"
  if (source === "custom") return "Custom"
  return "kein Art"
}

/**
 * Füllt fehlende Rückseiten-URLs. Bei einer Scryfall-Vorderseite wird das
 * exakte Printing per ID geladen; sonst dient die lokale Karten-Rückseite als
 * Fallback. So steht im Export immer ein echtes Bild, auch für Altbestände.
 */
export async function enrichDeckBacks(deck: ExportDeck): Promise<void> {
  const all = [deck.commander, ...deck.cards, ...deck.maybeboard].filter(Boolean) as ExportCard[]
  for (const card of all) {
    if (card.faces.length < 2) continue
    if (card.back_art_url) continue
    const printingId = card.back_printing_id || card.printing_id
    if (printingId && !printingId.startsWith("mpcfill:")) {
      try {
        const printing = await scryfallJson<any>(
          `https://api.scryfall.com/cards/${encodeURIComponent(printingId)}`,
          1000 * 60 * 60 * 24,
        )
        const face = printing?.card_faces?.[1]
        const image = face?.image_uris
        if (image) {
          card.back_printing_id = printingId
          card.back_art_url = image.normal ?? image.large ?? image.png ?? null
          card.back_artist = face?.artist ?? printing?.artist ?? null
          continue
        }
      } catch {
        // Offline oder kein Printing: lokale Rückseite unten.
      }
    }
    const image = card.faces[1]?.image_uris
    if (image) card.back_art_url = image.normal ?? image.large ?? image.png ?? null
  }
}

/** Baut aus der gewählten/abgeleiteten Rückseite eine eigene Exportzeile. */
export function backExportCard(card: ExportCard): ExportCard | null {
  const back = card.faces[1]
  if (!back) return null
  const backUrl = card.back_art_url ?? back.image_uris?.normal ?? back.image_uris?.large ?? back.image_uris?.png ?? null
  const scryfallFront = card.printing_id && !String(card.printing_id).startsWith("mpcfill:")
  const backPrinting =
    card.back_printing_id ?? (card.back_art_url ? null : scryfallFront ? card.printing_id : null)
  return {
    name: back.name || `${card.name} (Rückseite)`,
    quantity: card.quantity,
    printing_id: backPrinting,
    art_url: backUrl,
    artist: card.back_artist ?? null,
    back_printing_id: null,
    back_art_url: null,
    back_artist: null,
    board: "back",
    faces: [],
  }
}

function backCards(deck: ExportDeck): ExportCard[] {
  const out: ExportCard[] = []
  for (const card of [deck.commander, ...deck.cards].filter(Boolean) as ExportCard[]) {
    const back = backExportCard(card)
    if (back) out.push(back)
  }
  return out
}

export function buildDeckList(deck: ExportDeck): string {
  const lines = [`1 ${deck.commander_name}`, ""]
  for (const card of deck.cards) lines.push(`${card.quantity} ${card.name}`)
  if (deck.maybeboard.length > 0) {
    lines.push("", "// Maybeboard")
    for (const card of deck.maybeboard) lines.push(`${card.quantity} ${card.name}`)
  }
  return lines.join("\n")
}

function artLine(card: ExportCard): string {
  const parts = [`${card.quantity} ${card.name}`, artLabel(card)]
  if (card.artist) parts.push(`Artist: ${card.artist}`)
  if (card.art_url) parts.push(card.art_url)
  return parts.join(" | ")
}

export function buildDeckArtList(deck: ExportDeck): string {
  const stamp = new Date().toISOString().slice(0, 10)
  const lines = [
    `# ${deck.name}`,
    `# Deckliste mit Arts · ${stamp}`,
    "# Format: Menge Name | Quelle Art-ID | Artist | URL | Back (nur Rückseiten)",
    "",
    "Commander",
  ]
  if (deck.commander) lines.push(artLine(deck.commander))
  lines.push("", "Deck")
  for (const card of deck.cards) lines.push(artLine(card))
  if (deck.maybeboard.length > 0) {
    lines.push("", "Maybeboard")
    for (const card of deck.maybeboard) lines.push(artLine(card))
  }
  const backs = backCards(deck)
  if (backs.length > 0) {
    lines.push("", "Rückseiten")
    for (const card of backs) lines.push(`${artLine(card)} | Back`)
  }
  return lines.join("\n")
}

function tsvCell(value: unknown): string {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ").trim()
}

export function buildDeckArtTsv(deck: ExportDeck): string {
  const header = ["quantity", "name", "board", "source", "printing_id", "art_id", "art_url", "artist", "face"]
  const rows: string[][] = []
  const push = (card: ExportCard, face: "front" | "back") => {
    rows.push([
      String(card.quantity),
      card.name,
      card.board,
      artSource(card),
      card.printing_id ?? "",
      artId(card),
      card.art_url ?? "",
      card.artist ?? "",
      face,
    ])
  }
  if (deck.commander) push(deck.commander, "front")
  for (const card of deck.cards) push(card, "front")
  for (const card of deck.maybeboard) push(card, "front")
  for (const card of backCards(deck)) push(card, "back")
  return [header, ...rows].map((row) => row.map(tsvCell).join("\t")).join("\n")
}

export function deckExportFilename(deck: ExportDeck, suffix: string, ext: string): string {
  const slug = deck.name
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "deck"
  return `${slug}${suffix ? `-${suffix}` : ""}.${ext}`
}

export function exportDir(): string {
  return process.env.KZ_EXPORT_DIR?.trim() || `${ROOT}/exports`
}
