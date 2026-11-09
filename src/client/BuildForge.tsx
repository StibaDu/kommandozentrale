import { useEffect, useRef, useState, type CSSProperties } from "react"
import type { BuildRun, Deck } from "./api"
import { pickGimbalLine } from "./gimbalLines"
import { ManaCost, cx } from "./ui"

const GIMBAL_ART = "/gimbal-gremlin-prodigy.jpg"

const MANA = ["W", "U", "B", "R", "G"] as const

const PHASES = [
  { label: "Kandidaten", sub: "Pool & Commander" },
  { label: "KI deckt", sub: "99 auswählen" },
  { label: "Regeln", sub: "Struktur & Identität" },
] as const

const WHISPERS = [
  "Sol Ring ist gesetzt. Wie immer.",
  "Mana Base: 34 Länder. Vielleicht 35. Vielleicht 33.",
  "Der dritte Counterspell wird gerade verhandelt.",
  "Nein, Lightning Greaves ist keine Ramp-Karte.",
  "Der Gremlin zählt die Karten. Zum dritten Mal.",
  "Der Gremlin hat Armageddon gehört und versteckt die Länder.",
  "Fast fertig. Es fehlt noch ein Land.",
  "99 Karten. Plus Commander. Plus schlechte Ideen.",
] as const

const FLIGHT_CARDS = Array.from({ length: 12 }, (_, index) => {
  const angle = (index / 12) * Math.PI * 2 - Math.PI / 2
  const radius = 235 + (index % 3) * 18
  const startX = Math.round(Math.cos(angle) * radius)
  const startY = Math.round(Math.sin(angle) * radius * 0.56) - 54
  const midX = Math.round(startX * 0.34)
  const midY = Math.round(startY * 0.34)
  const tilt = index % 2 === 0 ? 1 : -1
  return {
    startX: `${startX}px`,
    startY: `${startY}px`,
    midX: `${midX}px`,
    midY: `${midY}px`,
    startRotate: `${tilt * (20 + index * 3)}deg`,
    midRotate: `${tilt * (8 + index)}deg`,
    endRotate: `${tilt * 3}deg`,
    delay: `${(index * -0.37).toFixed(2)}s`,
  }
})

const SPARKS = Array.from({ length: 18 }, (_, index) => ({
  x: `${(index % 2 === 0 ? 1 : -1) * (12 + ((index * 17) % 92))}px`,
  duration: `${4.5 + ((index * 1.3) % 4.2)}s`,
  delay: `${(-index * 0.43).toFixed(2)}s`,
}))

function cssVars(values: Record<string, string | number>) {
  return values as CSSProperties
}

function phaseFrom(run: BuildRun | null) {
  if (run?.status === "done") return 2
  const message = (run?.message ?? "").toLowerCase()
  if (message.includes("validiert") || message.includes("validier")) return 2
  if (message.includes("engine") || message.includes("deterministisch")) return 2
  if (message.includes("prüft") || message.includes("kontext") || message.includes("deepseek")) return 1
  return 0
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
}

function ForgeClock() {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const started = Date.now()
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <span className="forge-status-time" title="Laufzeit dieser Werkstatt">
      {formatElapsed(elapsed)}
    </span>
  )
}

export function BuildForge({ deck, run }: { deck: Deck; run: BuildRun | null }) {
  const identity = deck.commander.color_identity ?? []
  const identityLabel = MANA.filter((color) => identity.includes(color)).join("") || "farblos"
  const art = deck.commander.image_uris?.art_crop ?? deck.commander.image_uris?.normal ?? null
  const message = run?.message?.trim() || "Die Werkstatt arbeitet."
  const phase = phaseFrom(run)
  const stage = phase + 1
  const cardCount = run?.status === "done" ? 100 : run?.card_count != null && run.card_count > 1 ? run.card_count : null
  const [gimbalLine, setGimbalLine] = useState(() => pickGimbalLine())
  const runId = run?.id ?? null
  const lastRunId = useRef(runId)

  useEffect(() => {
    if (lastRunId.current === runId) return
    lastRunId.current = runId
    setGimbalLine((current) => pickGimbalLine(current))
  }, [runId])

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const timer = window.setInterval(() => {
      setGimbalLine((current) => pickGimbalLine(current))
    }, 10000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!window.matchMedia("(max-width: 980px)").matches) return
    const stage = document.querySelector<HTMLElement>(".forge")
    if (!stage) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const frame = window.requestAnimationFrame(() => {
      stage.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  return (
    <div className="forge" aria-busy="true">
      <header className="forge-head">
        <div className="forge-kicker">
          <span className="forge-live-dot" aria-hidden="true" />
          Deckwerkstatt <span className="forge-run">/ Lauf</span>
        </div>
        <div className="forge-meta" aria-label={`Bracket ${deck.bracket}, ${deck.pod_size} Spieler, Identität ${identityLabel}`}>
          <span aria-hidden="true">B{deck.bracket}</span>
          <span aria-hidden="true">{deck.pod_size} Spieler</span>
          <span aria-hidden="true">Identität {identityLabel}</span>
        </div>
      </header>

      <ol className="forge-phases" aria-label="Baufortschritt">
        {PHASES.map((item, index) => (
          <li
            key={item.label}
            className={cx("forge-phase", index < phase && "is-done", index === phase && "is-active")}
            aria-current={index === phase ? "step" : undefined}
          >
            <span className="forge-phase-index" aria-hidden="true">
              {index < phase ? "✓" : index === phase ? "●" : `0${index + 1}`}
            </span>
            <span className="forge-phase-copy">
              <span className="forge-phase-name">{item.label}</span>
              <span className="forge-phase-sub">{item.sub}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="forge-scene" aria-hidden="true">
        <span className="forge-crop is-tl" />
        <span className="forge-crop is-tr" />
        <span className="forge-crop is-bl" />
        <span className="forge-crop is-br" />

        <span className="forge-halo" />
        <span className="forge-ring is-outer" />
        <span className="forge-ring is-inner" />

        <div className="forge-pips">
          {MANA.map((color, index) => {
            const active = identity.includes(color)
            return (
              <span
                key={color}
                className={cx("forge-pip-slot", active && "is-active")}
                style={cssVars({ "--a": `${index * 72}deg`, "--i": index })}
              >
                <span className={cx("forge-pip", `is-${color.toLowerCase()}`, active && "is-active")}>{color}</span>
              </span>
            )
          })}
        </div>

        <div className="forge-card-float">
          <div className="forge-card">
            <span className="forge-card-corner is-tl" />
            <span className="forge-card-corner is-tr" />
            <span className="forge-card-corner is-bl" />
            <span className="forge-card-corner is-br" />

            <div className="forge-card-title">
              <span className="forge-card-name">{deck.commander.name}</span>
              <span className="forge-card-cost">
                <ManaCost cost={deck.commander.mana_cost} />
              </span>
            </div>

            <div className="forge-card-art">
              {art ? <span className="forge-card-art-img" style={{ backgroundImage: `url("${art}")` }} /> : null}
              <span className="forge-card-art-wash" />
            </div>

            <div className="forge-card-type">{deck.commander.type_line}</div>
            <div className="forge-card-text">
              <span />
              <span />
              <span />
            </div>
            <span className="forge-card-set">KZ 001</span>
            <span className="forge-stamp">
              <span>99</span>
            </span>
          </div>
        </div>

        <div className="forge-flight">
          {FLIGHT_CARDS.map((card, index) => (
            <span
              key={index}
              className="forge-flight-card"
              style={cssVars({
                "--sx": card.startX,
                "--sy": card.startY,
                "--mx": card.midX,
                "--my": card.midY,
                "--sr": card.startRotate,
                "--mr": card.midRotate,
                "--er": card.endRotate,
                "--delay": card.delay,
              })}
            >
              <span>K</span>
            </span>
          ))}
        </div>

        <div className="forge-stack">
          {Array.from({ length: 10 }, (_, index) => (
            <span key={index} className="forge-stack-card" style={cssVars({ "--n": index })}>
              <span>K</span>
            </span>
          ))}
          <span className="forge-stack-tag">99</span>
        </div>

        <div className="forge-sparks">
          {SPARKS.map((spark, index) => (
            <span
              key={index}
              className="forge-spark"
              style={cssVars({ "--x": spark.x, "--dur": spark.duration, "--delay": spark.delay })}
            />
          ))}
        </div>

        <div className="forge-gimbal">
          <span className="forge-gimbal-tape" />
          <figure className="forge-gimbal-card">
            <img src={GIMBAL_ART} alt="" decoding="async" />
            <figcaption>
              <strong>Gimbal</strong>
              <span>Gremlin Prodigy</span>
            </figcaption>
          </figure>
          <span className="forge-gimbal-note">
            <span key={gimbalLine} className="forge-gimbal-line">„{gimbalLine}“</span>
          </span>
        </div>

        <span className="forge-scene-note">99 Karten, 1 Commander</span>
      </div>

      <div className="forge-progress">
        <div className="forge-progress-head" aria-hidden="true">
          <span className="forge-progress-label">Werkstatt-Fortschritt</span>
          <span className="forge-progress-step">Schritt {stage} / 3</span>
        </div>
        <div
          className="forge-progress-track"
          role="progressbar"
          aria-label="Bauphase"
          aria-valuemin={1}
          aria-valuemax={3}
          aria-valuenow={stage}
        >
          <span className="forge-progress-fill" style={{ transform: `scaleX(${stage / 3})` }} />
          {phase < 2 && <span className="forge-progress-shimmer" aria-hidden="true" />}
        </div>
        <div className="forge-progress-foot" aria-hidden="true">
          <span>{PHASES[phase].label}</span>
          <span>
            {cardCount != null
              ? `${cardCount} / 100 Karten`
              : run?.candidate_count != null
                ? `${run.candidate_count} Kandidaten`
                : "Kandidaten werden geladen"}
          </span>
        </div>
      </div>

      <div className="forge-status">
        <span className="forge-status-dot" aria-hidden="true" />
        <div className="forge-status-copy" role="status" aria-live="polite">
          <span className="forge-status-phase">{run?.status === "done" ? "Fertig" : PHASES[phase].label}</span>
          <span className="forge-status-message">{message}</span>
        </div>
        <ForgeClock />
      </div>

      <div className="forge-whisper" aria-hidden="true">
        <span className="forge-whisper-label">Aus der Werkstatt</span>
        <span className="forge-whisper-track">
          {WHISPERS.map((line, index) => (
            <span key={line} style={cssVars({ "--i": index })}>
              {line}
            </span>
          ))}
        </span>
      </div>
    </div>
  )
}
