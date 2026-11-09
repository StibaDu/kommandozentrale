import { useEffect, useState } from "react"
import { api, type AuthUser, type BabyzillaInfo, type Invite, type Meta, type Profile } from "./api"
import { copyText } from "./clipboard"
import { Icon } from "./ui"

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

function formatDate(value: string | null | undefined) {
  if (!value) return "noch nie"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "unbekannt"
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" })
}

export function ProfilePage({
  user,
  meta,
  onUser,
  onNotice,
  onLogout,
}: {
  user: AuthUser
  meta: Meta
  onUser: (user: AuthUser) => void
  onNotice: (text: string) => void
  onLogout: () => void
}) {
  const [displayName, setDisplayName] = useState(user.display_name)
  const [avatarColor, setAvatarColor] = useState(user.avatar_color)
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const [users, setUsers] = useState<Profile[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [inviteLabel, setInviteLabel] = useState("")
  const [inviteUses, setInviteUses] = useState("1")
  const [inviteDays, setInviteDays] = useState("30")
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [qrInvite, setQrInvite] = useState<string | null>(null)
  const [babyzilla, setBabyzilla] = useState<BabyzillaInfo | null>(null)

  useEffect(() => {
    setDisplayName(user.display_name)
    setAvatarColor(user.avatar_color)
  }, [user.display_name, user.avatar_color])

  useEffect(() => {
    let alive = true
    api
      .babyzilla()
      .then((value) => {
        if (alive) setBabyzilla(value)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    api
      .users()
      .then((next) => {
        if (alive) setUsers(next)
      })
      .catch(() => {})
    if (user.role === "admin") {
      api
        .invites()
        .then((next) => {
          if (alive) setInvites(next)
        })
        .catch(() => {})
    }
    return () => {
      alive = false
    }
  }, [user.role])

  async function saveProfile() {
    setProfileBusy(true)
    setProfileError(null)
    try {
      const result = await api.updateProfile({ displayName, avatarColor })
      onUser(result.user)
      onNotice("Profil gespeichert.")
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : String(err))
    } finally {
      setProfileBusy(false)
    }
  }

  async function reloadInvites() {
    try {
      setInvites(await api.invites())
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : String(err))
    }
  }

  async function createInvite() {
    setInviteBusy(true)
    setInviteError(null)
    try {
      await api.createInvite({
        label: inviteLabel.trim() || "Einladung",
        maxUses: Number(inviteUses) || 1,
        expiresInDays: Number(inviteDays) || 30,
      })
      setInviteLabel("")
      await reloadInvites()
      onNotice("Einladung angelegt.")
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : String(err))
    } finally {
      setInviteBusy(false)
    }
  }

  async function removeInvite(invite: Invite) {
    if (!window.confirm(`Einladung für ${invite.label ?? "diese Person"} löschen?`)) return
    try {
      await api.deleteInvite(invite.id)
      await reloadInvites()
      onNotice("Einladung gelöscht.")
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : String(err))
    }
  }

  async function copy(text: string, label: string) {
    if (await copyText(text)) onNotice(`${label} kopiert.`)
    else onNotice(text)
  }

  function inviteLink(code: string) {
    const base = meta.network.lanUrl ?? window.location.origin
    return `${base}/m#invite=${encodeURIComponent(code)}`
  }

  return (
    <section className="page profile-page">
      <div className="page-head">
        <div>
          <h2 className="display-sm">Dein Platz in der Runde.</h2>
          <p className="lede">Profil, Einladungen und der Zugang fürs Handy.</p>
        </div>
        <button type="button" className="button ghost" onClick={onLogout}>
          <Icon name="logout" size={16} /> Abmelden
        </button>
      </div>

      <div className="profile-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Profil</h2>
            <span className="panel-count">{user.role === "admin" ? "Admin" : "Mitglied"}</span>
          </div>
          <div className="profile-identity">
            <span className="avatar is-large" style={{ background: avatarColor }}>
              {initials(displayName || user.display_name)}
            </span>
            <div>
              <strong>{user.display_name}</strong>
              <span>@{user.username}</span>
            </div>
          </div>

          <div className="profile-form">
            <label>
              <span className="field-label">Anzeigename</span>
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} />
            </label>
            <label>
              <span className="field-label">Avatar-Farbe</span>
              <span className="color-picker">
                {["#a4552f", "#1f3d33", "#2d5547", "#7d3d22", "#c39a3e", "#8f2f2f"].map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={avatarColor === color ? "color-dot is-active" : "color-dot"}
                    style={{ background: color }}
                    onClick={() => setAvatarColor(color)}
                    aria-label={`Farbe ${color}`}
                  />
                ))}
              </span>
            </label>
            {profileError && <p className="field-note is-error">{profileError}</p>}
            <button type="button" className="button primary" onClick={() => void saveProfile()} disabled={profileBusy}>
              <Icon name="check" size={16} /> {profileBusy ? "Speichert…" : "Profil speichern"}
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Handy</h2>
          </div>
          {meta.network.lanUrl ? (
            <>
              <p className="muted">
                {meta.network.publicUrl
                  ? "Der mobile Begleiter läuft über diese feste öffentliche Adresse:"
                  : "Der mobile Begleiter läuft unter dieser Adresse. Im WLAN ist die stabile .local-Adresse der beste Einstieg:"}
              </p>
              <div className="lan-url">
                <code>{`${meta.network.lanUrl}/m`}</code>
                <button type="button" className="icon-button" onClick={() => void copy(`${meta.network.lanUrl}/m`, "Adresse")} aria-label="Adresse kopieren">
                  <Icon name="copy" size={16} />
                </button>
              </div>
              <img
                className="profile-mobile-qr"
                src={`/api/mobile/qr.svg?url=${encodeURIComponent(`${meta.network.lanUrl}/m`)}`}
                alt="QR-Code für die mobile Kommandozentrale"
              />
              {meta.network.ipUrl && meta.network.ipUrl !== meta.network.lanUrl && (
                <p className="field-note">
                  Fallback im aktuellen WLAN: <code>{`${meta.network.ipUrl}/m`}</code>
                </p>
              )}
              <a className="button ghost" href="/m">
                Mobilen Tisch öffnen
              </a>
              <p className="field-note">
                Der Server ist standardmäßig im LAN erreichbar. Die macOS-Firewall muss eingehende Verbindungen für Bun erlauben.
                {meta.network.tailscaleAvailable
                  ? " Für unterwegs Tailscale starten; die App zeigt die Adresse dann im Handy-Dialog."
                  : " Für unterwegs kann eine feste PUBLIC_URL oder Tailscale genutzt werden."}
              </p>
            </>
          ) : (
            <p className="muted">Keine LAN-Adresse gefunden. Prüfe die Netzwerkverbindung des Macs.</p>
          )}
          <p className="field-note">Das Handy ist der Companion: Profile, Decks, Statistiken und der Live-Life-Counter. Einstellungen und Deckbau bleiben am Rechner.</p>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Babyzilla</h2>
            <span className="panel-count">Tokenbremse</span>
          </div>
          {babyzilla?.stats ? (
            <>
              <div className="token-grid">
                <div>
                  <strong>{babyzilla.stats.savedPct.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %</strong>
                  <span>Kontext gespart</span>
                </div>
                <div>
                  <strong>{babyzilla.stats.requests.savedPct.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %</strong>
                  <span>Anfragen gespart</span>
                </div>
                <div>
                  <strong>{babyzilla.stats.sessions.toLocaleString("de-DE")}</strong>
                  <span>Sessions</span>
                </div>
              </div>
              <p className="muted">
                Babyzilla komprimiert die OpenCode-Kontexte, in denen die KI baut und erklärt (global über alle Sessions). Roh{" "}
                {babyzilla.stats.rawTokens.toLocaleString("de-DE")} → Pack {babyzilla.stats.packTokens.toLocaleString("de-DE")} Tokens.
              </p>
              <p className="field-note">
                {babyzilla.app.calls > 0
                  ? `App-KI: ${babyzilla.app.calls.toLocaleString("de-DE")} Läufe · ${babyzilla.app.promptTokens.toLocaleString("de-DE")} Prompt-Tokens · ${babyzilla.app.costUsd.toLocaleString("de-DE", { style: "currency", currency: "USD", maximumFractionDigits: 4 })}`
                  : "Noch keine App-KI-Läufe erfasst. Beim nächsten Build oder Doctor-Lauf erscheint der Verbrauch hier."}
              </p>
            </>
          ) : (
            <p className="muted">Babyzilla ist nicht erreichbar. Die App läuft trotzdem; die KI-Aufrufe gehen weiter über OpenCode.</p>
          )}
          <p className="field-note">Kontextbudget der KI-Builds: 240 statt 360 Kandidaten. Das kürzt den Prompt, ohne die Rollenabdeckung zu verlieren.</p>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Die Runde</h2>
            <span className="panel-count">{users.length}</span>
          </div>
          <div className="profile-list">
            {users.map((member) => (
              <div className={member.id === user.id ? "profile-row is-me" : "profile-row"} key={member.id}>
                <span className="avatar" style={{ background: member.avatar_color }}>
                  {initials(member.display_name)}
                </span>
                <div>
                  <strong>{member.display_name}{member.id === user.id ? " · du" : ""}</strong>
                  <span>@{member.username}{member.role === "admin" ? " · Admin" : ""}</span>
                </div>
                <span className="profile-last">{member.last_login_at ? formatDate(member.last_login_at) : "neu"}</span>
              </div>
            ))}
          </div>
        </section>

        {user.role === "admin" && (
          <section className="panel profile-invites">
            <div className="panel-head">
              <h2>Einladungen</h2>
              <span className="panel-count">{invites.filter((invite) => invite.valid).length} offen</span>
            </div>
            <p className="muted">Jeder Code funktioniert einmal. Die vier Codes für Dennis, Ingo, Bamdad und Nima wurden bei der Einrichtung angelegt.</p>
            <div className="invite-list">
              {invites.length === 0 && <p className="muted">Noch keine Einladungen.</p>}
              {invites.map((invite) => (
                <div className="invite-entry" key={invite.id}>
                  <div className={invite.valid ? "invite-row" : "invite-row is-used"}>
                    <div>
                      <strong>{invite.label ?? "Einladung"}</strong>
                      <span>
                        <code>{invite.code}</code> · {invite.uses}/{invite.max_uses} benutzt
                        {invite.expires_at ? ` · bis ${formatDate(invite.expires_at)}` : ""}
                      </span>
                    </div>
                    <div className="invite-actions">
                      <button type="button" className="icon-button" onClick={() => void copy(invite.code, "Code")} aria-label="Code kopieren">
                        <Icon name="copy" size={15} />
                      </button>
                      <button type="button" className="icon-button" disabled={!invite.valid} onClick={() => void copy(inviteLink(invite.code), "Einladungslink")} aria-label="Einladungslink kopieren">
                        <Icon name="copy" size={15} />
                      </button>
                      <button type="button" className="icon-button" disabled={!invite.valid} onClick={() => setQrInvite(qrInvite === invite.code ? null : invite.code)} aria-label="QR-Code anzeigen">
                        <Icon name="qr" size={15} />
                      </button>
                      <button type="button" className="icon-button" onClick={() => void removeInvite(invite)} aria-label="Einladung löschen">
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </div>
                  {invite.valid && qrInvite === invite.code && (
                    <div className="invite-qr">
                      <img src={`/api/auth/invite/${encodeURIComponent(invite.code)}/qr.svg`} alt={`QR-Code für Einladung ${invite.code}`} />
                      <code>{inviteLink(invite.code)}</code>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="invite-create">
              <label>
                <span className="field-label">Für wen?</span>
                <input value={inviteLabel} onChange={(event) => setInviteLabel(event.target.value)} placeholder="Name" />
              </label>
              <label>
                <span className="field-label">Nutzungen</span>
                <input type="number" min={1} max={100} value={inviteUses} onChange={(event) => setInviteUses(event.target.value)} />
              </label>
              <label>
                <span className="field-label">Tage gültig</span>
                <input type="number" min={0} max={365} value={inviteDays} onChange={(event) => setInviteDays(event.target.value)} />
              </label>
              <button type="button" className="button ghost" onClick={() => void createInvite()} disabled={inviteBusy}>
                <Icon name="plus" size={15} /> {inviteBusy ? "Legt an…" : "Einladung"}
              </button>
            </div>
            {inviteError && <p className="field-note is-error">{inviteError}</p>}
          </section>
        )}
      </div>
    </section>
  )
}
