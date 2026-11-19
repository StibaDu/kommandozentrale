import { useEffect, useState } from "react"
import { api, type Meta, type NetworkInfo } from "./api"
import { copyText } from "./clipboard"
import { Icon, Modal, cx } from "./ui"

function join(base: string) {
  return `${base.replace(/\/+$/, "")}/m`
}

export function MobileConnectModal({ meta, onClose }: { meta: Meta; onClose: () => void }) {
  const [network, setNetwork] = useState<NetworkInfo>(meta.network)
  const fallback = typeof window === "undefined" ? "" : join(window.location.origin)
  const preferred = network.lanUrl ? join(network.lanUrl) : fallback
  const preferredLabel = network.publicUrl
    ? "Öffentliche Adresse"
    : network.mdnsUrl && network.lanUrl === network.mdnsUrl
      ? "Stabile WLAN-Adresse"
      : "Aktuelle LAN-Adresse"
  const alternatives = [
    { label: "Stabile WLAN-Adresse", url: network.mdnsUrl ? join(network.mdnsUrl) : null },
    { label: "Aktuelle IP", url: network.ipUrl ? join(network.ipUrl) : null },
    { label: "Tailscale", url: network.tailscaleUrl ? join(network.tailscaleUrl) : null },
  ].filter((entry): entry is { label: string; url: string } => Boolean(entry.url) && entry.url !== preferred)
  const [copied, setCopied] = useState<string | null>(null)
  const [qrUrl, setQrUrl] = useState(preferred)

  useEffect(() => {
    let alive = true
    api
      .network()
      .then((next) => {
        if (alive) setNetwork(next)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    setQrUrl(preferred)
  }, [preferred])
  const qrOptions = [
    { label: network.publicUrl ? "Öffentlich" : "Stabil", url: preferred },
    ...alternatives.map((entry) => ({
      label: entry.label === "Aktuelle IP" ? "IP" : entry.label === "Tailscale" ? "Tailscale" : "Stabil",
      url: entry.url,
    })),
  ]

  async function copy(value: string, label: string) {
    if (await copyText(value)) {
      setCopied(label)
      window.setTimeout(() => setCopied(null), 1800)
    }
  }

  return (
    <Modal title="Handy verbinden" onClose={onClose} wide>
      <div className="mobile-connect">
        <div className="mobile-connect-qr">
          <img src={`/api/mobile/qr.svg?url=${encodeURIComponent(qrUrl)}`} alt="QR-Code für die mobile Kommandozentrale" />
          <span>{qrOptions.find((entry) => entry.url === qrUrl)?.label ?? preferredLabel}</span>
          {qrOptions.length > 1 && (
            <div className="mobile-connect-qr-switch" role="group" aria-label="QR-Ziel wählen">
              {qrOptions.map((entry) => (
                <button
                  type="button"
                  key={`${entry.label}-${entry.url}`}
                  className={cx(entry.url === qrUrl && "is-active")}
                  aria-pressed={entry.url === qrUrl}
                  onClick={() => setQrUrl(entry.url)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mobile-connect-copy">
          <p className="lede">
            Öffne die Adresse auf dem Handy und lege sie als Web-App auf den Home-Bildschirm.{" "}
            {network.publicUrl
              ? "Diese Instanz ist über eine öffentliche Adresse erreichbar."
              : network.tailscaleUrl
                ? "Im gleichen WLAN oder über Tailscale, wenn das Handy im Tailnet ist."
                : "Beide Geräte müssen im gleichen WLAN sein."}
          </p>

          <div className="mobile-connect-url">
            <code>{preferred}</code>
            <button type="button" className={cx("button ghost", copied === preferredLabel && "is-copied")} onClick={() => void copy(preferred, preferredLabel)}>
              <Icon name={copied === preferredLabel ? "check" : "copy"} size={15} /> {copied === preferredLabel ? "Kopiert" : "Kopieren"}
            </button>
          </div>

          {alternatives.length > 0 && (
            <div className="mobile-connect-alternatives">
              <span className="field-label">Alternativen</span>
              {alternatives.map((entry) => (
                <button type="button" className="mobile-connect-alt" key={entry.label} onClick={() => void copy(entry.url, entry.label)}>
                  <span>{entry.label}</span>
                  <code>{entry.url}</code>
                  <Icon name="copy" size={13} />
                </button>
              ))}
            </div>
          )}

          <div className="mobile-connect-notes">
            {network.mdnsUrl ? (
              <p>
                <strong>WLAN-Wechsel:</strong> Nimm die Adresse mit <code>.local</code>, nicht die IP. Sie bleibt gleich,
                auch wenn der Rechner in einem anderen WLAN eine neue IP bekommt.
              </p>
            ) : (
              <p>
                <strong>WLAN:</strong> Nutze die aktuelle LAN-IP-Adresse. Unter Windows ist sie nicht automatisch stabil;
                nach einem WLAN-Wechsel kann sich die IP ändern.
              </p>
            )}
            {network.publicUrl ? (
              <p><strong>Öffentlich:</strong> Diese Instanz läuft über eine feste öffentliche Adresse und funktioniert auch außerhalb des WLANs.</p>
            ) : network.tailscaleUrl ? (
              <p><strong>Tailscale aktiv:</strong> Die Tailscale-Adresse funktioniert auch unterwegs, wenn das Handy im selben Tailnet ist.</p>
            ) : network.tailscaleAvailable ? (
              <p><strong>Tailscale:</strong> installiert, aber nicht verbunden. Starte Tailscale, wenn Mac und Handy nicht im selben WLAN sind.</p>
            ) : null}
            <p className="field-note">
              {network.mdnsUrl
                ? "Falls die .local-Adresse auf einem Android-Gerät nicht aufgelöst wird, nimm die aktuelle IP als Fallback."
                : "Die Firewall von Windows muss eingehende Verbindungen für Bun erlauben."}
            </p>
          </div>
        </div>
      </div>
    </Modal>
  )
}
