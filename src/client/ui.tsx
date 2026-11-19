import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react"
import { api } from "./api"

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ")
}

const ICONS: Record<string, ReactNode> = {
  home: (
    <>
      <path d="M4 10.5L12 4l8 6.5" />
      <path d="M6 9.5V20h12V9.5" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  cards: (
    <>
      <rect x="3" y="5" width="13" height="16" rx="1.5" />
      <path d="M8 3h11a2 2 0 0 1 2 2v13" />
    </>
  ),
  hammer: (
    <>
      <path d="M14 4l6 6" />
      <path d="M12 6l6 6" />
      <path d="M4 20l7-7" />
      <path d="M3 21l3-1 1-3" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
      <path d="M4 5.5v16" />
      <path d="M8 7h8" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="9" cy="6" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="8" cy="18" r="2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <path d="M7.5 10.5L12 15l4.5-4.5" />
      <path d="M5 19h14" />
    </>
  ),
  upload: (
    <>
      <path d="M12 20V9" />
      <path d="M7.5 13.5L12 9l4.5 4.5" />
      <path d="M5 4h14" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z" />
      <path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="M21 15l-5-5L5 20" />
    </>
  ),
  check: <path d="M4 12.5l5 5L20 6.5" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="1.5" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path d="M20 4v5h-5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </>
  ),
  logout: (
    <>
      <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" />
      <path d="M16 8l4 4-4 4" />
      <path d="M20 12H9" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="1.5" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </>
  ),
  bookmark: (
    <>
      <path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4z" />
    </>
  ),
  qr: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1" />
    </>
  ),
  wifi: (
    <>
      <path d="M2 9a16 16 0 0 1 20 0" />
      <path d="M5 12.5a11 11 0 0 1 14 0" />
      <path d="M8.5 16a6 6 0 0 1 7 0" />
      <circle cx="12" cy="19.5" r="1" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M3 9h18M9 9v11M15 9v11" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  list: (
    <>
      <path d="M9 6h12M9 12h12M9 18h12" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20V7" />
      <path d="M2 20h22" />
    </>
  ),
}

export function Icon({ name, size = 18 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

const MANA_COLORS: Record<string, string> = { W: "w", U: "u", B: "b", R: "r", G: "g" }

export function ManaCost({ cost }: { cost: string | null }) {
  if (!cost) return <span className="mana-empty">ohne</span>
  const symbols = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])
  if (!symbols.length) return <span className="mana-empty">{cost}</span>
  return (
    <span className="mana-cost" aria-label={`Manakosten ${cost}`}>
      {symbols.map((sym, i) => {
        const normalized = sym.toUpperCase()
        const color = MANA_COLORS[normalized]
        const hybrid = normalized.includes("/")
        return (
          <span key={`${sym}-${i}`} className={cx("mana", color ? `mana-${color}` : "mana-generic", hybrid && "mana-hybrid")} title={sym}>
            {sym.replace(/\//g, "")}
          </span>
        )
      })}
    </span>
  )
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="toggle-row">
      <div className="toggle-copy">
        <span className="toggle-label">{label}</span>
        <span className="toggle-hint">{hint}</span>
      </div>
      <button type="button" role="switch" aria-checked={checked} className={cx("switch", checked && "is-on")} onClick={() => onChange(!checked)}>
        <span className="switch-knob" />
      </button>
    </div>
  )
}

export function NumberField({
  label,
  hint,
  value,
  onChange,
  max = 30,
}: {
  label: string
  hint: string
  value: number | null
  onChange: (next: number | null) => void
  max?: number
}) {
  return (
    <label className="number-row">
      <span className="number-copy">
        <span className="toggle-label">{label}</span>
        <span className="toggle-hint">{hint}</span>
      </span>
      <input
        type="number"
        min={0}
        max={max}
        value={value ?? ""}
        placeholder="kein Limit"
        onChange={(e) => onChange(e.target.value === "" ? null : Math.max(0, Math.min(max, Number(e.target.value))))}
      />
    </label>
  )
}

export function BracketDial({
  brackets,
  value,
  onChange,
  compact = false,
}: {
  brackets: Array<{ id: 3 | 4 | 5; name: string; tagline: string; expected_turns: string }>
  value: 3 | 4 | 5
  onChange: (next: 3 | 4 | 5) => void
  compact?: boolean
}) {
  return (
    <div className={cx("bracket-dial", compact && "is-compact")}>
      <div className="bracket-options" role="group" aria-label="Bracket">
        {brackets.map((b) => (
          <button key={b.id} type="button" className={cx("bracket-option", value === b.id && "is-active")} aria-pressed={value === b.id} onClick={() => onChange(b.id)}>
            <span className="bracket-number">{b.id}</span>
            <span className="bracket-name">{b.name === "Unser Maximum" ? "Maximum" : b.name}</span>
          </button>
        ))}
      </div>
      {!compact && (
        <p className="bracket-note">
          {brackets.find((b) => b.id === value)?.tagline} Erwartet {brackets.find((b) => b.id === value)?.expected_turns}.
        </p>
      )}
    </div>
  )
}

export function PodPicker({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  return (
    <div className="pod-picker" role="group" aria-label="Pod-Größe">
      {[3, 4, 5].map((n) => (
        <button key={n} type="button" className={cx("pod-option", value === n && "is-active")} aria-pressed={value === n} onClick={() => onChange(n)}>
          {n}
          <span>Spieler</span>
        </button>
      ))}
    </div>
  )
}

const SEARCH_MODE_LABELS: Record<"auto" | "name" | "effect" | "semantic", string> = {
  auto: "Auto",
  name: "Name",
  effect: "Effekt",
  semantic: "Semantik",
}

const TAG_LABELS: Record<string, string> = {
  sweeper: "Boardwipe",
  "sweeper-one-sided": "einseitiger Wipe",
  "multi-removal": "Massenentfernung",
  "spot-removal": "Removal",
  "removal-creature": "Kreaturenentfernung",
  "removal-destroy": "Zerstörung",
  "removal-exile": "Exil",
  "removal-sacrifice": "Opfer-Zwang",
  "removal-enchantment": "Verzauberung entfernen",
  "removal-artifact": "Artefakt entfernen",
  "removal-land": "Land entfernen",
  ramp: "Ramp",
  "land-ramp": "Land-Ramp",
  "mana-rock": "Mana-Rock",
  "mana-dork": "Mana-Dork",
  ritual: "Ritual",
  "draw-engine": "Draw-Engine",
  "pure-draw": "Kartenziehen",
  "burst-draw": "Draw-Zauber",
  cantrip: "Cantrip",
  "repeatable-pure-draw": "wiederholbares Ziehen",
  "repeatable-card-advantage": "Kartenvorteil",
  "tutor-to-hand": "Tutor",
  "tutor-to-top": "Tutor (auf die Bibliothek)",
  "tutor-to-battlefield": "Tutor ins Spiel",
  "tutor-creature": "Kreatur-Tutor",
  "tutor-land-basic": "Land-Tutor",
  "tutor-artifact": "Artefakt-Tutor",
  counterspell: "Gegenzauber",
  "counterspell-soft": "weicher Gegenzauber",
  "reanimate-creature": "Reanimation",
  "theft-creature": "Kontrolle übernehmen",
  "hate-graveyard": "Friedhofshass",
  "sweeper-graveyard": "Friedhof leeren",
  "extra-turn": "Extrazug",
  lifegain: "Lebensgewinn",
  "drain-life": "Leben absaugen",
  "sacrifice-outlet-creature": "Opfer-Outlet",
  "mass-land-denial": "Landzerstörung",
  "repeatable-creature-tokens": "Token-Engine",
}

function tagLabel(tag: string): string {
  return TAG_LABELS[tag] ?? tag.replace(/-/g, " ")
}

export function SearchBox({
  onPick,
  placeholder,
  autoFocus = false,
  mode: initialMode = "auto",
  context,
}: {
  onPick: (name: string) => void
  placeholder: string
  autoFocus?: boolean
  mode?: "auto" | "name" | "effect" | "semantic"
  context?: { colorIdentity?: string[]; commanderLegal?: boolean }
}) {
  const [q, setQ] = useState("")
  const [mode, setMode] = useState<"auto" | "name" | "effect" | "semantic">(initialMode)
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [interpreting, setInterpreting] = useState(false)
  const [interpreted, setInterpreted] = useState<string[]>([])
  const timer = useRef<number | null>(null)
  const colorKey = (context?.colorIdentity ?? []).join("")

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      setLoading(true)
      try {
        setResults(await api.search(q, { mode, color: context?.colorIdentity, legal: context?.commanderLegal }))
        setInterpreted([])
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 220)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [q, mode, colorKey])

  const interpret = async () => {
    if (!q.trim() || interpreting) return
    setInterpreting(true)
    try {
      const res = await api.interpret({ q, colorIdentity: context?.colorIdentity, commanderLegal: context?.commanderLegal })
      setResults(res.results)
      setInterpreted(res.spec ? [...res.spec.terms, ...res.spec.tags.map(tagLabel)] : [])
    } catch {
      // Stufe 1 bleibt stehen
    } finally {
      setInterpreting(false)
    }
  }

  return (
    <div className="search">
      <div className="search-field">
        <Icon name="search" size={18} />
        <input
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && mode !== "name" && mode !== "semantic") {
              e.preventDefault()
              void interpret()
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
        />
        {loading && <span className="search-loading">sucht</span>}
        {interpreting && <span className="search-loading">versteht…</span>}
      </div>
      <div className="search-modes">
        {(["auto", "name", "effect", "semantic"] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={cx("search-mode", mode === option && "is-active")}
            onClick={() => setMode(option)}
            aria-pressed={mode === option}
          >
            {SEARCH_MODE_LABELS[option]}
          </button>
        ))}
        <span className="search-hint">
          {mode === "name"
            ? "nur Namen"
            : mode === "semantic"
              ? "nach Bedeutung & Mechanik"
              : "Enter für ganze Sätze"}
        </span>
      </div>
      {interpreted.length > 0 && <p className="search-interpreted">verstanden als: {interpreted.join(" · ")}</p>}
      <div className="search-results">
        {results.map((r) => {
          const img = r.image_uris?.art_crop ?? r.image_uris?.normal
          const legal = r.legalities?.commander
          return (
            <button key={r.oracle_id} type="button" className="search-result" onClick={() => onPick(r.name)}>
              <span className="search-thumb" style={img ? { backgroundImage: `url(${img})` } : undefined} />
              <span className="search-copy">
                <span className="search-name">
                  {r.name}
                  {r.is_game_changer && <span className="badge">GC</span>}
                  {r.is_one_win && <span className="badge is-warn">1-Win</span>}
                </span>
                <span className="search-meta">
                  {r.mana_cost} {r.type_line}
                </span>
                {r.matched?.tags?.length ? (
                  <span className="search-tags">
                    {r.matched.tags.map((tag: string) => (
                      <span key={tag} className="search-tag">
                        {tagLabel(tag)}
                      </span>
                    ))}
                  </span>
                ) : null}
                {r.matched?.snippet ? <span className="search-snippet">{r.matched.snippet}</span> : null}
              </span>
              <span className={cx("search-legal", legal === "legal" ? "is-ok" : "is-warn")}>{legal === "legal" ? "legal" : "nicht legal"}</span>
            </button>
          )
        })}
        {!loading && !interpreting && q.trim() && results.length === 0 && (
          <p className="search-empty">Keine Karte gefunden. Andere Schreibweise oder „Effekt“ probieren.</p>
        )}
      </div>
    </div>
  )
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function inline(text: string, cardLinks = false) {
  return escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`(.+?)`/g, cardLinks ? '<code class="card-link" data-card-name="$1" title="Karte ansehen">$1</code>' : "<code>$1</code>")
}

export function Markdown({ text, onCardName }: { text: string; onCardName?: (name: string) => void }) {
    const lines = text.split("\n")
    const blocks: ReactNode[] = []
    let list: string[] = []
    const onContentClick = (event: MouseEvent<HTMLDivElement>) => {
      if (!onCardName) return
      const target = (event.target as HTMLElement).closest("[data-card-name]") as HTMLElement | null
      if (!target) return
      event.preventDefault()
      const name = target.getAttribute("data-card-name")
      if (name) onCardName(name)
    }
    const flush = () => {
    if (!list.length) return
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {list.map((item, i) => (
          <li key={i} dangerouslySetInnerHTML={{ __html: inline(item, Boolean(onCardName)) }} />
        ))}
      </ul>,
    )
    list = []
  }
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      flush()
      continue
    }
    if (trimmed.startsWith("### ")) {
      flush()
      blocks.push(<h3 key={blocks.length}>{trimmed.slice(4)}</h3>)
    } else if (trimmed.startsWith("## ")) {
      flush()
      blocks.push(<h2 key={blocks.length}>{trimmed.slice(3)}</h2>)
    } else if (trimmed.startsWith("# ")) {
      flush()
      blocks.push(<h2 key={blocks.length}>{trimmed.slice(2)}</h2>)
    } else if (trimmed.startsWith("- ")) {
      list.push(trimmed.slice(2))
    } else {
      flush()
        blocks.push(<p key={blocks.length} dangerouslySetInnerHTML={{ __html: inline(trimmed, Boolean(onCardName)) }} />)
    }
  }
    flush()
    return <div className="markdown" onClick={onContentClick}>{blocks}</div>
  }

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener("keydown", onKey)
    }
  }, [onClose])
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className={cx("modal-panel", wide && "is-wide")} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Schließen">
            <Icon name="close" />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}

export function artSrc(url: string | null | undefined) {
  if (!url) return ""
  if (url.includes("drive.google.com") || url.includes("googleusercontent.com")) return `/api/art/image?url=${encodeURIComponent(url)}`
  return url
}
