export const POD_COUNTER_MAX = 999

export type PodCounterKey =
  | "energy"
  | "experience"
  | "rad"
  | "treasure"
  | "clue"
  | "food"
  | "blood"
  | "gold"

export interface PodCounterDefinition {
  key: PodCounterKey
  label: string
  short: string
}

export const POD_COUNTERS: PodCounterDefinition[] = [
  { key: "energy", label: "Energy", short: "Energy" },
  { key: "experience", label: "Erfahrung", short: "Exp" },
  { key: "rad", label: "Rad", short: "Rad" },
  { key: "treasure", label: "Treasure", short: "Treasure" },
  { key: "clue", label: "Clue", short: "Clue" },
  { key: "food", label: "Food", short: "Food" },
  { key: "blood", label: "Blood", short: "Blood" },
  { key: "gold", label: "Gold", short: "Gold" },
]

export type PodStatusKey = "monarch" | "initiative" | "citys_blessing"

export interface PodStatusDefinition {
  key: PodStatusKey
  label: string
  short: string
  exclusive: boolean
}

export const POD_STATUSES: PodStatusDefinition[] = [
  { key: "monarch", label: "Monarch", short: "Monarch", exclusive: true },
  { key: "initiative", label: "Initiative", short: "Initiative", exclusive: true },
  { key: "citys_blessing", label: "Stadtsegen", short: "Segen", exclusive: false },
]

export function isPodCounterKey(value: string): value is PodCounterKey {
  return POD_COUNTERS.some((counter) => counter.key === value)
}

export function isPodStatusKey(value: string): value is PodStatusKey {
  return POD_STATUSES.some((status) => status.key === value)
}

export function podCounterValue(counters: Record<string, number> | null | undefined, key: PodCounterKey): number {
  return Math.max(0, Math.min(POD_COUNTER_MAX, Number(counters?.[key] ?? 0)))
}
