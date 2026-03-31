/**
 * 全局语言和国家代码映射系统
 * 确保系统中所有涉及语言或国家的地方都使用统一的映射
 *
 * 支持 40+ 种语言和 80+ 个国家/地区
 */

/**
 * 语言代码映射表
 * 从完整语言名称映射到标准的 ISO 639-1 代码
 */
export const LANGUAGE_CODE_MAP: Record<string, string> = {
  // 英语
  'english': 'en',
  'en': 'en',
  '英语': 'en',

  // 中文
  'chinese': 'zh',
  'zh': 'zh',
  '中文': 'zh',
  'mandarin': 'zh',

  // 西班牙语
  'spanish': 'es',
  'es': 'es',
  '西班牙语': 'es',

  // 意大利语
  'italian': 'it',
  'it': 'it',
  '意大利语': 'it',

  // 法语
  'french': 'fr',
  'fr': 'fr',
  'fr-ca': 'fr',
  'canadian french': 'fr',
  'french (canada)': 'fr',
  '法语': 'fr',

  // 德语
  'german': 'de',
  'de': 'de',
  '德语': 'de',

  // 葡萄牙语
  'portuguese': 'pt',
  'pt': 'pt',
  '葡萄牙语': 'pt',

  // 日语
  'japanese': 'ja',
  'ja': 'ja',
  '日语': 'ja',

  // 韩语
  'korean': 'ko',
  'ko': 'ko',
  '韩语': 'ko',

  // 俄语
  'russian': 'ru',
  'ru': 'ru',
  '俄语': 'ru',

  // 阿拉伯语
  'arabic': 'ar',
  'ar': 'ar',
  '阿拉伯语': 'ar',

  // 瑞典语
  'swedish': 'sv',
  'sv': 'sv',
  '瑞典语': 'sv',

  // 荷兰语
  'dutch': 'nl',
  'nl': 'nl',
  '荷兰语': 'nl',

  // 波兰语
  'polish': 'pl',
  'pl': 'pl',
  '波兰语': 'pl',

  // 土耳其语
  'turkish': 'tr',
  'tr': 'tr',
  '土耳其语': 'tr',

  // 泰语
  'thai': 'th',
  'th': 'th',
  '泰语': 'th',

  // 越南语
  'vietnamese': 'vi',
  'vi': 'vi',
  '越南语': 'vi',

  // 印尼语
  'indonesian': 'id',
  'id': 'id',
  '印尼语': 'id',

  // 马来语
  'malay': 'ms',
  'ms': 'ms',
  '马来语': 'ms',

  // 印地语
  'hindi': 'hi',
  'hi': 'hi',
  '印地语': 'hi',

  // 希腊语
  'greek': 'el',
  'el': 'el',
  '希腊语': 'el',

  // 捷克语
  'czech': 'cs',
  'cs': 'cs',
  '捷克语': 'cs',

  // 丹麦语
  'danish': 'da',
  'da': 'da',
  '丹麦语': 'da',

  // 芬兰语
  'finnish': 'fi',
  'fi': 'fi',
  '芬兰语': 'fi',

  // 挪威语
  'norwegian': 'no',
  'no': 'no',
  '挪威语': 'no',

  // 匈牙利语
  'hungarian': 'hu',
  'hu': 'hu',
  '匈牙利语': 'hu',

  // 罗马尼亚语
  'romanian': 'ro',
  'ro': 'ro',
  '罗马尼亚语': 'ro',

  // 乌克兰语
  'ukrainian': 'uk',
  'uk': 'uk',
  '乌克兰语': 'uk',

  // 希伯来语
  'hebrew': 'he',
  'he': 'he',
  '希伯来语': 'he',

  // 波斯语
  'persian': 'fa',
  'farsi': 'fa',
  'fa': 'fa',
  '波斯语': 'fa',

  // 孟加拉语
  'bengali': 'bn',
  'bn': 'bn',
  '孟加拉语': 'bn',

  // 塔加洛语（菲律宾）
  'tagalog': 'tl',
  'filipino': 'tl',
  'tl': 'tl',
  '菲律宾语': 'tl',

  // 斯洛伐克语
  'slovak': 'sk',
  'sk': 'sk',
  '斯洛伐克语': 'sk',

  // 保加利亚语
  'bulgarian': 'bg',
  'bg': 'bg',
  '保加利亚语': 'bg',

  // 克罗地亚语
  'croatian': 'hr',
  'hr': 'hr',
  '克罗地亚语': 'hr',

  // 塞尔维亚语
  'serbian': 'sr',
  'sr': 'sr',
  '塞尔维亚语': 'sr',

  // 斯洛文尼亚语
  'slovenian': 'sl',
  'sl': 'sl',
  '斯洛文尼亚语': 'sl',

  // 爱沙尼亚语
  'estonian': 'et',
  'et': 'et',
  '爱沙尼亚语': 'et',

  // 拉脱维亚语
  'latvian': 'lv',
  'lv': 'lv',
  '拉脱维亚语': 'lv',

  // 立陶宛语
  'lithuanian': 'lt',
  'lt': 'lt',
  '立陶宛语': 'lt',

  // 瑞士德语
  'swiss german': 'de-ch',
  'de-ch': 'de-ch',
  'de-CH': 'de-ch',
  '瑞士德语': 'de-ch',
}

/**
 * 国家代码映射表
 * 从完整国家名称映射到标准的 ISO 3166-1 alpha-2 代码
 */
export const COUNTRY_CODE_MAP: Record<string, string> = {
  // 北美
  'united states': 'US',
  'usa': 'US',
  'us': 'US',
  '美国': 'US',

  'canada': 'CA',
  'ca': 'CA',
  '加拿大': 'CA',

  'mexico': 'MX',
  'mx': 'MX',
  '墨西哥': 'MX',

  // 欧洲
  'united kingdom': 'GB',
  'uk': 'GB',
  'gb': 'GB',
  '英国': 'GB',

  'germany': 'DE',
  'de': 'DE',
  '德国': 'DE',

  'france': 'FR',
  'fr': 'FR',
  '法国': 'FR',

  'italy': 'IT',
  'it': 'IT',
  '意大利': 'IT',

  'spain': 'ES',
  'es': 'ES',
  '西班牙': 'ES',

  'portugal': 'PT',
  'pt': 'PT',
  '葡萄牙': 'PT',

  'netherlands': 'NL',
  'holland': 'NL',
  'nl': 'NL',
  '荷兰': 'NL',

  'belgium': 'BE',
  'be': 'BE',
  '比利时': 'BE',

  'austria': 'AT',
  'at': 'AT',
  '奥地利': 'AT',

  'switzerland': 'CH',
  'ch': 'CH',
  '瑞士': 'CH',

  'sweden': 'SE',
  'se': 'SE',
  '瑞典': 'SE',

  'norway': 'NO',
  'no': 'NO',
  '挪威': 'NO',

  'denmark': 'DK',
  'dk': 'DK',
  '丹麦': 'DK',

  'finland': 'FI',
  'fi': 'FI',
  '芬兰': 'FI',

  'poland': 'PL',
  'pl': 'PL',
  '波兰': 'PL',

  'czech republic': 'CZ',
  'czechia': 'CZ',
  'cz': 'CZ',
  '捷克': 'CZ',

  'hungary': 'HU',
  'hu': 'HU',
  '匈牙利': 'HU',

  'greece': 'GR',
  'gr': 'GR',
  '希腊': 'GR',

  'ireland': 'IE',
  'ie': 'IE',
  '爱尔兰': 'IE',

  'romania': 'RO',
  'ro': 'RO',
  '罗马尼亚': 'RO',

  'bulgaria': 'BG',
  'bg': 'BG',
  '保加利亚': 'BG',

  'croatia': 'HR',
  'hr': 'HR',
  '克罗地亚': 'HR',

  'serbia': 'RS',
  'rs': 'RS',
  '塞尔维亚': 'RS',

  'slovenia': 'SI',
  'si': 'SI',
  '斯洛文尼亚': 'SI',

  'slovakia': 'SK',
  'sk': 'SK',
  '斯洛伐克': 'SK',

  'ukraine': 'UA',
  'ua': 'UA',
  '乌克兰': 'UA',

  'estonia': 'EE',
  'ee': 'EE',
  '爱沙尼亚': 'EE',

  'latvia': 'LV',
  'lv': 'LV',
  '拉脱维亚': 'LV',

  'lithuania': 'LT',
  'lt': 'LT',
  '立陶宛': 'LT',

  'russia': 'RU',
  'ru': 'RU',
  '俄罗斯': 'RU',

  // 亚洲
  'china': 'CN',
  'cn': 'CN',
  '中国': 'CN',

  'japan': 'JP',
  'jp': 'JP',
  '日本': 'JP',

  'south korea': 'KR',
  'korea': 'KR',
  'kr': 'KR',
  '韩国': 'KR',

  'india': 'IN',
  'in': 'IN',
  '印度': 'IN',

  'indonesia': 'ID',
  'id': 'ID',
  '印度尼西亚': 'ID',
  '印尼': 'ID',

  'thailand': 'TH',
  'th': 'TH',
  '泰国': 'TH',

  'vietnam': 'VN',
  'vn': 'VN',
  '越南': 'VN',

  'philippines': 'PH',
  'ph': 'PH',
  '菲律宾': 'PH',

  'malaysia': 'MY',
  'my': 'MY',
  '马来西亚': 'MY',

  'singapore': 'SG',
  'sg': 'SG',
  '新加坡': 'SG',

  'hong kong': 'HK',
  'hk': 'HK',
  '香港': 'HK',

  'taiwan': 'TW',
  'tw': 'TW',
  '台湾': 'TW',

  'bangladesh': 'BD',
  'bd': 'BD',
  '孟加拉国': 'BD',

  'pakistan': 'PK',
  'pk': 'PK',
  '巴基斯坦': 'PK',

  // 中东
  'turkey': 'TR',
  'tr': 'TR',
  '土耳其': 'TR',

  'saudi arabia': 'SA',
  'sa': 'SA',
  '沙特阿拉伯': 'SA',

  'united arab emirates': 'AE',
  'uae': 'AE',
  'ae': 'AE',
  '阿联酋': 'AE',

  'israel': 'IL',
  'il': 'IL',
  '以色列': 'IL',

  'egypt': 'EG',
  'eg': 'EG',
  '埃及': 'EG',

  'iran': 'IR',
  'ir': 'IR',
  '伊朗': 'IR',

  'iraq': 'IQ',
  'iq': 'IQ',
  '伊拉克': 'IQ',

  'qatar': 'QA',
  'qa': 'QA',
  '卡塔尔': 'QA',

  'kuwait': 'KW',
  'kw': 'KW',
  '科威特': 'KW',

  // 大洋洲
  'australia': 'AU',
  'au': 'AU',
  '澳大利亚': 'AU',

  'new zealand': 'NZ',
  'nz': 'NZ',
  '新西兰': 'NZ',

  // 南美
  'brazil': 'BR',
  'br': 'BR',
  '巴西': 'BR',

  'argentina': 'AR',
  'ar': 'AR',
  '阿根廷': 'AR',

  'colombia': 'CO',
  'co': 'CO',
  '哥伦比亚': 'CO',

  'chile': 'CL',
  'cl': 'CL',
  '智利': 'CL',

  'peru': 'PE',
  'pe': 'PE',
  '秘鲁': 'PE',

  'venezuela': 'VE',
  've': 'VE',
  '委内瑞拉': 'VE',

  // 非洲
  'south africa': 'ZA',
  'za': 'ZA',
  '南非': 'ZA',

  'nigeria': 'NG',
  'ng': 'NG',
  '尼日利亚': 'NG',

  'kenya': 'KE',
  'ke': 'KE',
  '肯尼亚': 'KE',

  'morocco': 'MA',
  'ma': 'MA',
  '摩洛哥': 'MA',
}

/**
 * 语言-国家对应关系
 * 用于验证语言和国家的组合是否合理
 */
export const LANGUAGE_COUNTRY_PAIRS: Record<string, string[]> = {
  'en': ['US', 'GB', 'CA', 'AU', 'NZ', 'IE', 'SG', 'PH', 'IN', 'ZA', 'NG', 'KE'],
  'zh': ['CN', 'TW', 'HK', 'SG', 'MY'],
  'es': ['ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'VE'],
  'it': ['IT', 'CH'],
  'fr': ['FR', 'BE', 'CH', 'CA', 'MA'],
  'de': ['DE', 'AT', 'CH'],
  'pt': ['BR', 'PT'],
  'ja': ['JP'],
  'ko': ['KR'],
  'ru': ['RU', 'UA'],
  'ar': ['SA', 'AE', 'EG', 'IQ', 'QA', 'KW', 'MA'],
  'sv': ['SE'],
  'nl': ['NL', 'BE'],
  'pl': ['PL'],
  'tr': ['TR'],
  'th': ['TH'],
  'vi': ['VN'],
  'id': ['ID'],
  'ms': ['MY', 'SG'],
  'hi': ['IN'],
  'el': ['GR'],
  'cs': ['CZ'],
  'da': ['DK'],
  'fi': ['FI'],
  'no': ['NO'],
  'hu': ['HU'],
  'ro': ['RO'],
  'uk': ['UA'],
  'he': ['IL'],
  'fa': ['IR'],
  'bn': ['BD'],
  'tl': ['PH'],
  'sk': ['SK'],
  'bg': ['BG'],
  'hr': ['HR'],
  'sr': ['RS'],
  'sl': ['SI'],
  'et': ['EE'],
  'lv': ['LV'],
  'lt': ['LT'],
  'de-ch': ['CH'],
}

/**
 * 国家代码到语言名称的映射
 * 用于根据目标国家确定分析语言
 */
export const COUNTRY_TO_LANGUAGE_NAME: Record<string, string> = {
  // 英语国家
  US: 'English',
  GB: 'English',
  CA: 'English',
  AU: 'English',
  NZ: 'English',
  IE: 'English',
  SG: 'English',
  PH: 'English',
  ZA: 'English',
  NG: 'English',
  KE: 'English',

  // 中文
  CN: 'Chinese',
  TW: 'Chinese',
  HK: 'Chinese',

  // 西班牙语国家
  ES: 'Spanish',
  MX: 'Spanish',
  AR: 'Spanish',
  CO: 'Spanish',
  CL: 'Spanish',
  PE: 'Spanish',
  VE: 'Spanish',

  // 意大利语
  IT: 'Italian',

  // 法语国家
  FR: 'French',
  BE: 'French', // 比利时也说荷兰语，但法语更普遍
  MA: 'French', // 摩洛哥法语和阿拉伯语都常用

  // 德语国家
  DE: 'German',
  AT: 'German',
  CH: 'German', // 瑞士德语区

  // 葡萄牙语国家
  BR: 'Portuguese',
  PT: 'Portuguese',

  // 日语
  JP: 'Japanese',

  // 韩语
  KR: 'Korean',

  // 俄语
  RU: 'Russian',

  // 阿拉伯语国家
  SA: 'Arabic',
  AE: 'Arabic',
  EG: 'Arabic',
  IQ: 'Arabic',
  QA: 'Arabic',
  KW: 'Arabic',

  // 瑞典语
  SE: 'Swedish',

  // 荷兰语
  NL: 'Dutch',

  // 波兰语
  PL: 'Polish',

  // 土耳其语
  TR: 'Turkish',

  // 泰语
  TH: 'Thai',

  // 越南语
  VN: 'Vietnamese',

  // 印尼语
  ID: 'Indonesian',

  // 马来语
  MY: 'Malay',

  // 印地语
  IN: 'Hindi', // 印度也常用英语，但印地语是官方语言

  // 希腊语
  GR: 'Greek',

  // 捷克语
  CZ: 'Czech',

  // 丹麦语
  DK: 'Danish',

  // 芬兰语
  FI: 'Finnish',

  // 挪威语
  NO: 'Norwegian',

  // 匈牙利语
  HU: 'Hungarian',

  // 罗马尼亚语
  RO: 'Romanian',

  // 乌克兰语
  UA: 'Ukrainian',

  // 希伯来语
  IL: 'Hebrew',

  // 波斯语
  IR: 'Persian',

  // 孟加拉语
  BD: 'Bengali',

  // 塔加洛语（菲律宾语）- 菲律宾默认用英语
  // PH: 'Tagalog', // 已设为英语

  // 斯洛伐克语
  SK: 'Slovak',

  // 保加利亚语
  BG: 'Bulgarian',

  // 克罗地亚语
  HR: 'Croatian',

  // 塞尔维亚语
  RS: 'Serbian',

  // 斯洛文尼亚语
  SI: 'Slovenian',

  // 爱沙尼亚语
  EE: 'Estonian',

  // 拉脱维亚语
  LV: 'Latvian',

  // 立陶宛语
  LT: 'Lithuanian',

  // 巴基斯坦（乌尔都语/英语）
  PK: 'English', // 商业环境常用英语
}

/**
 * 根据国家代码获取语言名称
 * 用于评论分析、竞品分析等场景
 * @param countryCode ISO 3166-1 alpha-2 国家代码
 * @returns 语言名称（英文），默认返回 'English'
 */
export function getLanguageNameForCountry(countryCode: string): string {
  if (!countryCode) return 'English'
  const upperCode = countryCode.toUpperCase()
  return COUNTRY_TO_LANGUAGE_NAME[upperCode] || 'English'
}

/**
 * 根据国家代码获取语言代码
 * 用于网页抓取时设置Accept-Language头
 * @param countryCode ISO 3166-1 alpha-2 国家代码
 * @returns ISO 639-1 语言代码，默认返回 'en'
 */
export function getLanguageCodeForCountry(countryCode: string): string {
  if (!countryCode) return 'en'
  const languageName = getLanguageNameForCountry(countryCode)
  return normalizeLanguageCode(languageName)
}

/**
 * 规范化语言代码
 * @param language 语言名称或代码
 * @returns 标准的 ISO 639-1 代码
 */
export function normalizeLanguageCode(language: string): string {
  if (!language) return 'en'
  const normalized = language.toLowerCase().trim()
  return LANGUAGE_CODE_MAP[normalized] || 'en'
}

/**
 * 规范化国家代码
 * @param country 国家名称或代码
 * @returns 标准的 ISO 3166-1 alpha-2 代码
 */
export function normalizeCountryCode(country: string): string {
  if (!country) return 'US'
  const normalized = country.toLowerCase().trim()
  return COUNTRY_CODE_MAP[normalized] || country.toUpperCase()
}

/**
 * 验证语言-国家组合是否合理
 * @param language ISO 639-1 语言代码
 * @param country ISO 3166-1 alpha-2 国家代码
 * @returns 是否为合理的组合
 */
export function isValidLanguageCountryPair(language: string, country: string): boolean {
  const validCountries = LANGUAGE_COUNTRY_PAIRS[language]
  if (!validCountries) return false
  return validCountries.includes(country.toUpperCase())
}

/**
 * 获取语言的完整名称
 * @param code ISO 639-1 语言代码
 * @returns 完整的语言名称
 */
export function getLanguageName(code: string): string {
  const languageNames: Record<string, string> = {
    'en': 'English',
    'zh': 'Chinese',
    'es': 'Spanish',
    'it': 'Italian',
    'fr': 'French',
    'de': 'German',
    'pt': 'Portuguese',
    'ja': 'Japanese',
    'ko': 'Korean',
    'ru': 'Russian',
    'ar': 'Arabic',
    'sv': 'Swedish',
    'nl': 'Dutch',
    'pl': 'Polish',
    'tr': 'Turkish',
    'th': 'Thai',
    'vi': 'Vietnamese',
    'id': 'Indonesian',
    'ms': 'Malay',
    'hi': 'Hindi',
    'el': 'Greek',
    'cs': 'Czech',
    'da': 'Danish',
    'fi': 'Finnish',
    'no': 'Norwegian',
    'hu': 'Hungarian',
    'ro': 'Romanian',
    'uk': 'Ukrainian',
    'he': 'Hebrew',
    'fa': 'Persian',
    'bn': 'Bengali',
    'tl': 'Tagalog',
    'sk': 'Slovak',
    'bg': 'Bulgarian',
    'hr': 'Croatian',
    'sr': 'Serbian',
    'sl': 'Slovenian',
    'et': 'Estonian',
    'lv': 'Latvian',
    'lt': 'Lithuanian',
    'de-ch': 'Swiss German',
  }
  return languageNames[code] || 'Unknown'
}

/**
 * 获取国家的完整名称
 * @param code ISO 3166-1 alpha-2 国家代码
 * @returns 完整的国家名称
 */
export function getCountryName(code: string): string {
  const countryNames: Record<string, string> = {
    // 北美
    'US': 'United States',
    'CA': 'Canada',
    'MX': 'Mexico',
    // 欧洲
    'GB': 'United Kingdom',
    'DE': 'Germany',
    'FR': 'France',
    'IT': 'Italy',
    'ES': 'Spain',
    'PT': 'Portugal',
    'NL': 'Netherlands',
    'BE': 'Belgium',
    'AT': 'Austria',
    'CH': 'Switzerland',
    'SE': 'Sweden',
    'NO': 'Norway',
    'DK': 'Denmark',
    'FI': 'Finland',
    'PL': 'Poland',
    'CZ': 'Czech Republic',
    'HU': 'Hungary',
    'GR': 'Greece',
    'IE': 'Ireland',
    'RO': 'Romania',
    'BG': 'Bulgaria',
    'HR': 'Croatia',
    'RS': 'Serbia',
    'SI': 'Slovenia',
    'SK': 'Slovakia',
    'UA': 'Ukraine',
    'EE': 'Estonia',
    'LV': 'Latvia',
    'LT': 'Lithuania',
    'RU': 'Russia',
    // 亚洲
    'CN': 'China',
    'JP': 'Japan',
    'KR': 'South Korea',
    'IN': 'India',
    'ID': 'Indonesia',
    'TH': 'Thailand',
    'VN': 'Vietnam',
    'PH': 'Philippines',
    'MY': 'Malaysia',
    'SG': 'Singapore',
    'HK': 'Hong Kong',
    'TW': 'Taiwan',
    'BD': 'Bangladesh',
    'PK': 'Pakistan',
    // 中东
    'TR': 'Turkey',
    'SA': 'Saudi Arabia',
    'AE': 'United Arab Emirates',
    'IL': 'Israel',
    'EG': 'Egypt',
    'IR': 'Iran',
    'IQ': 'Iraq',
    'QA': 'Qatar',
    'KW': 'Kuwait',
    // 大洋洲
    'AU': 'Australia',
    'NZ': 'New Zealand',
    // 南美
    'BR': 'Brazil',
    'AR': 'Argentina',
    'CO': 'Colombia',
    'CL': 'Chile',
    'PE': 'Peru',
    'VE': 'Venezuela',
    // 非洲
    'ZA': 'South Africa',
    'NG': 'Nigeria',
    'KE': 'Kenya',
    'MA': 'Morocco',
  }
  return countryNames[code.toUpperCase()] || code
}

/**
 * 获取语言的 Google Ads API 代码
 * 用于 Keyword Planner 和其他 Google Ads API 调用
 * 返回 Google Ads 使用的语言代码（数字）
 * 参考: https://developers.google.com/google-ads/api/reference/data/codes-formats#language_code
 */
export function getGoogleAdsLanguageCode(language: string): number {
  const code = normalizeLanguageCode(language)
  const googleAdsLanguageCodes: Record<string, number> = {
    // NOTE: These are Google Ads `language_constant` IDs (languageConstants/<id>),
    // not locale IDs. Keep in sync with Google Ads reference data.
    'en': 1000,  // English
    'de': 1001,  // German
    'fr': 1002,  // French
    'es': 1003,  // Spanish
    'it': 1004,  // Italian
    'ja': 1005,  // Japanese
    'zh': 1008,  // Chinese
    'da': 1009,  // Danish
    'nl': 1010,  // Dutch
    'fi': 1011,  // Finnish
    'ko': 1012,  // Korean
    'no': 1013,  // Norwegian
    'pt': 1014,  // Portuguese
    'sv': 1015,  // Swedish
    'ar': 1019,  // Arabic
    'bg': 1020,  // Bulgarian
    'cs': 1021,  // Czech
    'el': 1022,  // Greek
    'hi': 1023,  // Hindi
    'hu': 1024,  // Hungarian
    'id': 1025,  // Indonesian
    'he': 1027,  // Hebrew (Google Ads uses code 'iw')
    'lv': 1028,  // Latvian
    'lt': 1029,  // Lithuanian
    'pl': 1030,  // Polish
    'ru': 1031,  // Russian
    'ro': 1032,  // Romanian
    'sk': 1033,  // Slovak
    'sl': 1034,  // Slovenian
    'sr': 1035,  // Serbian
    'uk': 1036,  // Ukrainian
    'tr': 1037,  // Turkish
    'hr': 1039,  // Croatian
    'vi': 1040,  // Vietnamese
    'tl': 1042,  // Filipino (Tagalog)
    'et': 1043,  // Estonian
    'th': 1044,  // Thai
    'bn': 1056,  // Bengali
    'fa': 1064,  // Persian
    'ms': 1102,  // Malay
    'de-ch': 1001,  // Swiss German (use German)
  }
  return googleAdsLanguageCodes[code] || 1000  // 默认英文
}

/**
 * 获取语言的 Google Ads API 国家代码
 * 用于 Keyword Planner 和其他 Google Ads API 调用
 */
export function getGoogleAdsCountryCode(country: string): string {
  return normalizeCountryCode(country)
}

/**
 * 验证并规范化语言和国家代码
 * @param language 语言名称或代码
 * @param country 国家名称或代码
 * @returns 规范化后的 { language, country } 对象
 */
export function normalizeLanguageCountry(language: string, country: string): { language: string; country: string } {
  const normalizedLanguage = normalizeLanguageCode(language)
  const normalizedCountry = normalizeCountryCode(country)

  return {
    language: normalizedLanguage,
    country: normalizedCountry,
  }
}

/**
 * 获取所有支持的语言列表
 * 扩展到40种语言
 */
export function getSupportedLanguages(): Array<{ code: string; name: string }> {
  return [
    // 主要语言 (高优先级)
    { code: 'en', name: 'English' },
    { code: 'zh', name: 'Chinese' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'it', name: 'Italian' },
    { code: 'ru', name: 'Russian' },
    { code: 'ar', name: 'Arabic' },
    // 欧洲语言
    { code: 'nl', name: 'Dutch' },
    { code: 'pl', name: 'Polish' },
    { code: 'sv', name: 'Swedish' },
    { code: 'da', name: 'Danish' },
    { code: 'fi', name: 'Finnish' },
    { code: 'no', name: 'Norwegian' },
    { code: 'el', name: 'Greek' },
    { code: 'cs', name: 'Czech' },
    { code: 'hu', name: 'Hungarian' },
    { code: 'ro', name: 'Romanian' },
    { code: 'sk', name: 'Slovak' },
    { code: 'bg', name: 'Bulgarian' },
    { code: 'hr', name: 'Croatian' },
    { code: 'sr', name: 'Serbian' },
    { code: 'sl', name: 'Slovenian' },
    { code: 'uk', name: 'Ukrainian' },
    { code: 'et', name: 'Estonian' },
    { code: 'lv', name: 'Latvian' },
    { code: 'lt', name: 'Lithuanian' },
    // 亚洲语言
    { code: 'tr', name: 'Turkish' },
    { code: 'th', name: 'Thai' },
    { code: 'vi', name: 'Vietnamese' },
    { code: 'id', name: 'Indonesian' },
    { code: 'ms', name: 'Malay' },
    { code: 'hi', name: 'Hindi' },
    { code: 'bn', name: 'Bengali' },
    { code: 'tl', name: 'Tagalog' },
    // 中东语言
    { code: 'he', name: 'Hebrew' },
    { code: 'fa', name: 'Persian' },
    // 特殊变体
    { code: 'de-ch', name: 'Swiss German' },
  ]
}

/**
 * 获取所有支持的国家列表
 * 扩展到60+国家
 */
export function getSupportedCountries(): Array<{ code: string; name: string }> {
  return [
    // 北美
    { code: 'US', name: 'United States' },
    { code: 'CA', name: 'Canada' },
    { code: 'MX', name: 'Mexico' },
    // 欧洲
    { code: 'GB', name: 'United Kingdom' },
    { code: 'DE', name: 'Germany' },
    { code: 'FR', name: 'France' },
    { code: 'IT', name: 'Italy' },
    { code: 'ES', name: 'Spain' },
    { code: 'PT', name: 'Portugal' },
    { code: 'NL', name: 'Netherlands' },
    { code: 'BE', name: 'Belgium' },
    { code: 'AT', name: 'Austria' },
    { code: 'CH', name: 'Switzerland' },
    { code: 'SE', name: 'Sweden' },
    { code: 'NO', name: 'Norway' },
    { code: 'DK', name: 'Denmark' },
    { code: 'FI', name: 'Finland' },
    { code: 'PL', name: 'Poland' },
    { code: 'CZ', name: 'Czech Republic' },
    { code: 'HU', name: 'Hungary' },
    { code: 'GR', name: 'Greece' },
    { code: 'IE', name: 'Ireland' },
    { code: 'RO', name: 'Romania' },
    { code: 'BG', name: 'Bulgaria' },
    { code: 'HR', name: 'Croatia' },
    { code: 'RS', name: 'Serbia' },
    { code: 'SI', name: 'Slovenia' },
    { code: 'SK', name: 'Slovakia' },
    { code: 'UA', name: 'Ukraine' },
    { code: 'EE', name: 'Estonia' },
    { code: 'LV', name: 'Latvia' },
    { code: 'LT', name: 'Lithuania' },
    { code: 'RU', name: 'Russia' },
    // 亚洲
    { code: 'CN', name: 'China' },
    { code: 'JP', name: 'Japan' },
    { code: 'KR', name: 'South Korea' },
    { code: 'IN', name: 'India' },
    { code: 'ID', name: 'Indonesia' },
    { code: 'TH', name: 'Thailand' },
    { code: 'VN', name: 'Vietnam' },
    { code: 'PH', name: 'Philippines' },
    { code: 'MY', name: 'Malaysia' },
    { code: 'SG', name: 'Singapore' },
    { code: 'HK', name: 'Hong Kong' },
    { code: 'TW', name: 'Taiwan' },
    { code: 'BD', name: 'Bangladesh' },
    { code: 'PK', name: 'Pakistan' },
    // 中东
    { code: 'TR', name: 'Turkey' },
    { code: 'SA', name: 'Saudi Arabia' },
    { code: 'AE', name: 'United Arab Emirates' },
    { code: 'IL', name: 'Israel' },
    { code: 'EG', name: 'Egypt' },
    { code: 'IR', name: 'Iran' },
    { code: 'IQ', name: 'Iraq' },
    { code: 'QA', name: 'Qatar' },
    { code: 'KW', name: 'Kuwait' },
    // 大洋洲
    { code: 'AU', name: 'Australia' },
    { code: 'NZ', name: 'New Zealand' },
    // 南美
    { code: 'BR', name: 'Brazil' },
    { code: 'AR', name: 'Argentina' },
    { code: 'CO', name: 'Colombia' },
    { code: 'CL', name: 'Chile' },
    { code: 'PE', name: 'Peru' },
    { code: 'VE', name: 'Venezuela' },
    // 非洲
    { code: 'ZA', name: 'South Africa' },
    { code: 'NG', name: 'Nigeria' },
    { code: 'KE', name: 'Kenya' },
    { code: 'MA', name: 'Morocco' },
  ]
}

/**
 * Google Ads 地理目标ID映射
 * 用于 Keyword Planner API 的国家定位
 * 参考: https://developers.google.com/google-ads/api/reference/data/geotargets
 */
const GOOGLE_ADS_GEO_TARGETS: Record<string, string> = {
  // 北美
  US: '2840',   // United States
  CA: '2124',   // Canada
  MX: '2484',   // Mexico

  // 欧洲
  GB: '2826',   // United Kingdom
  UK: '2826',   // United Kingdom (别名)
  DE: '2276',   // Germany
  FR: '2250',   // France
  IT: '2380',   // Italy
  ES: '2724',   // Spain
  PT: '2620',   // Portugal
  NL: '2528',   // Netherlands
  BE: '2056',   // Belgium
  AT: '2040',   // Austria
  CH: '2756',   // Switzerland
  SE: '2752',   // Sweden
  NO: '2578',   // Norway
  DK: '2208',   // Denmark
  FI: '2246',   // Finland
  PL: '2616',   // Poland
  CZ: '2203',   // Czech Republic
  HU: '2348',   // Hungary
  GR: '2300',   // Greece
  IE: '2372',   // Ireland
  RO: '2642',   // Romania
  BG: '2100',   // Bulgaria
  HR: '2191',   // Croatia
  RS: '2688',   // Serbia
  SI: '2705',   // Slovenia
  SK: '2703',   // Slovakia
  UA: '2804',   // Ukraine
  EE: '2233',   // Estonia
  LV: '2428',   // Latvia
  LT: '2440',   // Lithuania
  RU: '2643',   // Russia

  // 亚洲
  CN: '2156',   // China
  JP: '2392',   // Japan
  KR: '2410',   // South Korea
  IN: '2356',   // India
  ID: '2360',   // Indonesia
  TH: '2764',   // Thailand
  VN: '2704',   // Vietnam
  PH: '2608',   // Philippines
  MY: '2458',   // Malaysia
  SG: '2702',   // Singapore
  HK: '2344',   // Hong Kong
  TW: '2158',   // Taiwan
  BD: '2050',   // Bangladesh
  PK: '2586',   // Pakistan

  // 中东
  TR: '2792',   // Turkey
  SA: '2682',   // Saudi Arabia
  AE: '2784',   // United Arab Emirates
  IL: '2376',   // Israel
  EG: '2818',   // Egypt
  IR: '2364',   // Iran
  IQ: '2368',   // Iraq
  QA: '2634',   // Qatar
  KW: '2414',   // Kuwait

  // 大洋洲
  AU: '2036',   // Australia
  NZ: '2554',   // New Zealand

  // 南美
  BR: '2076',   // Brazil
  AR: '2032',   // Argentina
  CO: '2170',   // Colombia
  CL: '2152',   // Chile
  PE: '2604',   // Peru
  VE: '2862',   // Venezuela

  // 非洲
  ZA: '2710',   // South Africa
  NG: '2566',   // Nigeria
  KE: '2404',   // Kenya
  MA: '2504',   // Morocco
}

/**
 * 获取国家的 Google Ads 地理目标ID
 * 用于 Keyword Planner API 的国家定位
 * @param countryCode ISO 3166-1 alpha-2 国家代码 (如 'US', 'CN', 'JP')
 * @returns Google Ads 地理目标ID (如 '2840', '2156', '2392')
 */
export function getGoogleAdsGeoTargetId(countryCode: string): string {
  const upperCode = countryCode.toUpperCase()
  return GOOGLE_ADS_GEO_TARGETS[upperCode] || '2840'  // 默认美国
}

/**
 * 判断国家是否有明确的 Google Ads 地理目标ID映射
 * 用于一致性校验（避免意外走默认值）
 */
export function hasGoogleAdsGeoTargetId(countryCode: string): boolean {
  const upperCode = countryCode.toUpperCase()
  return upperCode in GOOGLE_ADS_GEO_TARGETS
}

/**
 * 获取语言代码的 Google Ads API 语言ID (字符串格式)
 * 用于 Keyword Planner API
 * @param languageCode ISO 639-1 语言代码 (如 'en', 'zh', 'ja')
 * @returns Google Ads 语言ID字符串 (如 '1000', '1017', '1041')
 */
export function getGoogleAdsLanguageIdString(languageCode: string): string {
  return getGoogleAdsLanguageCode(languageCode).toString()
}

/**
 * 国家中文名称映射
 * 用于前端UI显示
 */
const COUNTRY_CHINESE_NAMES: Record<string, string> = {
  // 北美
  US: '美国',
  CA: '加拿大',
  MX: '墨西哥',
  // 欧洲
  GB: '英国',
  DE: '德国',
  FR: '法国',
  IT: '意大利',
  ES: '西班牙',
  PT: '葡萄牙',
  NL: '荷兰',
  BE: '比利时',
  AT: '奥地利',
  CH: '瑞士',
  SE: '瑞典',
  NO: '挪威',
  DK: '丹麦',
  FI: '芬兰',
  PL: '波兰',
  CZ: '捷克',
  HU: '匈牙利',
  GR: '希腊',
  IE: '爱尔兰',
  RO: '罗马尼亚',
  BG: '保加利亚',
  HR: '克罗地亚',
  RS: '塞尔维亚',
  SI: '斯洛文尼亚',
  SK: '斯洛伐克',
  UA: '乌克兰',
  EE: '爱沙尼亚',
  LV: '拉脱维亚',
  LT: '立陶宛',
  RU: '俄罗斯',
  // 亚洲
  CN: '中国',
  JP: '日本',
  KR: '韩国',
  IN: '印度',
  ID: '印度尼西亚',
  TH: '泰国',
  VN: '越南',
  PH: '菲律宾',
  MY: '马来西亚',
  SG: '新加坡',
  HK: '香港',
  TW: '台湾',
  BD: '孟加拉国',
  PK: '巴基斯坦',
  // 中东
  TR: '土耳其',
  SA: '沙特阿拉伯',
  AE: '阿联酋',
  IL: '以色列',
  EG: '埃及',
  IR: '伊朗',
  IQ: '伊拉克',
  QA: '卡塔尔',
  KW: '科威特',
  // 大洋洲
  AU: '澳大利亚',
  NZ: '新西兰',
  // 南美
  BR: '巴西',
  AR: '阿根廷',
  CO: '哥伦比亚',
  CL: '智利',
  PE: '秘鲁',
  VE: '委内瑞拉',
  // 非洲
  ZA: '南非',
  NG: '尼日利亚',
  KE: '肯尼亚',
  MA: '摩洛哥',
}

/**
 * 获取国家的中文名称
 * @param countryCode ISO 3166-1 alpha-2 国家代码
 * @returns 中文国家名称
 */
export function getCountryChineseName(countryCode: string): string {
  const upperCode = countryCode.toUpperCase()
  return COUNTRY_CHINESE_NAMES[upperCode] || countryCode
}

/**
 * 获取所有支持的国家列表（带中文名称）
 * 用于前端下拉选择框
 * @returns 包含code、英文名、中文名的国家数组
 */
export function getSupportedCountriesWithChineseName(): Array<{ code: string; name: string; chineseName: string }> {
  return getSupportedCountries().map(country => ({
    ...country,
    chineseName: COUNTRY_CHINESE_NAMES[country.code] || country.name,
  }))
}

/**
 * 获取前端UI用的国家选项列表
 * 格式：{ code: 'US', name: '美国 (US)' }
 * 用于替代各组件中的硬编码国家列表
 */
export function getCountryOptionsForUI(): Array<{ code: string; name: string }> {
  return getSupportedCountries().map(country => ({
    code: country.code,
    name: `${COUNTRY_CHINESE_NAMES[country.code] || country.name} (${country.code})`,
  }))
}

/**
 * 语言代码到Accept-Language HTTP头的映射
 * 用于网页抓取时设置正确的语言偏好
 */
const LANGUAGE_TO_ACCEPT_HEADER: Record<string, string> = {
  // 主要语言
  en: 'en-US,en;q=0.9',
  zh: 'zh-CN,zh;q=0.9,en;q=0.8',
  ja: 'ja-JP,ja;q=0.9,en;q=0.8',
  ko: 'ko-KR,ko;q=0.9,en;q=0.8',
  de: 'de-DE,de;q=0.9,en;q=0.8',
  fr: 'fr-FR,fr;q=0.9,en;q=0.8',
  es: 'es-ES,es;q=0.9,en;q=0.8',
  it: 'it-IT,it;q=0.9,en;q=0.8',
  pt: 'pt-BR,pt;q=0.9,en;q=0.8',
  // 北欧语言
  sv: 'sv-SE,sv;q=0.9,en;q=0.8',
  no: 'no-NO,no;q=0.9,en;q=0.8',
  da: 'da-DK,da;q=0.9,en;q=0.8',
  fi: 'fi-FI,fi;q=0.9,en;q=0.8',
  // 东欧语言
  pl: 'pl-PL,pl;q=0.9,en;q=0.8',
  cs: 'cs-CZ,cs;q=0.9,en;q=0.8',
  hu: 'hu-HU,hu;q=0.9,en;q=0.8',
  ro: 'ro-RO,ro;q=0.9,en;q=0.8',
  uk: 'uk-UA,uk;q=0.9,en;q=0.8',
  ru: 'ru-RU,ru;q=0.9,en;q=0.8',
  // 西欧语言
  nl: 'nl-NL,nl;q=0.9,en;q=0.8',
  el: 'el-GR,el;q=0.9,en;q=0.8',
  // 亚洲语言
  th: 'th-TH,th;q=0.9,en;q=0.8',
  vi: 'vi-VN,vi;q=0.9,en;q=0.8',
  id: 'id-ID,id;q=0.9,en;q=0.8',
  ms: 'ms-MY,ms;q=0.9,en;q=0.8',
  hi: 'hi-IN,hi;q=0.9,en;q=0.8',
  // 中东语言
  ar: 'ar-SA,ar;q=0.9,en;q=0.8',
  he: 'he-IL,he;q=0.9,en;q=0.8',
  tr: 'tr-TR,tr;q=0.9,en;q=0.8',
}

/**
 * 获取语言对应的Accept-Language HTTP头
 * 用于网页抓取时设置正确的语言偏好
 * @param languageCode - 语言代码（如 'en', 'zh', 'ja'）
 * @returns Accept-Language头值
 */
export function getAcceptLanguageHeader(languageCode: string): string {
  const normalizedCode = languageCode.toLowerCase().split('-')[0]
  return LANGUAGE_TO_ACCEPT_HEADER[normalizedCode] || 'en-US,en;q=0.9'
}
