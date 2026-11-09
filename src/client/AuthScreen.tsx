import { useEffect, useState } from "react"
import { api, type AuthUser, type Invite } from "./api"
import { parseEntryContext } from "./entry"
import { Icon } from "./ui"

type Mode = "choose" | "register" | "setup"

export function AuthScreen({
  initialized,
  onAuthenticated,
}: {
  initialized: boolean
  onAuthenticated: (user: AuthUser, invites?: Invite[]) => void
}) {
  const [entry] = useState(() => parseEntryContext())
  const [mode, setMode] = useState<Mode>(() =>
    !initialized ? "setup" : entry.invite ? "register" : "choose",
  )
  const [profiles, setProfiles] = useState<AuthUser[]>([])
  const [profilesLoading, setProfilesLoading] = useState(initialized)
  const [profilesError, setProfilesError] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState(initialized ? "" : "Sebastian")
  const [inviteCode, setInviteCode] = useState(entry.invite ?? "")
  const [inviteLabel, setInviteLabel] = useState<string | null>(null)
  const [inviteState, setInviteState] = useState<"idle" | "checking" | "valid" | "invalid">("idle")
  const [busy, setBusy] = useState(false)
  const [busyProfileId, setBusyProfileId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!initialized) {
      setMode("setup")
      return
    }
    setMode((current) => {
      if (current === "setup") return entry.invite ? "register" : "choose"
      return current
    })
  }, [initialized, entry.invite])

  useEffect(() => {
    if (!initialized) {
      setProfiles([])
      return
    }
    let alive = true
    setProfilesLoading(true)
    api
      .profiles()
      .then((next) => {
        if (!alive) return
        setProfiles(next)
        setProfilesError(null)
      })
      .catch((err) => {
        if (alive) setProfilesError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (alive) setProfilesLoading(false)
      })
    return () => {
      alive = false
    }
  }, [initialized])

  useEffect(() => {
    if (!initialized || !entry.invite) return
    setInviteCode(entry.invite)
    setMode("register")
    void checkInvite(entry.invite)
    // checkInvite nutzt den aktuellen Anzeigenamen nur als leeren Startwert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized, entry.invite])

  async function checkInvite(value: string) {
    const code = value.trim().toUpperCase()
    if (!code) {
      setInviteState("idle")
      setInviteLabel(null)
      return
    }
    setInviteState("checking")
    try {
      const result = await api.inviteInfo(code)
      setInviteState(result.valid ? "valid" : "invalid")
      setInviteLabel(result.label)
      if (result.valid && result.label && !displayName.trim()) setDisplayName(result.label)
    } catch {
      setInviteState("invalid")
      setInviteLabel(null)
    }
  }

  async function selectProfile(profile: AuthUser) {
    setError(null)
    setBusy(true)
    setBusyProfileId(profile.id)
    try {
      const result = await api.selectProfile(profile.id)
      onAuthenticated(result.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setBusyProfileId(null)
    }
  }

  async function submit() {
    setError(null)
    const name = displayName.trim()
    if (name.length < 2) {
      setError("Bitte gib einen Anzeigenamen ein.")
      return
    }
    if (mode === "register" && !inviteCode.trim()) {
      setError("Bitte gib einen Einladungscode ein.")
      return
    }
    if (mode === "register" && inviteState === "invalid") {
      setError("Dieser Einladungscode ist ungültig oder schon benutzt.")
      return
    }
    setBusy(true)
    try {
      if (mode === "setup") {
        const result = await api.bootstrap({ displayName: name })
        onAuthenticated(result.user, result.invites)
      } else if (mode === "register") {
        const result = await api.register({ inviteCode: inviteCode.trim().toUpperCase(), displayName: name })
        onAuthenticated(result.user)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const isSetup = mode === "setup"
  const isRegister = mode === "register"

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">
            <img src="/logo-mark.svg" alt="" width={40} height={40} />
          </span>
          <div>
            <strong>Kommandozentrale</strong>
            <span>Deckwerkstatt für eure Runde</span>
          </div>
        </div>

        {entry.table && (
          <div className="auth-context">
            <Icon name="cards" size={18} />
            <div>
              <strong>Tisch {entry.table}</strong>
              <span>Nach der Anmeldung trittst du direkt bei.</span>
            </div>
          </div>
        )}

        {entry.invite && (
          <div className="auth-context">
            <Icon name="user" size={18} />
            <div>
              <strong>Einladung{inviteLabel ? ` für ${inviteLabel}` : ""}</strong>
              <span>Du kannst ein neues Profil anlegen oder ein vorhandenes wählen.</span>
            </div>
          </div>
        )}

        <div className="auth-head">
          <h1>
            {isSetup
              ? "Richte die Werkstatt ein."
              : isRegister
                ? "Mach dir ein Profil."
                : "Wer spielt mit?"}
          </h1>
          <p>
            {isSetup
              ? "Du wirst Admin. Dein bestehendes Deck und die bisherigen Spiele übernehmen wir automatisch."
              : isRegister
                ? "Nur der Einladungscode und dein Name. Kein Passwort, keine Extra-Anmeldung danach."
                : "Wähle dein Profil: ein Tipp genügt. Kein Passwort nötig."}
          </p>
        </div>

        {mode === "choose" && (
          <>
            <p className="auth-section-label">Anmelden</p>

            {profilesLoading ? (
              <p className="auth-note">Profile werden geladen…</p>
            ) : profilesError ? (
              <p className="field-note is-error" role="alert">{profilesError}</p>
            ) : profiles.length > 0 ? (
              <div className="auth-profile-list">
                {profiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    className="auth-profile"
                    onClick={() => void selectProfile(profile)}
                    disabled={busy}
                  >
                    <span className="avatar" style={{ background: profile.avatar_color }}>
                      {initials(profile.display_name)}
                    </span>
                    <span className="auth-profile-copy">
                      <strong>{profile.display_name}</strong>
                      <small>@{profile.username}{profile.role === "admin" ? " · Admin" : ""}</small>
                    </span>
                    <span className="auth-profile-arrow" aria-hidden="true">
                      {busyProfileId === profile.id ? "…" : <Icon name="arrow" size={16} />}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="auth-note">Noch kein Profil vorhanden. Lege eins mit Einladungscode an.</p>
            )}

            {error && <p className="field-note is-error" role="alert">{error}</p>}

            <div className="auth-or"><span>oder</span></div>

            <button
              type="button"
              className="button ghost wide auth-invite-button"
              onClick={() => {
                setMode("register")
                setError(null)
              }}
            >
              <Icon name="user" size={16} /> Mit Einladungscode
            </button>
          </>
        )}

        {(isSetup || isRegister) && (
          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            {isRegister && (
              <label>
                <span className="field-label">Einladungscode</span>
                <input
                  value={inviteCode}
                  onChange={(event) => {
                    setInviteCode(event.target.value.toUpperCase())
                    setInviteState("idle")
                    setInviteLabel(null)
                  }}
                  onBlur={() => void checkInvite(inviteCode)}
                  placeholder="KZ-XXXXXX"
                  autoComplete="one-time-code"
                  autoFocus={!entry.invite}
                />
                {inviteState === "valid" && <span className="field-note is-ok">Code gültig{inviteLabel ? ` · ${inviteLabel}` : ""}</span>}
                {inviteState === "invalid" && <span className="field-note is-error">Code ungültig oder schon benutzt.</span>}
                {inviteState === "checking" && <span className="field-note">Prüfe Code…</span>}
              </label>
            )}

            <label>
              <span className="field-label">Anzeigename</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Wie dich die Runde kennt"
                autoComplete="name"
                autoFocus={isSetup || Boolean(entry.invite)}
                maxLength={40}
              />
            </label>

            {error && <p className="field-note is-error" role="alert">{error}</p>}

            <button type="submit" className="button primary wide" disabled={busy}>
              <Icon name={isSetup ? "spark" : "check"} size={17} />
              {busy ? "Einen Moment…" : isSetup ? "Werkstatt einrichten" : "Profil anlegen und los"}
            </button>
          </form>
        )}

        {isRegister && (
          <div className="auth-switch">
            Schon dabei?{" "}
            <button
              type="button"
              className="text-link"
              onClick={() => {
                setMode("choose")
                setError(null)
              }}
            >
              Profil wählen
            </button>
          </div>
        )}

        {isSetup && (
          <p className="auth-note">
            Nach der Einrichtung werden direkt Einladungen für <strong>Dennis, Ingo, Bamdad und Nima</strong> angelegt.
            Die Codes findest du danach unter Profil.
          </p>
        )}
      </div>
    </div>
  )
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}
