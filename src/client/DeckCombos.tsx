import { useEffect, useState } from "react"
import { api, type ComboTranslation, type Deck, type DeckComboResult, type DeckComboVariant } from "./api"
import { Icon, cx } from "./ui"

function namesOf(deck: Deck): Set<string> {
  return new Set(deck.cards.map((card) => card.name.toLowerCase()))
}

function missingCards(deck: Deck, variant: DeckComboVariant): string[] {
  const names = namesOf(deck)
  return variant.cards.map((card) => card.name).filter((name) => !names.has(name.toLowerCase()))
}

const comboGuard = new Map<string, Set<string>>()

export function wouldBreakCombo(deckId: string, name: string): boolean {
  return comboGuard.get(deckId)?.has(name.toLowerCase()) ?? false
}

function rememberIncludedCombos(deckId: string, variants: DeckComboVariant[]) {
  const names = new Set<string>()
  for (const variant of variants) for (const card of variant.cards) names.add(card.name.toLowerCase())
  comboGuard.set(deckId, names)
}

const ROLE_LIMITS: Record<string, number> = {
  land: 38,
  ramp: 12,
  draw: 12,
  removal: 10,
  wipe: 4,
  tutor: 4,
  recursion: 6,
  wincon: 5,
  synergy: 12,
  protection: 8,
  flex: 10,
}

function suggestedCuts(deck: Deck, variant: DeckComboVariant): Deck["cards"] {
  const combo = new Set(variant.cards.map((card) => card.name.toLowerCase()))
  const counts = deck.analysis?.counts ?? {}
  const overrepresented = Object.entries(ROLE_LIMITS)
    .filter(([role, limit]) => (counts[role] ?? 0) > limit)
    .map(([role]) => role)
  const eligible = deck.cards.filter(
    (card) => card.role !== "commander" && card.role !== "land" && !combo.has(card.name.toLowerCase()),
  )
  const preferred = overrepresented.length
    ? eligible.filter((card) => overrepresented.includes(card.role))
    : eligible.filter((card) => card.role === "flex" || card.role === "synergy")
  return preferred
    .slice()
    .sort((a, b) => (b.edhrec_rank ?? 999999) - (a.edhrec_rank ?? 999999))
    .slice(0, 2)
}

function ComboEntry({
  deck,
  variant,
  translation,
  almost = false,
  onAdd,
  onSwap,
}: {
  deck: Deck
  variant: DeckComboVariant
  translation?: ComboTranslation
  almost?: boolean
  onAdd: (name: string) => Promise<boolean> | void
  onSwap: (addName: string, removeOracleId: string) => Promise<boolean> | void
}) {
  const missing = almost ? missingCards(deck, variant) : []
  const cuts = almost ? suggestedCuts(deck, variant) : []
  const [busy, setBusy] = useState(false)
  const description = translation?.description?.trim() || variant.description
  const produces = translation?.produces?.length ? translation.produces : variant.produces
  const easyPrerequisites = translation?.easyPrerequisites?.trim() || variant.easyPrerequisites
  const notablePrerequisites = translation?.notablePrerequisites?.trim() || variant.notablePrerequisites

  async function add(name: string) {
    setBusy(true)
    try {
      await onAdd(name)
    } finally {
      setBusy(false)
    }
  }

  async function swap(name: string, cutOracleId: string) {
    setBusy(true)
    try {
      await onSwap(name, cutOracleId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className={cx("combo-entry", almost && "is-almost")}>
      <div className="combo-entry-head">
        <div>
          <h4>{description.split("\n")[0]}</h4>
          <span className="combo-meta">
            {variant.identity && <span>{variant.identity}</span>}
            {variant.bracketTag && <span className="badge">{variant.bracketTag}</span>}
            {variant.manaNeeded && <span>Mana: {variant.manaNeeded}</span>}
            {variant.popularity != null && <span>{variant.popularity.toLocaleString("de-DE")} Decks</span>}
          </span>
        </div>
        <a className="icon-button" href={`https://commanderspellbook.com/combo/${encodeURIComponent(variant.id)}/`} target="_blank" rel="noreferrer" aria-label="Bei Commander Spellbook öffnen">
          <Icon name="arrow" size={16} />
        </a>
      </div>
      <p className="combo-description">{description}</p>
      <div className="combo-tags">
        {variant.cards.map((card) => (
          <span className={card.mustBeCommander ? "combo-card is-commander" : "combo-card"} key={`${variant.id}-${card.name}`}>
            {card.quantity > 1 ? `${card.quantity}× ` : ""}
            {card.name}
          </span>
        ))}
      </div>
      {missing.length > 0 && (
        <div className="combo-actions">
          <p className="field-note">
            Fehlt noch: <strong>{missing.join(", ")}</strong>
          </p>
          <div className="combo-action-row">
            {missing.map((name) => (
              <button type="button" className="button ghost" key={name} onClick={() => void add(name)} disabled={busy}>
                <Icon name="plus" size={14} /> {name}
              </button>
            ))}
            {missing[0] && cuts[0] && (
              <button type="button" className="text-link" onClick={() => void swap(missing[0], cuts[0].oracle_id)} disabled={busy}>
                Tauschen gegen {cuts[0].name}
              </button>
            )}
          </div>
          {cuts.length > 0 && (
            <p className="field-note">
              Schnittvorschlag: {cuts.map((card) => card.name).join(" oder ")}.
            </p>
          )}
        </div>
      )}
      {produces.length > 0 && (
        <p className="combo-line">
          <span>Erzeugt</span> {produces.join(" · ")}
        </p>
      )}
      {(easyPrerequisites || notablePrerequisites) && (
        <p className="combo-line">
          <span>Voraussetzung</span> {[easyPrerequisites, notablePrerequisites].filter(Boolean).join(" · ")}
        </p>
      )}
    </article>
  )
}

export function DeckCombos({
  deck,
  onNotice,
  onAdd,
  onSwap,
}: {
  deck: Deck
  onNotice: (text: string) => void
  onAdd: (name: string) => Promise<boolean> | void
  onSwap: (addName: string, removeOracleId: string) => Promise<boolean> | void
}) {
  const [data, setData] = useState<DeckComboResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [translations, setTranslations] = useState<Record<string, ComboTranslation>>({})
  const [translating, setTranslating] = useState(false)
  const [translationError, setTranslationError] = useState<string | null>(null)

  async function load(refresh: boolean) {
    setLoading(true)
    setError(null)
    try {
      const next = await api.deckCombos(deck.id, refresh)
      setData(next)
      rememberIncludedCombos(deck.id, next.included)
      if (next.warning) onNotice(next.warning)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setData(null)
    void load(false)
    // The deck fingerprint is the cache key; reload when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.id, deck.updated_at])

  useEffect(() => {
    if (!data) return
    const visible = [...data.included, ...data.almostIncluded.slice(0, 12)]
    if (visible.length === 0) return
    let alive = true
    setTranslating(true)
    setTranslationError(null)
    api
      .translateCombos(
        visible.map((variant) => ({
          id: variant.id,
          description: variant.description,
          produces: variant.produces,
          easyPrerequisites: variant.easyPrerequisites,
          notablePrerequisites: variant.notablePrerequisites,
          cardNames: variant.cards.map((card) => card.name),
        })),
      )
      .then((result) => {
        if (!alive) return
        setTranslations((current) => ({ ...current, ...result.translations }))
        if (result.error) setTranslationError(result.error)
      })
      .catch((err) => {
        if (alive) setTranslationError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (alive) setTranslating(false)
      })
    return () => {
      alive = false
    }
  }, [data])

  const included = data?.included ?? []
  const almost = data?.almostIncluded ?? []

  return (
    <div className="combo-panel">
      <div className="combo-head">
        <div>
          <h3>Combos im Deck</h3>
          <p className="muted">Commander Spellbook zeigt vollständige Linien und Karten, die nur noch einen Baustein brauchen. Die App fügt nichts automatisch hinzu.</p>
          {translating && <p className="field-note combo-translation-note">Deutsche Fassung wird geladen …</p>}
          {translationError && <p className="field-note">Deutsche Übersetzung gerade nicht verfügbar; die englischen Originaltexte bleiben sichtbar.</p>}
        </div>
        <button type="button" className="button ghost" onClick={() => void load(true)} disabled={loading}>
          <Icon name="refresh" size={15} /> {loading ? "Fragt…" : "Neu prüfen"}
        </button>
      </div>

      {data?.warning && <p className="field-note is-error">{data.warning}</p>}
      {error && <p className="field-note is-error">{error}</p>}
      {loading && !data && <p className="muted">Commander Spellbook wird gefragt.</p>}

      {data && (
        <>
          <div className="combo-summary">
            <div>
              <strong>{included.length}</strong>
              <span>vollständig</span>
            </div>
            <div>
              <strong>{almost.length}</strong>
              <span>fast dabei</span>
            </div>
            <div>
              <strong>{data.identity || "—"}</strong>
              <span>Farbidentität</span>
            </div>
          </div>

          <section className="combo-section">
            <div className="panel-head">
              <h4>Vollständig im Deck</h4>
              <span className="panel-count">{included.length}</span>
            </div>
            {included.length === 0 ? (
              <p className="muted">Keine vollständige Combo gefunden. Das ist kein Fehler: Viele Decks gewinnen über Druck und Wert, nicht über eine Endlosschleife.</p>
            ) : (
              <div className="combo-list">
                {included.map((variant) => (
                  <ComboEntry deck={deck} variant={variant} translation={translations[variant.id]} onAdd={onAdd} onSwap={onSwap} key={variant.id} />
                ))}
              </div>
            )}
          </section>

          <section className="combo-section">
            <div className="panel-head">
              <h4>Fast dabei</h4>
              <span className="panel-count">{almost.length}</span>
            </div>
            {almost.length === 0 ? (
              <p className="muted">Keine Fast-Combos gefunden.</p>
            ) : (
              <div className="combo-list">
                {almost.slice(0, 12).map((variant) => (
                  <ComboEntry deck={deck} variant={variant} translation={translations[variant.id]} almost onAdd={onAdd} onSwap={onSwap} key={variant.id} />
                ))}
              </div>
            )}
          </section>

          <p className="field-note">
            Quelle: <a href={data.sourceUrl} target="_blank" rel="noreferrer">{data.source}</a> · Stand{" "}
            {new Date(data.fetchedAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}
            {data.cached ? " · aus dem Cache" : ""}
            {Object.keys(translations).length > 0 ? " · Combos maschinell übersetzt" : ""}
          </p>
        </>
      )}
    </div>
  )
}
