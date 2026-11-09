export interface ParsedEntry {
  quantity: number
  name: string
  section: string
}

export interface ParsedDeckList {
  entries: ParsedEntry[]
  commanderName: string | null
  sections: string[]
}

const KNOWN_SECTIONS = new Set([
  "commander",
  "command zone",
  "deck",
  "mainboard",
  "main deck",
  "main",
  "maybeboard",
  "maybe",
  "sideboard",
  "side",
  "tokens",
  "token",
  "companion",
  "about",
  "description",
  "categories",
])

function sectionFor(header: string): string | null {
  if (/^\d/.test(header.trim())) return null
  const normalized = header
    .replace(/[:\-–—]+$/, "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .trim()
    .toLowerCase()
  if (!normalized) return null
  if (KNOWN_SECTIONS.has(normalized)) {
    if (normalized === "commander" || normalized === "command zone") return "commander"
    if (normalized === "maybeboard" || normalized === "maybe") return "maybeboard"
    if (normalized === "sideboard" || normalized === "side") return "sideboard"
    if (normalized === "tokens" || normalized === "token") return "tokens"
    if (normalized === "companion") return "companion"
    return "main"
  }
  // Archidekt-style category headers such as "Ramp (10)" or "Lands (37)"
  if (/^[a-zäöüß0-9 /&'()\-]+\(\d+\)$/i.test(header.trim())) return "main"
  return null
}

function cleanName(value: string): string {
  let line = value.replace(/\u00a0/g, " ").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim()
  line = line.replace(/\s+\*[A-Za-z]+\*\s*$/, "")
  line = line.replace(/\s+\([A-Za-z0-9]{2,8}\)\s+\d+[a-z]?\s*$/i, "")
  line = line.replace(/\s+\([A-Za-z0-9]{2,8}\)\s*$/, "")
  line = line.replace(/\s+\[[A-Za-z0-9]{2,8}\]\s*\d*[a-z]?\s*$/, "")
  line = line.replace(/\s+\{[A-Za-z0-9]{2,8}\}\s*$/, "")
  line = line.replace(/\s+#!?\S+.*$/, "")
  return line.replace(/\s+/g, " ").trim()
}

export function parseDeckList(text: string): ParsedDeckList {
  const entries: ParsedEntry[] = []
  let section = "main"
  let commanderName: string | null = null

  for (const rawLine of text.replace(/\r/g, "").split("\n")) {
    let line = rawLine.replace(/^\ufeff/, "").trim()
    if (!line) continue
    if (line.startsWith("//") || line.startsWith(";;") || line.startsWith("SB:")) continue
    if (/^#\s/.test(line)) continue

    const header = sectionFor(line)
    if (header) {
      section = header
      continue
    }

    let quantity = 1
    const withX = line.match(/^(\d+)\s*[xX]\s*(.+)$/)
    const withSpace = line.match(/^(\d+)\s+(.+)$/)
    const match = withX ?? withSpace
    if (match) {
      quantity = Math.max(1, Number(match[1]))
      line = match[2]
    } else if (/^\d+\s*[xX]?$/.test(line)) {
      continue
    }

    const name = cleanName(line)
    if (!name) continue
    if (section === "commander" && !commanderName) commanderName = name
    entries.push({ quantity, name, section })
  }

  return {
    entries,
    commanderName,
    sections: [...new Set(entries.map((e) => e.section))],
  }
}

export function isSkippedSection(section: string): boolean {
  return ["maybeboard", "sideboard", "tokens", "companion", "about", "description", "categories"].includes(section)
}
