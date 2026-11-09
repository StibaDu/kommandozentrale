export async function copyText(value: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // Im LAN-HTTP ist die Clipboard-API oft gesperrt; Fallback unten.
    }
  }
  try {
    const area = document.createElement("textarea")
    area.value = value
    area.setAttribute("readonly", "")
    area.style.position = "fixed"
    area.style.left = "-9999px"
    area.style.top = "0"
    document.body.appendChild(area)
    area.focus()
    area.select()
    area.setSelectionRange(0, area.value.length)
    const ok = document.execCommand("copy")
    area.remove()
    return ok
  } catch {
    return false
  }
}
