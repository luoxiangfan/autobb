/**
 * Timezone 工具函数
 * 用于处理补点击任务的时区转换
 *
 * 设计原则（KISS）：
 * - 数据库存储 UTC 时间戳
 * - 只在需要"本地日期/时间"的地方转换timezone
 * - 使用原生 Intl API，避免重量级库
 */

/**
 * 国家代码到主要时区的映射
 * 基于 getSupportedCountries() 支持的 60+ 国家
 * 对于有多个时区的国家，选择最具代表性的商业时区
 */
export const COUNTRY_TIMEZONE_MAP: Record<string, string> = {
  // 北美（3个国家）
  'US': 'America/New_York',      // 美国 - 东部时间（纽约，最大商业中心）
  'CA': 'America/Toronto',        // 加拿大 - 东部时间（多伦多，最大城市）
  'MX': 'America/Mexico_City',    // 墨西哥 - 中部时间（墨西哥城，首都）

  // 欧洲（30个国家）
  'GB': 'Europe/London',          // 英国 - 伦敦时间
  'DE': 'Europe/Berlin',          // 德国 - 柏林时间
  'FR': 'Europe/Paris',           // 法国 - 巴黎时间
  'IT': 'Europe/Rome',            // 意大利 - 罗马时间
  'ES': 'Europe/Madrid',          // 西班牙 - 马德里时间
  'PT': 'Europe/Lisbon',          // 葡萄牙 - 里斯本时间
  'NL': 'Europe/Amsterdam',       // 荷兰 - 阿姆斯特丹时间
  'BE': 'Europe/Brussels',        // 比利时 - 布鲁塞尔时间
  'AT': 'Europe/Vienna',          // 奥地利 - 维也纳时间
  'CH': 'Europe/Zurich',          // 瑞士 - 苏黎世时间
  'SE': 'Europe/Stockholm',       // 瑞典 - 斯德哥尔摩时间
  'NO': 'Europe/Oslo',            // 挪威 - 奥斯陆时间
  'DK': 'Europe/Copenhagen',      // 丹麦 - 哥本哈根时间
  'FI': 'Europe/Helsinki',        // 芬兰 - 赫尔辛基时间
  'PL': 'Europe/Warsaw',          // 波兰 - 华沙时间
  'CZ': 'Europe/Prague',          // 捷克 - 布拉格时间
  'HU': 'Europe/Budapest',        // 匈牙利 - 布达佩斯时间
  'GR': 'Europe/Athens',          // 希腊 - 雅典时间
  'IE': 'Europe/Dublin',          // 爱尔兰 - 都柏林时间
  'RO': 'Europe/Bucharest',       // 罗马尼亚 - 布加勒斯特时间
  'BG': 'Europe/Sofia',           // 保加利亚 - 索非亚时间
  'HR': 'Europe/Zagreb',          // 克罗地亚 - 萨格勒布时间
  'RS': 'Europe/Belgrade',        // 塞尔维亚 - 贝尔格莱德时间
  'SI': 'Europe/Ljubljana',       // 斯洛文尼亚 - 卢布尔雅那时间
  'SK': 'Europe/Bratislava',      // 斯洛伐克 - 布拉迪斯拉发时间
  'UA': 'Europe/Kyiv',            // 乌克兰 - 基辅时间
  'EE': 'Europe/Tallinn',         // 爱沙尼亚 - 塔林时间
  'LV': 'Europe/Riga',            // 拉脱维亚 - 里加时间
  'LT': 'Europe/Vilnius',         // 立陶宛 - 维尔纽斯时间
  'RU': 'Europe/Moscow',          // 俄罗斯 - 莫斯科时间（最大商业中心）

  // 亚洲（14个国家）
  'CN': 'Asia/Shanghai',          // 中国 - 上海时间（全国统一时区）
  'JP': 'Asia/Tokyo',             // 日本 - 东京时间
  'KR': 'Asia/Seoul',             // 韩国 - 首尔时间
  'IN': 'Asia/Kolkata',           // 印度 - 加尔各答时间（全国统一时区）
  'ID': 'Asia/Jakarta',           // 印度尼西亚 - 雅加达时间（西部时间，最大商业中心）
  'TH': 'Asia/Bangkok',           // 泰国 - 曼谷时间
  'VN': 'Asia/Ho_Chi_Minh',       // 越南 - 胡志明市时间（最大商业中心）
  'PH': 'Asia/Manila',            // 菲律宾 - 马尼拉时间
  'MY': 'Asia/Kuala_Lumpur',      // 马来西亚 - 吉隆坡时间
  'SG': 'Asia/Singapore',         // 新加坡时间
  'HK': 'Asia/Hong_Kong',         // 香港时间
  'TW': 'Asia/Taipei',            // 台湾 - 台北时间
  'BD': 'Asia/Dhaka',             // 孟加拉国 - 达卡时间
  'PK': 'Asia/Karachi',           // 巴基斯坦 - 卡拉奇时间

  // 中东（9个国家）
  'TR': 'Europe/Istanbul',        // 土耳其 - 伊斯坦布尔时间
  'SA': 'Asia/Riyadh',            // 沙特阿拉伯 - 利雅得时间
  'AE': 'Asia/Dubai',             // 阿联酋 - 迪拜时间
  'IL': 'Asia/Jerusalem',         // 以色列 - 耶路撒冷时间
  'EG': 'Africa/Cairo',           // 埃及 - 开罗时间
  'IR': 'Asia/Tehran',            // 伊朗 - 德黑兰时间
  'IQ': 'Asia/Baghdad',           // 伊拉克 - 巴格达时间
  'QA': 'Asia/Qatar',             // 卡塔尔 - 多哈时间
  'KW': 'Asia/Kuwait',            // 科威特时间

  // 大洋洲（2个国家）
  'AU': 'Australia/Sydney',       // 澳大利亚 - 悉尼时间（东部时间，最大商业中心）
  'NZ': 'Pacific/Auckland',       // 新西兰 - 奥克兰时间

  // 南美（6个国家）
  'BR': 'America/Sao_Paulo',      // 巴西 - 圣保罗时间（最大商业中心）
  'AR': 'America/Argentina/Buenos_Aires', // 阿根廷 - 布宜诺斯艾利斯时间
  'CO': 'America/Bogota',         // 哥伦比亚 - 波哥大时间
  'CL': 'America/Santiago',       // 智利 - 圣地亚哥时间
  'PE': 'America/Lima',           // 秘鲁 - 利马时间
  'VE': 'America/Caracas',        // 委内瑞拉 - 加拉加斯时间

  // 非洲（4个国家）
  'ZA': 'Africa/Johannesburg',    // 南非 - 约翰内斯堡时间
  'NG': 'Africa/Lagos',           // 尼日利亚 - 拉各斯时间
  'KE': 'Africa/Nairobi',         // 肯尼亚 - 内罗毕时间
  'MA': 'Africa/Casablanca',      // 摩洛哥 - 卡萨布兰卡时间
};

/**
 * 根据国家代码获取默认时区
 * @param countryCode - ISO 3166-1 alpha-2 国家代码（如 'US', 'CN'）
 * @returns IANA timezone 标识符（如 'America/New_York'）
 */
export function getTimezoneByCountry(countryCode: string): string {
  const upperCode = countryCode.toUpperCase();
  return COUNTRY_TIMEZONE_MAP[upperCode] || 'America/New_York'; // 默认美国东部时间
}

/**
 * 获取指定timezone的当前日期（YYYY-MM-DD格式）
 * 使用原生 Intl API，轻量级且可靠
 *
 * @param date - Date 对象（通常是当前时间）
 * @param timezone - IANA timezone 标识符
 * @returns YYYY-MM-DD 格式的日期字符串
 *
 * @example
 * getDateInTimezone(new Date(), 'America/New_York')
 * // 返回 "2024-12-28" (纽约当地日期)
 */
export function getDateInTimezone(date: Date, timezone: string): string {
  // 使用 Intl.DateTimeFormat 获取 timezone 的年月日
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  // en-CA 格式: YYYY-MM-DD
  return formatter.format(date);
}

/**
 * 在指定timezone中构造Date对象（返回UTC Date）
 *
 * ⚠️ 重要：JavaScript 没有原生 API 支持"在特定timezone构造Date"
 * 这个函数使用 formatToParts 来获取指定timezone的本地时间对应的UTC时间
 *
 * @param dateStr - YYYY-MM-DD 格式的日期
 * @param timeStr - HH:mm 或 HH:mm:ss 格式的时间
 * @param timezone - IANA timezone 标识符
 * @returns UTC Date 对象，表示输入的本地时间对应的UTC时间
 *
 * @example
 * createDateInTimezone('2024-12-30', '06:00:30', 'America/New_York')
 * // 纽约时间 2024-12-30 06:00:30 EST (UTC-5) = UTC 2024-12-30 11:00:30
 * // 返回 Date 对象
 */
export function createDateInTimezone(
  dateStr: string,
  timeStr: string,
  timezone: string,
  second?: number  // 🆕 可选秒数参数
): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const timeParts = timeStr.split(':').map(Number);
  const hour = timeParts[0];
  const minute = timeParts[1];
  const sec = second !== undefined ? second : (timeParts[2] || 0);

  // 方法：使用 formatToParts 获取本地时间，然后计算对应的UTC时间
  // 1. 构造一个UTC时间作为基准
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, sec));

  // 2. 获取这个UTC时间在目标时区的显示时间
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(utcDate);
  const localHour = parseInt(parts.find(p => p.type === 'hour')!.value);
  const localMinute = parseInt(parts.find(p => p.type === 'minute')!.value);

  // 3. 计算本地时间与UTC时间的差值（偏移量）
  const localMinutes = localHour * 60 + localMinute;
  const utcMinutes = hour * 60 + minute;
  let offsetMinutes = localMinutes - utcMinutes;

  // 处理跨越午夜的情况（如 UTC 02:00 在东京显示为 11:00，offset = -540）
  while (offsetMinutes > 720) offsetMinutes -= 1440;
  while (offsetMinutes < -720) offsetMinutes += 1440;

  // 4. 应用偏移量得到正确的UTC时间
  const targetUtcMs = utcDate.getTime() - offsetMinutes * 60 * 1000;
  return new Date(targetUtcMs);
}

/**
 * 获取指定timezone的当前小时（0-23）
 *
 * @param date - Date 对象（通常是当前时间）
 * @param timezone - IANA timezone 标识符
 * @returns 小时数（0-23）
 *
 * @example
 * getHourInTimezone(new Date(), 'America/New_York')
 * // 返回 14 (纽约当地时间 14:00)
 */
export function getHourInTimezone(date: Date, timezone: string): number {
  return parseInt(
    date.toLocaleString('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    })
  );
}
