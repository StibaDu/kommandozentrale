import { useEffect, useState } from "react"
import { api, type Deck, type DeckRevision, type DeckRevisionCard } from "./api"
import { Icon, cx } from "./ui"

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })
}

function DiffChips({ cards, direction }: { cards: DeckRevisionCard[]; direction: "add" | "remove" }) {
  if (cards.length === 0) return null
  const visible = cards.slice(0, 8)
  const hidden = cards.length - visible.length
  return (
    <>
      {visible.map((card) => (
        <span key={card.oracle_id} className={cx("history-chip", direction === "add" ? "is-add" : "is-remove")}>
          {direction === "add" ? "+" : "−"}
          {card.quantity} {card.name}
        </span>
      ))}
      {hidden > 0 && <span className="history-more">… {hidden} weitere</span>}
    </>
  )
}

export function DeckHistory({
  deck,
  canEdit,
  onDeck,
  onNotice,
}: {
  deck: Deck
  canEdit: boolean
  onDeck: (deck: Deck) => void
  onNotice: (text: string) => void
}) {
  const [revisions, setRevisions] = useState<DeckRevision[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [token, setToken] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    api
      .revisions(deck.id)
      .then((next) => {
        if (alive) setRevisions(next.revisions)
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
  }, [deck.id, token])

  async function restore(revision: DeckRevision) {
    const when = formatDate(revision.created_at)
    const confirmed = window.confirm(
      `Deck auf den Stand vom ${when} zurücksetzen?\n\nDer aktuelle Stand wird vorher als Revision gesichert.`,
    )
    if (!confirmed) return
    setRestoring(revision.id)
    setError(null)
    try {
      const result = await api.restoreRevision(deck.id, revision.id)
      onDeck(result.deck)
      onNotice(`Deck auf den Stand vom ${when} zurückgesetzt.`)
      setToken((value) => value + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRestoring(null)
    }
  }

  return (
    <div className="history">
      <div className="history-head">
        <div>
          <h3>Verlauf</h3>
          <p>
            Die letzten zehn Snapshots. Vor jeder Doctor-Änderung und jeder Wiederherstellung legt die App den aktuellen
            Stand ab.
          </p>
        </div>
        <button type="button" className="button ghost" onClick={() => setToken((value) => value + 1)} disabled={loading}>
          <Icon name="refresh" size={16} /> Neu laden
        </button>
      </div>

      {error && <p className="field-note is-error">{error}</p>}

      {loading ? (
        <div className="doctor-state">
          <p>Lade Verlauf…</p>
        </div>
      ) : revisions.length === 0 ? (
        <div className="doctor-empty">
          <h4>Noch keine Revisionen</h4>
          <p>
            Der Doctor legt vor jeder Änderung einen Snapshot an. Sobald du Vorschläge anwendest, erscheint der Verlauf
            hier.
          </p>
        </div>
      ) : (
        <div className="history-list">
          {revisions.map((revision) => {
            const unchanged = revision.added.length === 0 && revision.removed.length === 0
            return (
              <article className="history-entry" key={revision.id}>
                <div className="history-main">
                  <div className="history-title">
                    <strong>{revision.label}</strong>
                    <span className="history-time">{formatDate(revision.created_at)}</span>
                  </div>
                  <p className="history-meta">
                    {revision.total} Karten inklusive Commander · {revision.unique} verschiedene
                    {Math.abs((revision.averageMvAfter ?? 0) - (revision.averageMvBefore ?? 0)) >= 0.1
                      ? ` · Ø MV ${(revision.averageMvBefore ?? 0).toFixed(1)} zu ${(revision.averageMvAfter ?? 0).toFixed(1)}`
                      : ""}
                  </p>
                  {revision.roleDelta?.length > 0 && (
                    <div className="history-role-delta">
                      <span className="history-diff-label">Rollen:</span>
                      {revision.roleDelta.map((entry) => (
                        <span key={entry.role} className={cx("history-chip", entry.delta > 0 ? "is-add" : "is-remove")}>
                          {entry.delta > 0 ? "+" : "−"}
                          {Math.abs(entry.delta)} {entry.label}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="history-diff">
                    {unchanged ? (
                      <span className="history-same">Identisch mit dem aktuellen Deck.</span>
                    ) : (
                      <>
                        <span className="history-diff-label">Seit diesem Stand:</span>
                        <DiffChips cards={revision.added} direction="add" />
                        <DiffChips cards={revision.removed} direction="remove" />
                      </>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="button ghost"
                  onClick={() => void restore(revision)}
                  disabled={restoring !== null || !canEdit}
                >
                  {restoring === revision.id ? "Stelle her…" : canEdit ? "Wiederherstellen" : "Nur Besitzer"}
                </button>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
