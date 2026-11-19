import { useState } from "react"
import { api, type Deck } from "./api"
import { Icon, cx } from "./ui"

function pct(value: number): string {
  return `${Math.round(value * 100)} %`
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="sim-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  )
}

export function DeckSimulation({
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const simulation = deck.simulation
  const stale = Boolean(simulation?.deckUpdatedAt && simulation.deckUpdatedAt !== deck.updated_at)

  async function run() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const next = await api.simulateDeck(deck.id)
      onDeck(next)
      onNotice("Simulation aktualisiert.")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      onNotice(`Simulation fehlgeschlagen: ${message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="simulation">
      <div className="sim-head">
        <div>
          <h3>Simulation</h3>
          <p className="muted">
            Goldfish, Eröffnungshände, typische Szenarien und tote Karten. Der KI-Doctor verbessert das Deck direkt nach
            dem Build; hier kannst du den Stand neu berechnen.
          </p>
        </div>
        {canEdit && (
          <button type="button" className="button ghost" onClick={run} disabled={busy}>
            <Icon name="spark" size={15} /> {busy ? "Simuliert …" : simulation ? "Neu simulieren" : "Simulation starten"}
          </button>
        )}
      </div>

      {error && <p className="sim-error">{error}</p>}

      {!simulation ? (
        <div className="sim-empty">
          <Icon name="grid" size={22} />
          <p className="muted">
            Noch keine Simulation. Baue das Deck, dann erzeugt die Werkstatt automatisch einen Report. Du kannst ihn hier
            auch manuell neu berechnen.
          </p>
        </div>
      ) : (
        <>
          {stale && (
            <div className="sim-stale">
              <Icon name="refresh" size={15} />
              <span>Das Deck wurde seit dieser Simulation geändert. Der Report ist eventuell veraltet.</span>
              {canEdit && (
                <button type="button" className="text-link" onClick={run} disabled={busy}>
                  Jetzt neu simulieren
                </button>
              )}
            </div>
          )}

          <div className="sim-overview">
            <div className="sim-score">
              <strong>{simulation.score}</strong>
              <span>/ 100</span>
              <small>{simulation.runs.toLocaleString("de-DE")} Läufe</small>
            </div>
            <div className="sim-overview-body">
              {simulation.improvement ? (
                <p>
                  <strong>KI-Doctor:</strong> Score {simulation.improvement.beforeScore} →{" "}
                  {simulation.improvement.afterScore}
                  {simulation.improvement.applied.length
                    ? `, ${simulation.improvement.applied.length} Karten ersetzt.`
                    : ", keine Änderung nötig."}
                </p>
              ) : (
                <p>
                  <strong>Simulation:</strong> Der Report zeigt Rollenabdeckung, Mana-Stabilität und Szenarien.
                </p>
              )}
              {simulation.improvement?.assessment && <p className="sim-assessment">{simulation.improvement.assessment}</p>}
              <p className="sim-meta">
                Erstellt {new Date(simulation.createdAt).toLocaleString("de-DE")}
                {simulation.deckUpdatedAt
                  ? ` · Deckstand ${new Date(simulation.deckUpdatedAt).toLocaleString("de-DE")}`
                  : ""}
              </p>
              {simulation.strengths.length > 0 && (
                <div className="sim-strengths">
                  {simulation.strengths.map((strength) => (
                    <span className="sim-tag is-good" key={strength}>
                      {strength}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="sim-metrics">
            <Metric
              label="Theme"
              value={
                simulation.theme
                  ? `${simulation.theme.count}/${simulation.theme.target}`
                  : `${simulation.metrics.themeCount}`
              }
              hint={simulation.theme?.label ?? "kein Theme erkannt"}
            />
            <Metric label="Länder" value={String(simulation.metrics.lands)} />
            <Metric label="Ramp" value={String(simulation.metrics.ramp)} />
            <Metric label="Draw" value={String(simulation.metrics.draw)} />
            <Metric label="Interaktion" value={String(simulation.metrics.interaction)} />
            <Metric label="Schutz" value={String(simulation.metrics.protection)} />
            <Metric label="Wincons" value={String(simulation.metrics.wincons)} />
            <Metric label="Ø Manawert" value={simulation.metrics.averageMv.toFixed(2)} />
            <Metric
              label="Keepable Hände"
              value={`${simulation.opening.keepablePct} %`}
              hint={`${simulation.opening.hands} Hände · Ø ${simulation.opening.averageLands} Länder`}
            />
            <Metric
              label="Verpasste Drops"
              value={pct(simulation.metrics.missedLandDropRate)}
              hint="frühe Züge"
            />
            <Metric label="Farb-Screw" value={pct(simulation.metrics.colorScrewRate)} />
            <Metric
              label="Commander"
              value={
                simulation.metrics.averageCommanderTurn != null
                  ? `Zug ${simulation.metrics.averageCommanderTurn}`
                  : "—"
              }
              hint={`Ø ${simulation.metrics.averageLandsByTurn4} Länder bis Zug 4`}
            />
          </div>

          <div className="sim-columns">
            <section className="sim-block">
              <h4>Schwächen</h4>
              {simulation.weaknesses.length === 0 ? (
                <p className="muted">Keine auffälligen Schwächen gefunden.</p>
              ) : (
                <ul className="sim-list">
                  {simulation.weaknesses.map((weakness) => (
                    <li key={weakness.id} className={cx("sim-weakness", `is-${weakness.severity}`)}>
                      <div className="sim-list-head">
                        <strong>{weakness.title}</strong>
                        <span className={cx("sim-severity", `is-${weakness.severity}`)}>{weakness.severity}</span>
                      </div>
                      <p>{weakness.text}</p>
                      {weakness.fixes.length > 0 && (
                        <p className="sim-fixes">Ansatz: {weakness.fixes.join(" · ")}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="sim-block">
              <h4>Tote Karten</h4>
              {simulation.deadCards.length === 0 ? (
                <p className="muted">Keine offensichtlich toten Karten.</p>
              ) : (
                <ul className="sim-list">
                  {simulation.deadCards.map((card) => (
                    <li key={card.name} className="sim-dead">
                      <div className="sim-list-head">
                        <strong>{card.name}</strong>
                        <span className="muted">
                          {card.role} · MV {card.cmc}
                        </span>
                      </div>
                      <p>{card.reason}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="sim-block">
            <h4>Szenarien</h4>
            <div className="sim-scenarios">
              {simulation.scenarios.map((scenario) => (
                <div key={scenario.name} className={cx("sim-scenario", `is-${scenario.risk}`)}>
                  <div className="sim-list-head">
                    <strong>{scenario.name}</strong>
                    <span className={cx("sim-risk", `is-${scenario.risk}`)}>Risiko {scenario.risk}</span>
                  </div>
                  <p>{scenario.text}</p>
                </div>
              ))}
            </div>
          </section>

          {simulation.improvement && (
            <section className="sim-block">
              <h4>KI-Verbesserung</h4>
              {simulation.improvement.applied.length === 0 ? (
                <p className="muted">Der Doctor hat keine Änderung angewendet.</p>
              ) : (
                <ul className="sim-swaps">
                  {simulation.improvement.applied.map((swap) => (
                    <li key={`${swap.cut}-${swap.add}`}>
                      <div className="sim-swap-line">
                        <span className="sim-cut">{swap.cut}</span>
                        <Icon name="arrow" size={14} />
                        <span className="sim-add">{swap.add}</span>
                      </div>
                      <p>{swap.reason}</p>
                      {swap.fixes.length > 0 && <p className="sim-fixes">Für: {swap.fixes.join(" · ")}</p>}
                    </li>
                  ))}
                </ul>
              )}
              {simulation.improvement.rejected.length > 0 && (
                <details className="sim-rejected">
                  <summary>{simulation.improvement.rejected.length} verworfene Vorschläge</summary>
                  <ul>
                    {simulation.improvement.rejected.map((entry, index) => (
                      <li key={`${entry.swap.cut}-${entry.swap.add}-${index}`}>
                        {entry.swap.cut} → {entry.swap.add}: {entry.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
