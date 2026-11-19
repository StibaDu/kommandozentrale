import { useEffect, useRef, useState } from "react"
import { api, type Deck, type DeckChatEntry } from "./api"
import { CardPreview } from "./CardPreview"
import { Icon, Markdown, cx } from "./ui"

const QUICK_PROMPTS = [
  "Was sind die drei größten Schwächen dieses Decks?",
  "Welche Karten sind tot und warum?",
  "Welche Änderungen würdest du jetzt vornehmen?",
  "Wie verbessere ich die Manabase?",
  "Welche fünf Karten würdest du cutten?",
  "Wie spiele ich das Deck gegen Kontrolle?",
]

function timeLabel(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
}

export function DeckChat({
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
  const [messages, setMessages] = useState<DeckChatEntry[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applyNotice, setApplyNotice] = useState<string | null>(null)
  const [previewName, setPreviewName] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const proposals = messages.flatMap((message) => message.proposals ?? []).slice(-20)
  const openProposals = proposals.filter((proposal) => proposal.status === "open")
  const appliedProposals = proposals.filter((proposal) => proposal.status === "applied")

  useEffect(() => {
    const latest = [...messages]
      .reverse()
      .find((message) => message.role === "assistant" && (message.proposals?.length ?? 0) > 0)
    setSelected(new Set((latest?.proposals ?? []).filter((proposal) => proposal.status === "open").map((proposal) => proposal.id)))
  }, [messages])

  async function refresh() {
    const result = await api.deckChat(deck.id)
    setMessages(result.messages)
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    api
      .deckChat(deck.id)
      .then((result) => {
        if (alive) setMessages(result.messages)
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
  }, [deck.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" })
  }, [messages, busy])

  async function send() {
    const text = input.trim()
    if (!text || busy || applying || !canEdit) return
    const local: DeckChatEntry = {
      id: `local-${Date.now()}`,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    }
    setMessages((previous) => [...previous, local])
    setInput("")
    setBusy(true)
    setError(null)
    setApplyNotice(null)
    setApplyError(null)
    try {
      const result = await api.sendDeckChat(deck.id, text)
      setMessages((previous) => [...previous.filter((message) => message.id !== local.id), result.user, result.reply])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setMessages((previous) => previous.filter((entry) => entry.id !== local.id))
      setInput(text)
      setError(message)
      onNotice(`Deck-Chat: ${message}`)
    } finally {
      setBusy(false)
    }
  }

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function applySelected() {
    const ids = [...selected].filter((id) => openProposals.some((proposal) => proposal.id === id))
    if (!ids.length || applying || !canEdit) return
    setApplying(true)
    setApplyError(null)
    setApplyNotice(null)
    try {
      const result = await api.applyDeckChat(deck.id, ids)
      onDeck(result.deck)
      if (result.error) setApplyError(result.error)
      if (result.rejected.length) {
        setApplyError(result.rejected.map((entry) => `${entry.swap.cut} → ${entry.swap.add}: ${entry.reason}`).join(" · "))
      }
      if (result.applied.length) {
        const notice = `${result.applied.length} Änderung${result.applied.length === 1 ? "" : "en"} übernommen.`
        setApplyNotice(notice)
        onNotice(notice)
      }
      await refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setApplyError(message)
      onNotice(`Chat-Swap: ${message}`)
    } finally {
      setApplying(false)
    }
  }

  function usePrompt(prompt: string) {
    if (!canEdit || busy || applying) return
    setInput(prompt)
  }

  function openCard(name: string) {
    const clean = name.trim()
    if (clean) setPreviewName(clean)
  }

  return (
    <>
      <div className="deck-chat">
      <div className="chat-head">
        <div>
          <h3>Deck-Chat</h3>
          <p className="muted">
            Sprich mit der KI über dieses Deck. Sie liest Deckliste, Analyse, Primer und Simulation. Konkrete Swaps
            erscheinen unter dem Chat und können dort direkt übernommen werden.
          </p>
        </div>
        <span className="chat-context-chip">
          <Icon name="spark" size={14} /> Deckkontext
        </span>
      </div>

      {loading ? (
        <div className="chat-loading">
          <span className="build-line" />
          <p className="muted">Chatverlauf wird geladen.</p>
        </div>
      ) : (
        <div className="chat-log">
          {messages.length === 0 && (
            <div className="chat-empty">
              <Icon name="spark" size={22} />
              <h4>Frag die KI zu diesem Deck.</h4>
              <p className="muted">
                Zum Beispiel nach Schwächen, toten Karten, Manabase, Swaps oder Spielplan. Der Chat kennt den aktuellen
                Simulationsreport.
              </p>
            </div>
          )}
          {messages.map((message) => (
            <div className={cx("chat-turn", `is-${message.role}`)} key={message.id}>
              <div className="chat-role">
                <span>{message.role === "user" ? "Du" : "KI"}</span>
                <time>{timeLabel(message.created_at)}</time>
              </div>
              <div className="chat-bubble">
                {message.role === "assistant" ? <Markdown text={message.content} onCardName={(name) => void openCard(name)} /> : <p>{message.content}</p>}
              </div>
            </div>
          ))}
          {busy && (
            <div className="chat-turn is-assistant">
              <div className="chat-role">
                <span>KI</span>
                <time>denkt nach</time>
              </div>
              <div className="chat-bubble chat-thinking">
                <span className="build-line" />
                <p className="muted">Deck, Analyse und Simulation werden gelesen.</p>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {proposals.length > 0 && (
        <section className="chat-proposals">
          <div className="chat-proposals-head">
            <div>
              <h4>Änderungsvorschläge</h4>
              <p className="muted">
                Die KI schlägt konkrete 1:1-Swaps vor. Übernehmen prüft Farbe, Rollen, Theme und Bracket-Budget und
                speichert eine Revision.
              </p>
            </div>
            <span className="chat-proposals-count">
              {openProposals.length} offen{appliedProposals.length ? ` · ${appliedProposals.length} übernommen` : ""}
            </span>
          </div>
          <div className="chat-proposal-list">
            {proposals.map((proposal) => (
              <label className={cx("chat-proposal", proposal.status === "applied" && "is-applied")} key={proposal.id}>
                <input
                  type="checkbox"
                  checked={selected.has(proposal.id)}
                  disabled={proposal.status !== "open" || applying || !canEdit}
                  onChange={() => toggle(proposal.id)}
                />
                <div className="chat-proposal-body">
                  <div className="chat-proposal-swap">
                    <button
                      type="button"
                      className="chat-cut chat-card-link"
                      title={`${proposal.cut_name} ansehen`}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        void openCard(proposal.cut_name)
                      }}
                    >
                      {proposal.cut_name}
                    </button>
                    <Icon name="arrow" size={14} />
                    <button
                      type="button"
                      className="chat-add chat-card-link"
                      title={`${proposal.add_name} ansehen`}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        void openCard(proposal.add_name)
                      }}
                    >
                      {proposal.add_name}
                    </button>
                    {proposal.status === "applied" && <span className="chat-proposal-status">übernommen</span>}
                  </div>
                  <p>{proposal.reason}</p>
                  {proposal.fixes.length > 0 && <p className="chat-proposal-fixes">Für: {proposal.fixes.join(" · ")}</p>}
                </div>
              </label>
            ))}
          </div>
          <div className="chat-proposals-bar">
            <span className="field-note">
              {applying
                ? "Die Änderungen werden geprüft und übernommen."
                : `${selected.size} ausgewählt${canEdit ? "" : " · Lesemodus"}`}
            </span>
            <button
              type="button"
              className="button primary"
              onClick={() => void applySelected()}
              disabled={!canEdit || applying || busy || selected.size === 0}
            >
              <Icon name="check" size={16} /> {applying ? "Übernimmt …" : `Ausgewählte übernehmen (${selected.size})`}
            </button>
          </div>
          {applyError && <p className="chat-error">{applyError}</p>}
          {applyNotice && <p className="chat-success">{applyNotice}</p>}
        </section>
      )}

      {error && <p className="chat-error">{error}</p>}

      {messages.length === 0 && !loading && (
        <div className="chat-quick" aria-label="Vorschläge">
          {QUICK_PROMPTS.map((prompt) => (
            <button type="button" className="chat-prompt" key={prompt} onClick={() => usePrompt(prompt)} disabled={!canEdit || busy || applying}>
              {prompt}
            </button>
          ))}
        </div>
      )}

      <form
        className="chat-compose"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
          placeholder={canEdit ? "Frage zu diesem Deck … (Enter sendet, Shift+Enter neue Zeile)" : "Nur der Besitzer kann schreiben."}
          rows={3}
          maxLength={2000}
          disabled={!canEdit || busy || applying}
          aria-label="Nachricht an die Deck-KI"
        />
        <div className="chat-compose-bar">
          <span className="field-note">
            {canEdit ? `${input.length}/2000 · Die KI kann irren; Karten und Regeln prüfen.` : "Lesemodus: Du kannst den Verlauf lesen."}
          </span>
          <button type="submit" className="button primary" disabled={!canEdit || busy || applying || !input.trim()}>
            <Icon name="arrow" size={16} /> {busy ? "Antwortet …" : "Senden"}
          </button>
        </div>
      </form>
      </div>

      {previewName && <CardPreview name={previewName} deck={deck} onClose={() => setPreviewName(null)} />}
    </>
  )
}
