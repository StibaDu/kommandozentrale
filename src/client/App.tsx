import { useEffect, useMemo, useRef, useState } from "react"
import { api, type ArtOption, type AuthUser, type BuildRun, type CommanderSuggestion, type Deck, type DeckSummary, type GameRecord, type GermanCardText, type Invite, type Meta } from "./api"
import { BracketDial, Icon, ManaCost, Markdown, Modal, NumberField, PodPicker, SearchBox, Toggle, artSrc, cx } from "./ui"
import { applyZeroRule } from "./settings"
import { ImportModal } from "./ImportModal"
import { DeckCombos, wouldBreakCombo } from "./DeckCombos"
import { DeckDoctor } from "./DeckDoctor"
import { DeckHistory } from "./DeckHistory"
import { DeckLab } from "./DeckLab"
import { MobileConnectModal } from "./MobileConnect"
import { BuildForge } from "./BuildForge"
import { HomeScreen } from "./HomeScreen"
import { AuthScreen } from "./AuthScreen"
import { ProfilePage } from "./ProfilePage"

type View = "start" | "builder" | "decks" | "games" | "rules" | "settings" | "profile"
type DeckView = "grid" | "list"
type DeckCard = Deck["cards"][number]
type GameInput = Parameters<typeof api.createGame>[0]

const DECK_VIEW_STORAGE_KEY = "kz.deck-view"

function initialDeckView(): DeckView {
  try {
    return window.localStorage.getItem(DECK_VIEW_STORAGE_KEY) === "list" ? "list" : "grid"
  } catch {
    return "grid"
  }
}

function deckInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

function commanderAsDeckCard(deck: Deck): DeckCard {
  const commander = deck.commander
  return {
    oracle_id: commander.oracle_id,
    name: commander.name,
    mana_cost: commander.mana_cost,
    cmc: commander.cmc,
    type_line: commander.type_line,
    oracle_text: commander.oracle_text,
    colors: commander.colors,
    color_identity: commander.color_identity,
    image_uris: commander.image_uris,
    card_faces: commander.card_faces,
    edhrec_rank: commander.edhrec_rank,
    is_game_changer: commander.is_game_changer,
    is_one_win: commander.is_one_win,
    produced_mana: commander.produced_mana,
    legalities: commander.legalities,
    role: "commander",
    category: "commander",
    reason: "Commander",
    printing_id: commander.printing_id,
    art_url: commander.art_url,
    artist: commander.artist,
    quantity: 1,
    is_commander: true,
    tags: [],
  }
}

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
  commander: "Command Zone",
}

const NAV: Array<{ id: View; label: string; icon: "home" | "hammer" | "cards" | "calendar" | "book" | "sliders" | "user" }> = [
  { id: "start", label: "Start", icon: "home" },
  { id: "builder", label: "Bauen", icon: "hammer" },
  { id: "decks", label: "Decks", icon: "cards" },
  { id: "games", label: "Spiele", icon: "calendar" },
  { id: "rules", label: "Regeln", icon: "book" },
  { id: "profile", label: "Profil", icon: "user" },
  { id: "settings", label: "Einstellungen", icon: "sliders" },
]

function friendlyModel(model: string | null | undefined) {
  if (!model) return "DeepSeek"
  const id = model.split("/")[1] ?? model
  if (id.includes("deepseek-v4.1-flash")) return "DeepSeek V4.1 Flash"
  return id
}

export default function App() {
  const [authReady, setAuthReady] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [decks, setDecks] = useState<DeckSummary[]>([])
  const [games, setGames] = useState<GameRecord[]>([])
  const [deck, setDeck] = useState<Deck | null>(null)
  const [profiles, setProfiles] = useState<AuthUser[]>([])
  const [view, setView] = useState<View>("start")
  const [draftBracket, setDraftBracket] = useState<3 | 4 | 5>(4)
  const [draftPod, setDraftPod] = useState(5)
  const [draftSettings, setDraftSettings] = useState<Record<string, any>>({})
  const [brief, setBrief] = useState("")
  const [buildRun, setBuildRun] = useState<BuildRun | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ text: string; run: () => Promise<void> | void } | null>(null)
  const [saveName, setSaveName] = useState("")
  const [saveOwner, setSaveOwner] = useState("")
  const [savingDeck, setSavingDeck] = useState(false)
  const [cardModal, setCardModal] = useState<DeckCard | null>(null)
  const [artModal, setArtModal] = useState<DeckCard | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const pollRef = useRef<number | null>(null)
  const buildTokenRef = useRef(0)
  const activeRunIdRef = useRef<string | null>(null)
  const settingsTimer = useRef<number | null>(null)
  const briefTimer = useRef<number | null>(null)

  useEffect(() => {
    let alive = true
    api
      .authStatus()
      .then((status) => {
        if (!alive) return
        setInitialized(status.initialized)
        setUser(status.user)
        setAuthReady(true)
        if (status.user) void loadWorkspace()
      })
      .catch((e) => {
        if (!alive) return
        setError(String(e))
        setAuthReady(true)
      })
    return () => {
      alive = false
      if (pollRef.current) clearTimeout(pollRef.current)
      if (settingsTimer.current) clearTimeout(settingsTimer.current)
      if (briefTimer.current) clearTimeout(briefTimer.current)
    }
  }, [])

  useEffect(() => {
    const unauthorized = () => {
      stopPolling()
      activeRunIdRef.current = null
      setBusy(false)
      setUser(null)
      setDeck(null)
      setProfiles([])
      setBuildRun(null)
      setMeta(null)
      setDecks([])
      setGames([])
      setBrief("")
      setView("start")
    }
    window.addEventListener("kz:unauthorized", unauthorized)
    return () => window.removeEventListener("kz:unauthorized", unauthorized)
  }, [])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 3200)
    return () => clearTimeout(t)
  }, [notice])

  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), 8000)
    return () => clearTimeout(t)
  }, [undo])

  useEffect(() => {
    if (!deck) {
      setSaveName("")
      setSaveOwner(user?.id ?? "")
      return
    }
    setSaveName(deck.name.replace(/ – Entwurf$/, ""))
    setSaveOwner(deck.owner_user_id ?? user?.id ?? "")
  }, [deck?.id, user?.id])

  async function loadWorkspace() {
    try {
      const [nextMeta, nextDecks, nextGames, nextProfiles] = await Promise.all([api.meta(), api.decks(), api.games(), api.profiles()])
      setMeta(nextMeta)
      setDraftSettings({ ...nextMeta.settings })
      setDecks(nextDecks)
      setGames(nextGames)
      setProfiles(nextProfiles)
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }

  function handleAuthenticated(nextUser: AuthUser, invites?: Invite[]) {
    setUser(nextUser)
    setInitialized(true)
    setError(null)
    if (invites?.length) setNotice(`Profil angelegt. ${invites.length} Einladungen warten unter Profil.`)
    void loadWorkspace()
  }

  async function logout() {
    const runId = activeRunIdRef.current ?? buildRun?.id
    if (runId) void api.cancelBuild(runId).catch(() => {})
    stopPolling()
    activeRunIdRef.current = null
    try {
      await api.logout()
    } catch {
      // Session ist lokal trotzdem beendet.
    }
    setBusy(false)
    setUser(null)
    setDeck(null)
    setProfiles([])
    setBuildRun(null)
    setMeta(null)
    setDecks([])
    setGames([])
    setBrief("")
    setView("start")
  }

  function goView(next: View) {
    setView(next)
    history.replaceState(null, "", next === "builder" && deck ? `#deck=${deck.id}` : `#${next}`)
  }

  useEffect(() => {
    if (!user) return
    const applyHash = () => {
      const h = window.location.hash.replace(/^#/, "")
      if (h.startsWith("deck=")) {
        void openDeck(h.slice(5))
        return
      }
      if (h === "import") {
        setImportOpen(true)
        setView("builder")
        return
      }
      if (["start", "builder", "decks", "games", "rules", "settings", "profile"].includes(h)) setView(h as View)
    }
    applyHash()
    window.addEventListener("hashchange", applyHash)
    return () => window.removeEventListener("hashchange", applyHash)
  }, [user])

  async function refreshDecks() {
    try {
      setDecks(await api.decks())
    } catch (e) {
      setError(String(e))
    }
  }

  async function refreshGames() {
    try {
      setGames(await api.games())
    } catch (e) {
      setError(String(e))
    }
  }

  function stopPolling() {
    buildTokenRef.current += 1
    if (pollRef.current) {
      window.clearTimeout(pollRef.current)
      pollRef.current = null
    }
  }

  async function openDeck(id: string) {
    const runId = activeRunIdRef.current ?? buildRun?.id
    stopPolling()
    activeRunIdRef.current = null
    if (runId) {
      try {
        await api.cancelBuild(runId)
      } catch {
        // Das Öffnen eines anderen Decks darf nicht an einem alten Build hängen.
      }
    }
    setBusy(true)
    setError(null)
    if (briefTimer.current) clearTimeout(briefTimer.current)
    try {
      const d = await api.deck(id)
      setDeck(d)
      setBrief(d.brief ?? "")
      setView("builder")
      history.replaceState(null, "", `#deck=${id}`)
      setBuildRun(null)
      setDraftBracket(d.bracket)
      setDraftPod(d.pod_size)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  function startPolling(runId: string, deckId: string) {
    const token = buildTokenRef.current
    const poll = async () => {
      if (token !== buildTokenRef.current) return
      try {
        const run = await api.buildStatus(runId)
        if (token !== buildTokenRef.current) return
        setBuildRun(run)
        if (run.status === "done" || run.status === "error" || run.status === "cancelled") {
          if (run.status === "cancelled") {
            activeRunIdRef.current = null
            setBusy(false)
            setNotice("Build abgebrochen.")
            return
          }
          const d = await api.deck(deckId)
          if (token !== buildTokenRef.current) return
          activeRunIdRef.current = null
          setDeck(d)
          if (run.status === "done") {
            await new Promise((resolve) => window.setTimeout(resolve, 950))
            if (token !== buildTokenRef.current) return
          }
          setBusy(false)
          await refreshDecks()
          if (run.status === "error") setError(run.error ?? "Der Build ist fehlgeschlagen.")
        } else {
          pollRef.current = window.setTimeout(poll, 1400)
        }
      } catch (e) {
        if (token !== buildTokenRef.current) return
        activeRunIdRef.current = null
        void api.cancelBuild(runId).catch(() => {})
        setBuildRun(null)
        setError(String(e))
        setBusy(false)
      }
    }
    void poll()
  }

  async function startBuild(deckId: string, nextBrief = brief) {
    const previousRunId = activeRunIdRef.current
    stopPolling()
    activeRunIdRef.current = null
    if (previousRunId) void api.cancelBuild(previousRunId).catch(() => {})
    const token = buildTokenRef.current
    setBusy(true)
    setError(null)
    setBuildRun({ id: "", deck_id: deckId, status: "queued", message: "Build wird gestartet.", error: null, provider: null, model: null })
    try {
      const { runId } = await api.build(deckId, nextBrief)
      if (token !== buildTokenRef.current) {
        void api.cancelBuild(runId).catch(() => {})
        return
      }
      activeRunIdRef.current = runId
      startPolling(runId, deckId)
    } catch (e) {
      if (token !== buildTokenRef.current) return
      activeRunIdRef.current = null
      setError(String(e))
      setBusy(false)
      setBuildRun(null)
    }
  }

  function cancelBuild() {
    const runId = activeRunIdRef.current ?? buildRun?.id
    stopPolling()
    activeRunIdRef.current = null
    setBusy(false)
    setBuildRun(null)
    setNotice("Build abgebrochen. Die Werkstatt ist bereit.")
    if (runId) {
      void api.cancelBuild(runId).catch((e) => setError(String(e)))
    }
  }

  function requestBuild(id: string) {
    if (deck && deck.cards.length > 0) {
      const ok = confirm("Neu bauen ersetzt die aktuelle Deckliste durch einen neuen Entwurf. Fortfahren?")
      if (!ok) return
    }
    void startBuild(id, brief)
  }

  async function createDeck(commanderName: string, autoBuild = false) {
    if (!meta) return
    const runId = activeRunIdRef.current
    stopPolling()
    activeRunIdRef.current = null
    if (runId) void api.cancelBuild(runId).catch(() => {})
    setBusy(true)
    setError(null)
    setBuildRun(null)
    let building = false
    try {
      const d = await api.createDeck({
        commanderName,
        bracket: draftBracket,
        podSize: draftPod,
        settings: deck?.settings ?? draftSettings,
        brief,
      })
      setDeck(d)
      setBrief(d.brief)
      setDraftBracket(d.bracket)
      setDraftPod(d.pod_size)
      history.replaceState(null, "", `#deck=${d.id}`)
      setBusy(false)
      await refreshDecks()
      if (autoBuild) {
        building = true
        setNotice("Commander gesetzt. Der Build startet.")
        await startBuild(d.id, d.brief)
      } else {
        setNotice("Commander gesetzt. Prüfe die Vision und starte dann den Build.")
      }
    } catch (e) {
      setError(String(e))
    } finally {
      if (!building) setBusy(false)
    }
  }

  function updateBrief(next: string) {
    const limited = next.slice(0, 2000)
    setBrief(limited)
    if (!deck) return
    const deckId = deck.id
    setDeck((current) => (current && current.id === deckId ? { ...current, brief: limited } : current))
    if (briefTimer.current) clearTimeout(briefTimer.current)
    briefTimer.current = window.setTimeout(() => {
      api
        .patchDeck(deckId, { brief: limited })
        .then((saved) => {
          setDeck((current) =>
            current && current.id === deckId && current.brief === limited
              ? { ...current, brief: saved.brief, updated_at: saved.updated_at }
              : current,
          )
        })
        .catch((e) => setError(String(e)))
    }, 450)
  }

  function updateSettings(partial: Record<string, any>) {
    const current = deck?.settings ?? draftSettings
    let next = { ...current, ...partial }
    if (partial.zeroRule !== undefined) next = applyZeroRule(next, Boolean(partial.zeroRule))
    if (deck) {
      setDeck({ ...deck, settings: next })
      if (settingsTimer.current) clearTimeout(settingsTimer.current)
      settingsTimer.current = window.setTimeout(() => {
        api
          .patchDeck(deck.id, { settings: next })
          .then((d) => setDeck((prev) => (prev ? { ...prev, settings: d.settings } : prev)))
          .catch((e) => setError(String(e)))
      }, 350)
    } else {
      setDraftSettings(next)
    }
  }

  function updateBracket(next: 3 | 4 | 5) {
    setDraftBracket(next)
    if (!deck) return
    setDeck({ ...deck, bracket: next })
    api
      .patchDeck(deck.id, { bracket: next })
      .then((d) => setDeck(d))
      .catch((e) => setError(String(e)))
  }

  function updatePod(next: number) {
    setDraftPod(next)
    if (!deck) return
    setDeck({ ...deck, pod_size: next })
    api
      .patchDeck(deck.id, { podSize: next })
      .then((d) => setDeck(d))
      .catch((e) => setError(String(e)))
  }

  async function addCard(
    name: string,
    options: {
      board?: "main" | "maybeboard"
      role?: string
      category?: string
      reason?: string
      printingId?: string | null
      artUrl?: string | null
      artist?: string | null
    } = {},
  ): Promise<boolean> {
    if (!deck) return false
    try {
      const d = await api.addCard(deck.id, name, options)
      setDeck(d)
      setNotice(options.board === "maybeboard" ? `${name} ins Maybeboard gelegt.` : `${name} hinzugefügt.`)
      return true
    } catch (e) {
      setError(String(e))
      return false
    }
  }

  async function removeCard(card: DeckCard): Promise<boolean> {
    if (!deck) return false
    const board = card.board ?? "main"
    if (board === "main" && wouldBreakCombo(deck.id, card.name)) {
      const confirmed = window.confirm(
        `${card.name} ist Teil einer erkannten Combo. Trotzdem entfernen?\n\nÖffne den Combos-Tab, wenn du die Variante vorher prüfen willst.`,
      )
      if (!confirmed) return false
    }
    try {
      const d = await api.removeCard(deck.id, card.oracle_id)
      setDeck(d)
      setCardModal(null)
      setNotice(null)
      setUndo({
        text: `${card.name} entfernt.`,
        run: async () => {
          const restored = await api.addCard(deck.id, card.name, {
            board,
            role: card.role,
            category: card.category,
            reason: card.reason,
            printingId: card.printing_id,
            artUrl: card.art_url,
            artist: card.artist,
          })
          setDeck(restored)
          setUndo(null)
          setNotice(`${card.name} wiederhergestellt.`)
        },
      })
      return true
    } catch (e) {
      setError(String(e))
      return false
    }
  }

  async function moveCard(card: DeckCard, board: "main" | "maybeboard") {
    if (!deck) return false
    const from = card.board ?? "main"
    try {
      const d = await api.moveCard(deck.id, card.oracle_id, board)
      setDeck(d)
      setCardModal(null)
      setNotice(null)
      setUndo({
        text: board === "maybeboard" ? `${card.name} ins Maybeboard gelegt.` : `${card.name} ins Deck geholt.`,
        run: async () => {
          const back = await api.moveCard(deck.id, card.oracle_id, from)
          setDeck(back)
          setUndo(null)
          setNotice(`${card.name} zurück verschoben.`)
        },
      })
      return true
    } catch (e) {
      setError(String(e))
      return false
    }
  }

  async function swapCard(addName: string, removeOracleId: string): Promise<boolean> {
    if (!deck) return false
    try {
      const removedName = deck.cards.find((card) => card.oracle_id === removeOracleId)?.name ?? "die andere Karte"
      const d = await api.swapCard(deck.id, addName, removeOracleId)
      setDeck(d)
      setNotice(`${addName} für ${removedName} getauscht.`)
      return true
    } catch (e) {
      setError(String(e))
      return false
    }
  }

  async function chooseArt(card: DeckCard, option: ArtOption | { artUrl: string; artist?: string; printingId?: string }) {
    if (!deck) return
    const body =
      "source" in option
        ? { printingId: option.id.startsWith("mpcfill:") ? option.id : option.id, artUrl: option.imageUrl, artist: option.artist ?? null }
        : { printingId: option.printingId ?? null, artUrl: option.artUrl, artist: option.artist ?? null }
    await api.setArt(deck.id, card.oracle_id, body)
    const d = await api.deck(deck.id)
    setDeck(d)
    setArtModal(null)
    setNotice(`Art für ${card.name} gespeichert.`)
  }

  async function clearArt(card: DeckCard) {
    if (!deck) return
    await api.setArt(deck.id, card.oracle_id, { printingId: null, artUrl: null, artist: null })
    const d = await api.deck(deck.id)
    setDeck(d)
    setArtModal(null)
    setNotice(`Art für ${card.name} zurückgesetzt.`)
  }

  async function startNewDeck() {
    if (deck && !deck.saved_at) {
      if (!confirm("Der ungespeicherte Entwurf wird verworfen. Fortfahren?")) return
    }

    const runId = activeRunIdRef.current ?? buildRun?.id
    stopPolling()
    activeRunIdRef.current = null
    if (runId) {
      try {
        await api.cancelBuild(runId)
      } catch {
        // Die Auswahl bleibt trotzdem erreichbar; der alte Lauf wird ignoriert.
      }
    }
    setBusy(false)
    setBuildRun(null)

    if (deck && !deck.saved_at) {
      try {
        await api.deleteDeck(deck.id)
      } catch (e) {
        setError(String(e))
        return
      }
    }

    if (deck) {
      setDraftSettings(deck.settings)
      setDraftBracket(deck.bracket)
      setDraftPod(deck.pod_size)
      setBrief(deck.brief ?? "")
    }
    if (briefTimer.current) clearTimeout(briefTimer.current)
    setDeck(null)
    setView("builder")
    history.replaceState(null, "", "#builder")
    setNotice(
      deck?.saved_at
        ? "Commander-Auswahl geöffnet. Das Deck bleibt gespeichert."
        : "Commander-Auswahl geöffnet. Vision und Einstellungen bleiben erhalten.",
    )
  }

  async function saveDeck() {
    if (!deck) return
    const wasSaved = Boolean(deck.saved_at)
    setSavingDeck(true)
    setError(null)
    try {
      const saved = await api.saveDeck(deck.id, {
        name: saveName.trim() || deck.commander_name,
        ownerUserId: saveOwner || user?.id,
      })
      setDeck(saved)
      setSaveName(saved.name)
      setSaveOwner(saved.owner_user_id ?? user?.id ?? "")
      await refreshDecks()
      if (!wasSaved) {
        setMeta((current) => (current ? { ...current, counts: { ...current.counts, decks: current.counts.decks + 1 } } : current))
      }
      setNotice(`Deck für ${saved.owner_name ?? "dich"} gespeichert.`)
    } catch (e) {
      setError(String(e))
    } finally {
      setSavingDeck(false)
    }
  }

  async function saveSettingsNow() {
    if (settingsTimer.current) clearTimeout(settingsTimer.current)
    if (!deck) {
      setNotice("Einstellungen für das nächste Deck gespeichert.")
      return
    }
    try {
      const d = await api.patchDeck(deck.id, { settings: deck.settings })
      setDeck(d)
      setNotice("Einstellungen gespeichert.")
    } catch (e) {
      setError(String(e))
    }
  }

  const settings = deck?.settings ?? draftSettings
  const bracket = deck?.bracket ?? draftBracket
  const pod = deck?.pod_size ?? draftPod
  const deckEditable = Boolean(deck && (user?.role === "admin" || deck.owner_user_id === user?.id))

  if (!authReady) {
    return (
      <div className="boot">
        <div className="boot-mark">
          <Icon name="cards" size={26} />
        </div>
        <h1 style={{ overflowWrap: "break-word", minWidth: 0 }}>Kommandozentrale</h1>
        <p>Die Werkstatt prüft die Anmeldung.</p>
      </div>
    )
  }

  if (!user) {
    return <AuthScreen initialized={initialized} onAuthenticated={handleAuthenticated} />
  }

  if (!meta) {
    return (
      <div className="boot">
        <div className="boot-mark">
          <Icon name="cards" size={26} />
        </div>
        <h1 style={{ overflowWrap: "break-word", minWidth: 0 }}>Kommandozentrale</h1>
        <p>Die Werkstatt lädt Karten, Regeln und Brackets.</p>
      </div>
    )
  }

  return (
    <div className="shell">
      <aside className="rail">
        <button type="button" className="brand" onClick={() => goView("start")} aria-label="Zur Startseite">
          <span className="brand-mark">
            <img src="/logo-mark.svg" alt="" width={40} height={40} />
          </span>
          <div>
            <strong>Kommandozentrale</strong>
            <span>Deckwerkstatt</span>
          </div>
        </button>
        <nav className="nav" aria-label="Hauptnavigation">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cx("nav-item", view === item.id && "is-active")}
              onClick={() => goView(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="rail-user">
          <span className="avatar" style={{ background: user.avatar_color }}>
            {user.display_name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{user.display_name}</strong>
            <span>@{user.username}</span>
          </div>
          <button type="button" className="icon-button" onClick={() => void logout()} aria-label="Abmelden">
            <Icon name="logout" size={16} />
          </button>
        </div>
        <div className="rail-foot">
          <span className="rail-label">Modell</span>
          <span className="rail-model">{meta.model.split("/")[1]}</span>
          <span className="rail-meta">{meta.counts.cards.toLocaleString("de-DE")} Karten im Index</span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{view === "builder" ? "Bauen" : NAV.find((n) => n.id === view)?.label}</h1>
          </div>
          <div className="topbar-actions">
            <button type="button" className="button ghost topbar-mobile" onClick={() => setMobileOpen(true)} aria-label="Handy verbinden">
              <Icon name="wifi" size={16} /> <span>Handy</span>
            </button>
            {view !== "start" && deck && (
              <span className={cx("status-chip", busy && "is-busy")}>
                {busy ? "Baut" : !deck.saved_at ? "Nicht gespeichert" : deck.status === "ready" ? "Bereit" : "Entwurf"}
              </span>
            )}
            {view === "builder" && deck && deckEditable && busy && buildRun && (buildRun.status === "queued" || buildRun.status === "running") && (
              <button type="button" className="button ghost" onClick={cancelBuild}>
                Build abbrechen
              </button>
            )}
            {view === "builder" && deck && deckEditable && (
              <button type="button" className="button ghost" onClick={() => void startNewDeck()}>
                <Icon name="arrow" size={16} /> Commander &amp; Vision
              </button>
            )}
            {view !== "start" && deck && deckEditable && !busy && (
              <button
                type="button"
                className={cx("button ghost", deck.cards.length === 0 && "is-idle-action")}
                onClick={() => requestBuild(deck.id)}
              >
                <Icon name="spark" size={16} /> {deck.cards.length === 0 ? "Deck bauen" : "Neu bauen"}
              </button>
            )}
          </div>
        </header>

        {error && (
          <div className="notice is-error" role="alert">
            <span>{error}</span>
            <button type="button" className="icon-button" onClick={() => setError(null)} aria-label="Fehler schließen">
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {notice && <div className="notice">{notice}</div>}
        {undo && (
          <div className="notice notice-undo">
            <span>{undo.text}</span>
            <span className="notice-actions">
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  const action = undo.run
                  setUndo(null)
                  void Promise.resolve(action()).catch((e) => setError(String(e)))
                }}
              >
                Rückgängig
              </button>
              <button type="button" className="icon-button" onClick={() => setUndo(null)} aria-label="Hinweis schließen">
                <Icon name="close" size={15} />
              </button>
            </span>
          </div>
        )}

        {view === "start" && (
          <HomeScreen
            meta={meta}
            decks={decks}
            games={games}
            deck={deck}
            editable={deckEditable}
            user={user}
            busy={busy}
            buildRun={buildRun}
            modelLabel={friendlyModel(meta.model)}
            onNew={() => void startNewDeck()}
            onContinue={() => {
              if (!deck) return
              setView("builder")
              history.replaceState(null, "", `#deck=${deck.id}`)
            }}
            onOpen={openDeck}
            onView={(next) => goView(next)}
          />
        )}

        {view === "builder" &&
          (deck ? (
            <BuilderScreen
              deck={deck}
              meta={meta}
              profiles={profiles}
              currentUser={user}
              editable={deckEditable}
              busy={busy}
              buildRun={buildRun}
              bracket={bracket}
              pod={pod}
              settings={settings}
              brief={brief}
              saveName={saveName}
              saveOwner={saveOwner}
              savingDeck={savingDeck}
              onSaveName={setSaveName}
              onSaveOwner={setSaveOwner}
              onSave={saveDeck}
              onBracket={updateBracket}
              onPod={updatePod}
              onSettings={updateSettings}
              onBrief={updateBrief}
              onBuild={() => requestBuild(deck.id)}
              onCancel={cancelBuild}
              onCard={setCardModal}
              onArt={setArtModal}
              onAdd={addCard}
              onRemove={removeCard}
              onMove={moveCard}
              onSwap={swapCard}
              onExport={() => window.open(`/api/decks/${deck.id}/export`, "_blank")}
              onSettingsPage={() => setView("settings")}
              onNew={startNewDeck}
              onDoctorApplied={(next) => {
                setDeck(next)
                setDraftBracket(next.bracket)
                setDraftPod(next.pod_size)
                setDraftSettings(next.settings)
                history.replaceState(null, "", `#deck=${next.id}`)
                void refreshDecks()
              }}
              onNotice={setNotice}
            />
          ) : (
            <StartScreen
              meta={meta}
              decks={decks}
              bracket={bracket}
              pod={pod}
              settings={settings}
              brief={brief}
              onBracket={updateBracket}
              onPod={updatePod}
              onSettings={updateSettings}
              onBrief={setBrief}
              onPick={createDeck}
              onBuildSuggestion={(name) => void createDeck(name, true)}
              onOpen={openDeck}
              onImport={() => setImportOpen(true)}
            />
          ))}

        {view === "decks" && (
          <DecksPage
            decks={decks}
            user={user}
            onOpen={openDeck}
            onNew={startNewDeck}
            onImport={() => setImportOpen(true)}
            onCopy={async (id) => {
              try {
                const copy = await api.copyDeck(id)
                setDeck(copy)
                setBrief(copy.brief ?? "")
                setBuildRun(null)
                setDraftBracket(copy.bracket)
                setDraftPod(copy.pod_size)
                setDraftSettings(copy.settings)
                setView("builder")
                history.replaceState(null, "", `#deck=${copy.id}`)
                await refreshDecks()
                setNotice("Deck kopiert. Du kannst die Kopie jetzt bearbeiten.")
              } catch (e) {
                setError(String(e))
              }
            }}
            onDelete={async (id) => {
              if (!confirm("Deck wirklich löschen?")) return
              try {
                await api.deleteDeck(id)
                if (deck?.id === id) setDeck(null)
                await refreshDecks()
              } catch (e) {
                setError(String(e))
              }
            }}
          />
        )}

        {view === "games" && (
          <GamesPage
            games={games}
            decks={decks}
            onCreate={async (body) => {
              try {
                const game = await api.createGame(body)
                setGames((prev) => [game, ...prev])
                setMeta((prev) => (prev ? { ...prev, counts: { ...prev.counts, games: prev.counts.games + 1 } } : prev))
                setNotice("Spiel protokolliert.")
                return true
              } catch (e) {
                setError(String(e))
                return false
              }
            }}
            onDelete={async (id) => {
              if (!confirm("Spiel wirklich löschen?")) return
              try {
                await api.deleteGame(id)
                setGames((prev) => prev.filter((game) => game.id !== id))
                setMeta((prev) => (prev ? { ...prev, counts: { ...prev.counts, games: Math.max(0, prev.counts.games - 1) } } : prev))
              } catch (e) {
                setError(String(e))
              }
            }}
          />
        )}

        {view === "rules" && <RulesPage meta={meta} />}

        {view === "profile" && (
          <ProfilePage user={user} meta={meta} onUser={setUser} onNotice={setNotice} onLogout={() => void logout()} />
        )}

        {view === "settings" && (
          <SettingsPage meta={meta} deck={deck} settings={settings} onChange={updateSettings} onSave={saveSettingsNow} />
        )}
      </main>

      {cardModal && (
        <CardModal
          card={cardModal}
          deckId={deck?.id ?? ""}
          onClose={() => setCardModal(null)}
          onArt={() => {
            setArtModal(cardModal)
            setCardModal(null)
          }}
          onRemove={cardModal.is_commander ? undefined : () => removeCard(cardModal)}
          onMove={
            cardModal.is_commander
              ? undefined
              : () => moveCard(cardModal, cardModal.board === "maybeboard" ? "main" : "maybeboard")
          }
        />
      )}

      {artModal && deck && (
        <ArtModal
          card={artModal}
          onClose={() => setArtModal(null)}
          onChoose={(option) => chooseArt(artModal, option)}
          onClear={() => clearArt(artModal)}
        />
      )}

      {mobileOpen && <MobileConnectModal meta={meta} onClose={() => setMobileOpen(false)} />}

      {importOpen && (
        <ImportModal
          meta={meta}
          bracket={bracket}
          pod={pod}
          settings={settings}
          onClose={() => {
            setImportOpen(false)
            if (window.location.hash === "#import") history.replaceState(null, "", "#decks")
          }}
          onImported={(importedDeck) => {
            setDeck(importedDeck)
            setBrief(importedDeck.brief ?? "")
            setView("builder")
            setBuildRun(null)
            setDraftBracket(importedDeck.bracket)
            setDraftPod(importedDeck.pod_size)
            setDraftSettings(importedDeck.settings)
            history.replaceState(null, "", `#deck=${importedDeck.id}`)
            void refreshDecks()
          }}
        />
      )}
    </div>
  )
}

function StartScreen({
  meta,
  decks,
  bracket,
  pod,
  settings,
  brief,
  onBracket,
  onPod,
  onSettings,
  onBrief,
  onPick,
  onBuildSuggestion,
  onOpen,
  onImport,
}: {
  meta: Meta
  decks: DeckSummary[]
  bracket: 3 | 4 | 5
  pod: number
  settings: Record<string, any>
  brief: string
  onBracket: (next: 3 | 4 | 5) => void
  onPod: (next: number) => void
  onSettings: (partial: Record<string, any>) => void
  onBrief: (next: string) => void
  onPick: (name: string) => void
  onBuildSuggestion: (name: string) => void
  onOpen: (id: string) => void
  onImport: () => void
}) {
  const [suggestions, setSuggestions] = useState<CommanderSuggestion[]>([])
  const [suggesting, setSuggesting] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [suggestNote, setSuggestNote] = useState<string | null>(null)
  const suggestToken = useRef(0)
  const visionReady = brief.trim().length >= 8

  useEffect(() => {
    suggestToken.current += 1
    setSuggesting(false)
    setSuggestions([])
    setSuggestError(null)
    setSuggestNote(null)
  }, [brief, bracket, pod, settings])

  async function suggestCommanders() {
    if (!visionReady || suggesting) return
    const token = ++suggestToken.current
    setSuggesting(true)
    setSuggestError(null)
    setSuggestNote(null)
    setSuggestions([])
    try {
      const result = await api.suggestCommanders({ brief, bracket, podSize: pod, settings })
      if (token !== suggestToken.current) return
      setSuggestions(result.suggestions)
      setSuggestNote(result.note ?? null)
    } catch (error) {
      if (token !== suggestToken.current) return
      setSuggestError(error instanceof Error ? error.message : String(error))
    } finally {
      if (token === suggestToken.current) setSuggesting(false)
    }
  }

  function cancelSuggest() {
    suggestToken.current += 1
    setSuggesting(false)
  }

  return (
    <div className="start-grid">
      <section className="start-main">
        <h2 className="display">Beschreib dein Deck.</h2>
        <p className="lede">Schreib deine Vision. Die KI sucht den passenden Commander und baut daraus das Deck. Die Engine prüft Manabase, Rollen und Bracket.</p>

        <div className="vision-block start-vision">
          <label htmlFor="start-brief" className="field-label">Deck-Vision</label>
          <textarea
            id="start-brief"
            className="vision-input"
            value={brief}
            onChange={(event) => onBrief(event.target.value)}
            rows={5}
            maxLength={2000}
            placeholder="Golgari-Reanimator: früh Kreaturen millen, ab Runde 4 große Sachen zurückholen und über ETB-Wert gewinnen. Keine Combos, keine Tutor-Ketten, gerne viele kleine Synergien."
            aria-describedby="start-brief-hint"
          />
          <div className="vision-meta">
            <span id="start-brief-hint">Mechaniken, Tempo, Wincons, No-Gos. Die KI sucht Commander, die dazu passen; du kannst danach noch eingreifen.</span>
            <span>{brief.length}/2000</span>
          </div>
        </div>

        <div className="start-controls">
          <div>
            <span className="field-label">Bracket</span>
            <BracketDial brackets={meta.brackets} value={bracket} onChange={onBracket} compact />
          </div>
          <div>
            <span className="field-label">Pod-Größe</span>
            <PodPicker value={pod} onChange={onPod} />
          </div>
        </div>

        <div className="quick-rules">
          <Toggle
            label="0 Rule"
            hint="Legalität und Banlist sind egal. Die Farbidentität des Commanders bleibt Pflicht."
            checked={Boolean(settings.zeroRule)}
            onChange={(next) => onSettings({ zeroRule: next })}
          />
        </div>

        <div className="suggest-block">
          <div className="suggest-head">
            <div className="suggest-intro">
              <h3>Commander aus deiner Vision.</h3>
              <p>Die KI schlägt bis zu drei Commander vor, die zu Mechanik, Tempo, Bracket und Hausregeln passen. Du entscheidest.</p>
            </div>
            <button
              type="button"
              className="button primary suggest-action"
              onClick={() => void suggestCommanders()}
              disabled={!visionReady || suggesting}
            >
              <Icon name="spark" size={16} /> {suggesting ? "KI prüft ..." : "Commander vorschlagen"}
            </button>
          </div>
          {!visionReady && <p className="field-note">Ein paar Sätze Vision reichen, dann sucht die KI passende Commander.</p>}
          {suggesting && (
            <div className="suggest-progress" role="status">
              <span className="build-line" />
              <div className="suggest-progress-copy">
                <p>Die KI prüft deine Vision und sucht passende Commander. Das kann einen Moment dauern.</p>
                <button type="button" className="text-link" onClick={cancelSuggest}>
                  Abbrechen
                </button>
              </div>
            </div>
          )}
          {suggestError && (
            <p className="field-note is-error" role="alert">
              {suggestError}
            </p>
          )}
          {suggestNote && <p className="field-note suggest-note">{suggestNote}</p>}
          {suggestions.length > 0 && (
            <div className="suggest-results">
              <div className="suggest-results-head">
                <h4>Vorschläge</h4>
                <span className="panel-count">{suggestions.length} Commander</span>
              </div>
              <div className="suggest-list">
                {suggestions.map((suggestion) => {
                  const img = suggestion.image_uris?.art_crop ?? suggestion.image_uris?.normal
                  return (
                    <article className="suggest-card" key={suggestion.oracle_id}>
                      <div className="suggest-art" style={img ? { backgroundImage: `url(${artSrc(img)})` } : undefined} aria-hidden="true" />
                      <div className="suggest-copy">
                        <div className="suggest-meta">
                          <span>{suggestion.color_identity.join("") || "farblos"}</span>
                          <span>{suggestion.edhrec_rank ? `EDHREC #${suggestion.edhrec_rank}` : "EDHREC —"}</span>
                        </div>
                        <h4>{suggestion.name}</h4>
                        <div className="suggest-mana">
                          <ManaCost cost={suggestion.mana_cost} />
                        </div>
                        <p>{suggestion.reason}</p>
                        <div className="suggest-actions">
                          <button type="button" className="button primary" onClick={() => onBuildSuggestion(suggestion.name)}>
                            Diesen Vorschlag bauen
                          </button>
                          <button type="button" className="text-link" onClick={() => onPick(suggestion.name)}>
                            Nur Commander übernehmen
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="start-search">
          <div className="start-divider">
            <span>Oder Commander selbst suchen</span>
          </div>
          <SearchBox onPick={onPick} placeholder="Commander suchen, zum Beispiel Uugguu" />
          <p className="field-note start-flow-note">Nach der Auswahl öffnet sich die Werkstatt. Dort prüfst du Vision und Einstellungen und startest den Build.</p>
          <button type="button" className="button ghost start-import" onClick={onImport}>
            <Icon name="upload" size={16} /> Deckliste importieren
          </button>
        </div>

        {decks.length > 0 && (
          <div className="recent">
            <h3>Zuletzt gebaut</h3>
            <div className="recent-list">
              {decks.slice(0, 4).map((d) => (
                <button key={d.id} type="button" className="recent-item" onClick={() => onOpen(d.id)}>
                  <span className="recent-name">{d.name}</span>
                  <span className="recent-meta">
                    B{d.bracket}, {d.card_count} Karten
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <aside className="start-aside">
        <div className="aside-block">
          <h3>Brief statt Prompt</h3>
          <p>Deck-Vision, Bracket, Pod-Größe und Hausregeln. Die KI sucht den Commander, der zu deinem Auftrag passt.</p>
        </div>
        <div className="aside-block">
          <h3>Engine statt Bauchgefühl</h3>
          <p>100 Karten, Singleton, Farbquellen, Kurve, Rollen. Die harten Checks laufen nach jedem Build.</p>
        </div>
        <div className="aside-block">
          <h3>Erst Entwurf, dann Deck</h3>
          <p>Vision schreiben, Commander vorschlagen lassen, bauen, prüfen. Erst beim Speichern entscheidest du über Name und Spielerprofil.</p>
        </div>
        <div className="aside-note">
          <span>{meta.counts.cards.toLocaleString("de-DE")} Karten</span>
          <span>{meta.counts.rules.toLocaleString("de-DE")} Regeln</span>
          <span>CR {meta.crVersion ?? "importiert"}</span>
        </div>
      </aside>
    </div>
  )
}

function DeckSavePanel({
  deck,
  profiles,
  currentUser,
  name,
  owner,
  saving,
  onName,
  onOwner,
  onSave,
}: {
  deck: Deck
  profiles: AuthUser[]
  currentUser: AuthUser
  name: string
  owner: string
  saving: boolean
  onName: (next: string) => void
  onOwner: (next: string) => void
  onSave: () => void
}) {
  if (deck.saved_at) {
    return (
      <section className="panel save-panel">
        <div className="panel-head">
          <h2>Deck</h2>
          <span className="badge">Gespeichert</span>
        </div>
        <p className="field-note">
          Gespeichert für <strong>{deck.owner_name ?? currentUser.display_name}</strong>
          {deck.saved_at ? ` am ${new Date(deck.saved_at).toLocaleDateString("de-DE")}` : ""}.
        </p>
      </section>
    )
  }

  const choices = currentUser.role === "admin" ? profiles : profiles.filter((profile) => profile.id === currentUser.id)
  const options = choices.length > 0 ? choices : [currentUser]
  return (
    <section className="panel save-panel">
      <div className="panel-head">
        <h2>Deck speichern</h2>
        <span className="badge is-warn">Nicht gespeichert</span>
      </div>
      <form
        className="save-form"
        onSubmit={(event) => {
          event.preventDefault()
          onSave()
        }}
      >
        <label className="save-field" htmlFor="save-deck-name">
          <span className="field-label">Name</span>
          <input
            id="save-deck-name"
            className="save-input"
            value={name}
            maxLength={120}
            onChange={(event) => onName(event.target.value)}
            placeholder={deck.commander_name}
          />
        </label>
        <div className="save-field">
          <span className="field-label">Spielerprofil</span>
          {currentUser.role === "admin" ? (
            <select id="save-deck-owner" className="save-input" aria-label="Spielerprofil" value={owner} onChange={(event) => onOwner(event.target.value)}>
              {options.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.display_name}
                </option>
              ))}
            </select>
          ) : (
            <p className="save-static">{currentUser.display_name}</p>
          )}
        </div>
        <p className="field-note">Bis zum Speichern bleibt das Deck ein Entwurf und erscheint nicht unter „Decks“.</p>
        <button type="submit" className="button primary wide" disabled={saving || !name.trim()}>
          <Icon name="check" size={16} /> {saving ? "Speichert" : "Deck speichern"}
        </button>
      </form>
    </section>
  )
}

function BuilderScreen({
  deck,
  meta,
  profiles,
  currentUser,
  editable,
  busy,
  buildRun,
  bracket,
  pod,
  settings,
  brief,
  saveName,
  saveOwner,
  savingDeck,
  onSaveName,
  onSaveOwner,
  onSave,
  onBracket,
  onPod,
  onSettings,
  onBrief,
  onBuild,
  onCancel,
  onCard,
  onArt,
  onAdd,
  onRemove,
  onMove,
  onSwap,
  onExport,
  onSettingsPage,
  onNew,
  onDoctorApplied,
  onNotice,
}: {
  deck: Deck
  meta: Meta
  profiles: AuthUser[]
  currentUser: AuthUser
  editable: boolean
  busy: boolean
  buildRun: BuildRun | null
  bracket: 3 | 4 | 5
  pod: number
  settings: Record<string, any>
  brief: string
  saveName: string
  saveOwner: string
  savingDeck: boolean
  onSaveName: (next: string) => void
  onSaveOwner: (next: string) => void
  onSave: () => void
  onBracket: (next: 3 | 4 | 5) => void
  onPod: (next: number) => void
  onSettings: (partial: Record<string, any>) => void
  onBrief: (next: string) => void
  onBuild: () => void
  onCancel: () => void
  onCard: (card: DeckCard) => void
  onArt: (card: DeckCard) => void
  onAdd: (name: string) => Promise<boolean> | void
  onRemove: (card: DeckCard) => Promise<boolean> | void
  onMove: (card: DeckCard, board: "main" | "maybeboard") => Promise<boolean> | void
  onSwap: (addName: string, removeOracleId: string) => Promise<boolean>
  onExport: () => void
  onSettingsPage: () => void
  onNew: () => void
  onDoctorApplied: (deck: Deck) => void
  onNotice: (text: string) => void
}) {
  const building = Boolean(busy && buildRun && (buildRun.status === "queued" || buildRun.status === "running" || buildRun.status === "done"))
  return (
    <div className="builder-grid">
      <aside className="brief">
        <CommanderCard deck={deck} onNew={onNew} onOpen={() => onCard(commanderAsDeckCard(deck))} />
        <DeckSavePanel
          deck={deck}
          profiles={profiles}
          currentUser={currentUser}
          name={saveName}
          owner={saveOwner}
          saving={savingDeck}
          onName={onSaveName}
          onOwner={onSaveOwner}
          onSave={onSave}
        />
        <section className={editable ? "panel vision-panel" : "panel vision-panel is-readonly"}>
          <div className="panel-head">
            <h2>Deck-Vision</h2>
            <span className="panel-count">{brief.length}/2000</span>
          </div>
          <textarea
            id="builder-brief"
            className="vision-input"
            value={brief}
            onChange={(event) => onBrief(event.target.value)}
            readOnly={!editable || busy}
            rows={6}
            maxLength={2000}
            placeholder="Was soll das Deck können? Mechaniken, Tempo, Wincons, No-Gos, Wunschkarten."
            aria-describedby="builder-brief-hint"
          />
          <p className="field-note" id="builder-brief-hint">
            {!editable
              ? "Die Vision gehört dem Besitzer des Decks."
              : busy
                ? "Während des Bauens gesperrt. Danach kannst du sie ändern und neu bauen."
                : "Wird automatisch gespeichert und beim nächsten Bauen mitgeschickt."}
          </p>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Auftrag</h2>
            <span className="panel-count">B{bracket}</span>
          </div>
          <span className="field-label">Bracket</span>
          <BracketDial brackets={meta.brackets} value={bracket} onChange={onBracket} compact />
          <p className="field-note">{meta.brackets.find((b) => b.id === bracket)?.description}</p>
          <span className="field-label">Pod</span>
          <PodPicker value={pod} onChange={onPod} />
          <div className="quick-rules">
            <Toggle
              label="0 Rule"
              hint="Legalität aus. Die Farbidentität des Commanders bleibt Pflicht."
              checked={Boolean(settings.zeroRule)}
              onChange={(next) => onSettings({ zeroRule: next })}
            />
          </div>
          <button type="button" className="text-link" onClick={onSettingsPage}>
            Alle Hausregeln
            <Icon name="arrow" size={15} />
          </button>
        </section>

        <section className="panel build-panel">
          {!busy && deck.cards.length === 0 && (
            <div className="build-idle" aria-hidden="true">
              <span className="build-idle-mark">
                <Icon name="spark" size={16} />
              </span>
              <span className="build-idle-copy">
                <strong>Werkstatt bereit.</strong>
                <span>Commander und Vision prüfen, dann Deck bauen.</span>
              </span>
            </div>
          )}
          <button type="button" className="button primary wide" onClick={onBuild} disabled={busy || !editable}>
            <Icon name="spark" size={17} />
            {busy ? "DeepSeek baut" : "Deck bauen"}
          </button>
          {busy && (
            <>
              <div className="build-progress" role="status">
                <span className="build-line" />
                <p>{buildRun?.message ?? "Der Agent arbeitet."}</p>
              </div>
              <button type="button" className="button ghost wide" onClick={onCancel}>
                Build abbrechen
              </button>
            </>
          )}
          {!busy && buildRun?.status === "done" && (
            <p className="field-note">
              {buildRun.provider === "engine"
                ? `Engine-Fallback: Die KI war nicht verfügbar, das Deck ist deterministisch gebaut.${brief.trim() ? " Die Deck-Vision konnte dabei nicht berücksichtigt werden." : ""}`
                : `Gebaut von ${friendlyModel(buildRun.model)}. Prüfe den Bracket-Audit rechts.`}
              {buildRun.provider === "opencode" && buildRun.candidate_count
                ? ` Kontext: ${buildRun.candidate_count} Kandidaten${buildRun.prompt_tokens_estimate ? ` · ~${buildRun.prompt_tokens_estimate.toLocaleString("de-DE")} Tokens` : ""}.`
                : ""}
              {buildRun.provider === "opencode" && buildRun.prompt_tokens != null
                ? ` Gemessen: ${buildRun.prompt_tokens.toLocaleString("de-DE")} Prompt- und ${(buildRun.output_tokens ?? 0).toLocaleString("de-DE")} Output-Tokens${buildRun.cost_usd ? ` · ${buildRun.cost_usd.toLocaleString("de-DE", { style: "currency", currency: "USD", maximumFractionDigits: 4 })}` : ""}.`
                : ""}
              {buildRun.error ? ` Hinweis: ${buildRun.error.slice(0, 160)}` : ""}
            </p>
          )}
          {!busy && buildRun?.status === "error" && <p className="field-note is-error">{buildRun.error}</p>}
          {!busy && buildRun?.status === "cancelled" && <p className="field-note">Build abgebrochen.</p>}
          <button type="button" className="button ghost wide" onClick={onExport}>
            <Icon name="download" size={16} /> Deckliste exportieren
          </button>
        </section>
      </aside>

      <DeckPanel
        deck={deck}
        editable={editable}
        building={building}
        buildRun={buildRun}
        onCard={onCard}
        onArt={onArt}
        onAdd={onAdd}
        onRemove={onRemove}
        onMove={onMove}
        onSwap={onSwap}
        onExport={onExport}
        onDoctorApplied={onDoctorApplied}
        onNotice={onNotice}
      />
      {!building && <AnalysisRail deck={deck} />}
    </div>
  )
}

function CommanderCard({ deck, onNew, onOpen }: { deck: Deck; onNew: () => void; onOpen: () => void }) {
  const art = deck.commander.art_url ?? deck.commander.image_uris?.art_crop ?? deck.commander.image_uris?.normal
  const legal = deck.commander.legalities?.commander
  return (
    <section className="commander-card">
      <div
        className="commander-art"
        style={art ? { backgroundImage: `url(${art})` } : undefined}
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            onOpen()
          }
        }}
        aria-label={`${deck.commander.name} öffnen: Kartentext und Art`}
      >
        <div className="commander-scrim" />
        <div className="commander-copy">
          <h2>{deck.commander.name}</h2>
          <div className="commander-meta">
            <ManaCost cost={deck.commander.mana_cost} />
            <span>{deck.commander.type_line}</span>
          </div>
          {legal !== "legal" && <span className="badge is-warn">nicht offiziell legal</span>}
          <span className="commander-open-hint">Karte &amp; Art öffnen</span>
        </div>
      </div>
      <button type="button" className="text-link" onClick={onNew}>
        Anderen Commander wählen
        <Icon name="arrow" size={15} />
      </button>
    </section>
  )
}

function DeckTile({
  card,
  editable,
  commander = false,
  onCard,
  onArt,
  onRemove,
  onMove,
  moveTitle = "Aufs Maybeboard",
}: {
  card: DeckCard
  editable: boolean
  commander?: boolean
  onCard: () => void
  onArt: () => void
  onRemove?: () => void
  onMove?: () => void
  moveTitle?: string
}) {
  const faceImage = card.card_faces?.find((face) => face.image_uris?.normal)?.image_uris
  const img =
    artSrc(card.art_url) ||
    artSrc(card.image_uris?.normal) ||
    artSrc(card.image_uris?.border_crop) ||
    artSrc(faceImage?.normal) ||
    artSrc(faceImage?.border_crop) ||
    artSrc(card.image_uris?.small)
  return (
    <article className={cx("deck-card-tile", commander && "is-commander")}>
      <button type="button" className="deck-card-tile-open" onClick={onCard} title={card.name} aria-label={`${card.name} öffnen`}>
        <span className="deck-card-tile-art">
          {img ? (
            <img src={img} alt="" loading="lazy" decoding="async" />
          ) : (
            <span className="deck-card-tile-fallback" aria-hidden="true">
              {deckInitials(card.name)}
            </span>
          )}
          {card.quantity > 1 && <span className="deck-card-tile-qty">×{card.quantity}</span>}
        </span>
        <span className="deck-card-tile-copy">
          <span className="deck-card-tile-name">{card.name}</span>
          <span className="deck-card-tile-meta">
            {card.mana_cost && <ManaCost cost={card.mana_cost} />}
            {commander && <span className="badge">CMD</span>}
            {card.is_game_changer && <span className="badge">GC</span>}
            {card.is_one_win && <span className="badge is-warn">1-Win</span>}
          </span>
        </span>
      </button>
      {editable && (
        <div className="deck-card-tile-tools">
          <button type="button" className="icon-button" onClick={onArt} aria-label={`Art von ${card.name} ändern`}>
            <Icon name="image" size={15} />
          </button>
          {onMove && (
            <button type="button" className="icon-button" onClick={onMove} aria-label={`${card.name}: ${moveTitle}`} title={moveTitle}>
              <Icon name="bookmark" size={15} />
            </button>
          )}
          {onRemove && (
            <button type="button" className="icon-button" onClick={onRemove} aria-label={`${card.name} entfernen`}>
              <Icon name="trash" size={15} />
            </button>
          )}
        </div>
      )}
    </article>
  )
}

function Maybeboard({
  deck,
  editable,
  onCard,
  onArt,
  onRemove,
  onMove,
}: {
  deck: Deck
  editable: boolean
  onCard: (card: DeckCard) => void
  onArt: (card: DeckCard) => void
  onRemove: (card: DeckCard) => void
  onMove: (card: DeckCard, board: "main" | "maybeboard") => void
}) {
  const cards = deck.maybeboard ?? []
  return (
    <section className="maybeboard">
      <div className="role-head">
        <h3>Maybeboard</h3>
        <span>{cards.length}</span>
      </div>
      <p className="field-note">Karten zum Ausprobieren. Sie zählen nicht zu den 100 und nicht in die Analyse.</p>
      {cards.length === 0 ? (
        <p className="maybeboard-empty">Noch leer. Über das Lesezeichen an einer Deckkarte landet sie hier.</p>
      ) : (
        <div className="deck-card-grid">
          {cards.map((card) => (
            <DeckTile
              card={card}
              editable={editable}
              onCard={() => onCard(card)}
              onArt={() => onArt(card)}
              onMove={() => onMove(card, "main")}
              moveTitle="Ins Deck"
              onRemove={editable ? () => onRemove(card) : undefined}
              key={card.oracle_id}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function DeckPanel({
  deck,
  editable,
  building,
  buildRun,
  onCard,
  onArt,
  onAdd,
  onRemove,
  onMove,
  onSwap,
  onExport,
  onDoctorApplied,
  onNotice,
}: {
  deck: Deck
  editable: boolean
  building: boolean
  buildRun: BuildRun | null
  onCard: (card: DeckCard) => void
  onArt: (card: DeckCard) => void
  onAdd: (name: string) => Promise<boolean> | void
  onRemove: (card: DeckCard) => Promise<boolean> | void
  onMove: (card: DeckCard, board: "main" | "maybeboard") => Promise<boolean> | void
  onSwap: (addName: string, removeOracleId: string) => Promise<boolean>
  onExport: () => void
  onDoctorApplied: (deck: Deck) => void
  onNotice: (text: string) => void
}) {
  const [tab, setTab] = useState<"deck" | "primer" | "combos" | "doctor" | "labor" | "history">("deck")
  const [adding, setAdding] = useState(false)
  const [view, setView] = useState<DeckView>(initialDeckView)
  const [diffBanner, setDiffBanner] = useState(true)
  const [query, setQuery] = useState("")
  const [roleFilter, setRoleFilter] = useState("all")
  const [colorFilter, setColorFilter] = useState("all")
  const [mvFilter, setMvFilter] = useState("all")
  const [gcOnly, setGcOnly] = useState(false)
  const [sort, setSort] = useState<"role" | "mv" | "name" | "edhrec">("role")
  const changeView = (next: DeckView) => {
    setView(next)
    try {
      window.localStorage.setItem(DECK_VIEW_STORAGE_KEY, next)
    } catch {
      // localStorage kann in privaten Fenstern fehlen; die Ansicht gilt dann nur für die Sitzung.
    }
  }
  useEffect(() => {
    setQuery("")
    setRoleFilter("all")
    setColorFilter("all")
    setMvFilter("all")
    setGcOnly(false)
    setSort("role")
  }, [deck.id])
  useEffect(() => {
    setDiffBanner(true)
  }, [buildRun?.id])
  useEffect(() => {
    const handler = (event: Event) => {
      const role = (event as CustomEvent<string>).detail
      if (!role) return
      setRoleFilter(role)
      setQuery("")
      setColorFilter("all")
      setMvFilter("all")
      setGcOnly(false)
      setTab("deck")
    }
    window.addEventListener("kz:filter-role", handler)
    return () => window.removeEventListener("kz:filter-role", handler)
  }, [])
  const filterActive = Boolean(query.trim() || roleFilter !== "all" || colorFilter !== "all" || mvFilter !== "all" || gcOnly)
  const filteredCards = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const cards = deck.cards.filter((card) => {
      if (roleFilter !== "all" && card.role !== roleFilter) return false
      if (gcOnly && !card.is_game_changer) return false
      if (needle && !`${card.name} ${card.type_line} ${card.oracle_text ?? ""}`.toLowerCase().includes(needle)) return false
      const colors = card.colors.length ? card.colors : card.color_identity
      if (colorFilter === "multicolor" && colors.length < 2) return false
      if (colorFilter === "colorless" && colors.length > 0) return false
      if (["W", "U", "B", "R", "G"].includes(colorFilter) && !colors.includes(colorFilter)) return false
      if (mvFilter === "0-1" && (card.cmc < 0 || card.cmc > 1)) return false
      if (["2", "3", "4", "5"].includes(mvFilter) && card.cmc !== Number(mvFilter)) return false
      if (mvFilter === "6+" && card.cmc < 6) return false
      return true
    })
    const sorter = (a: DeckCard, b: DeckCard) => {
      if (sort === "mv") return a.cmc - b.cmc || a.name.localeCompare(b.name, "de")
      if (sort === "name") return a.name.localeCompare(b.name, "de")
      if (sort === "edhrec") return (a.edhrec_rank ?? 999999) - (b.edhrec_rank ?? 999999) || a.name.localeCompare(b.name, "de")
      return 0
    }
    return cards.slice().sort(sorter)
  }, [deck.cards, query, roleFilter, colorFilter, mvFilter, gcOnly, sort])
  const groups = useMemo(() => {
    return ROLE_ORDER.map((role) => ({ role, cards: filteredCards.filter((c) => c.role === role) })).filter((g) => g.cards.length)
  }, [filteredCards])
  const visibleQuantity = filteredCards.reduce((sum, card) => sum + card.quantity, 0)
  const totalQuantity = deck.cards.reduce((sum, card) => sum + card.quantity, 0)
  const total = deck.analysis?.total ?? totalQuantity + 1
  const commanderCard = commanderAsDeckCard(deck)

  return (
    <section className={cx("deck-panel", building && "is-forging")}>
      <div className="deck-head">
        <div>
          <h2 className="deck-title">{deck.name}</h2>
          <p className="deck-sub">
            {building ? (
              "Die Werkstatt arbeitet am nächsten Entwurf."
            ) : (
              <>
                {total} Karten inklusive Commander, B{deck.bracket}, {deck.pod_size} Spieler
                {deck.owner_name ? ` · ${deck.owner_name}` : ""}
                {!editable ? " · Lesemodus" : ""}
              </>
            )}
          </p>
        </div>
        <div className="deck-actions">
          {building ? (
            <span className="status-chip is-busy">Werkstatt läuft</span>
          ) : (
            <>
              {editable && (
                <button type="button" className="button ghost" onClick={() => setAdding((v) => !v)}>
                  <Icon name="plus" size={16} /> Karte
                </button>
              )}
              <button type="button" className="button ghost" onClick={onExport}>
                <Icon name="download" size={16} /> Export
              </button>
              {tab === "deck" && (
                <div className="view-switch" role="group" aria-label="Deckansicht">
                  <button
                    type="button"
                    className={cx("view-switch-button", view === "grid" && "is-active")}
                    aria-pressed={view === "grid"}
                    aria-label="Grid-Ansicht"
                    onClick={() => changeView("grid")}
                    title="Visuelle Kartenansicht"
                  >
                    <Icon name="grid" size={15} /> <span>Grid</span>
                  </button>
                  <button
                    type="button"
                    className={cx("view-switch-button", view === "list" && "is-active")}
                    aria-pressed={view === "list"}
                    aria-label="Listenansicht"
                    onClick={() => changeView("list")}
                    title="Kompakte Listenansicht"
                  >
                    <Icon name="list" size={15} /> <span>Liste</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {building ? (
        <BuildForge deck={deck} run={buildRun} />
      ) : (
        <>
          {adding && (
            <div className="add-card">
              <SearchBox
                onPick={(name) => {
                  onAdd(name)
                  setAdding(false)
                }}
                placeholder="Karte hinzufügen oder Effekt beschreiben"
                autoFocus
                context={{ colorIdentity: deck.commander.color_identity, commanderLegal: true }}
              />
            </div>
          )}

          <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "deck"} className={cx("tab", tab === "deck" && "is-active")} onClick={() => setTab("deck")}>
          Deck
        </button>
        <button type="button" role="tab" aria-selected={tab === "primer"} className={cx("tab", tab === "primer" && "is-active")} onClick={() => setTab("primer")}>
          Primer
        </button>
        <button type="button" role="tab" aria-selected={tab === "combos"} className={cx("tab", tab === "combos" && "is-active")} onClick={() => setTab("combos")}>
          Combos
        </button>
        <button type="button" role="tab" aria-selected={tab === "doctor"} className={cx("tab", tab === "doctor" && "is-active")} onClick={() => setTab("doctor")}>
          Doctor
        </button>
        <button type="button" role="tab" aria-selected={tab === "labor"} className={cx("tab", tab === "labor" && "is-active")} onClick={() => setTab("labor")}>
          Labor
        </button>
        <button type="button" role="tab" aria-selected={tab === "history"} className={cx("tab", tab === "history" && "is-active")} onClick={() => setTab("history")}>
          Verlauf
        </button>
      </div>

      {!building && buildRun?.status === "done" && diffBanner && tab !== "history" && (
        <div className="build-diff-banner">
          <Icon name="spark" size={15} />
          <span>Neu gebaut. Der Verlauf zeigt Karten- und Rollen-Änderungen.</span>
          <button type="button" className="text-link" onClick={() => setTab("history")}>Diff ansehen</button>
          <button type="button" className="icon-button" onClick={() => setDiffBanner(false)} aria-label="Hinweis schließen">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {!building && tab === "deck" && (
        <div className="deck-filterbar">
          <div className="deck-filter-main">
            <label className="deck-filter-search">
              <Icon name="search" size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Im Deck suchen"
                aria-label="Im Deck suchen"
              />
              {query && (
                <button type="button" className="icon-button" onClick={() => setQuery("")} aria-label="Suche löschen">
                  <Icon name="close" size={13} />
                </button>
              )}
            </label>
            <div className="deck-filter-count" aria-live="polite">
              {filterActive ? `${visibleQuantity} von ${totalQuantity}` : `${totalQuantity} Karten`}
            </div>
          </div>

          <div className="deck-filter-roles" role="group" aria-label="Nach Rolle filtern">
            <button type="button" className={cx("filter-chip", roleFilter === "all" && "is-active")} aria-pressed={roleFilter === "all"} onClick={() => setRoleFilter("all")}>
              Alle
            </button>
            {ROLE_ORDER.map((role) => {
              const count = deck.cards.filter((card) => card.role === role).reduce((sum, card) => sum + card.quantity, 0)
              if (!count) return null
              return (
                <button
                  type="button"
                  className={cx("filter-chip", roleFilter === role && "is-active")}
                  aria-pressed={roleFilter === role}
                  key={role}
                  onClick={() => setRoleFilter((current) => (current === role ? "all" : role))}
                >
                  {ROLE_LABEL[role] ?? role}
                  <span>{count}</span>
                </button>
              )
            })}
          </div>

          <div className="deck-filter-options">
            <select value={colorFilter} onChange={(event) => setColorFilter(event.target.value)} aria-label="Nach Farbe filtern">
              <option value="all">Alle Farben</option>
              <option value="W">Weiß</option>
              <option value="U">Blau</option>
              <option value="B">Schwarz</option>
              <option value="R">Rot</option>
              <option value="G">Grün</option>
              <option value="multicolor">Mehrfarbig</option>
              <option value="colorless">Farblos</option>
            </select>
            <select value={mvFilter} onChange={(event) => setMvFilter(event.target.value)} aria-label="Nach Mana-Wert filtern">
              <option value="all">Alle Mana-Werte</option>
              <option value="0-1">MV 0 bis 1</option>
              <option value="2">MV 2</option>
              <option value="3">MV 3</option>
              <option value="4">MV 4</option>
              <option value="5">MV 5</option>
              <option value="6+">MV 6+</option>
            </select>
            <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="Karten sortieren">
              <option value="role">Sortierung: Rollen</option>
              <option value="mv">Sortierung: Mana-Wert</option>
              <option value="name">Sortierung: Name</option>
              <option value="edhrec">Sortierung: EDHREC</option>
            </select>
            <button
              type="button"
              className={cx("filter-chip", gcOnly && "is-active")}
              onClick={() => setGcOnly((value) => !value)}
              aria-pressed={gcOnly}
            >
              GC
            </button>
            {filterActive && (
              <button
                type="button"
                className="text-link deck-filter-reset"
                onClick={() => {
                  setQuery("")
                  setRoleFilter("all")
                  setColorFilter("all")
                  setMvFilter("all")
                  setGcOnly(false)
                }}
              >
                Filter löschen
              </button>
            )}
          </div>
        </div>
      )}

      {tab === "deck" ? (
        <>
        {view === "grid" ? (
          <div className="deck-card-grid-view">
            <div className="role-group">
              <div className="role-head">
                <h3>Command Zone</h3>
                <span>1</span>
              </div>
              <div className="deck-card-grid">
                <DeckTile
                  card={commanderCard}
                  commander
                  editable={editable}
                  onCard={() => onCard(commanderCard)}
                  onArt={() => onArt(commanderCard)}
                />
              </div>
            </div>

            {filterActive && groups.length === 0 && (
              <p className="deck-filter-empty">Keine Karte passt zu diesem Filter.</p>
            )}

            {groups.map((group) => (
              <div className="role-group" key={group.role}>
                <div className="role-head">
                  <h3>{ROLE_LABEL[group.role] ?? group.role}</h3>
                  <span>{group.cards.reduce((n, c) => n + c.quantity, 0)}</span>
                </div>
                <div className="deck-card-grid">
                  {group.cards.map((card) => (
                    <DeckTile
                      card={card}
                      editable={editable}
                      onCard={() => onCard(card)}
                      onArt={() => onArt(card)}
                      onMove={editable ? () => void onMove(card, "maybeboard") : undefined}
                      onRemove={editable ? () => void onRemove(card) : undefined}
                      key={card.oracle_id}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="deck-list">
            <div className="role-group">
            <div className="role-head">
              <h3>Command Zone</h3>
              <span>1</span>
            </div>
            <div className="card-row is-commander">
              <button type="button" className="card-open" onClick={() => onCard(commanderAsDeckCard(deck))}>
                <span className="card-line">
                  <ManaCost cost={deck.commander.mana_cost} />
                  <span className="card-name">{deck.commander.name}</span>
                  {deck.commander.is_game_changer && <span className="badge">GC</span>}
                </span>
                <span className="card-type">{deck.commander.type_line}</span>
              </button>
            </div>
          </div>

          {filterActive && groups.length === 0 && (
            <p className="deck-filter-empty">Keine Karte passt zu diesem Filter.</p>
          )}

          {groups.map((group) => (
            <div className={cx("role-group", group.role === "land" && "is-lands")} key={group.role}>
              <div className="role-head">
                <h3>{ROLE_LABEL[group.role] ?? group.role}</h3>
                <span>{group.cards.reduce((n, c) => n + c.quantity, 0)}</span>
              </div>
              {group.cards.map((card) => (
                <div className="card-row" key={card.oracle_id}>
                  <button type="button" className="card-open" onClick={() => onCard(card)}>
                    <span className="card-line">
                      {card.mana_cost && <ManaCost cost={card.mana_cost} />}
                      <span className="card-name">{card.name}</span>
                      {card.quantity > 1 && <span className="qty">×{card.quantity}</span>}
                      {card.is_game_changer && <span className="badge">GC</span>}
                      {card.is_one_win && <span className="badge is-warn">1-Win</span>}
                    </span>
                    {card.role !== "land" && <span className="card-type">{card.type_line}</span>}
                  </button>
                  {editable && (
                    <div className="card-tools">
                      <button type="button" className="icon-button" onClick={() => onArt(card)} aria-label={`Art von ${card.name} ändern`}>
                        <Icon name="image" size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => void onMove(card, "maybeboard")}
                        aria-label={`${card.name} aufs Maybeboard`}
                        title="Aufs Maybeboard"
                      >
                        <Icon name="bookmark" size={16} />
                      </button>
                      <button type="button" className="icon-button" onClick={() => void onRemove(card)} aria-label={`${card.name} entfernen`}>
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
          </div>
        )}
        <Maybeboard
          deck={deck}
          editable={editable}
          onCard={onCard}
          onArt={onArt}
          onRemove={(card) => void onRemove(card)}
          onMove={(card, board) => void onMove(card, board)}
        />
        </>
      ) : tab === "primer" ? (
        <div className="primer">
          <div className="primer-bar">
            <span>Deckguide</span>
            <button
              type="button"
              className="text-link"
              onClick={() => {
                void navigator.clipboard?.writeText(deck.primer ?? "")
              }}
            >
              Kopieren
            </button>
          </div>
          {deck.primer ? <Markdown text={deck.primer} /> : <p className="muted">Noch kein Primer. Baue das Deck, dann schreibt der Agent einen.</p>}
        </div>
      ) : tab === "combos" ? (
        <DeckCombos deck={deck} onNotice={onNotice} onAdd={onAdd} onSwap={onSwap} />
      ) : tab === "doctor" ? (
        <DeckDoctor deck={deck} canEdit={editable} onDeck={onDoctorApplied} onNotice={onNotice} />
      ) : tab === "labor" ? (
        <DeckLab deck={deck} onCard={onCard} />
      ) : (
        <DeckHistory deck={deck} canEdit={editable} onDeck={onDoctorApplied} onNotice={onNotice} />
      )}
        </>
      )}
    </section>
  )
}

function AnalysisRail({ deck }: { deck: Deck }) {
  const a = deck.analysis
  if (!a) return <aside className="analysis"><p className="muted">Noch keine Analyse.</p></aside>
  const requested = deck.bracket
  const audit = a.bracket.bracket
  return (
    <aside className="analysis">
      <section className="analysis-block">
        <div className="analysis-head">
          <h2>Bracket</h2>
          <span className="panel-count">B{requested}</span>
        </div>
        <div className="gauge" aria-hidden="true">
          {[3, 4, 5].map((n) => (
            <span key={n} className={cx("gauge-seg", n <= audit && "is-on", n === requested && "is-choice")}>
              {n}
            </span>
          ))}
        </div>
        <p className="analysis-line">
          Auditor: <strong>B{audit} {a.bracket.label}</strong> ({a.bracket.confidence})
        </p>
        {audit !== requested && <p className="analysis-line is-warn">Deine Wahl ist B{requested}. Der Audit sieht B{audit}.</p>}
        <ul className="reason-list">
          {a.bracket.reasons.slice(0, 4).map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </section>

      <section className="analysis-block">
        <h2>Rollen</h2>
        <div className="stat-grid">
          <Stat label="Länder" value={a.lands} onClick={() => window.dispatchEvent(new CustomEvent("kz:filter-role", { detail: "land" }))} />
          <Stat label="Ramp" value={a.counts.ramp ?? 0} onClick={() => window.dispatchEvent(new CustomEvent("kz:filter-role", { detail: "ramp" }))} />
          <Stat label="Draw" value={a.counts.draw ?? 0} onClick={() => window.dispatchEvent(new CustomEvent("kz:filter-role", { detail: "draw" }))} />
          <Stat label="Removal" value={a.counts.removal ?? 0} onClick={() => window.dispatchEvent(new CustomEvent("kz:filter-role", { detail: "removal" }))} />
          <Stat label="Wipes" value={a.counts.wipe ?? 0} onClick={() => window.dispatchEvent(new CustomEvent("kz:filter-role", { detail: "wipe" }))} />
          <Stat label="Tutoren" value={a.counts.tutor ?? 0} onClick={() => window.dispatchEvent(new CustomEvent("kz:filter-role", { detail: "tutor" }))} />
          <Stat label="Wincons" value={a.counts.wincon ?? 0} onClick={() => window.dispatchEvent(new CustomEvent("kz:filter-role", { detail: "wincon" }))} />
          <Stat label="Ø MV" value={a.averageMv.toFixed(1)} />
        </div>
      </section>

      <section className="analysis-block">
        <h2>Kurve</h2>
        <div className="curve">
          {a.curve.map((bin) => {
            const max = Math.max(...a.curve.map((b) => b.count), 1)
            return (
              <div className="curve-col" key={bin.label}>
                <span className="curve-value">{bin.count}</span>
                <span className="curve-bar" style={{ height: `${Math.max(6, (bin.count / max) * 72)}px` }} />
                <span className="curve-label">{bin.label}</span>
              </div>
            )
          })}
        </div>
      </section>

      <section className="analysis-block">
        <h2>Farben</h2>
        <div className="color-table">
          {(["W", "U", "B", "R", "G"] as const).map((color) => (
            <div className="color-row" key={color}>
              <span className={cx("mana", `mana-${color.toLowerCase()}`)}>{color}</span>
              <span className="color-sources">{a.sources[color] ?? 0} Quellen</span>
              <span className="color-pips">{a.pips[color] ?? 0} Pips</span>
            </div>
          ))}
        </div>
      </section>

      <section className="analysis-block">
        <h2>Goldfish</h2>
        <div className="stat-grid">
          <Stat label="Commander-Zug" value={a.goldfish.averageCommanderTurn ?? "?"} />
          <Stat label="Länder T4" value={a.goldfish.averageLandsByTurn4} />
          <Stat label="Land verpasst" value={`${Math.round(a.goldfish.missedLandDropRate * 100)}%`} />
          <Stat label="Farb-Screw" value={`${Math.round(a.goldfish.colorScrewRate * 100)}%`} />
        </div>
        <p className="field-note">Vereinfachte Simulation, keine vollständige Spiel-Engine. Sie zeigt Manaprobleme, nicht Politk.</p>
      </section>

      {a.warnings.length > 0 && (
        <section className="analysis-block">
          <h2>Hinweise</h2>
          <ul className="warning-list">
            {a.warnings.map((w, i) => (
              <li key={i} className={cx("warning", w.level === "error" && "is-error")}>
                {w.text}
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}

function Stat({ label, value, onClick }: { label: string; value: string | number; onClick?: () => void }) {
  if (onClick) {
    return (
      <button type="button" className="stat stat-clickable" onClick={onClick} title={`${label} im Deck filtern`}>
        <span className="stat-value">{value}</span>
        <span className="stat-label">{label}</span>
      </button>
    )
  }
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}

function CardModal({
  card,
  deckId,
  onClose,
  onArt,
  onRemove,
  onMove,
}: {
  card: DeckCard
  deckId: string
  onClose: () => void
  onArt: () => void
  onRemove?: () => void
  onMove?: () => void
}) {
  const [detail, setDetail] = useState<{ tags: string[]; rulings: any[] } | null>(null)
  const [german, setGerman] = useState<GermanCardText | null>(null)
  const [germanLoading, setGermanLoading] = useState(true)
  const [germanError, setGermanError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    api
      .card(card.oracle_id)
      .then((d) => {
        if (alive) setDetail({ tags: d.tags, rulings: d.rulings })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [card.oracle_id])

  useEffect(() => {
    let alive = true
    setGerman(null)
    setGermanLoading(true)
    setGermanError(null)
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
  }, [card.oracle_id])

  const img = artSrc(card.art_url) || card.image_uris?.normal || card.image_uris?.border_crop
  return (
    <Modal title={card.name} onClose={onClose} wide>
      <div className="card-detail">
        <div className="card-detail-art">{img && <img src={img} alt={card.name} />}</div>
        <div className="card-detail-copy">
          <div className="card-detail-meta">
            <ManaCost cost={card.mana_cost} />
            <span>{card.type_line}</span>
            <span className="chip">{ROLE_LABEL[card.role] ?? card.role}</span>
          </div>
          {german?.name && german.name !== card.name && <p className="card-german-name">Deutsch: {german.name}</p>}
          <div className="oracle-block">
            {german?.card_faces?.length ? (
              german.card_faces.map((face) => (
                <div className="oracle-face" key={`${face.name}-${face.oracle_text ?? ""}`}>
                  <h4>{face.name}</h4>
                  <p className="oracle">{face.oracle_text ?? "Kein Oracle-Text."}</p>
                </div>
              ))
            ) : (
              <p className="oracle">{german?.oracle_text ?? card.oracle_text ?? "Kein Oracle-Text."}</p>
            )}
            {germanLoading && <p className="field-note">Deutscher Kartentext wird geladen …</p>}
            {!germanLoading && !german && (
              <p className="field-note">
                {germanError ? "Deutscher Kartentext konnte nicht geladen werden; angezeigt wird der englische Text." : "Keine deutsche Fassung gefunden; angezeigt wird der englische Text."}
              </p>
            )}
            {german?.set_name && <p className="field-note">Deutsche Fassung: {german.set_name}{german.collector_number ? ` #${german.collector_number}` : ""}</p>}
          </div>
          <p className="reason">{card.reason}</p>
          {detail?.tags?.length ? (
            <div className="tag-row">
              {detail.tags.slice(0, 14).map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
          {detail?.rulings?.length ? (
            <details className="rulings">
              <summary>Rulings ({detail.rulings.length})</summary>
              <ul>
                {detail.rulings.slice(0, 6).map((r, i) => (
                  <li key={i}>{r.comment}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="modal-actions">
            <button type="button" className="button primary" onClick={onArt}>
              <Icon name="image" size={16} /> Art ändern
            </button>
            {onMove && (
              <button type="button" className="button ghost" onClick={onMove}>
                <Icon name="bookmark" size={16} /> {card.board === "maybeboard" ? "Ins Deck" : "Aufs Maybeboard"}
              </button>
            )}
            {onRemove && (
              <button type="button" className="button ghost" onClick={onRemove}>
                <Icon name="trash" size={16} /> Entfernen
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function ArtModal({
  card,
  onClose,
  onChoose,
  onClear,
}: {
  card: DeckCard
  onClose: () => void
  onChoose: (option: ArtOption | { artUrl: string; artist?: string; printingId?: string }) => void
  onClear: () => void
}) {
  const [tab, setTab] = useState<"scryfall" | "mpcfill" | "url">("scryfall")
  const [printings, setPrintings] = useState<ArtOption[]>([])
  const [mpc, setMpc] = useState<ArtOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState("")

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    Promise.allSettled([api.printings(card.oracle_id), api.mpcfill(card.oracle_id)]).then(([p, m]) => {
      if (!alive) return
      if (p.status === "fulfilled") setPrintings(p.value.printings)
      if (m.status === "fulfilled") {
        setMpc(m.value.arts)
        if (m.value.error) setError(m.value.error)
      }
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [card.oracle_id])

  const options = tab === "scryfall" ? printings : tab === "mpcfill" ? mpc : []

  return (
    <Modal title={`Art für ${card.name}`} onClose={onClose} wide>
      <div className="art-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "scryfall"} className={cx("tab", tab === "scryfall" && "is-active")} onClick={() => setTab("scryfall")}>
          Scryfall
        </button>
        <button type="button" role="tab" aria-selected={tab === "mpcfill"} className={cx("tab", tab === "mpcfill" && "is-active")} onClick={() => setTab("mpcfill")}>
          MPCFill Community
        </button>
        <button type="button" role="tab" aria-selected={tab === "url"} className={cx("tab", tab === "url" && "is-active")} onClick={() => setTab("url")}>
          Eigene URL
        </button>
      </div>

      {tab === "url" ? (
        <div className="url-form">
          <label className="field-label" htmlFor="art-url">
            Bild-URL
          </label>
          <input id="art-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
          <p className="field-note">Für private Proxies. Keine offiziellen Karten als Handelsware verwenden.</p>
          <button type="button" className="button primary" disabled={!url.startsWith("http")} onClick={() => onChoose({ artUrl: url })}>
            Übernehmen
          </button>
        </div>
      ) : (
        <>
          <div className="art-grid">
            {options.map((option) => (
              <button key={option.id} type="button" className="art-option" onClick={() => onChoose(option)} title={option.name}>
                <img src={artSrc(option.thumbnailUrl || option.imageUrl)} alt="" loading="lazy" />
                <span className="art-meta">
                  <span>{option.setCode ?? "MPCFill"}</span>
                  <span>{option.artist ?? option.note ?? ""}</span>
                  {option.lang && <span>{option.lang}</span>}
                </span>
              </button>
            ))}
          </div>
          {loading && <p className="muted">Arts werden geladen. MPCFill kann einen Moment brauchen.</p>}
          {!loading && options.length === 0 && <p className="muted">Keine Alternativen gefunden.</p>}
          {error && <p className="field-note is-error">{error}</p>}
        </>
      )}

      <div className="modal-actions">
        <button type="button" className="button ghost" onClick={onClear}>
          Art zurücksetzen
        </button>
      </div>
    </Modal>
  )
}

function DecksPage({
  decks,
  user,
  onOpen,
  onNew,
  onImport,
  onCopy,
  onDelete,
}: {
  decks: DeckSummary[]
  user: AuthUser
  onOpen: (id: string) => void
  onNew: () => void
  onImport: () => void
  onCopy: (id: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2 className="display-sm">Eure Decks.</h2>
        </div>
        <div className="page-actions">
          <button type="button" className="button ghost" onClick={onImport}>
            <Icon name="upload" size={16} /> Importieren
          </button>
          <button type="button" className="button primary" onClick={onNew}>
            <Icon name="plus" size={16} /> Neues Deck
          </button>
        </div>
      </div>
      {decks.length === 0 ? (
        <div className="empty">
          <h3>Noch kein Deck.</h3>
          <p>Wähle einen Commander, baue den Entwurf und speichere ihn mit Name und Spielerprofil.</p>
          <button type="button" className="button primary" onClick={onNew}>
            Commander wählen
          </button>
        </div>
      ) : (
        <div className="deck-grid">
          {decks.map((d) => (
            <article className="deck-tile" key={d.id}>
              <button type="button" className="deck-tile-open" onClick={() => onOpen(d.id)}>
                <span className="deck-tile-top">
                  <span className="chip">B{d.bracket}</span>
                  <span className="deck-tile-count">{d.card_count} Karten</span>
                </span>
                <strong>{d.name}</strong>
                <span className="deck-tile-commander">{d.commander_name}</span>
                <span className="deck-tile-date">
                  {d.owner_name ? `${d.owner_name} · ` : ""}
                  {new Date(d.updated_at).toLocaleDateString("de-DE")}
                </span>
              </button>
              <div className="deck-tile-actions">
                <button type="button" className="icon-button" onClick={() => onCopy(d.id)} aria-label={`${d.name} kopieren`}>
                  <Icon name="copy" size={16} />
                </button>
                {(user.role === "admin" || d.owner_user_id === user.id) && (
                  <button type="button" className="icon-button" onClick={() => onDelete(d.id)} aria-label={`${d.name} löschen`}>
                    <Icon name="trash" size={16} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function GamesPage({
  games,
  decks,
  onCreate,
  onDelete,
}: {
  games: GameRecord[]
  decks: DeckSummary[]
  onCreate: (body: GameInput) => Promise<boolean>
  onDelete: (id: string) => Promise<void>
}) {
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const [playedAt, setPlayedAt] = useState(today)
  const [podSize, setPodSize] = useState(5)
  const [winnerDeckId, setWinnerDeckId] = useState(decks[0]?.id ?? "")
  const [winnerTouched, setWinnerTouched] = useState(false)
  const [turns, setTurns] = useState("")
  const [fun, setFun] = useState("3")
  const [salt, setSalt] = useState("2")
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!winnerTouched && !winnerDeckId && decks[0]) setWinnerDeckId(decks[0].id)
  }, [decks, winnerTouched, winnerDeckId])

  async function submit() {
    setBusy(true)
    try {
      const ok = await onCreate({
        playedAt,
        podSize,
        winnerDeckId: winnerDeckId || null,
        turns: turns === "" ? null : Number(turns),
        notes: notes.trim(),
        fun: Number(fun),
        salt: Number(salt),
      })
      if (ok) {
        setTurns("")
        setNotes("")
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2 className="display-sm">Was ist am Tisch passiert?</h2>
        </div>
        <span className="status-chip">{games.length === 1 ? "1 Spiel" : `${games.length} Spiele`}</span>
      </div>

      <div className="log-grid">
        <section className="panel">
          <h2>Neues Spiel</h2>
          <form
            className="game-form"
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <div className="form-row">
              <label>
                <span className="field-label">Datum</span>
                <input type="date" value={playedAt} onChange={(e) => setPlayedAt(e.target.value)} />
              </label>
              <label>
                <span className="field-label">Pod-Größe</span>
                <select value={podSize} onChange={(e) => setPodSize(Number(e.target.value))}>
                  {[3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} Spieler
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label>
              <span className="field-label">Siegerdeck</span>
              <select
                value={winnerDeckId}
                onChange={(e) => {
                  setWinnerTouched(true)
                  setWinnerDeckId(e.target.value)
                }}
              >
                <option value="">Nicht erfasst</option>
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="form-row three">
              <label>
                <span className="field-label">Züge</span>
                <input type="number" min={0} max={99} value={turns} onChange={(e) => setTurns(e.target.value)} placeholder="z. B. 7" />
              </label>
              <label>
                <span className="field-label">Fun</span>
                <select value={fun} onChange={(e) => setFun(e.target.value)}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}/5
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="field-label">Salz</span>
                <select value={salt} onChange={(e) => setSalt(e.target.value)}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}/5
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label>
              <span className="field-label">Notizen</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Was war der Turning Point? Welche Karte war zu stark?" rows={4} />
            </label>

            <button type="submit" className="button primary" disabled={busy}>
              <Icon name="check" size={16} /> {busy ? "Speichert" : "Spiel speichern"}
            </button>
            <p className="field-note">Beendete Live-Tische liefern Teilnehmer, Decks, Leben und Sieger automatisch. Das Formular ist für nachgetragene Runden; der Sieger wird als Teilnehmer für die Statistik erfasst.</p>
          </form>
        </section>

        <section className="game-list">
          <div className="game-list-head">
            <h2>Protokoll</h2>
            <span>{games.length === 0 ? "Noch keine Einträge" : games.length === 1 ? "1 Eintrag" : `${games.length} Einträge`}</span>
          </div>
          {games.length === 0 ? (
            <div className="empty">
              <h3>Noch kein Spiel.</h3>
              <p>Tragt Sieger, Züge, Fun und Salz ein. Nach ein paar Runden sieht man, welche Decks und Karten den Pod wirklich tragen.</p>
            </div>
          ) : (
            games.map((game) => (
              <article className="game-entry" key={game.id}>
                <span className="game-date">{new Date(game.played_at).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" })}</span>
                <div className="game-main">
                  <strong>{game.winner_name ?? "Sieger nicht erfasst"}</strong>
                  <div className="game-meta">
                    <span>{game.pod_size} Spieler</span>
                    {game.turns != null && <span>{game.turns} Züge</span>}
                    {game.fun != null && <span>Fun {game.fun}/5</span>}
                    {game.salt != null && <span>Salz {game.salt}/5</span>}
                    {game.winner_commander && <span>{game.winner_commander}</span>}
                  </div>
                  {game.notes && <p className="game-notes">{game.notes}</p>}
                </div>
                <button type="button" className="icon-button game-delete" onClick={() => onDelete(game.id)} aria-label="Spiel löschen">
                  <Icon name="trash" size={16} />
                </button>
              </article>
            ))
          )}
        </section>
      </div>
    </section>
  )
}

function RulesPage({ meta }: { meta: Meta }) {
  const [q, setQ] = useState("")
  const [results, setResults] = useState<{ format: any[]; cr: any[] }>({ format: [], cr: [] })
  const [selected, setSelected] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    api
      .rules(q)
      .then(setResults)
      .catch(() => setResults({ format: [], cr: [] }))
      .finally(() => setLoading(false))
  }, [q])

  async function openRule(number: string) {
    try {
      setSelected(await api.rule(number))
    } catch {
      setSelected(null)
    }
  }

  return (
    <section className="page rules-page">
      <div className="page-head">
        <div>
          <h2 className="display-sm">Nachschlagen, nicht raten.</h2>
        </div>
        <span className="status-chip">CR {meta.crVersion ?? "importiert"}</span>
      </div>
      <div className="rules-search">
        <div className="search-field">
          <Icon name="search" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Regelnummer oder Begriff, zum Beispiel 903.4 oder color identity" aria-label="Regeln durchsuchen" />
        </div>
      </div>

      <div className="rules-grid">
        <div className="rules-list">
          <h3>Commander und Hausregeln</h3>
          {results.format.map((r) => (
            <article className="rule-card" key={r.id}>
              <span className="rule-category">{r.category}</span>
              <h4>{r.title}</h4>
              <p>{r.body}</p>
              <span className="rule-citation">{r.citation}</span>
            </article>
          ))}
          {results.cr.length > 0 && (
            <>
              <h3>Comprehensive Rules</h3>
              {results.cr.map((r) => (
                <button key={r.number} type="button" className="rule-row" onClick={() => openRule(r.number)}>
                  <span className="rule-number">{r.number}</span>
                  <span>{r.text.slice(0, 220)}</span>
                </button>
              ))}
            </>
          )}
          {loading && <p className="muted">Suche läuft.</p>}
        </div>

        <aside className="rule-detail">
          {selected ? (
            <>
              <div className="rule-detail-head">
                <span className="rule-number">{selected.rule.number}</span>
                <button type="button" className="icon-button" onClick={() => setSelected(null)} aria-label="Schließen">
                  <Icon name="close" size={16} />
                </button>
              </div>
              {selected.parent && <p className="rule-parent">{selected.parent.number} {selected.parent.text}</p>}
              <p className="rule-text">{selected.rule.text}</p>
              {selected.children?.length > 0 && (
                <div className="rule-children">
                  <span className="field-label">Unterregeln</span>
                  {selected.children.map((c: any) => (
                    <p key={c.number}>
                      <strong>{c.number}</strong> {c.text}
                    </p>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="rule-detail-empty">
              <h3>Regel nachschlagen</h3>
              <p>Suche nach einer Nummer oder einem Begriff. Die App zitiert die CR und die Commander-Regeln getrennt, damit klar bleibt, was offiziell ist.</p>
              <p className="field-note">Regeln ändern sich mit jedem Set. Der Import ist versioniert.</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}

function SettingsPage({
  meta,
  deck,
  settings,
  onChange,
  onSave,
}: {
  meta: Meta
  deck: Deck | null
  settings: Record<string, any>
  onChange: (partial: Record<string, any>) => void
  onSave: () => void
}) {
  return (
    <section className="page settings-page">
      <div className="page-head">
        <div>
          <h2 className="display-sm">Eure Regeln, eure Werkstatt.</h2>
        </div>
        <button type="button" className="button primary" onClick={onSave}>
          <Icon name="check" size={16} /> Speichern
        </button>
      </div>

      <div className="settings-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Hausregeln</h2>
            <span className="panel-count">{deck ? deck.name : "Für das nächste Deck"}</span>
          </div>
          <div className="settings-list">
            {meta.settingLabels.map((item) =>
              item.kind === "bool" ? (
                <Toggle
                  key={item.key}
                  label={item.label}
                  hint={item.hint}
                  checked={Boolean(settings[item.key])}
                  onChange={(next) => onChange({ [item.key]: next })}
                />
              ) : (
                <NumberField
                  key={item.key}
                  label={item.label}
                  hint={item.hint}
                  value={settings[item.key] == null ? null : Number(settings[item.key])}
                  onChange={(next) => onChange({ [item.key]: next })}
                />
              ),
            )}
          </div>
        </section>

        <aside className="settings-aside">
          <section className="panel">
            <h2>Daten</h2>
            <dl className="data-list">
              <div>
                <dt>Modell</dt>
                <dd>{meta.model}</dd>
              </div>
              <div>
                <dt>Karten</dt>
                <dd>{meta.counts.cards.toLocaleString("de-DE")}</dd>
              </div>
              <div>
                <dt>Regeln</dt>
                <dd>{meta.counts.rules.toLocaleString("de-DE")}</dd>
              </div>
              <div>
                <dt>Rulings</dt>
                <dd>{meta.counts.rulings.toLocaleString("de-DE")}</dd>
              </div>
              <div>
                <dt>Spiele</dt>
                <dd>{meta.counts.games.toLocaleString("de-DE")}</dd>
              </div>
              <div>
                <dt>CR-Stand</dt>
                <dd>{meta.crVersion ?? "unbekannt"}</dd>
              </div>
            </dl>
            <p className="field-note">Neu importieren: <code>bun run ingest</code>. Der Import überschreibt Karten, Regeln und Rulings, nicht eure Decks.</p>
          </section>

          <section className="panel">
            <h2>0 Rule</h2>
            <p className="muted">Wenn 0 Rule an ist, sind Legalität, Banlist und Un-Cards nur Hinweise. 1-Win-Karten sind dauerhaft ausgeschlossen, und die Farbidentität des Commanders bleibt immer Pflicht.</p>
            <div className="rule-callout">
              <strong>B5 heißt hier „unser Maximum“.</strong>
              <span>Nicht cEDH. Die Engine behandelt B5 als das obere Ende eures Pods, nicht als Turn-1-Metagame.</span>
            </div>
          </section>
        </aside>
      </div>
    </section>
  )
}
