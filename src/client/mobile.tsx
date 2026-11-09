import { useEffect, useMemo, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import {
  api,
  type AuthUser,
  type Deck,
  type DeckSummary,
  type Invite,
  type Meta,
  type MyStats,
  type PodPlayerState,
  type PodStanding,
  type PodState,
  type Profile,
} from "./api"
import { AuthScreen } from "./AuthScreen"
import { copyText } from "./clipboard"
import { parseEntryContext } from "./entry"
import {
  POD_COUNTERS,
  POD_STATUSES,
  podCounterValue,
  type PodCounterKey,
  type PodStatusKey,
} from "../lib/pod-counters"
import { Icon, ManaCost, Markdown, cx } from "./ui"

type Tab = "table" | "decks" | "profile" | "stats"

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "short" })
}

function MobileApp() {
  const [entry] = useState(() => parseEntryContext())
  const [ready, setReady] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [decks, setDecks] = useState<DeckSummary[]>([])
  const [users, setUsers] = useState<Profile[]>([])
  const [tab, setTab] = useState<Tab>("table")
  const [podCode, setPodCode] = useState<string | null>(entry.table)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .authStatus()
      .then((status) => {
        if (!alive) return
        setInitialized(status.initialized)
        setUser(status.user)
        setReady(true)
        if (status.user) void loadWorkspace()
      })
      .catch((err) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : String(err))
        setReady(true)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const unauthorized = () => {
      setUser(null)
      setMeta(null)
      setDecks([])
      setUsers([])
    }
    window.addEventListener("kz:unauthorized", unauthorized)
    return () => window.removeEventListener("kz:unauthorized", unauthorized)
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 3600)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!user) return
    const applyHash = () => {
      const route = parseEntryContext()
      if (route.table) {
        setPodCode(route.table)
        setTab("table")
        return
      }
      const hash = window.location.hash.replace(/^#/, "")
      if (hash === "decks" || hash === "profile" || hash === "stats" || hash === "table") setTab(hash as Tab)
    }
    applyHash()
    const current = parseEntryContext()
    if (current.invite || current.table) {
      const nextHash = current.table ? `#table=${current.table}` : "#table"
      if (window.location.hash !== nextHash) history.replaceState(null, "", nextHash)
    }
    window.addEventListener("hashchange", applyHash)
    return () => window.removeEventListener("hashchange", applyHash)
  }, [user])

  async function loadWorkspace() {
    try {
      const [nextMeta, nextDecks, nextUsers] = await Promise.all([api.meta(), api.decks(), api.users()])
      setMeta(nextMeta)
      setDecks(nextDecks)
      setUsers(nextUsers)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function authenticated(next: AuthUser) {
    setUser(next)
    setInitialized(true)
    setError(null)
    void loadWorkspace()
  }

  async function logout() {
    try {
      await api.logout()
    } catch {
      // lokal abmelden reicht
    }
    setUser(null)
    setMeta(null)
    setDecks([])
    setUsers([])
    setPodCode(null)
  }

  function go(next: Tab) {
    setTab(next)
    if (next === "table" && podCode) history.replaceState(null, "", `#table=${podCode}`)
    else history.replaceState(null, "", `#${next}`)
  }

  function choosePod(code: string | null) {
    setPodCode(code)
    if (code) history.replaceState(null, "", `#table=${code}`)
    else history.replaceState(null, "", "#table")
  }

  if (!ready) {
    return (
      <div className="boot">
        <div className="boot-mark">
          <Icon name="cards" size={26} />
        </div>
        <h1 className="boot-title">Kommandozentrale</h1>
        <p>Tisch wird geladen.</p>
      </div>
    )
  }

  if (!user) return <AuthScreen initialized={initialized} onAuthenticated={authenticated} />
  if (!meta) {
    return (
      <div className="boot">
        <div className="boot-mark">
          <Icon name="cards" size={26} />
        </div>
        <h1 className="boot-title">Kommandozentrale</h1>
        <p>Decks und Karten werden geladen.</p>
      </div>
    )
  }

  return (
    <div className="mobile-shell">
      <header className="mobile-top">
        <div className="mobile-brand">
          <span className="brand-mark">
            <img src="/logo-mark.svg" alt="" width={40} height={40} />
          </span>
          <div>
            <strong>Kommandozentrale</strong>
            <span>Tisch · {tab === "table" ? "Life-Counter" : tab === "decks" ? "Decks" : tab === "profile" ? "Profil" : "Statistik"}</span>
          </div>
        </div>
        <button type="button" className="mobile-user" onClick={() => go("profile")} aria-label="Profil öffnen">
          <span className="avatar" style={{ background: user.avatar_color }}>
            {initials(user.display_name)}
          </span>
        </button>
      </header>

      {error && (
        <div className="mobile-alert is-error" role="alert">
          <span>{error}</span>
          <button type="button" className="icon-button" onClick={() => setError(null)} aria-label="Fehler schließen">
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
      {notice && <div className="mobile-alert">{notice}</div>}

      <main className="mobile-main">
        {tab === "table" && (
          <MobileTable
            user={user}
            meta={meta}
            decks={decks}
            initialCode={podCode}
            onPodCode={choosePod}
            onNotice={setNotice}
            onError={setError}
          />
        )}
        {tab === "decks" && <MobileDecks decks={decks} user={user} onNotice={setNotice} onError={setError} />}
        {tab === "profile" && (
          <MobileProfile user={user} meta={meta} users={users} onUser={setUser} onLogout={() => void logout()} onNotice={setNotice} />
        )}
        {tab === "stats" && <MobileStats />}
      </main>

      <nav className="mobile-nav" aria-label="Mobile Navigation">
        {(
          [
            ["table", "Tisch", "table"],
            ["decks", "Decks", "cards"],
            ["profile", "Profil", "user"],
            ["stats", "Statistik", "chart"],
          ] as Array<[Tab, string, "table" | "cards" | "user" | "chart"]>
        ).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            className={cx("mobile-tab", tab === id && "is-active")}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => go(id)}
          >
            <Icon name={icon} size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

function MobileTable({
  user,
  meta,
  decks,
  initialCode,
  onPodCode,
  onNotice,
  onError,
}: {
  user: AuthUser
  meta: Meta
  decks: DeckSummary[]
  initialCode: string | null
  onPodCode: (code: string | null) => void
  onNotice: (text: string) => void
  onError: (text: string) => void
}) {
  const [pod, setPod] = useState<PodState | null>(null)
  const [active, setActive] = useState<PodState[]>([])
  const [podName, setPodName] = useState("")
  const [deckId, setDeckId] = useState("")
  const [codeInput, setCodeInput] = useState(initialCode ?? "")
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)
  const [finishOpen, setFinishOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [invites, setInvites] = useState<Invite[]>([])
  const [shareInviteCode, setShareInviteCode] = useState<string | null>(null)
  const [invitesLoading, setInvitesLoading] = useState(false)
  const [finishWinner, setFinishWinner] = useState("")
  const [finishTurns, setFinishTurns] = useState("")
  const [finishFun, setFinishFun] = useState("3")
  const [finishSalt, setFinishSalt] = useState("2")
  const [finishNotes, setFinishNotes] = useState("")
  const queues = useRef<Record<string, Promise<unknown>>>({})

  useEffect(() => {
    let alive = true
    api
      .activePods()
      .then((next) => {
        if (alive) setActive(next)
      })
      .catch(() => {})
    if (initialCode) {
      api
        .pod(initialCode)
        .then((next) => {
          if (alive) applyPod(next)
        })
        .catch((err) => {
          if (alive) setLocalError(err instanceof Error ? err.message : String(err))
        })
    }
    return () => {
      alive = false
    }
  }, [initialCode])

  const isMember = Boolean(
    pod && (pod.host_user_id === user.id || pod.players.some((player) => player.user_id === user.id)),
  )

  useEffect(() => {
    if (!pod || isMember || deckId) return
    if (decks.length === 1) setDeckId(decks[0].id)
  }, [pod, isMember, decks, deckId])

  useEffect(() => {
    if (!shareOpen || user.role !== "admin") return
    let alive = true
    setInvitesLoading(true)
    api
      .invites()
      .then((next) => {
        if (!alive) return
        const open = next.filter((invite) => invite.valid)
        setInvites(open)
        setShareInviteCode((current) =>
          current && open.some((invite) => invite.code === current) ? current : open[0]?.code ?? null,
        )
      })
      .catch(() => {
        if (alive) setInvites([])
      })
      .finally(() => {
        if (alive) setInvitesLoading(false)
      })
    return () => {
      alive = false
    }
  }, [shareOpen, user.role])

  useEffect(() => {
    if (!pod?.code) return
    let closed = false
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let ping: ReturnType<typeof setInterval> | null = null
    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws"
      socket = new WebSocket(`${protocol}://${window.location.host}/api/pods/${pod.code}/ws`)
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data))
          if (message.type === "state" && message.state) setPod(message.state)
        } catch {
          // ignore
        }
      }
      socket.onclose = () => {
        if (!closed) retry = setTimeout(connect, 1500)
      }
      socket.onerror = () => socket?.close()
      ping = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) socket.send("ping")
      }, 25000)
    }
    connect()
    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      if (ping) clearInterval(ping)
      socket?.close()
    }
  }, [pod?.code])

  function applyPod(next: PodState) {
    setPod(next)
    setLocalError(null)
    onPodCode(next.code)
    if (next.players.length) {
      setFinishWinner((current) => {
        if (next.players.some((player) => player.id === current)) return current
        const candidate = next.players.find((player) => !player.eliminated) ?? next.players[0]
        return candidate.id
      })
    }
  }

  async function refreshActive() {
    try {
      setActive(await api.activePods())
    } catch {
      // egal
    }
  }

  async function createPod() {
    setBusy(true)
    setLocalError(null)
    try {
      const next = await api.createPod({ name: podName.trim() || undefined, deckId: deckId || null })
      applyPod(next)
      await refreshActive()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function joinPod(code = codeInput) {
    const clean = code.trim().toUpperCase()
    if (!clean) {
      setLocalError("Gib einen Pod-Code ein.")
      return
    }
    setBusy(true)
    setLocalError(null)
    try {
      const next = await api.joinPod(clean, deckId || null)
      applyPod(next)
      setCodeInput(clean)
      await refreshActive()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function leavePod() {
    setPod(null)
    setSelectedPlayerId(null)
    setFinishOpen(false)
    onPodCode(null)
    void refreshActive()
  }

  function shareBase() {
    return meta.network.lanUrl ?? window.location.origin
  }

  function inviteShareUrl(invite: Invite) {
    if (!pod) return ""
    return `${shareBase()}/m#invite=${encodeURIComponent(invite.code)}&table=${encodeURIComponent(pod.code)}`
  }

  async function copyShare() {
    if (!pod) return
    const url = `${shareBase()}/m#table=${pod.code}`
    if (await copyText(url)) onNotice("Tisch-Link kopiert.")
    else onNotice(url)
  }

  async function copyInviteShare() {
    const invite = invites.find((item) => item.code === shareInviteCode)
    if (!invite) return
    const url = inviteShareUrl(invite)
    if (await copyText(url)) onNotice("Einladungslink kopiert.")
    else onNotice(url)
  }

  function adjustLife(playerId: string, delta: number) {
    if (!pod) return
    const code = pod.code
    setPod((current) =>
      current
        ? {
            ...current,
            players: current.players.map((player) =>
              player.id === playerId ? { ...player, life: Math.max(0, Math.min(999, player.life + delta)) } : player,
            ),
          }
        : current,
    )
    const previous = queues.current[playerId] ?? Promise.resolve()
    queues.current[playerId] = previous
      .then(() => api.podLife(code, playerId, delta))
      .then((next) => setPod(next))
      .catch((err) => {
        onError(err instanceof Error ? err.message : String(err))
      })
  }

  async function adjustPoison(playerId: string, delta: number) {
    if (!pod) return
    try {
      setPod(await api.podPoison(pod.code, playerId, delta))
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    }
  }

  async function adjustCommander(playerId: string, fromPlayerId: string, delta: number) {
    if (!pod) return
    try {
      setPod(await api.podCommander(pod.code, playerId, fromPlayerId, delta))
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    }
  }

  async function adjustCounter(playerId: string, counter: PodCounterKey, delta: number) {
    if (!pod) return
    try {
      setPod(await api.podCounter(pod.code, playerId, counter, delta))
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    }
  }

  async function toggleStatus(playerId: string, status: PodStatusKey, value: boolean) {
    if (!pod) return
    try {
      setPod(await api.podStatus(pod.code, playerId, status, value))
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    }
  }

  async function toggleEliminated(player: PodPlayerState) {
    if (!pod) return
    try {
      setPod(await api.podEliminate(pod.code, player.id, !player.eliminated))
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    }
  }

  async function resetPod() {
    if (!pod || !window.confirm("Alle Life-Werte auf 40, Poison, Zähler, Status und Commander-Schaden zurücksetzen?")) return
    try {
      setPod(await api.podReset(pod.code))
      onNotice("Tisch zurückgesetzt.")
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    }
  }

  async function undoPod() {
    if (!pod) return
    try {
      setPod(await api.podUndo(pod.code))
      onNotice("Letzte Änderung zurückgenommen.")
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    }
  }

  async function finishPod() {
    if (!pod) return
    setBusy(true)
    try {
      const result = await api.podFinish(pod.code, {
        winnerPlayerId: finishWinner || null,
        turns: finishTurns === "" ? null : Number(finishTurns),
        fun: Number(finishFun),
        salt: Number(finishSalt),
        notes: finishNotes.trim(),
      })
      setPod(result.state)
      setFinishOpen(false)
      onNotice("Spiel gespeichert. Die Statistik ist aktualisiert.")
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!pod) {
    return (
      <div className="mobile-page">
        <section className="mobile-panel">
          <h1 className="mobile-title">Wer sitzt am Tisch?</h1>
          <p className="mobile-lede">Erstelle einen Pod oder tritt mit dem Code deiner Runde bei. Alle Handys sehen denselben Life-Stand.</p>

          {active.length > 0 && (
            <div className="mobile-active-pods">
              <h2>Offene Tische</h2>
              {active.map((item) => (
                <button key={item.id} type="button" className="mobile-active-row" onClick={() => void joinPod(item.code)}>
                  <div>
                    <strong>{item.name ?? `Tisch ${item.code}`}</strong>
                    <span>{item.host_name} · {item.players.length} Spieler · Code {item.code}</span>
                  </div>
                  <span className="button ghost">Beitreten</span>
                </button>
              ))}
            </div>
          )}

          <div className="mobile-form">
            <label>
              <span className="field-label">Dein Deck</span>
              <select value={deckId} onChange={(event) => setDeckId(event.target.value)}>
                <option value="">Ohne Deck</option>
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name} · {deck.owner_name ?? "ohne Profil"}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="button primary wide" onClick={() => void createPod()} disabled={busy}>
              <Icon name="plus" size={17} /> {busy ? "Erstellt…" : "Neuen Tisch erstellen"}
            </button>
          </div>

          <div className="mobile-or"><span>oder</span></div>

          <div className="mobile-form">
            <label>
              <span className="field-label">Pod-Code</span>
              <input value={codeInput} onChange={(event) => setCodeInput(event.target.value.toUpperCase())} placeholder="z. B. K7M2QP" autoCapitalize="characters" />
            </label>
            <button type="button" className="button ghost wide" onClick={() => void joinPod()} disabled={busy}>
              <Icon name="arrow" size={17} /> {busy ? "Tritt bei…" : "Tisch beitreten"}
            </button>
          </div>

          {localError && <p className="field-note is-error">{localError}</p>}
          <p className="mobile-hint">Jeder am Tisch kann Werte korrigieren. Undo nimmt die letzte Änderung zurück; der Host kann zurücksetzen und das Spiel beenden.</p>
        </section>
      </div>
    )
  }

  if (!isMember) {
    const canJoin = pod.status === "active" && pod.players.length < 5
    return (
      <div className="mobile-page">
        <section className="mobile-panel">
          <h1 className="mobile-title">Tisch {pod.code}</h1>
          <p className="mobile-lede">
            {pod.name ?? `Tisch ${pod.code}`} · {pod.players.length} Spieler
            {pod.status !== "active" ? " · beendet" : pod.players.length >= 5 ? " · voll" : ""}
          </p>
          <p className="mobile-lede">Du bist noch nicht dabei. Wähle dein Deck und tritt dem Tisch bei.</p>
          <div className="mobile-form">
            <label>
              <span className="field-label">Dein Deck</span>
              <select value={deckId} onChange={(event) => setDeckId(event.target.value)} disabled={!canJoin}>
                <option value="">Ohne Deck</option>
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name} · {deck.owner_name ?? "ohne Profil"}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="button primary wide" onClick={() => void joinPod(pod.code)} disabled={busy || !canJoin}>
              <Icon name="arrow" size={17} /> {busy ? "Tritt bei…" : canJoin ? "Tisch beitreten" : "Beitritt nicht möglich"}
            </button>
          </div>
          {localError && <p className="field-note is-error">{localError}</p>}
          <button type="button" className="text-link mobile-back" onClick={leavePod}>
            Anderen Tisch wählen
          </button>
          <p className="mobile-hint">Der Tisch-Code bleibt in der Adresse gespeichert. Du kannst dein Deck auch später am Tisch sehen.</p>
        </section>
      </div>
    )
  }

  const selected = pod.players.find((player) => player.id === selectedPlayerId) ?? null
  const isHost = pod.host_user_id === user.id || user.role === "admin"
  const finished = pod.status !== "active"
  const shareInvite = invites.find((invite) => invite.code === shareInviteCode) ?? null

  return (
    <div className="mobile-page">
      <section className="mobile-pod-head">
        <div>
          <h1 className="mobile-title">{pod.name ?? `Tisch ${pod.code}`}</h1>
          <p className="mobile-lede">{finished ? "Beendet" : "Live"} · Code <strong>{pod.code}</strong> · {pod.players.length} Spieler</p>
        </div>
        <div className="mobile-pod-tools">
          <button type="button" className="icon-button" onClick={() => setShareOpen(true)} aria-label="Tisch teilen">
            <Icon name="wifi" size={17} />
          </button>
          <button type="button" className="text-link" onClick={leavePod}>Verlassen</button>
        </div>
      </section>

      <p className="mobile-table-hint">Tippe auf „Details“ bei einem Spieler, um Zähler und Status zu öffnen.</p>

      <div className="pod-grid">
        {pod.players.map((player) => {
          const damage = Object.values(player.commander_damage).reduce((sum, value) => sum + Number(value ?? 0), 0)
          const lethalCommander = Object.values(player.commander_damage).some((value) => Number(value ?? 0) >= 21)
          const lethal = player.life <= 0 || player.poison >= 10 || lethalCommander
          const counters = POD_COUNTERS.map((counter) => ({ ...counter, value: podCounterValue(player.counters, counter.key) })).filter(
            (counter) => counter.value > 0,
          )
          return (
            <article className={cx("pod-player", player.user_id === user.id && "is-me", player.eliminated && "is-out")} key={player.id}>
              <button
                type="button"
                className="pod-player-head"
                onClick={() => setSelectedPlayerId(player.id)}
                aria-label={`Details und Zähler für ${player.display_name} öffnen`}
              >
                <span className="avatar" style={{ background: player.avatar_color }}>{initials(player.display_name)}</span>
                <span className="pod-player-name">
                  <strong>{player.display_name}{player.user_id === user.id ? " · du" : ""}</strong>
                  <small>{player.commander_name ?? player.deck_name ?? "ohne Deck"}</small>
                </span>
                <span className="pod-player-open" aria-hidden="true">
                  Details <Icon name="arrow" size={15} />
                </span>
              </button>

              <div className="pod-player-body">
                <div className="pod-life-wrap">
                  <span className="pod-life-label">Leben</span>
                  <div className={cx("pod-life", player.life <= 0 && "is-danger")} aria-label={`Leben von ${player.display_name}: ${player.life}`}>
                    {player.life}
                  </div>
                </div>
                <div className="pod-controls">
                  <button type="button" onClick={() => adjustLife(player.id, -5)} disabled={finished} aria-label={`${player.display_name}: 5 Leben verlieren`}>−5</button>
                  <button type="button" onClick={() => adjustLife(player.id, -1)} disabled={finished} aria-label={`${player.display_name}: 1 Leben verlieren`}>−1</button>
                  <button type="button" onClick={() => adjustLife(player.id, 1)} disabled={finished} aria-label={`${player.display_name}: 1 Leben gewinnen`}>+1</button>
                  <button type="button" onClick={() => adjustLife(player.id, 5)} disabled={finished} aria-label={`${player.display_name}: 5 Leben gewinnen`}>+5</button>
                </div>
              </div>

              <div className="pod-meta">
                <span className={cx("pod-vital", player.poison >= 10 && "is-danger")}>Poison {player.poison}</span>
                <span className={cx("pod-vital", lethalCommander && "is-danger")}>CMD {damage}</span>
                {counters.map((counter) => (
                  <span key={counter.key}>{counter.short} {counter.value}</span>
                ))}
                {POD_STATUSES.map((status) => (
                  player.statuses?.[status.key] ? <span className="pod-status" key={status.key}>{status.short}</span> : null
                ))}
                {lethal && !player.eliminated && <span className="is-danger">tödlich</span>}
                {player.eliminated && <span className="is-danger">aus</span>}
              </div>
            </article>
          )
        })}
      </div>

      {finished ? (
        <div className="mobile-panel mobile-finished">
          <strong>Dieser Tisch ist beendet.</strong>
          <p>Das Spiel wurde im Protokoll gespeichert. Die Statistik findest du unter Statistik.</p>
          <button type="button" className="button primary wide" onClick={leavePod}>Neuen Tisch öffnen</button>
        </div>
      ) : (
        <div className="mobile-pod-actions">
          <button type="button" className="button ghost" onClick={() => void undoPod()} disabled={busy}>
            <Icon name="refresh" size={16} /> Undo
          </button>
          {isHost && (
            <>
              <button type="button" className="button ghost" onClick={() => void resetPod()} disabled={busy}>
                Reset
              </button>
              <button type="button" className="button primary" onClick={() => setFinishOpen(true)} disabled={busy}>
                <Icon name="check" size={16} /> Beenden
              </button>
            </>
          )}
        </div>
      )}

      {shareOpen && (
        <div className="mobile-sheet-backdrop" role="presentation" onClick={() => setShareOpen(false)}>
          <div className="mobile-sheet mobile-share" role="dialog" aria-modal="true" aria-label="Tisch teilen" onClick={(event) => event.stopPropagation()}>
            <div className="mobile-sheet-head">
              <div>
                <h2>Tisch teilen</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setShareOpen(false)} aria-label="Schließen">
                <Icon name="close" size={18} />
              </button>
            </div>
            <p className="mobile-lede">Für Spieler mit Profil: Scanne den Tisch-Code oder gib ihn direkt ein.</p>
            <img className="pod-qr" src={`/api/pods/${pod.code}/qr.svg`} alt={`QR-Code für Tisch ${pod.code}`} />
            <div className="share-code">{pod.code}</div>
            <button type="button" className="button ghost wide" onClick={() => void copyShare()}>
              <Icon name="copy" size={16} /> Tisch-Link kopieren
            </button>

            {user.role === "admin" && (
              <div className="mobile-share-invite">
                <h3>Neue Spieler einladen</h3>
                {invitesLoading ? (
                  <p className="mobile-hint">Einladungen werden geladen…</p>
                ) : invites.length > 0 ? (
                  <>
                    <p className="mobile-hint">Wähle eine Einladung. Der QR-Code enthält Tisch und Einladung: ein Scan genügt.</p>
                    <div className="invite-pick-list">
                      {invites.map((invite) => (
                        <button
                          key={invite.id}
                          type="button"
                          className={cx("invite-pick", shareInviteCode === invite.code && "is-active")}
                          onClick={() => setShareInviteCode(invite.code)}
                        >
                          <strong>{invite.label ?? "Einladung"}</strong>
                          <span>{invite.code}</span>
                        </button>
                      ))}
                    </div>
                    {shareInvite && (
                      <>
                        <img
                          className="pod-qr"
                          src={`/api/auth/invite/${encodeURIComponent(shareInvite.code)}/qr.svg?table=${encodeURIComponent(pod.code)}`}
                          alt={`QR-Code für Einladung ${shareInvite.code} und Tisch ${pod.code}`}
                        />
                        <div className="share-code">{shareInvite.code}</div>
                        <button type="button" className="button ghost wide" onClick={() => void copyInviteShare()}>
                          <Icon name="copy" size={16} /> Einladungslink kopieren
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <p className="mobile-hint">Keine offenen Einladungen. Lege im Profil eine neue Einladung an.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {selected && (
        <div className="mobile-sheet-backdrop" role="presentation" onClick={() => setSelectedPlayerId(null)}>
          <div className="mobile-sheet" role="dialog" aria-modal="true" aria-label={`Details für ${selected.display_name}`} onClick={(event) => event.stopPropagation()}>
            <div className="mobile-sheet-head">
              <div>
                <h2>{selected.display_name}</h2>
                <p className="mobile-sheet-sub">{selected.commander_name ?? selected.deck_name ?? "ohne Deck"} · {selected.life} Leben</p>
              </div>
              <button type="button" className="icon-button" onClick={() => setSelectedPlayerId(null)} aria-label="Schließen">
                <Icon name="close" size={20} />
              </button>
            </div>

            <div className="mobile-sheet-stat">
              <span>Leben</span>
              <strong>{selected.life}</strong>
              <div className="mobile-inline-buttons">
                <button type="button" onClick={() => adjustLife(selected.id, -5)} disabled={finished}>−5</button>
                <button type="button" onClick={() => adjustLife(selected.id, -1)} disabled={finished}>−1</button>
                <button type="button" onClick={() => adjustLife(selected.id, 1)} disabled={finished}>+1</button>
                <button type="button" onClick={() => adjustLife(selected.id, 5)} disabled={finished}>+5</button>
              </div>
            </div>

            <div className="mobile-sheet-stat">
              <span>Poison · Infect</span>
              <strong>{selected.poison}</strong>
              <div className="mobile-inline-buttons two">
                <button type="button" onClick={() => void adjustPoison(selected.id, -1)} disabled={finished}>−1</button>
                <button type="button" onClick={() => void adjustPoison(selected.id, 1)} disabled={finished}>+1</button>
              </div>
            </div>

            <div className="mobile-sheet-block">
              <h3>Weitere Zähler</h3>
              <div className="pod-counter-grid">
                {POD_COUNTERS.map((counter) => {
                  const value = podCounterValue(selected.counters, counter.key)
                  return (
                    <div className="pod-counter-row" key={counter.key}>
                      <span>{counter.label}</span>
                      <strong>{value}</strong>
                      <div className="mobile-inline-buttons pod-counter-buttons">
                        <button type="button" onClick={() => void adjustCounter(selected.id, counter.key, -1)} disabled={finished} aria-label={`${counter.label} um 1 verringern`}>−1</button>
                        <button type="button" onClick={() => void adjustCounter(selected.id, counter.key, 1)} disabled={finished} aria-label={`${counter.label} um 1 erhöhen`}>+1</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="mobile-sheet-block">
              <h3>Status</h3>
              <div className="pod-status-grid">
                {POD_STATUSES.map((status) => {
                  const active = Boolean(selected.statuses?.[status.key])
                  return (
                    <button
                      key={status.key}
                      type="button"
                      className={cx("pod-status-toggle", active && "is-active")}
                      onClick={() => void toggleStatus(selected.id, status.key, !active)}
                      disabled={finished}
                      aria-pressed={active}
                    >
                      <span>{status.label}</span>
                      <strong>{active ? "aktiv" : "aus"}</strong>
                    </button>
                  )
                })}
              </div>
              <p className="muted">Monarch und Initiative können nur bei einem Spieler gleichzeitig liegen.</p>
            </div>

            <div className="mobile-sheet-block">
              <h3>Commander-Schaden</h3>
              {pod.players.filter((player) => player.id !== selected.id).map((opponent) => {
                const value = Number(selected.commander_damage[opponent.id] ?? 0)
                return (
                  <div className="mobile-damage-row" key={opponent.id}>
                    <span>{opponent.display_name}</span>
                    <strong>{value}</strong>
                    <div className="mobile-inline-buttons">
                      <button type="button" onClick={() => void adjustCommander(selected.id, opponent.id, -1)} disabled={finished}>−1</button>
                      <button type="button" onClick={() => void adjustCommander(selected.id, opponent.id, 1)} disabled={finished}>+1</button>
                    </div>
                  </div>
                )
              })}
              {pod.players.length < 2 && <p className="muted">Sobald ein zweiter Spieler beitritt, erscheint die Schadensmatrix.</p>}
              <p className="muted">21 Schaden von einem Commander schalten einen Spieler aus.</p>
            </div>

            <button type="button" className={cx("button", selected.eliminated ? "ghost" : "primary", "wide")} onClick={() => void toggleEliminated(selected)} disabled={finished}>
              {selected.eliminated ? "Wieder ins Spiel holen" : "Als ausgeschieden markieren"}
            </button>
          </div>
        </div>
      )}

      {finishOpen && (
        <div className="mobile-sheet-backdrop" role="presentation" onClick={() => setFinishOpen(false)}>
          <div className="mobile-sheet" role="dialog" aria-modal="true" aria-label="Spiel beenden" onClick={(event) => event.stopPropagation()}>
            <div className="mobile-sheet-head">
              <div>
                <h2>Spiel beenden</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setFinishOpen(false)} aria-label="Schließen">
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="mobile-form">
              <label>
                <span className="field-label">Sieger</span>
                <select value={finishWinner} onChange={(event) => setFinishWinner(event.target.value)}>
                  {pod.players.map((player) => (
                    <option key={player.id} value={player.id}>{player.display_name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="field-label">Züge</span>
                <input type="number" min={0} max={99} value={finishTurns} onChange={(event) => setFinishTurns(event.target.value)} placeholder="z. B. 8" />
              </label>
              <div className="mobile-form-row">
                <label>
                  <span className="field-label">Fun</span>
                  <select value={finishFun} onChange={(event) => setFinishFun(event.target.value)}>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}/5</option>)}
                  </select>
                </label>
                <label>
                  <span className="field-label">Salz</span>
                  <select value={finishSalt} onChange={(event) => setFinishSalt(event.target.value)}>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}/5</option>)}
                  </select>
                </label>
              </div>
              <label>
                <span className="field-label">Notizen</span>
                <textarea rows={3} value={finishNotes} onChange={(event) => setFinishNotes(event.target.value)} placeholder="Turning Point, Salz, besondere Karte" />
              </label>
              <button type="button" className="button primary wide" onClick={() => void finishPod()} disabled={busy}>
                <Icon name="check" size={16} /> {busy ? "Speichert…" : "Spiel speichern"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MobileDecks({
  decks,
  user,
  onNotice,
  onError,
}: {
  decks: DeckSummary[]
  user: AuthUser
  onNotice: (text: string) => void
  onError: (text: string) => void
}) {
  const [filter, setFilter] = useState<"mine" | "all">("mine")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Deck | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let alive = true
    setLoading(true)
    api
      .deck(selectedId)
      .then((next) => {
        if (alive) setDetail(next)
      })
      .catch((err) => {
        if (alive) onError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [selectedId])

  const visible = useMemo(
    () => decks.filter((deck) => filter === "all" || deck.owner_user_id === user.id),
    [decks, filter, user.id],
  )

  if (selectedId) {
    return (
      <div className="mobile-page">
        <button type="button" className="text-link mobile-back" onClick={() => setSelectedId(null)}>
          <Icon name="arrow" size={15} /> Zurück zu den Decks
        </button>
        {loading || !detail ? (
          <div className="mobile-panel"><p className="muted">Deck wird geladen…</p></div>
        ) : (
          <>
            <section className="mobile-deck-hero">
              {detail.commander.image_uris?.art_crop && (
                <div className="mobile-deck-art" style={{ backgroundImage: `url(${detail.commander.image_uris.art_crop})` }} />
              )}
              <div className="mobile-deck-hero-copy">
                <h1 className="mobile-title">{detail.name}</h1>
                <p>{detail.owner_name ?? "ohne Profil"} · B{detail.bracket} · {detail.commander.name} · {detail.cards.reduce((sum, card) => sum + card.quantity, 0) + 1} Karten</p>
                <ManaCost cost={detail.commander.mana_cost} />
              </div>
            </section>

            <section className="mobile-panel">
              <h2>Rollen</h2>
              <div className="mobile-stat-grid">
                {[
                  ["Länder", detail.analysis?.lands ?? 0],
                  ["Ramp", detail.analysis?.counts.ramp ?? 0],
                  ["Draw", detail.analysis?.counts.draw ?? 0],
                  ["Removal", detail.analysis?.counts.removal ?? 0],
                  ["Wipes", detail.analysis?.counts.wipe ?? 0],
                  ["Tutoren", detail.analysis?.counts.tutor ?? 0],
                ].map(([label, value]) => (
                  <div key={label}>
                    <strong>{value}</strong>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="button ghost wide"
                onClick={async () => {
                  try {
                    await api.copyDeck(detail.id)
                    onNotice("Deck in dein Profil kopiert.")
                  } catch (err) {
                    onError(err instanceof Error ? err.message : String(err))
                  }
                }}
              >
                <Icon name="copy" size={16} /> In mein Profil kopieren
              </button>
            </section>

            {detail.primer && (
              <section className="mobile-panel mobile-primer">
                <h2>Primer</h2>
                <Markdown text={detail.primer} />
              </section>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="mobile-page">
      <div className="mobile-page-head">
        <div>
          <h1 className="mobile-title">Eure Sammlung.</h1>
        </div>
        <div className="mobile-segment">
          <button type="button" className={filter === "mine" ? "is-active" : ""} aria-pressed={filter === "mine"} onClick={() => setFilter("mine")}>Meine</button>
          <button type="button" className={filter === "all" ? "is-active" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>Alle</button>
        </div>
      </div>
      <div className="mobile-deck-list">
        {visible.map((deck) => (
          <button type="button" className="mobile-deck-row" key={deck.id} onClick={() => setSelectedId(deck.id)}>
            <span className="deck-tile-mark">B{deck.bracket}</span>
            <span className="mobile-deck-row-main">
              <strong>{deck.name}</strong>
              <small>{deck.commander_name} · {deck.card_count} Karten</small>
            </span>
            <span className="mobile-deck-owner">{deck.owner_name ?? "—"}</span>
          </button>
        ))}
        {visible.length === 0 && (
          <div className="mobile-empty">
            <h2>Noch kein Deck.</h2>
            <p>Decks baust du am Rechner. Hier siehst du sie und kannst sie kopieren.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function MobileProfile({
  user,
  meta,
  users,
  onUser,
  onLogout,
  onNotice,
}: {
  user: AuthUser
  meta: Meta
  users: Profile[]
  onUser: (user: AuthUser) => void
  onLogout: () => void
  onNotice: (text: string) => void
}) {
  const [displayName, setDisplayName] = useState(user.display_name)
  const [avatarColor, setAvatarColor] = useState(user.avatar_color)
  const [busy, setBusy] = useState(false)
  const [invites, setInvites] = useState<Invite[]>([])
  const [qrInvite, setQrInvite] = useState<Invite | null>(null)

  useEffect(() => {
    if (user.role !== "admin") return
    let alive = true
    api
      .invites()
      .then((next) => {
        if (alive) setInvites(next.filter((invite) => invite.valid))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [user.role])

  async function save() {
    setBusy(true)
    try {
      const result = await api.updateProfile({ displayName, avatarColor })
      onUser(result.user)
      onNotice("Profil gespeichert.")
    } catch (err) {
      onNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function inviteLink(invite: Invite) {
    const base = meta.network.lanUrl ?? window.location.origin
    return `${base}/m#invite=${encodeURIComponent(invite.code)}`
  }

  async function copyInvite(invite: Invite) {
    const url = inviteLink(invite)
    if (await copyText(url)) onNotice("Einladungslink kopiert.")
    else onNotice(url)
  }

  return (
    <div className="mobile-page">
      <section className="mobile-panel">
        <div className="mobile-profile-head">
          <span className="avatar is-large" style={{ background: avatarColor }}>{initials(displayName || user.display_name)}</span>
          <div>
            <h1 className="mobile-title">{user.display_name}</h1>
            <p>@{user.username}{user.role === "admin" ? " · Admin" : ""}</p>
          </div>
        </div>
        <div className="mobile-form">
          <label>
            <span className="field-label">Anzeigename</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} />
          </label>
          <label>
            <span className="field-label">Farbe</span>
            <span className="color-picker">
              {["#a4552f", "#1f3d33", "#2d5547", "#7d3d22", "#c39a3e", "#8f2f2f"].map((color) => (
                <button key={color} type="button" className={avatarColor === color ? "color-dot is-active" : "color-dot"} style={{ background: color }} onClick={() => setAvatarColor(color)} aria-label={`Farbe ${color}`} />
              ))}
            </span>
          </label>
          <button type="button" className="button primary wide" onClick={() => void save()} disabled={busy}>
            <Icon name="check" size={16} /> {busy ? "Speichert…" : "Profil speichern"}
          </button>
        </div>
      </section>

      {user.role === "admin" && (
        <section className="mobile-panel">
          <h2>Einladungen</h2>
          <p className="mobile-lede">Offene Einladungen für neue Profile. Ein Tipp auf QR zeigt den Code zum Scannen.</p>
          {invites.length > 0 ? (
            <div className="mobile-invite-list">
              {invites.map((invite) => (
                <div className="mobile-invite-row" key={invite.id}>
                  <div>
                    <strong>{invite.label ?? "Einladung"}</strong>
                    <span>{invite.code}</span>
                  </div>
                  <button type="button" className="icon-button" onClick={() => void copyInvite(invite)} aria-label={`Link für ${invite.label ?? "Einladung"} kopieren`}>
                    <Icon name="copy" size={16} />
                  </button>
                  <button type="button" className="icon-button" onClick={() => setQrInvite(invite)} aria-label={`QR-Code für ${invite.label ?? "Einladung"} anzeigen`}>
                    <Icon name="qr" size={16} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mobile-hint">Keine offenen Einladungen. Neue Einladungen legst du am Rechner an.</p>
          )}
        </section>
      )}

      <section className="mobile-panel">
        <h2>Die Runde</h2>
        <div className="mobile-member-list">
          {users.map((member) => (
            <div className="mobile-member" key={member.id}>
              <span className="avatar" style={{ background: member.avatar_color }}>{initials(member.display_name)}</span>
              <div><strong>{member.display_name}</strong><span>@{member.username}{member.role === "admin" ? " · Admin" : ""}</span></div>
            </div>
          ))}
        </div>
      </section>

      <section className="mobile-panel">
        <h2>Handy</h2>
        <p className="mobile-lede">Öffne die App auf jedem Handy im gleichen WLAN:</p>
        <div className="lan-url"><code>{meta.network.lanUrl ? `${meta.network.lanUrl}/m` : "LAN-Adresse nicht gefunden"}</code></div>
        <p className="mobile-hint">Die volle Deckwerkstatt verwaltest du am Rechner.</p>
        <button type="button" className="button ghost wide" onClick={onLogout}>
          <Icon name="logout" size={16} /> Abmelden
        </button>
      </section>

      {qrInvite && (
        <div className="mobile-sheet-backdrop" role="presentation" onClick={() => setQrInvite(null)}>
          <div className="mobile-sheet mobile-share" role="dialog" aria-modal="true" aria-label={`Einladung ${qrInvite.code}`} onClick={(event) => event.stopPropagation()}>
            <div className="mobile-sheet-head">
              <div>
                <h2>Einladung</h2>
                <p className="mobile-sheet-sub">{qrInvite.label ?? "Neues Profil"} · {qrInvite.code}</p>
              </div>
              <button type="button" className="icon-button" onClick={() => setQrInvite(null)} aria-label="Schließen">
                <Icon name="close" size={20} />
              </button>
            </div>
            <img className="pod-qr" src={`/api/auth/invite/${encodeURIComponent(qrInvite.code)}/qr.svg`} alt={`QR-Code für Einladung ${qrInvite.code}`} />
            <div className="share-code">{qrInvite.code}</div>
            <p className="mobile-hint">Mit der Handy-Kamera scannen. Der Code funktioniert einmal und führt direkt zur Profilanlage.</p>
            <button type="button" className="button ghost wide" onClick={() => void copyInvite(qrInvite)}>
              <Icon name="copy" size={16} /> Einladungslink kopieren
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function MobileStats() {
  const [me, setMe] = useState<MyStats | null>(null)
  const [pod, setPod] = useState<PodStanding[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([api.statsMe(), api.statsPod()])
      .then(([nextMe, nextPod]) => {
        if (!alive) return
        setMe(nextMe)
        setPod(nextPod)
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="mobile-page">
      <div className="mobile-page-head">
        <div>
          <h1 className="mobile-title">Deine Runde.</h1>
        </div>
      </div>

      {error && <p className="field-note is-error">{error}</p>}

      <section className="mobile-stat-cards">
        <div><strong>{me?.totals.games ?? 0}</strong><span>Spiele</span></div>
        <div><strong>{me?.totals.wins ?? 0}</strong><span>Siege</span></div>
        <div><strong>{me?.totals.winrate ?? 0}%</strong><span>Winrate</span></div>
        <div><strong>{me?.totals.avgTurns ?? "—"}</strong><span>Ø Züge</span></div>
      </section>

      <section className="mobile-panel">
        <h2>Pod-Ranking</h2>
        <div className="mobile-standing-list">
          {pod.map((member, index) => (
            <div className="mobile-standing" key={member.id}>
              <span className="mobile-rank">{index + 1}</span>
              <span className="avatar" style={{ background: member.avatar_color }}>{initials(member.display_name)}</span>
              <div><strong>{member.display_name}</strong><span>{member.games} Spiele · {member.wins} Siege</span></div>
              <strong className="mobile-winrate">{member.winrate}%</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="mobile-panel">
        <h2>Deine Decks</h2>
        {me?.byDeck.length ? (
          <div className="mobile-deck-stats">
            {me.byDeck.map((deck) => (
              <div className="mobile-deck-stat" key={deck.deck_id ?? deck.deck_name}>
                <div><strong>{deck.deck_name ?? "Unbekannt"}</strong><span>{deck.commander_name ?? ""}</span></div>
                <span>{deck.wins}/{deck.games}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Sobald du einen Tisch beendest, erscheinen hier deine Decks.</p>
        )}
      </section>

      <section className="mobile-panel">
        <h2>Letzte Spiele</h2>
        {me?.recent.length ? (
          <div className="mobile-recent-list">
            {me.recent.map((game) => (
              <div className="mobile-recent" key={game.id}>
                <span>{formatDate(game.played_at)}</span>
                <div><strong>{game.deck_name ?? "Unbekannt"}</strong><small>{game.is_winner ? "Sieg" : `${game.ending_life ?? "—"} Leben`}{game.turns != null ? ` · ${game.turns} Züge` : ""}</small></div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Noch kein Spiel protokolliert. Beende einen Tisch, dann füllt sich die Statistik.</p>
        )}
      </section>
    </div>
  )
}

createRoot(document.getElementById("root")!).render(<MobileApp />)
