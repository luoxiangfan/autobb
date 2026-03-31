/**
 * ⚡ P0重构: AI配置管理模块
 * 从ad-creative-generator.ts拆分出AI配置相关逻辑
 */
import { resolveActiveAIConfig } from '../ai-runtime-config'

export interface AIConfig {
  type: 'gemini-api' | null
  geminiAPI?: {
    apiKey: string
    model: string
  }
}

/**
 * 获取AI配置（仅用户级，不回退全局）
 */
export async function getAIConfig(userId?: number): Promise<AIConfig> {
  if (!userId || userId <= 0) {
    console.warn('⚠️ getAIConfig 缺少有效 userId，返回空配置')
    return { type: null }
  }

  const resolved = await resolveActiveAIConfig(userId)

  if (resolved.type === 'gemini-api' && resolved.geminiAPI) {
    console.log(`🤖 使用${resolved.geminiAPI.provider === 'relay' ? '第三方中转' : 'Gemini官方'}: 模型=${resolved.geminiAPI.model}`)
    return {
      type: 'gemini-api',
      geminiAPI: {
        apiKey: resolved.geminiAPI.apiKey,
        model: resolved.geminiAPI.model,
      },
    }
  }

  // 7. 无可用配置
  console.warn('⚠️ 未配置AI服务（Gemini API），将无法生成广告创意')
  return { type: null }
}

/**
 * 获取目标语言的指令文本
 */
export function getLanguageInstruction(targetLanguage: string): string {
  const languageInstructions: Record<string, string> = {
    'English': 'Generate ad copy in English.',
    'Spanish': 'Genera el copy del anuncio en español.',
    'French': 'Générez le contenu publicitaire en français.',
    'German': 'Erstellen Sie den Werbetext auf Deutsch.',
    'Italian': 'Genera il testo pubblicitario in italiano.',
    'Portuguese': 'Gere o texto do anúncio em português.',
    'Dutch': 'Genereer de advertentietekst in het Nederlands.',
    'Polish': 'Wygeneruj treść reklamy po polsku.',
    'Russian': 'Создайте рекламный текст на русском языке.',
    'Japanese': '日本語で広告コピーを生成してください。',
    'Korean': '한국어로 광고 문구를 생성하십시오.',
    'Chinese (Simplified)': '请用简体中文生成广告文案。',
    'Chinese (Traditional)': '請用繁體中文生成廣告文案。',
    'Arabic': 'قم بإنشاء نص الإعلان باللغة العربية.',
    'Hindi': 'विज्ञापन प्रति हिंदी में उत्पन्न करें।',
    'Bengali': 'বাংলায় বিজ্ঞাপন কপি তৈরি করুন।',
    'Turkish': 'Reklam metnini Türkçe olarak oluşturun.',
    'Vietnamese': 'Tạo nội dung quảng cáo bằng tiếng Việt.',
    'Thai': 'สร้างเนื้อหาโฆษณาเป็นภาษาไทย',
    'Indonesian': 'Buat teks iklan dalam bahasa Indonesia.',
    'Malay': 'Hasilkan teks iklan dalam bahasa Melayu.',
    'Swedish': 'Generera annonseringstext på svenska.',
    'Danish': 'Generer annoncetekst på dansk.',
    'Norwegian': 'Generer annonsetekst på norsk.',
    'Finnish': 'Luo mainosteksti suomeksi.',
    'Greek': 'Δημιουργήστε διαφημιστικό κείμενο στα ελληνικά.',
    'Czech': 'Vygenerujte text reklamy v češtině.',
    'Romanian': 'Generați textul publicitar în limba română.',
    'Hungarian': 'Hozzon létre hirdetési szöveget magyarul.',
    'Ukrainian': 'Створіть рекламний текст українською мовою.',
    'Hebrew': 'צור טקסט פרסומי בעברית.',
  }

  return languageInstructions[targetLanguage] || languageInstructions['English']
}
