import { useEffect, useState } from "react"
import { api, type Deck, type GermanCardText } from "./api"
import { ManaCost, Modal } from "./ui"

type DeckCard = Deck["cards"][number]

function previewImageFor(card: DeckCard | null): string | null {
  if (!card) return null
  return (
    card.image_uris?.normal ??
    card.image_uris?.large ??
    card.image_uris?.png ??
    card.image_uris?.small ??
    card.card_faces?.[0]?.image_uris?.normal ??
    card.card_faces?.[0]?.image_uris?.large ??
    null
  )
}

function fromKnownCard(card: DeckCard): DeckCard {
  return card
}

function commanderCard(deck: Deck): DeckCard | null {
  if (!deck.commander) return null
  return {
    ...deck.commander,
    role: "commander",
    category: "commander",
    reason: "Commander",
    quantity: 1,
    is_commander: true,
    tags: [],
    board: "main",
  } as DeckCard
}

export function CardPreview({
  name,
  deck,
  knownCards,
  onClose,
}: {
  name: string | null
  deck?: Deck | null
  knownCards?: DeckCard[]
  onClose: () => void
}) {
  const [card, setCard] = useState<DeckCard | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [german, setGerman] = useState<GermanCardText | null>(null)
  const [germanLoading, setGermanLoading] = useState(false)
  const [germanError, setGermanError] = useState<string | null>(null)

  useEffect(() => {
    if (!name) {
      setCard(null)
      setError(null)
      setLoading(false)
      return
    }
    let alive = true
    const needle = name.trim().toLowerCase()
    setLoading(true)
    setError(null)
    setCard(null)
    const known = knownCards?.find((entry) => entry.name.toLowerCase() === needle)
    if (known) {
      setCard(fromKnownCard(known))
      setLoading(false)
      return
    }
    const inDeck = deck?.cards.find((entry) => entry.name.toLowerCase() === needle)
    if (inDeck) {
      setCard(inDeck)
      setLoading(false)
      return
    }
    if (deck?.commander?.name.toLowerCase() === needle) {
      setCard(commanderCard(deck))
      setLoading(false)
      return
    }
    api
      .search(name, { mode: "name", limit: 8 })
      .then((hits) => {
        const exact = hits.find((hit: any) => String(hit?.name ?? "").toLowerCase() === needle)
        if (!exact) throw new Error(`Karte nicht gefunden: ${name}`)
        return api.card(exact.oracle_id)
      })
      .then((payload) => {
        if (!alive) return
        const full = payload.card
        setCard({
          ...full,
          role: full.role ?? "flex",
          category: full.category ?? "flex",
          reason: "Kartenvorschau",
          printing_id: full.printing_id ?? null,
          art_url: null,
          artist: null,
          back_printing_id: null,
          back_art_url: null,
          back_artist: null,
          quantity: 1,
          is_commander: false,
          tags: payload.tags ?? [],
          board: "main",
        } as DeckCard)
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [name, deck, knownCards])

  useEffect(() => {
    if (!card?.oracle_id) {
      setGerman(null)
      setGermanError(null)
      setGermanLoading(false)
      return
    }
    let alive = true
    setGerman(null)
    setGermanError(null)
    setGermanLoading(true)
    api
      .germanCard(card.oracle_id)
      .then((result) => {
        if (!alive) return
        setGerman(result.german)
        if (result.error) setGermanError(result.error)
      })
      .catch((err) => {
        if (alive) setGermanError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (alive) setGermanLoading(false)
      })
    return () => {
      alive = false
    }
  }, [card?.oracle_id])

  if (!name) return null
  const image = previewImageFor(card)
  const title = german?.name ?? card?.name ?? name
  const typeLine = german?.type_line ?? card?.type_line ?? ""
  const germanFaces = german?.card_faces?.length ? german.card_faces : null
  const englishName = german?.name && card?.name && german.name !== card.name ? card.name : null

  return (
    <Modal title={title} onClose={onClose} wide>
      {loading ? (
        <div className="card-preview-state">
          <span className="build-line" />
          <p className="muted">Karte wird geladen.</p>
        </div>
      ) : error ? (
        <div className="card-preview-state">
          <p className="field-note is-error">{error}</p>
        </div>
      ) : card ? (
        <div className="card-detail">
          <div className="card-detail-art">
            {image ? <img src={image} alt={title} /> : <p className="muted">Kein Kartenbild verfügbar.</p>}
          </div>
          <div className="card-detail-copy">
            <div className="card-detail-meta">
              <ManaCost cost={card.mana_cost} />
              <span>{typeLine}</span>
              <span className="chip">Vorschau</span>
            </div>
            {englishName && <p className="card-german-name">Englisch: {englishName}</p>}
            <div className="oracle-block">
              {germanFaces ? (
                germanFaces.map((face) => (
                  <div className="oracle-face" key={`${face.name}-${face.oracle_text ?? ""}`}>
                    <h4>{face.name}</h4>
                    {face.type_line && <p className="field-note">{face.type_line}</p>}
                    <p className="oracle">{face.oracle_text ?? "Kein Regeltext."}</p>
                  </div>
                ))
              ) : (
                <p className="oracle">{german?.oracle_text ?? card.oracle_text ?? "Kein Regeltext."}</p>
              )}
            </div>
            {germanLoading && <p className="field-note">Deutscher Kartentext wird geladen …</p>}
            {!germanLoading && !german && (
              <p className="field-note">
                {germanError
                  ? "Deutscher Kartentext konnte nicht geladen werden; angezeigt wird der englische Text."
                  : "Keine deutsche Fassung gefunden; angezeigt wird der englische Text."}
              </p>
            )}
            {german?.set_name && (
              <p className="field-note">
                Deutsche Fassung: {german.set_name}
                {german.collector_number ? ` #${german.collector_number}` : ""}
              </p>
            )}
            {card.legalities?.commander && <p className="field-note">Commander-Legalität: {card.legalities.commander}</p>}
            {card.edhrec_rank != null && <p className="field-note">EDHREC-Rang: #{card.edhrec_rank}</p>}
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
