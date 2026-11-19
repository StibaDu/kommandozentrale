import { useEffect, useState } from "react"
import { api, type CommanderDeckPreview, type CommanderSuggestion, type Deck } from "./api"
import { CardPreview } from "./CardPreview"
import { Icon, ManaCost, Modal } from "./ui"

const ROLE_ORDER = ["land", "ramp", "draw", "removal", "wipe", "protection", "tutor", "recursion", "wincon", "synergy", "flex"]
const ROLE_LABEL: Record<string, string> = {
  land: "Länder",
  ramp: "Ramp",
  draw: "Kartenvorteil",
  removal: "Removal",
  wipe: "Board Wipes",
  protection: "Schutz",
  tutor: "Tutoren",
  recursion: "Rekursion",
  wincon: "Wincons",
  synergy: "Synergie",
  flex: "Flex",
}

type DeckCard = Deck["cards"][number]

function cardCount(cards: DeckCard[]): number {
  return cards.reduce((sum, card) => sum + card.quantity, 0)
}

export function DeckIdeaPreview({
  suggestion,
  brief,
  bracket,
  pod,
  settings,
  onClose,
  onBuild,
}: {
  suggestion: CommanderSuggestion
  brief: string
  bracket: 3 | 4 | 5
  pod: number
  settings: Record<string, unknown>
  onClose: () => void
  onBuild: () => void
}) {
  const [preview, setPreview] = useState<CommanderDeckPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [previewName, setPreviewName] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    setPreview(null)
    api
      .previewCommanderDeck({
        commanderName: suggestion.name,
        brief,
        bracket,
        podSize: pod,
        settings,
      })
      .then((result) => {
        if (alive) setPreview(result)
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
  }, [suggestion.oracle_id, suggestion.name, brief, bracket, pod, settings, reloadToken])

  const counts = preview?.analysis?.counts ?? {}
  const total = preview ? cardCount(preview.cards) + 1 : 100
  const groups = preview
    ? ROLE_ORDER.map((role) => ({
        role,
        cards: preview.cards.filter((card) => card.role === role),
      })).filter((group) => group.cards.length > 0)
    : []

  return (
    <>
      <Modal title={`${suggestion.name} – Deck-Vorschau`} onClose={onClose} wide>
      <div className="idea-preview">
        <div className="idea-preview-head">
          <div>
            <div className="suggest-meta">
              <span>{suggestion.color_identity.join("") || "farblos"}</span>
              <span>{suggestion.type_line}</span>
              <span>{suggestion.edhrec_rank ? `EDHREC #${suggestion.edhrec_rank}` : "EDHREC —"}</span>
            </div>
            <h3>{suggestion.idea?.title ?? suggestion.name}</h3>
            <button type="button" className="text-link idea-commander-link" onClick={() => setPreviewName(suggestion.name)}>
              {suggestion.name} ansehen
            </button>
            <p>{suggestion.idea?.strategy ?? suggestion.reason}</p>
            {suggestion.idea?.themes.length ? (
              <div className="tag-row">
                {suggestion.idea.themes.map((theme) => (
                  <span className="tag" key={theme}>
                    {theme}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="idea-preview-score">
            <strong>{total}</strong>
            <span>Karten inkl. Commander</span>
          </div>
        </div>

        {loading ? (
          <div className="idea-preview-state">
            <span className="build-line" />
            <p className="muted">Die Engine baut die vollständige Vorschau mit Ländern, Ramp, Draw und Wincons.</p>
          </div>
        ) : error ? (
          <div className="idea-preview-state">
            <p className="field-note is-error">{error}</p>
            <button type="button" className="button ghost" onClick={() => setReloadToken((value) => value + 1)}>
              <Icon name="refresh" size={16} /> Neu laden
            </button>
          </div>
        ) : preview ? (
          <>
            <div className="idea-preview-stats">
              <div><strong>{counts.land ?? 0}</strong><span>Länder</span></div>
              <div><strong>{counts.ramp ?? 0}</strong><span>Ramp</span></div>
              <div><strong>{counts.draw ?? 0}</strong><span>Draw</span></div>
              <div><strong>{counts.removal ?? 0}</strong><span>Removal</span></div>
              <div><strong>{counts.wipe ?? 0}</strong><span>Wipes</span></div>
              <div><strong>{counts.wincon ?? 0}</strong><span>Wincons</span></div>
              <div><strong>{preview.analysis?.averageMv?.toFixed(2) ?? "—"}</strong><span>Ø MV</span></div>
            </div>
            {preview.theme && (
              <p className="field-note">
                Theme {preview.theme.label}: {preview.theme.count}/{preview.theme.target} Karten.
              </p>
            )}
            <p className="field-note">
              Vollständige Engine-Vorschau für deine Vision. Der spätere KI-Build nutzt denselben Rahmen, kann aber
              einzelne Karten anders wählen. Klick auf eine Karte öffnet die deutsche Fassung, soweit verfügbar.
            </p>
            <div className="idea-deck-groups">
              {groups.map((group) => (
                <section className="idea-deck-group" key={group.role}>
                  <h4>
                    {ROLE_LABEL[group.role] ?? group.role}
                    <span>{cardCount(group.cards)}</span>
                  </h4>
                  <ul>
                    {group.cards.map((card) => (
                      <li key={card.oracle_id}>
                        <button
                          type="button"
                          className="idea-deck-name idea-card-link"
                          onClick={() => setPreviewName(card.name)}
                          title={`${card.name} ansehen`}
                        >
                          {card.quantity > 1 ? `${card.quantity}× ` : ""}
                          {card.name}
                        </button>
                        <span className="idea-deck-meta">
                          <ManaCost cost={card.mana_cost} />
                          <span>MV {card.cmc}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            {suggestion.idea?.wincons.length ? (
              <div className="idea-preview-block">
                <span className="field-label">Wincons</span>
                <div className="tag-row">
                  {suggestion.idea.wincons.map((wincon) => (
                    <button
                      type="button"
                      className="tag tag-button"
                      key={wincon}
                      onClick={() => setPreviewName(wincon)}
                      title={`${wincon} ansehen`}
                    >
                      {wincon}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="idea-preview-footer">
              <button type="button" className="button primary" onClick={onBuild}>
                <Icon name="spark" size={16} /> Diese Deck-Idee bauen
              </button>
              <button type="button" className="button ghost" onClick={onClose}>
                Schließen
              </button>
            </div>
          </>
        ) : null}
      </div>
      </Modal>
      {previewName && (
        <CardPreview name={previewName} knownCards={preview?.cards ?? []} onClose={() => setPreviewName(null)} />
      )}
    </>
  )
}
