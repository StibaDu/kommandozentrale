import type { AuthUser, BuildRun, Deck, DeckSummary, GameRecord, Meta } from "./api"
import { Icon, cx } from "./ui"

type HomeView = "decks" | "games" | "rules" | "profile"

type HomeScreenProps = {
  meta: Meta
  decks: DeckSummary[]
  games: GameRecord[]
  deck: Deck | null
  editable: boolean
  user: AuthUser
  busy: boolean
  buildRun: BuildRun | null
  modelLabel: string
  onNew: () => void
  onContinue: () => void
  onOpen: (id: string) => void
  onView: (view: HomeView) => void
}

export function HomeScreen({
  meta,
  decks,
  games,
  deck,
  editable,
  user,
  busy,
  buildRun,
  modelLabel,
  onNew,
  onContinue,
  onOpen,
  onView,
}: HomeScreenProps) {
  const buildActive = Boolean(busy && buildRun && (buildRun.status === "queued" || buildRun.status === "running"))
  const latest = decks[0] ?? null
  const focusedId = deck?.id ?? latest?.id ?? null
  const recent = decks.filter((item) => item.id !== focusedId).slice(0, 5)
  const cardTotal = deck ? (deck.analysis?.total ?? deck.cards.reduce((sum, card) => sum + card.quantity, 0) + 1) : 0
  const art = deck?.commander.image_uris?.art_crop ?? deck?.commander.image_uris?.normal ?? null

  return (
    <div className="home">
      <section className="home-hero">
        <div className="home-hero-copy">
          <span className="home-kicker">Deckwerkstatt</span>
          <p className="home-greeting">Willkommen zurück, {user.display_name}.</p>
          <h2 className="display home-title">Deine Werkstatt.</h2>
          <p className="lede">
            Commander wählen, Vision schreiben, bauen lassen. Die Engine prüft Manabase, Rollen und Bracket; du behältst die
            Hand am Regler.
          </p>
          <div className="home-actions">
            <button type="button" className="button primary" onClick={onNew}>
              <Icon name="plus" size={16} /> Neues Deck
            </button>
            <button type="button" className="button ghost" onClick={() => onView("decks")}>
              <Icon name="cards" size={16} /> Decks ansehen
            </button>
          </div>
        </div>

        <aside className="home-focus" aria-label="Aktuelle Baustelle">
          {deck ? (
            <>
              <div className={cx("home-focus-art", !art && "is-empty")} style={art ? { backgroundImage: `url("${art}")` } : undefined}>
                <span className={cx("home-focus-status", buildActive && "is-live")}>
                  {buildActive ? (
                    <>
                      <span className="forge-live-dot" aria-hidden="true" /> Werkstatt läuft
                    </>
                  ) : !deck.saved_at ? (
                    "Entwurf"
                  ) : editable ? (
                    "Aktuelle Baustelle"
                  ) : (
                    "Geteiltes Deck"
                  )}
                </span>
              </div>
              <div className="home-focus-body">
                <h3>{deck.name}</h3>
                <p className="home-focus-commander">{deck.commander_name}</p>
                <div className="home-focus-meta">
                  <span>B{deck.bracket}</span>
                  <span>{cardTotal} Karten</span>
                  <span>{deck.pod_size} Spieler</span>
                </div>
                <button type="button" className="button primary wide" onClick={onContinue}>
                  <Icon name={editable ? "hammer" : "cards"} size={16} /> {editable ? "Weiterbauen" : "Deck ansehen"}
                </button>
              </div>
            </>
          ) : latest ? (
            <div className="home-focus-empty home-focus-latest">
              <span className="home-focus-mark">
                <Icon name="cards" size={30} />
              </span>
              <h3>{latest.name}</h3>
              <p>{latest.commander_name}</p>
              <div className="home-focus-meta">
                <span>B{latest.bracket}</span>
                <span>{latest.card_count} Karten</span>
                <span>{latest.pod_size} Spieler</span>
              </div>
              <button type="button" className="button primary" onClick={() => onOpen(latest.id)}>
                Deck öffnen
              </button>
            </div>
          ) : (
            <div className="home-focus-empty">
              <span className="home-focus-mark">
                <Icon name="cards" size={30} />
              </span>
              <h3>Noch keine Baustelle.</h3>
              <p>Wähle einen Commander und lass die Werkstatt anlaufen.</p>
              <button type="button" className="button primary" onClick={onNew}>
                Commander wählen
              </button>
            </div>
          )}
        </aside>
      </section>

      <section className="home-stats" aria-label="Bestand">
        <div className="home-stat">
          <strong>{meta.counts.cards.toLocaleString("de-DE")}</strong>
          <span>Karten im Index</span>
        </div>
        <div className="home-stat">
          <strong>{meta.counts.rules.toLocaleString("de-DE")}</strong>
          <span>Regeln</span>
        </div>
        <div className="home-stat">
          <strong>{decks.length}</strong>
          <span>gespeicherte Decks</span>
        </div>
        <div className="home-stat">
          <strong>{games.length}</strong>
          <span>Spiele im Log</span>
        </div>
      </section>

      <div className="home-body">
        <section className="home-block" aria-labelledby="home-recent-title">
          <div className="home-block-head">
            <h2 id="home-recent-title">Zuletzt gebaut</h2>
            <button type="button" className="text-link" onClick={() => onView("decks")}>
              Alle Decks
            </button>
          </div>

          {recent.length > 0 ? (
            <div className="home-deck-list">
              {recent.map((item) => (
                <button key={item.id} type="button" className="home-deck" onClick={() => onOpen(item.id)}>
                  <span className="home-deck-mark" style={item.owner_color ? { background: item.owner_color } : undefined} />
                  <span className="home-deck-copy">
                    <strong>{item.name}</strong>
                    <span>
                      {item.commander_name}
                      {item.owner_name && item.owner_user_id !== user.id ? ` von ${item.owner_name}` : ""}
                    </span>
                  </span>
                  <span className="home-deck-meta">
                    <span>B{item.bracket}</span>
                    <span>{item.card_count} Karten</span>
                  </span>
                  <Icon name="arrow" size={16} />
                </button>
              ))}
            </div>
          ) : (
            <div className="home-empty-state">
              <p className="home-empty-copy">
                {decks.length > 0
                  ? deck
                    ? "Das aktuelle Deck steht oben. Weitere Decks erscheinen hier, sobald du sie speicherst."
                    : "Das letzte Deck steht oben. Weitere Decks erscheinen hier, sobald du sie speicherst."
                  : "Noch kein Deck gespeichert. Wähle oben einen Commander und starte die erste Baustelle."}
              </p>
              {decks.length > 0 && (
                <button type="button" className="button ghost" onClick={onNew}>
                  <Icon name="plus" size={16} /> Neues Deck
                </button>
              )}
            </div>
          )}
        </section>

        <aside className="home-block home-werkstatt" aria-labelledby="home-werkstatt-title">
          <div className="home-block-head">
            <h2 id="home-werkstatt-title">Werkstatt</h2>
          </div>
          <div className="home-links">
            <button type="button" className="home-link" onClick={() => onView("decks")}>
              <span className="home-link-icon">
                <Icon name="cards" size={18} />
              </span>
              <span className="home-link-copy">
                <strong>Decks</strong>
                <span>Entwürfe, fertige Listen und Besitzer.</span>
              </span>
              <Icon name="arrow" size={16} />
            </button>
            <button type="button" className="home-link" onClick={() => onView("games")}>
              <span className="home-link-icon">
                <Icon name="calendar" size={18} />
              </span>
              <span className="home-link-copy">
                <strong>Spiele</strong>
                <span>Ergebnisse, Tische und Runden.</span>
              </span>
              <Icon name="arrow" size={16} />
            </button>
            <button type="button" className="home-link" onClick={() => onView("rules")}>
              <span className="home-link-icon">
                <Icon name="book" size={18} />
              </span>
              <span className="home-link-copy">
                <strong>Regeln</strong>
                <span>Bracket-Check, Banlist und Regelwerk.</span>
              </span>
              <Icon name="arrow" size={16} />
            </button>
            <button type="button" className="home-link" onClick={() => onView("profile")}>
              <span className="home-link-icon">
                <Icon name="user" size={18} />
              </span>
              <span className="home-link-copy">
                <strong>Profil</strong>
                <span>Spieler, Einladungen und Sichtbarkeit.</span>
              </span>
              <Icon name="arrow" size={16} />
            </button>
          </div>
          <p className="home-foot">Gebaut mit {modelLabel}. Die Engine prüft danach 100 Karten, Manaquellen und Bracket.</p>
        </aside>
      </div>
    </div>
  )
}
