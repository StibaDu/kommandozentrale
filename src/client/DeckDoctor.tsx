import { useEffect, useMemo, useState } from "react"
import { api, type Deck, type DoctorProposal, type DoctorResult } from "./api"
import { Icon, ManaCost, Markdown, cx } from "./ui"

export function DeckDoctor({
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
  const [result, setResult] = useState<DoctorResult | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ revisionId: string; updatedAt: string } | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [explanation, setExplanation] = useState<string | null>(null)
  const [explainRunId, setExplainRunId] = useState<string | null>(null)
  const [explainMessage, setExplainMessage] = useState<string | null>(null)
  const [explainError, setExplainError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    api
      .doctor(deck.id)
      .then((next) => {
        if (!alive) return
        setResult(next)
        setSelected(new Set(next.proposals.map((proposal) => proposal.id)))
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
  }, [deck.id, deck.updated_at, reloadToken])

  useEffect(() => {
    if (undo && undo.updatedAt !== deck.updated_at) setUndo(null)
  }, [deck.updated_at, undo])

  useEffect(() => {
    if (!explainRunId) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = async () => {
      try {
        const status = await api.explainStatus(explainRunId)
        if (!alive) return
        setExplainMessage(status.message)
        if (status.status === "done") {
          setExplanation(status.text)
          setExplainRunId(null)
          setExplainMessage(null)
          return
        }
        if (status.status === "error") {
          setExplainError(status.error ?? "Die Erklärung ist fehlgeschlagen.")
          setExplainRunId(null)
          setExplainMessage(null)
          return
        }
        timer = setTimeout(poll, 1800)
      } catch (err) {
        if (!alive) return
        setExplainError(err instanceof Error ? err.message : String(err))
        setExplainRunId(null)
        setExplainMessage(null)
      }
    }
    void poll()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [explainRunId])

  async function explain() {
    if (!result || !canEdit) return
    setExplainError(null)
    setExplanation(null)
    setExplainMessage("Die KI nimmt den Auftrag an.")
    try {
      const started = await api.explainDoctor(deck.id, result.proposals.map((proposal) => proposal.id))
      if (started.cached && started.explanation) {
        setExplanation(started.explanation)
        setExplainMessage(null)
        return
      }
      if (started.runId) setExplainRunId(started.runId)
    } catch (err) {
      setExplainError(err instanceof Error ? err.message : String(err))
      setExplainMessage(null)
    }
  }

  const selectedProposals = useMemo(
    () => result?.proposals.filter((proposal) => selected.has(proposal.id)) ?? [],
    [result, selected],
  )
  const totalDelta = selectedProposals.reduce((sum, proposal) => sum + (proposal.add ? 1 : 0) - (proposal.cut ? 1 : 0), 0)
  const projectedTotal = (result?.diagnosis.total ?? 0) + totalDelta

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function apply() {
    if (!result || selected.size === 0) return
    setBusy(true)
    setError(null)
    try {
      const applied = await api.applyDoctor(deck.id, [...selected])
      setUndo({ revisionId: applied.revisionId, updatedAt: applied.deck.updated_at })
      onDeck(applied.deck)
      onNotice(`${applied.applied} Deck-Doctor-Änderungen übernommen.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function restore() {
    if (!undo) return
    setBusy(true)
    setError(null)
    try {
      const restored = await api.restoreRevision(deck.id, undo.revisionId)
      setUndo(null)
      onDeck(restored.deck)
      onNotice("Letzte Deck-Doctor-Änderung rückgängig gemacht.")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="doctor">
        <div className="doctor-state">
          <span className="build-line" />
          <p>Der Doctor prüft Rollen, Budget und Kandidaten.</p>
        </div>
      </div>
    )
  }

  if (error && !result) {
    return (
      <div className="doctor">
        <div className="doctor-state">
          <p className="field-note is-error">{error}</p>
          <button type="button" className="button ghost" onClick={() => setReloadToken((value) => value + 1)}>
            <Icon name="refresh" size={16} /> Neu prüfen
          </button>
        </div>
      </div>
    )
  }

  if (!result) return null

  const diagnosis = result.diagnosis
  const allSelected = result.proposals.length > 0 && selected.size === result.proposals.length
  const wouldOverfill = diagnosis.total <= 100 ? projectedTotal > 100 : projectedTotal > diagnosis.total

  return (
    <div className="doctor">
      <div className="doctor-head">
        <div>
          <h3>Deck-Doctor</h3>
          <p>Prüft Rollen, Hausbudget und Kandidaten. Nichts wird ohne dein Okay geändert.</p>
        </div>
        <button type="button" className="button ghost" onClick={() => setReloadToken((value) => value + 1)} disabled={busy}>
          <Icon name="refresh" size={16} /> Neu prüfen
        </button>
      </div>

      {undo && undo.updatedAt === deck.updated_at && (
        <div className="doctor-undo">
          <span>Die letzte Änderung ist als Revision gespeichert.</span>
          <button type="button" className="text-link" onClick={() => void restore()} disabled={busy || !canEdit}>
            Rückgängig
          </button>
        </div>
      )}

      {result.proposals.length > 0 && (
        <div className="doctor-section doctor-explain">
          <div className="doctor-explain-head">
            <div>
              <h4>Warum diese Swaps?</h4>
              <p className="field-note">Die KI erklärt die Engine-Vorschläge. Sie wählt keine Karten aus und ändert nichts.</p>
            </div>
            <button type="button" className="button ghost" onClick={() => void explain()} disabled={!canEdit || Boolean(explainRunId)}>
              <Icon name="spark" size={16} />
              {explainRunId ? "Denkt nach…" : explanation ? "Neu erklären" : "KI-Erklärung"}
            </button>
          </div>
          {explainRunId && <p className="field-note">{explainMessage ?? "Die KI arbeitet."}</p>}
          {explainError && <p className="field-note is-error">{explainError}</p>}
          {explanation && (
            <div className="doctor-explanation">
              <Markdown text={explanation} />
            </div>
          )}
          {!canEdit && <p className="field-note">Nur der Besitzer kann eine Erklärung starten.</p>}
        </div>
      )}

      <div className="doctor-stats">
        <div>
          <strong>{diagnosis.total}</strong>
          <span>Karten</span>
        </div>
        <div>
          <strong>B{diagnosis.bracket}</strong>
          <span>Bracket</span>
        </div>
        <div>
          <strong>{result.proposals.length}</strong>
          <span>Vorschläge</span>
        </div>
        <div>
          <strong>{diagnosis.overBudget.length}</strong>
          <span>Budget</span>
        </div>
      </div>

      {diagnosis.needs.length > 0 && (
        <div className="doctor-section">
          <h4>Rollenbedarf</h4>
          <div className="need-list">
            {diagnosis.needs.map((need) => (
              <span className="need-chip" key={need.role}>
                {need.label}
                <strong>
                  {need.current}/{need.target}
                </strong>
                <em>+{need.deficit}</em>
              </span>
            ))}
          </div>
        </div>
      )}

      {diagnosis.overBudget.length > 0 && (
        <div className="doctor-section">
          <h4>Über Budget</h4>
          <div className="need-list">
            {diagnosis.overBudget.map((issue) => (
              <span className="need-chip is-warn" key={issue.kind}>
                {issue.label}
                <strong>
                  {issue.current}/{issue.allowed}
                </strong>
                <em>−{issue.current - issue.allowed}</em>
              </span>
            ))}
          </div>
        </div>
      )}

      {diagnosis.notes.length > 0 && (
        <div className="doctor-section">
          <h4>Hinweise</h4>
          <ul className="doctor-notes">
            {diagnosis.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {result.proposals.length === 0 ? (
        <div className="doctor-empty">
          <h4>Keine Änderung nötig.</h4>
          <p>Der Doctor sieht für B{diagnosis.bracket} keine offensichtliche Rollen- oder Budgetlücke. Prüfe den Primer und die Goldfish-Werte, bevor du Karten austauschst.</p>
        </div>
      ) : (
        <>
          <div className="doctor-toolbar">
            <span>
              {selected.size} von {result.proposals.length} ausgewählt
            </span>
            <button
              type="button"
              className="text-link"
              onClick={() => setSelected(allSelected ? new Set() : new Set(result.proposals.map((proposal) => proposal.id)))}
            >
              {allSelected ? "Alle abwählen" : "Alle auswählen"}
            </button>
          </div>

          <div className="doctor-list">
            {result.proposals.map((proposal) => (
              <ProposalRow key={proposal.id} proposal={proposal} selected={selected.has(proposal.id)} onToggle={() => toggle(proposal.id)} />
            ))}
          </div>

          {result.projected && (
            <div className="doctor-projected">
              <strong>Gesamtpaket:</strong> {result.projected.total} Karten, Auditor B{result.projected.bracket} {result.projected.label}.{' '}
              {result.projected.counts.removal ?? 0} Removal, {result.projected.counts.ramp ?? 0} Ramp, {result.projected.counts.draw ?? 0} Draw.
              {selected.size !== result.proposals.length && <span className="muted"> Die Vorschau gilt für alle Vorschläge.</span>}
              {result.projected.warnings.length > 0 && <span className="muted"> {result.projected.warnings[0]}</span>}
            </div>
          )}

          {error && <p className="field-note is-error">{error}</p>}
          {wouldOverfill && <p className="field-note is-error">Die Auswahl würde das Deck auf {projectedTotal} Karten bringen. Wähle weniger oder schneide zuerst.</p>}
          {!wouldOverfill && projectedTotal > 100 && (
            <p className="field-note">
              Die Auswahl reduziert auf {projectedTotal} Karten. Das Deck bleibt über 100; ein weiterer Doctor-Lauf schneidet weiter.
            </p>
          )}
          {!wouldOverfill && projectedTotal < 100 && (
            <p className="field-note">
              Die Auswahl ergibt {projectedTotal} Karten. Das Deck bleibt ein Entwurf; weitere Doctor-Läufe füllen den Rest.
            </p>
          )}

          <div className="doctor-footer">
            <button type="button" className="button primary" onClick={() => void apply()} disabled={busy || selected.size === 0 || wouldOverfill || !canEdit}>
              <Icon name="spark" size={16} /> {busy ? "Wendet an" : `Auswahl anwenden (${selected.size})`}
            </button>
            <span className="field-note">
              {canEdit
                ? "Die Änderung wird als Revision gesichert. Du kannst sie direkt zurücknehmen."
                : "Nur der Besitzer kann diese Vorschläge anwenden. Du kannst sie lesen und das Deck kopieren."}
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function ProposalRow({
  proposal,
  selected,
  onToggle,
}: {
  proposal: DoctorProposal
  selected: boolean
  onToggle: () => void
}) {
  return (
    <label className={cx("doctor-proposal", selected && "is-selected")}>
      <input type="checkbox" className="doctor-check" checked={selected} onChange={onToggle} />
      <div className="doctor-body">
        <div className="doctor-swap">
          <div className="doctor-card is-cut">
            <span className="doctor-sign">−</span>
            <div className="doctor-card-copy">
              <span className="doctor-card-name">{proposal.cut?.name ?? "Freier Platz"}</span>
              {proposal.cut && (
                <span className="doctor-card-meta">
                  {proposal.cut.mana_cost && <ManaCost cost={proposal.cut.mana_cost} />} {proposal.cut.type_line}
                </span>
              )}
            </div>
          </div>
          <span className="doctor-arrow">
            <Icon name="arrow" size={15} />
          </span>
          <div className="doctor-card is-add">
            <span className="doctor-sign">+</span>
            <div className="doctor-card-copy">
              <span className="doctor-card-name">{proposal.add?.name ?? "Nur schneiden"}</span>
              {proposal.add && (
                <span className="doctor-card-meta">
                  {proposal.add.mana_cost && <ManaCost cost={proposal.add.mana_cost} />} {proposal.add.type_line}
                </span>
              )}
            </div>
          </div>
        </div>
        <p className="doctor-reason">{proposal.reason}</p>
        <div className="doctor-tags">
          <span className="doctor-need">{proposal.need}</span>
          <span className="doctor-delta">
            {proposal.roleLabel} {proposal.before} → {proposal.after}
          </span>
          {proposal.add?.is_game_changer && <span className="badge">GC</span>}
          {proposal.add?.is_one_win && <span className="badge is-warn">1-Win</span>}
        </div>
      </div>
    </label>
  )
}
