import { useEffect, useMemo, useState } from "react"
import type { Deck } from "./api"
import { Icon, ManaCost, artSrc, cx } from "./ui"

type DeckCard = Deck["cards"][number]
type HandCard = DeckCard & { handKey: string }
type CategoryKey = "gc" | "tutor" | "extra" | "mass" | "fast"

const ROLE_LABEL: Record<string, string> = {
  land: "Land",
  ramp: "Ramp",
  draw: "Draw",
  removal: "Removal",
  wipe: "Wipe",
  protection: "Schutz",
  tutor: "Tutor",
  recursion: "Rekursion",
  wincon: "Wincon",
  synergy: "Synergie",
  flex: "Flex",
}

const CATEGORIES: Array<{ key: CategoryKey; label: string; hint: string }> = [
  { key: "gc", label: "Game Changers", hint: "B3 erlaubt drei." },
  { key: "tutor", label: "Tutoren", hint: "B3 bleibt unter fünf." },
  { key: "extra", label: "Extra-Züge", hint: "B3 erlaubt einen." },
  { key: "mass", label: "Mass Land Denial", hint: "In B3 nicht vorgesehen." },
  { key: "fast", label: "Fast Mana", hint: "Mehrfachmana für höchstens 2 Mana." },
]

function asCommanderCard(deck: Deck): DeckCard {
  return {
    ...deck.commander,
    role: "commander",
    category: "commander",
    reason: "Commander",
    quantity: 1,
    is_commander: true,
    tags: [],
    board: "main",
  }
}

function cardsFor(deck: Deck, key: CategoryKey, commander: DeckCard): DeckCard[] {
  if (key === "gc") {
    const cards = deck.cards.filter((card) => card.is_game_changer)
    return commander.is_game_changer ? [commander, ...cards] : cards
  }
  if (key === "tutor") return deck.cards.filter((card) => card.role === "tutor")
  if (key === "extra") return deck.cards.filter((card) => card.tags.includes("extra-turn"))
  if (key === "mass") return deck.cards.filter((card) => card.tags.includes("mass-land-denial"))
  return deck.cards.filter((card) => card.tags.includes("adds-multiple-mana") && card.cmc <= 2)
}

function bracketFor(signals: { gc: number; tutor: number; extra: number; mass: number; fast: number; wincons: number; averageMv: number }): 3 | 4 | 5 {
  let bracket: 3 | 4 | 5 = 3
  if (signals.gc > 3 || signals.tutor > 4 || signals.extra > 1 || signals.mass > 0 || signals.fast >= 4) bracket = 4
  if (signals.gc > 8 || signals.tutor > 8 || signals.extra > 3 || signals.fast >= 8 || (signals.wincons >= 4 && signals.averageMv <= 2.5)) bracket = 5
  return bracket
}

function targetKeep(target: 3 | 4 | 5): Record<CategoryKey, number> {
  if (target === 3) return { gc: 3, tutor: 4, extra: 1, mass: 0, fast: 3 }
  if (target === 4) return { gc: 8, tutor: 8, extra: 3, mass: 99, fast: 7 }
  return { gc: 99, tutor: 99, extra: 99, mass: 99, fast: 99 }
}

function expandDeck(deck: Deck): HandCard[] {
  const cards: HandCard[] = []
  for (const card of deck.cards) {
    const quantity = Math.max(1, Math.min(99, card.quantity))
    for (let index = 0; index < quantity; index += 1) {
      cards.push({ ...card, handKey: `${card.oracle_id}-${index}` })
    }
  }
  return cards
}

function shuffle<T>(input: T[]): T[] {
  const cards = input.slice()
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[cards[i], cards[j]] = [cards[j], cards[i]]
  }
  return cards
}

function newHand(deck: Deck) {
  const pool = shuffle(expandDeck(deck))
  return { hand: pool.slice(0, 7), library: pool.slice(7) }
}

export function DeckLab({ deck, onCard }: { deck: Deck; onCard: (card: DeckCard) => void }) {
  const commander = useMemo(() => asCommanderCard(deck), [deck])
  const categories = useMemo(
    () =>
      CATEGORIES.map((meta) => ({
        ...meta,
        cards: cardsFor(deck, meta.key, commander),
      })),
    [deck, commander],
  )
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const wincons = deck.analysis?.counts.wincon ?? 0
  const averageMv = deck.analysis?.averageMv ?? 0

  const simulated = useMemo(() => {
    const signals = { gc: 0, tutor: 0, extra: 0, mass: 0, fast: 0, wincons, averageMv }
    for (const category of categories) {
      signals[category.key] = category.cards.filter((card) => {
        if (card.is_commander) return true
        return !excluded.has(`${category.key}:${card.oracle_id}`)
      }).length
    }
    return { signals, bracket: bracketFor(signals) }
  }, [categories, excluded, wincons, averageMv])

  function toggle(category: CategoryKey, card: DeckCard) {
    if (card.is_commander) return
    const key = `${category}:${card.oracle_id}`
    setExcluded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function simulateTarget(target: 3 | 4 | 5) {
    const keep = targetKeep(target)
    const next = new Set<string>()
    for (const category of categories) {
      const movable = category.cards.filter((card) => !card.is_commander).slice().sort((a, b) => (b.edhrec_rank ?? 999999) - (a.edhrec_rank ?? 999999))
      const locked = category.cards.length - movable.length
      const allowed = Math.max(0, keep[category.key] - locked)
      movable.slice(allowed).forEach((card) => next.add(`${category.key}:${card.oracle_id}`))
    }
    setExcluded(next)
  }

  const [handState, setHandState] = useState(() => newHand(deck))
  const [mulligans, setMulligans] = useState(0)
  const [bottom, setBottom] = useState<Set<string>>(new Set())
  const [kept, setKept] = useState(false)

  useEffect(() => {
    setHandState(newHand(deck))
    setMulligans(0)
    setBottom(new Set())
    setKept(false)
  }, [deck.id, deck.updated_at])

  const hand = kept ? handState.hand.filter((card) => !bottom.has(card.handKey)) : handState.hand
  const finalHand = kept ? hand : handState.hand.filter((card) => !bottom.has(card.handKey))
  const lands = finalHand.filter((card) => card.role === "land").length
  const ramp = finalHand.filter((card) => card.role === "ramp").length
  const draw = finalHand.filter((card) => card.role === "draw").length
  const nonLands = finalHand.filter((card) => card.role !== "land")
  const handAverage = nonLands.length ? nonLands.reduce((sum, card) => sum + card.cmc, 0) / nonLands.length : 0
  const handVerdict = lands < 2 || lands > 5 ? "Riskant: Länderzahl prüfen." : ramp + draw === 0 ? "Ok, aber ohne frühen Plan." : "Solide Testhand."

  function mulligan() {
    setHandState(newHand(deck))
    setMulligans((value) => value + 1)
    setBottom(new Set())
    setKept(false)
  }

  function keepHand() {
    if (mulligans > 0 && bottom.size !== mulligans) return
    setHandState((current) => {
      const bottomCards = current.hand.filter((card) => bottom.has(card.handKey))
      return {
        hand: current.hand.filter((card) => !bottom.has(card.handKey)),
        library: [...current.library, ...bottomCards],
      }
    })
    setBottom(new Set())
    setKept(true)
  }

  function drawCard() {
    setHandState((current) => {
      if (current.library.length === 0) return current
      return { hand: [...current.hand, current.library[0]], library: current.library.slice(1) }
    })
  }

  function toggleBottom(card: HandCard) {
    if (mulligans === 0 || kept) return
    setBottom((current) => {
      const next = new Set(current)
      if (next.has(card.handKey)) next.delete(card.handKey)
      else if (next.size < mulligans) next.add(card.handKey)
      return next
    })
  }

  const needsBottom = mulligans > 0 && !kept

  return (
    <div className="lab">
      <section className="lab-panel bracket-lab">
        <div className="lab-head">
          <div>
            <h3>Bracket-Labor</h3>
            <p>Simuliere, welche Karten du schneiden müsstest, um dein Ziel zu halten. Das Deck bleibt unverändert.</p>
          </div>
          <span className={cx("lab-bracket", simulated.bracket <= deck.bracket ? "is-ok" : "is-warn")}>Simuliert B{simulated.bracket}</span>
        </div>

        <div className="lab-targets">
          <span>Ziel: B{deck.bracket}</span>
          <button type="button" className="button ghost" onClick={() => simulateTarget(3)}>B3 herstellen</button>
          <button type="button" className="button ghost" onClick={() => simulateTarget(4)}>B4 herstellen</button>
          <button type="button" className="text-link" onClick={() => setExcluded(new Set())}>Zurücksetzen</button>
        </div>

        <div className="lab-category-grid">
          {categories.map((category) => {
            const active = category.cards.filter((card) => card.is_commander || !excluded.has(`${category.key}:${card.oracle_id}`)).length
            return (
              <section className="lab-category" key={category.key}>
                <div className="lab-category-head">
                  <strong>{category.label}</strong>
                  <span>{active}/{category.cards.length}</span>
                </div>
                <p>{category.hint}</p>
                <div className="lab-card-list">
                  {category.cards.length === 0 ? (
                    <span className="lab-empty">Nichts im Deck.</span>
                  ) : (
                    category.cards.map((card) => {
                      const checked = card.is_commander || !excluded.has(`${category.key}:${card.oracle_id}`)
                      return (
                        <label className={cx("lab-card-toggle", !checked && "is-cut", card.is_commander && "is-locked")} key={`${category.key}:${card.oracle_id}`}>
                          <input type="checkbox" checked={checked} disabled={card.is_commander} onChange={() => toggle(category.key, card)} />
                          <span>
                            {card.mana_cost && <ManaCost cost={card.mana_cost} />}
                            {card.name}
                          </span>
                          {card.is_commander && <span className="lab-lock">CMD</span>}
                        </label>
                      )
                    })
                  )}
                </div>
              </section>
            )
          })}
        </div>

        <div className="lab-note">
          <strong>{simulated.bracket <= deck.bracket ? "Ziel gehalten." : `Noch über B${deck.bracket}.`}</strong>{" "}
          {simulated.bracket > deck.bracket
            ? "Die markierten Karten sind nur eine Simulation; sie bleiben im Deck."
            : "Die Simulation zeigt nur die harten Bracket-Signale, nicht die Spielstärke im Pod."}
        </div>
      </section>

      <section className="lab-panel hand-lab">
        <div className="lab-head">
          <div>
            <h3>Testhand</h3>
            <p>Mischen, sieben ziehen, Mulligan nehmen. Die Hand wird nicht gespeichert.</p>
          </div>
          <span className="lab-bracket is-neutral">{finalHand.length} Karten</span>
        </div>

        <div className="hand-toolbar">
          <button type="button" className="button ghost" onClick={() => { setHandState(newHand(deck)); setMulligans(0); setBottom(new Set()); setKept(false) }}>
            <Icon name="refresh" size={15} /> Neu mischen
          </button>
          <button type="button" className="button ghost" onClick={mulligan} disabled={kept}>
            Mulligan {mulligans > 0 ? `(${mulligans})` : ""}
          </button>
          {needsBottom ? (
            <button type="button" className="button primary" onClick={keepHand} disabled={bottom.size !== mulligans}>
              Behalten ({bottom.size}/{mulligans} ablegen)
            </button>
          ) : (
            <button type="button" className="button primary" onClick={keepHand} disabled={kept}>
              {kept ? "Hand steht" : "Behalten"}
            </button>
          )}
          <button type="button" className="button ghost" onClick={drawCard} disabled={!kept || handState.library.length === 0}>
            Karte ziehen
          </button>
          <span className="hand-library">Bibliothek: {handState.library.length}</span>
        </div>

        {needsBottom && <p className="field-note">London-Mulligan: Wähle {mulligans} Karte{mulligans === 1 ? "" : "n"} aus, die du unten ablegst.</p>}

        <div className="hand-cards">
          {hand.map((card) => {
            const img = artSrc(card.art_url) || artSrc(card.image_uris?.normal) || artSrc(card.image_uris?.border_crop)
            return (
              <article className={cx("hand-card", bottom.has(card.handKey) && "is-bottom")} key={card.handKey}>
                <button type="button" className="hand-card-open" onClick={() => onCard(card)} aria-label={`${card.name} öffnen`}>
                  <span className="hand-card-art">
                    {img ? <img src={img} alt="" /> : <span>{card.name.slice(0, 2)}</span>}
                  </span>
                  <span className="hand-card-name">{card.name}</span>
                  <span className="hand-card-meta">
                    {card.mana_cost && <ManaCost cost={card.mana_cost} />}
                    <span>{ROLE_LABEL[card.role] ?? card.role}</span>
                  </span>
                </button>
                {needsBottom && (
                  <button type="button" className={cx("hand-bottom", bottom.has(card.handKey) && "is-active")} onClick={() => toggleBottom(card)}>
                    {bottom.has(card.handKey) ? "Zurück" : "Ablegen"}
                  </button>
                )}
              </article>
            )
          })}
        </div>

        <div className="hand-stats">
          <span><strong>{lands}</strong> Länder</span>
          <span><strong>{ramp}</strong> Ramp</span>
          <span><strong>{draw}</strong> Draw</span>
          <span><strong>{handAverage.toFixed(1)}</strong> Ø MV</span>
          <span className={cx("hand-verdict", lands < 2 || lands > 5 ? "is-warn" : "is-ok")}>{handVerdict}</span>
        </div>
      </section>
    </div>
  )
}
