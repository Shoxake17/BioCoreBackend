// src/services/adaptiveTarget.js

const SYMPTOM_RULES = {
  gi_issues: {
    keywords: ['oshqozon', 'ichak', 'hazm', 'meteorizm', 'IBS', 'ko\'ngil aynishi'],
    adjustments: {
      mass_gain: {
        calorieOffset: -200,  // +500 o'rniga +300 (Lean Bulking)
        label: 'Lean Bulking',
        reason: 'Hazm muammolari sababli standart bulk o\'rniga Lean Bulking (+300 kkal) qo\'llanildi',
      },
      fat_loss:  { calorieOffset: +100, label: 'Yumshoq Defitsit', reason: 'Hazm uchun yumshoqroq defitsit' },
      maintain:  { calorieOffset: 0,    label: 'Standart',         reason: '' },
    },
  },

  // Tiroid muammolari (TSH)
  thyroid: {
    keywords: ['tiroid', 'qalqonsimon', 'gipotiroidizm', 'hipertiroidizm', 'TSH'],
    adjustments: {
      fat_loss:  { calorieOffset: +150, label: 'Tiroid Adaptiv', reason: 'Tiroid muammolari sababli kichikroq defitsit qo\'llanildi' },
      mass_gain: { calorieOffset: 0,    label: 'Standart',       reason: '' },
      maintain:  { calorieOffset: 0,    label: 'Standart',       reason: '' },
    },
  },

  // Anemiya (past gemoglobin)
  anemia: {
    keywords: ['anemiya', 'gemoglobin', 'temir yetishmovchiligi'],
    adjustments: {
      fat_loss:  { calorieOffset: +200, label: 'Yumshoq Defitsit',  reason: 'Anemiya bilan keskin defitsit xavfli' },
      mass_gain: { calorieOffset: +50,  label: 'Boyitilgan Bulk',   reason: 'Qon ko\'paytiruvchi ozuqalar uchun kichik qo\'shimcha' },
      maintain:  { calorieOffset: 0,    label: 'Standart',          reason: '' },
    },
  },

  // Gormonal disbalans (ayollar)
  hormonal: {
    keywords: ['gormonal', 'PCOS', 'menstruatsiya', 'estrogen', 'progesteron'],
    adjustments: {
      fat_loss:  { calorieOffset: +100, label: 'Gormonal Adaptiv', reason: 'Gormonal balans saqlanishi uchun kamroq defitsit' },
      mass_gain: { calorieOffset: 0,    label: 'Standart',         reason: '' },
      maintain:  { calorieOffset: 0,    label: 'Standart',         reason: '' },
    },
  },

  // Yurak-qon tomir muammolari
  cardiovascular: {
    keywords: ['yurak', 'qon bosimi', 'gipertenziya', 'xolesterin'],
    adjustments: {
      mass_gain: { calorieOffset: -200, label: 'Xavfsiz Bulk',   reason: 'Yurak uchun og\'irroq ortiqcha kkal xavfli' },
      fat_loss:  { calorieOffset: +100, label: 'Yumshoq Defitsit', reason: 'Keskin defitsit yurakka yuk bo\'lishi mumkin' },
      maintain:  { calorieOffset: 0,    label: 'Standart',         reason: '' },
    },
  },
}

/**
 * Simptomlarni tahlil qilish va tegishli qoidalarni topish
 */
function detectSymptomRules(symptoms = []) {
  const detectedRules = []
  const symptomsLower = symptoms.map(s => s.toLowerCase())

  for (const [ruleKey, rule] of Object.entries(SYMPTOM_RULES)) {
    const matched = rule.keywords.some(kw =>
      symptomsLower.some(s => s.includes(kw.toLowerCase()))
    )
    if (matched) {
      detectedRules.push({ key: ruleKey, ...rule })
    }
  }

  return detectedRules
}

/**
 * Gemoglobin qiymatiga asosida anemiya aniqlash
 * Erkak: < 13.5 g/dL, Ayol: < 12.0 g/dL
 */
function detectAnemiaFromHemoglobin(hemoglobin, gender) {
  if (!hemoglobin) return false
  const value   = parseFloat(hemoglobin)
  const minNorm = gender === 'Erkak' ? 13.5 : 12.0
  return !isNaN(value) && value < minNorm
}

/**
 * TSH qiymatiga asosida tiroid muammosini aniqlash
 * Normal TSH: 0.4–4.0 mU/L
 */
function detectThyroidFromTSH(tsh) {
  if (!tsh) return false
  const value = parseFloat(tsh)
  return !isNaN(value) && (value < 0.4 || value > 4.0)
}

/**
 * Asosiy adaptiv funksiya — barcha simptom va laboratoriya ko'rsatkichlari asosida
 * kaloriya maqsadini moslashtiradi
 *
 * @param {Object} params
 * @param {number} params.baseCalories - BMI filtrlangan kaloriya maqsadi
 * @param {string} params.goal         - mass_gain | fat_loss | maintain
 * @param {Array}  params.symptoms     - Simptomlar ro'yxati
 * @param {string} params.hemoglobin   - Gemoglobin qiymati (string)
 * @param {string} params.tsh          - TSH qiymati (string)
 * @param {string} params.gender       - Erkak | Ayol
 * @returns {Object} adaptedCalories, appliedRules, finalLabel
 */
function applyAdaptiveTarget({ baseCalories, goal, symptoms = [], hemoglobin, tsh, gender }) {
  let totalOffset  = 0
  const appliedRules = []

  // 1. Simptomlardan qoidalarni aniqlash
  const rules = detectSymptomRules(symptoms)

  // 2. Laboratoriya ko'rsatkichlari asosida qo'shimcha qoidalar
  if (detectAnemiaFromHemoglobin(hemoglobin, gender) && !rules.find(r => r.key === 'anemia')) {
    rules.push({ key: 'anemia', ...SYMPTOM_RULES.anemia })
  }
  if (detectThyroidFromTSH(tsh) && !rules.find(r => r.key === 'thyroid')) {
    rules.push({ key: 'thyroid', ...SYMPTOM_RULES.thyroid })
  }

  // 3. Har bir qoidaning maqsadga mos korreksiyasini qo'llash
  for (const rule of rules) {
    const adjustment = rule.adjustments[goal]
    if (adjustment && adjustment.calorieOffset !== 0) {
      totalOffset += adjustment.calorieOffset
      appliedRules.push({
        rule:   rule.key,
        label:  adjustment.label,
        offset: adjustment.calorieOffset,
        reason: adjustment.reason,
      })
    }
  }

  const adaptedCalories = Math.max(1200, Math.round(baseCalories + totalOffset))
  const finalLabel      = appliedRules.length > 0
    ? appliedRules.map(r => r.label).join(' + ')
    : 'Standart'

  return {
    adaptedCalories,
    baseCalories,
    totalOffset,
    appliedRules,
    finalLabel,
    hasAdaptation: appliedRules.length > 0,
  }
}

/**
 * Makrolarni moslash — simptomga qarab oqsil / yog' ulushini o'zgartirish
 */
function adaptMacros({ protein, fat, carbs, symptoms = [], goal }) {
  const symptomsLower = symptoms.map(s => s.toLowerCase())
  const hasGI         = symptomsLower.some(s =>
    ['oshqozon', 'hazm', 'ichak', 'meteorizm'].some(kw => s.includes(kw))
  )

  // Hazm muammolari: tolaga boy uglevod (sabzavot, yaxlit don) > oddiy shakar
  // Makro nisbatini o'zgartirmaymiz, lekin tavsiya qo'shamiz
  const notes = []
  if (hasGI) notes.push('Kletchatkaga boy mahsulotlar, hazm qilish oson oqsillar tavsiya etiladi')
  if (goal === 'mass_gain' && hasGI) notes.push('Vaqt bo\'yicha kichik porsiyalar (har 2-3 soatda) tavsiya etiladi')

  return { protein, fat, carbs, notes }
}

export { applyAdaptiveTarget, adaptMacros, detectSymptomRules, detectAnemiaFromHemoglobin, detectThyroidFromTSH, SYMPTOM_RULES }