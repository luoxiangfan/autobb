import type { SoftCopyTemplates, SupportedSoftCopyLanguage } from '../types'

export function getSoftCopyTemplates(
  language: SupportedSoftCopyLanguage,
  preferredKeyword: string,
  brandSeed: string
): SoftCopyTemplates {
  if (language === 'fr') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} avec support officiel et qualité fiable`,
          cta: 'En savoir plus',
        },
        brandHeadline: `Support officiel ${brandSeed}`,
      },
      b: {
        painSolution1: {
          base: `Besoin de résultats fiables au quotidien ? ${preferredKeyword} vous aide à avancer sereinement`,
          cta: 'En savoir plus',
        },
        painSolution2: {
          base: `${preferredKeyword} offre une performance stable pour vos besoins quotidiens`,
          cta: 'Acheter maintenant',
        },
        scenarioHeadline: 'Meilleurs résultats au quotidien ?',
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} offre un excellent rapport qualité-prix et une performance fiable`,
          cta: 'Acheter maintenant',
        },
        transactionalHeadline: `Achetez ${preferredKeyword} aujourd'hui`,
      },
    }
  }

  if (language === 'de') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} mit offiziellem Support und zuverlässiger Qualität`,
          cta: 'Mehr erfahren',
        },
        brandHeadline: `Offizieller ${brandSeed} Support`,
      },
      b: {
        painSolution1: {
          base: `Brauchen Sie verlässliche Ergebnisse im Alltag? ${preferredKeyword} unterstützt Sie zuverlässig`,
          cta: 'Mehr erfahren',
        },
        painSolution2: {
          base: `${preferredKeyword} liefert stabile Leistung für tägliche Anforderungen`,
          cta: 'Jetzt kaufen',
        },
        scenarioHeadline: 'Bessere Ergebnisse im Alltag?',
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} bietet starken Alltagswert und zuverlässige Leistung`,
          cta: 'Jetzt kaufen',
        },
        transactionalHeadline: `Kaufen Sie ${preferredKeyword} heute`,
      },
    }
  }

  if (language === 'es') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} con soporte oficial y calidad confiable`,
          cta: 'Más información',
        },
        brandHeadline: `Soporte oficial ${brandSeed}`,
      },
      b: {
        painSolution1: {
          base: `¿Necesitas resultados fiables cada día? ${preferredKeyword} te ayuda con rendimiento constante`,
          cta: 'Más información',
        },
        painSolution2: {
          base: `${preferredKeyword} ofrece confianza y desempeño para necesidades diarias`,
          cta: 'Comprar ahora',
        },
        scenarioHeadline: '¿Mejores resultados diarios?',
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} ofrece valor diario y rendimiento confiable`,
          cta: 'Comprar ahora',
        },
        transactionalHeadline: `Compra ${preferredKeyword} hoy`,
      },
    }
  }

  if (language === 'it') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} con supporto ufficiale e qualità affidabile`,
          cta: 'Scopri di più',
        },
        brandHeadline: `Supporto ufficiale ${brandSeed}`,
      },
      b: {
        painSolution1: {
          base: `Vuoi risultati affidabili ogni giorno? ${preferredKeyword} ti aiuta con prestazioni costanti`,
          cta: 'Scopri di più',
        },
        painSolution2: {
          base: `${preferredKeyword} offre affidabilità e performance per esigenze quotidiane`,
          cta: 'Acquista ora',
        },
        scenarioHeadline: 'Risultati migliori ogni giorno?',
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} offre valore quotidiano e prestazioni affidabili`,
          cta: 'Acquista ora',
        },
        transactionalHeadline: `Acquista ${preferredKeyword} oggi`,
      },
    }
  }

  if (language === 'pt') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} com suporte oficial e qualidade confiável`,
          cta: 'Saiba mais',
        },
        brandHeadline: `Suporte oficial ${brandSeed}`,
      },
      b: {
        painSolution1: {
          base: `Precisa de resultados confiáveis no dia a dia? ${preferredKeyword} ajuda com desempenho estável`,
          cta: 'Saiba mais',
        },
        painSolution2: {
          base: `${preferredKeyword} oferece confiança e performance para necessidades diárias`,
          cta: 'Comprar agora',
        },
        scenarioHeadline: 'Melhores resultados no dia a dia?',
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} oferece valor diário e desempenho confiável`,
          cta: 'Comprar agora',
        },
        transactionalHeadline: `Compre ${preferredKeyword} hoje`,
      },
    }
  }

  if (language === 'zh') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} 官方支持，品质可靠`,
          cta: '了解更多',
        },
        brandHeadline: `${brandSeed} 官方支持`,
      },
      b: {
        painSolution1: {
          base: `需要稳定可靠的日常表现吗？${preferredKeyword} 助你持续发挥更好`,
          cta: '了解更多',
        },
        painSolution2: {
          base: `${preferredKeyword} 为日常需求带来稳定表现与信心`,
          cta: '立即购买',
        },
        scenarioHeadline: '想要更好的日常表现吗？',
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} 兼顾价值与性能，日常使用更放心`,
          cta: '立即购买',
        },
        transactionalHeadline: `今日选购 ${preferredKeyword}`,
      },
    }
  }

  if (language === 'ja') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} は公式サポート付きで安心品質`,
          cta: '詳しく見る',
        },
        brandHeadline: `公式 ${brandSeed} サポート`,
      },
      b: {
        painSolution1: {
          base: `毎日の成果を安定させたいですか？${preferredKeyword} がしっかり支えます`,
          cta: '詳しく見る',
        },
        painSolution2: {
          base: `${preferredKeyword} は日常ニーズに安定したパフォーマンスを提供します`,
          cta: '今すぐ購入',
        },
        scenarioHeadline: '日々の成果を高めたいですか？',
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} は毎日の作業で価値と性能を両立`,
          cta: '今すぐ購入',
        },
        transactionalHeadline: `${preferredKeyword} を今日購入`,
      },
    }
  }

  if (language === 'ko') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} 공식 지원으로 믿을 수 있는 품질`,
          cta: '자세히 보기',
        },
        brandHeadline: `${brandSeed} 공식 지원`,
      },
      b: {
        painSolution1: {
          base: `매일 더 안정적인 결과가 필요하신가요? ${preferredKeyword} 가 꾸준히 도와줍니다`,
          cta: '자세히 보기',
        },
        painSolution2: {
          base: `${preferredKeyword} 는 일상 니즈에 안정적인 성능과 신뢰를 제공합니다`,
          cta: '지금 구매',
        },
        scenarioHeadline: '일상 성과를 더 높이고 싶나요?',
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} 는 일상 작업에서 가치와 성능을 제공합니다`,
          cta: '지금 구매',
        },
        transactionalHeadline: `오늘 ${preferredKeyword} 구매`,
      },
    }
  }

  if (language === 'ru') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} с официальной поддержкой и надежным качеством`,
          cta: 'Узнать больше',
        },
        brandHeadline: `Официальная поддержка ${brandSeed}`,
      },
      b: {
        painSolution1: {
          base: `Нужны стабильные результаты каждый день? ${preferredKeyword} помогает уверенно двигаться дальше`,
          cta: 'Узнать больше',
        },
        painSolution2: {
          base: `${preferredKeyword} обеспечивает надежную работу для ежедневных задач`,
          cta: 'Купить сейчас',
        },
        scenarioHeadline: 'Лучшие результаты каждый день?',
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} дает отличную ценность и надежную работу каждый день`,
          cta: 'Купить сейчас',
        },
        transactionalHeadline: `Купите ${preferredKeyword} сегодня`,
      },
    }
  }

  if (language === 'ar') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} مع دعم رسمي وجودة موثوقة`,
          cta: 'اعرف المزيد',
        },
        brandHeadline: `دعم رسمي ${brandSeed}`,
      },
      b: {
        painSolution1: {
          base: `هل تحتاج نتائج موثوقة كل يوم؟ ${preferredKeyword} يساعدك بأداء ثابت`,
          cta: 'اعرف المزيد',
        },
        painSolution2: {
          base: `${preferredKeyword} يمنحك ثباتًا وثقة لاحتياجاتك اليومية`,
          cta: 'اشتري الآن',
        },
        scenarioHeadline: 'تريد نتائج يومية أفضل؟',
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} يمنحك قيمة يومية وأداءً موثوقًا`,
          cta: 'اشتري الآن',
        },
        transactionalHeadline: `اشتر ${preferredKeyword} اليوم`,
      },
    }
  }

  return {
    a: {
      trustDescription: {
        base: `${preferredKeyword} with official support and trusted quality`,
        cta: 'Learn More',
      },
      brandHeadline: `Official ${brandSeed} Support`,
    },
    b: {
      painSolution1: {
        base: `Need dependable results every day? ${preferredKeyword} helps you stay confident and efficient`,
        cta: 'Learn More',
      },
      painSolution2: {
        base: `Get reliable everyday performance with ${preferredKeyword} designed for daily use`,
        cta: 'Shop Now',
      },
      scenarioHeadline: 'Need Better Everyday Results?',
    },
    d: {
      valueDescription: {
        base: `${preferredKeyword} delivers everyday value with trusted performance`,
        cta: 'Shop Now',
      },
      transactionalHeadline: `Buy ${preferredKeyword} Today`,
    },
  }
}

export function getDefaultProductNoun(language: SupportedSoftCopyLanguage): string {
  if (language === 'fr') return 'ce produit'
  if (language === 'de') return 'dieses Produkt'
  if (language === 'es') return 'este producto'
  if (language === 'it') return 'questo prodotto'
  if (language === 'pt') return 'este produto'
  if (language === 'zh') return '这款产品'
  if (language === 'ja') return 'この製品'
  if (language === 'ko') return '이 제품'
  if (language === 'ru') return 'этот продукт'
  if (language === 'ar') return 'هذا المنتج'
  return 'our product'
}
