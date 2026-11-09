export function applyZeroRule(settings: Record<string, any>, on: boolean) {
  if (on) {
    return {
      ...settings,
      zeroRule: true,
      allowIllegal: true,
      allowBanned: true,
      allowUnCards: true,
      allowMassLandDenial: true,
      allowCombos: true,
      maxGameChangers: null,
      maxTutors: null,
      maxExtraTurns: null,
    }
  }
  return {
    ...settings,
    zeroRule: false,
    allowIllegal: false,
    allowBanned: false,
    allowUnCards: false,
    allowMassLandDenial: false,
    allowCombos: true,
  }
}
