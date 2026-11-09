import { useRef, useState } from "react"
import { api, type Deck, type ImportReport, type Meta } from "./api"
import { applyZeroRule } from "./settings"
import { BracketDial, Icon, Modal, PodPicker, SearchBox, Toggle } from "./ui"

export function ImportModal({
  meta,
  bracket,
  pod,
  settings,
  onClose,
  onImported,
}: {
  meta: Meta
  bracket: 3 | 4 | 5
  pod: number
  settings: Record<string, any>
  onClose: () => void
  onImported: (deck: Deck) => void
}) {
  const [name, setName] = useState("")
  const [commanderName, setCommanderName] = useState("")
  const [list, setList] = useState("")
  const [localBracket, setLocalBracket] = useState<3 | 4 | 5>(bracket)
  const [localPod, setLocalPod] = useState(pod)
  const [localSettings, setLocalSettings] = useState<Record<string, any>>({ ...settings })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ deck: Deck; report: ImportReport } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  function changeSettings(partial: Record<string, any>) {
    let next = { ...localSettings, ...partial }
    if (partial.zeroRule !== undefined) next = applyZeroRule(next, Boolean(partial.zeroRule))
    setLocalSettings(next)
  }

  async function readFile(file: File) {
    const text = await file.text()
    setList(text)
    if (!name) setName(file.name.replace(/\.(txt|dek|md)$/i, "").replace(/[-_]+/g, " "))
  }

  async function submit() {
    if (!list.trim()) {
      setError("Füge eine Deckliste ein oder lade eine Textdatei.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const imported = await api.importDeck({
        name: name.trim() || undefined,
        commanderName: commanderName.trim() || undefined,
        list,
        bracket: localBracket,
        podSize: localPod,
        settings: localSettings,
      })
      setResult(imported)
      onImported(imported.deck)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    const report = result.report
    return (
      <Modal title="Import abgeschlossen" onClose={onClose} wide>
        <div className="import-result">
          <div className="import-result-head">
            <span className="import-result-number">{report.total}</span>
            <div>
              <strong>{result.deck.name}</strong>
              <p className="muted">Commander: {report.commander}. {report.imported} Karten importiert, {report.total} inklusive Commander.</p>
              {!result.deck.saved_at && <p className="field-note">Noch nicht gespeichert. Im Builder wählst du Name und Spielerprofil.</p>}
            </div>
          </div>

          {report.unknown.length > 0 && (
            <div className="import-block">
              <h3>Nicht gefunden ({report.unknown.length})</h3>
              <p className="field-note">Diese Namen stehen nicht in der Scryfall-Datenbank. Prüfe Schreibweise oder ergänze sie später manuell.</p>
              <ul className="import-list-report">
                {report.unknown.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {report.skipped.length > 0 && (
            <div className="import-block">
              <h3>Übersprungen ({report.skipped.length})</h3>
              <ul className="import-list-report">
                {report.skipped.map((item, index) => (
                  <li key={`${item.name}-${index}`}>
                    <span>{item.name}</span>
                    <span className="muted">{item.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.notes.length > 0 && (
            <div className="import-block">
              <h3>Hinweise</h3>
              <ul className="import-list-report">
                {report.notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="import-footer">
            <button type="button" className="button primary" onClick={onClose}>
              <Icon name="arrow" size={16} /> Deck öffnen
            </button>
            <button
              type="button"
              className="button ghost"
              onClick={() => {
                setResult(null)
                setName("")
                setCommanderName("")
                setList("")
                setError(null)
              }}
            >
              Weitere Liste
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Deckliste importieren" onClose={onClose} wide>
      <p className="import-intro">
        Moxfield, Archidekt oder eine einfache Textliste. Der Commander wird aus dem Commander-Abschnitt erkannt, wenn du ihn nicht oben wählst. Die Hausregeln aus den Einstellungen gelten auch beim Import.
      </p>

      <div className="import-grid">
        <label className="import-field">
          <span className="field-label">Deckname (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Zum Beispiel: Uugguu – Brutkammer" />
        </label>

        <div className="import-field">
          <span className="field-label">Commander (optional)</span>
          {commanderName ? (
            <div className="import-chip">
              <span>{commanderName}</span>
              <button type="button" className="icon-button" onClick={() => setCommanderName("")} aria-label="Commander entfernen">
                <Icon name="close" size={14} />
              </button>
            </div>
          ) : (
            <details className="import-commander">
              <summary>Commander manuell wählen</summary>
              <SearchBox onPick={setCommanderName} placeholder="Commander suchen" />
            </details>
          )}
        </div>
      </div>

      <div className="import-controls">
        <div>
          <span className="field-label">Bracket</span>
          <BracketDial brackets={meta.brackets} value={localBracket} onChange={setLocalBracket} compact />
        </div>
        <div>
          <span className="field-label">Pod-Größe</span>
          <PodPicker value={localPod} onChange={setLocalPod} />
        </div>
      </div>

      <div className="import-settings">
        <Toggle
          label="0 Rule"
          hint="Illegale Karten und Banlist werden nicht ausgefiltert. Farbidentität wird immer geprüft."
          checked={Boolean(localSettings.zeroRule)}
          onChange={(next) => changeSettings({ zeroRule: next })}
        />
      </div>

      <div className="import-list-head">
        <span className="field-label">Deckliste</span>
        <button type="button" className="button ghost" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={15} /> Datei laden
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.dek,.md,text/plain"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void readFile(file)
            event.currentTarget.value = ""
          }}
        />
      </div>
      <textarea
        className="import-list"
        value={list}
        onChange={(e) => setList(e.target.value)}
        rows={14}
        spellCheck={false}
        placeholder={`Commander\n1 Uugguu, the Omniplasm\n\nDeck\n1 Sol Ring\n1 Arcane Signet\n1 Cultivate\n12 Island\n...`}
      />
      <p className="field-note">Unterstützt „1 Karte“, „1x Karte“, Set-Kürzel wie „(CMM) 123“, Foil-Marker und Abschnitte wie Commander, Deck, Maybeboard oder Sideboard. CSV-Exporte bitte als Text exportieren.</p>

      {error && <p className="field-note is-error" role="alert">{error}</p>}

      <div className="import-footer">
        <button type="button" className="button primary" onClick={submit} disabled={busy}>
          <Icon name="upload" size={16} /> {busy ? "Importiert" : "Importieren"}
        </button>
        <button type="button" className="button ghost" onClick={onClose}>
          Abbrechen
        </button>
        <span className="field-note">Es wird nichts automatisch geschnitten oder ergänzt.</span>
      </div>
    </Modal>
  )
}
