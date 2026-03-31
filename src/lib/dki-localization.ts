import { getLanguageCodeForCountry, normalizeLanguageCode } from './language-country-codes'

export interface DkiLocaleOptions {
  targetLanguage?: string | null
  targetCountry?: string | null
}

export const DKI_OFFICIAL_SUFFIX_BY_LANGUAGE: Record<string, string> = {
  en: ' Official',
  zh: ' 官方',
  es: ' Oficial',
  it: ' Ufficiale',
  fr: ' Officiel',
  de: ' Offiziell',
  'de-ch': ' Offiziell',
  pt: ' Oficial',
  ja: ' 公式',
  ko: ' 공식',
  ru: ' Официальный',
  ar: ' رسمي',
  sv: ' Officiell',
  nl: ' Officieel',
  pl: ' Oficjalny',
  tr: ' Resmi',
  th: ' ทางการ',
  vi: ' Chính Hãng',
  id: ' Resmi',
  ms: ' Rasmi',
  hi: ' आधिकारिक',
  el: ' Επίσημο',
  cs: ' Oficiální',
  da: ' Officiel',
  fi: ' Virallinen',
  no: ' Offisiell',
  hu: ' Hivatalos',
  ro: ' Oficial',
  uk: ' Офіційний',
  he: ' רשמי',
  fa: ' رسمی',
  bn: ' অফিসিয়াল',
  tl: ' Opisyal',
  sk: ' Oficiálny',
  bg: ' Официален',
  hr: ' Službeni',
  sr: ' Zvanični',
  sl: ' Uradni',
  et: ' Ametlik',
  lv: ' Oficiāls',
  lt: ' Oficialus',
}

export function resolveDkiLanguageCode(options?: DkiLocaleOptions): string {
  const languageInput = String(options?.targetLanguage || '').trim()
  if (languageInput) {
    return normalizeLanguageCode(languageInput)
  }

  const countryInput = String(options?.targetCountry || '').trim()
  if (countryInput) {
    return getLanguageCodeForCountry(countryInput)
  }

  return 'en'
}

export function getLocalizedDkiOfficialSuffix(options?: DkiLocaleOptions): string {
  const languageCode = resolveDkiLanguageCode(options)
  return DKI_OFFICIAL_SUFFIX_BY_LANGUAGE[languageCode] || DKI_OFFICIAL_SUFFIX_BY_LANGUAGE.en
}

