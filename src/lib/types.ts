export type BracketId = 3 | 4 | 5
export type Role =
  | "commander"
  | "land"
  | "ramp"
  | "draw"
  | "removal"
  | "wipe"
  | "protection"
  | "tutor"
  | "recursion"
  | "wincon"
  | "synergy"
  | "flex"

export interface Card {
  oracle_id: string
  name: string
  mana_cost: string | null
  cmc: number
  type_line: string
  oracle_text: string | null
  oracle_text_all: string | null
  colors: string[]
  color_identity: string[]
  keywords: string[]
  legalities: Record<string, string>
  edhrec_rank: number | null
  image_uris: Record<string, string> | null
  card_faces: Array<{
    name?: string
    mana_cost?: string
    type_line?: string
    oracle_text?: string
    power?: string
    toughness?: string
    image_uris?: Record<string, string>
  }> | null
  layout: string | null
  set_code: string | null
  collector_number: string | null
  rarity: string | null
  power: string | null
  toughness: string | null
  loyalty: string | null
  defense: string | null
  produced_mana: string[]
  is_game_changer: boolean
  is_one_win: boolean
  is_land: boolean
  is_creature: boolean
  is_legendary: boolean
  tags?: string[]
}

export interface DeckSettings {
  zeroRule: boolean
  allowIllegal: boolean
  allowBanned: boolean
  allowUnCards: boolean
  enforceDeckSize: boolean
  enforceSingleton: boolean
  maxGameChangers: number | null
  maxTutors: number | null
  maxExtraTurns: number | null
  allowMassLandDenial: boolean
  allowCombos: boolean
  saltBudget: number | null
}

export const DEFAULT_SETTINGS: DeckSettings = {
  zeroRule: true,
  allowIllegal: true,
  allowBanned: true,
  allowUnCards: true,
  enforceDeckSize: true,
  enforceSingleton: true,
  maxGameChangers: null,
  maxTutors: null,
  maxExtraTurns: null,
  allowMassLandDenial: true,
  allowCombos: true,
  saltBudget: null,
}

export const SETTING_LABELS: Array<{
  key: keyof DeckSettings
  label: string
  hint: string
  kind: "bool" | "number"
}> = [
  { key: "zeroRule", label: "0 Rule", hint: "Legalität, Banlist und Un-Cards sind dann nur Hinweise. Farbidentität bleibt Pflicht.", kind: "bool" },
  { key: "allowIllegal", label: "Illegale Karten", hint: "Karten, die offiziell nicht Commander-legal sind, bleiben im Pool.", kind: "bool" },
  { key: "allowBanned", label: "Banlist ignorieren", hint: "Verbannte Karten werden nicht ausgefiltert.", kind: "bool" },
  { key: "allowUnCards", label: "Un-Cards und Playtest", hint: "Silberrand, Playtest, Spaßkarten. Der Regel-Richter markiert sie als nicht offiziell geregelt.", kind: "bool" },
  { key: "enforceDeckSize", label: "100 Karten prüfen", hint: "Strukturell: genau 100 inklusive Commander.", kind: "bool" },
  { key: "enforceSingleton", label: "Singleton prüfen", hint: "Eine Karte pro englischem Namen, außer Basics.", kind: "bool" },
  { key: "maxGameChangers", label: "Max. Game Changers", hint: "Leer = kein Limit. B3 erlaubt offiziell 3.", kind: "number" },
  { key: "maxTutors", label: "Max. Tutoren", hint: "Leer = kein Limit. Zählt Karten mit Tutor-Tag.", kind: "number" },
  { key: "maxExtraTurns", label: "Max. Extra-Züge", hint: "Leer = kein Limit. Zählt Effekte, die Züge wiederholen.", kind: "number" },
  { key: "allowMassLandDenial", label: "Mass Land Denial", hint: "Armageddon und Freunde. Standardmäßig an, weil 0 Rule.", kind: "bool" },
  { key: "allowCombos", label: "Combos erlauben", hint: "Endlose Combos sind nicht automatisch verboten.", kind: "bool" },
  { key: "saltBudget", label: "Salz-Budget", hint: "Leer = kein Limit. 1 = mild, 5 = richtig bitter.", kind: "number" },
]

export interface BracketInfo {
  id: BracketId
  name: string
  tagline: string
  description: string
  gc_limit: number | null
  expected_turns: string
  quotas: Record<string, number>
}

export interface BracketReport {
  bracket: BracketId
  label: string
  confidence: "niedrig" | "mittel" | "hoch"
  reasons: string[]
  signals: Record<string, number | string | boolean>
}

export interface DeckCard {
  oracle_id: string
  name: string
  mana_cost: string | null
  cmc: number
  type_line: string
  oracle_text: string | null
  colors: string[]
  color_identity: string[]
  image_uris: Record<string, string> | null
  edhrec_rank: number | null
  is_game_changer: boolean
  is_one_win: boolean
  produced_mana: string[]
  legalities: Record<string, string>
  role: Role
  category: string
  reason: string
  printing_id: string | null
  art_url: string | null
  artist: string | null
  quantity: number
  is_commander: boolean
  tags: string[]
  board?: "main" | "maybeboard"
}

export interface DeckAnalysis {
  total: number
  lands: number
  nonLands: number
  counts: Record<string, number>
  curve: Array<{ label: string; count: number }>
  averageMv: number
  pips: Record<string, number>
  sources: Record<string, number>
  bracket: BracketReport
  warnings: Array<{ level: "error" | "warn" | "info"; text: string }>
  goldfish: {
    averageCommanderTurn: number | null
    missedLandDropRate: number
    averageLandsByTurn4: number
    colorScrewRate: number
  }
}

export interface DeckRecord {
  id: string
  name: string
  commander_oracle_id: string | null
  commander_name: string | null
  bracket: BracketId
  pod_size: number
  settings: DeckSettings
  primer: string | null
  status: string
  created_at: string
  updated_at: string
  cards: DeckCard[]
  analysis: DeckAnalysis | null
}

export interface BuildStatus {
  id: string
  deck_id: string
  status: "queued" | "running" | "done" | "error"
  message: string | null
  error: string | null
  provider: string | null
  model: string | null
}
