// src/services/bmiFilter.js

import { calcBMI } from './mifflinEngine.js'

/**
 * BMI kategoriyalari
 */
const BMI_CATEGORIES = {
  UNDERWEIGHT:      { min: 0,    max: 18.5, label: 'Tana massasi yetarli emas', code: 'underweight' },
  NORMAL:           { min: 18.5, max: 25,   label: 'Sog\'lom vazn',              code: 'normal'      },
  OVERWEIGHT:       { min: 25,   max: 30,   label: 'Ortiqcha vazn',              code: 'overweight'  },
  OBESE_1:          { min: 30,   max: 35,   label: '1-darajali semizlik',        code: 'obese_1'     },
  OBESE_2:          { min: 35,   max: 40,   label: '2-darajali semizlik',        code: 'obese_2'     },
  OBESE_3:          { min: 40,   max: Infinity, label: '3-darajali semizlik',   code: 'obese_3'     },
}

/**
 * Xavfsizlik chegaralari (fizikaviy mantiqsiz qiymatlarni bloklash)
 */
const SAFETY_BOUNDS = {
  height: { min: 100, max: 250 }, // sm
  weight: { min: 20,  max: 300 }, // kg
  age:    { min: 10,  max: 100 },
}

/**
 * Fizikaviy qiymatlarni xavfsizlik chegaralariga tekshirish
 */
function validatePhysicalBounds(data) {
  const warnings = []
  const clamped  = { ...data }

  for (const [field, bounds] of Object.entries(SAFETY_BOUNDS)) {
    if (data[field] !== undefined) {
      if (data[field] < bounds.min) {
        warnings.push(`${field} juda kichik (${data[field]}). Minimal: ${bounds.min}`)
        clamped[field] = bounds.min
      }
      if (data[field] > bounds.max) {
        warnings.push(`${field} juda katta (${data[field]}). Maksimal: ${bounds.max}`)
        clamped[field] = bounds.max
      }
    }
  }

  return { clamped, warnings }
}

/**
 * BMI kategoriyasini aniqlash
 */
function getBMICategory(bmi) {
  for (const cat of Object.values(BMI_CATEGORIES)) {
    if (bmi >= cat.min && bmi < cat.max) {
      return cat
    }
  }
  return BMI_CATEGORIES.NORMAL
}

/**
 * BMI va maqsadga ko'ra xavfsizlik filtri
 * Tizim reaktsiyasi: ogohlantirish va avtomatik kaloriya korreksiyasi
 *
 * Qaytaradi: { safeCalories, warning, suggestion, bmiCategory, bmi }
 */
function applyBMIFilter({ weight, height, goal, tdee }) {
  const bmi        = calcBMI(weight, height)
  const category   = getBMICategory(bmi)
  let   safeCalories = tdee
  let   warning      = null
  let   suggestion   = null
  let   autoAdjusted = false

  // --- Tana massasi yetarli emas (BMI < 18.5) ---
  if (category.code === 'underweight') {
    warning    = `BMI: ${bmi} — Tana massasi yetarli emas. Minimal sog'lom og'irlikka erishish tavsiya etiladi.`
    suggestion = 'mass_gain'
    if (goal === 'fat_loss') {
      safeCalories = tdee + 300 // Xavfli defitsitni bloklash
      autoAdjusted = true
      warning += ' Fat Loss rejimi xavfli — Lean Bulking rejimiga o\'tkazildi.'
    }
  }

  // --- Ortiqcha vazn (BMI 25–29.9) ---
  if (category.code === 'overweight') {
    warning    = `BMI: ${bmi} — Ortiqcha vazn. Defitsit rejimi tavsiya etiladi.`
    suggestion = 'fat_loss'
    if (goal === 'mass_gain') {
      warning += ' Avval sog\'lom vaznga erishib, so\'ng bulk qilish maqsadga muvofiq.'
    }
  }

  // --- 3-darajali semizlik (BMI ≥ 40) + Maintain rejimi ---
  if (category.code === 'obese_3') {
    warning      = `BMI: ${bmi} — 3-darajali semizlik aniqlandi. Xavfsiz defitsit rejimi avtomatik yoqildi.`
    suggestion   = 'fat_loss'
    safeCalories = Math.max(1200, tdee - 300) // Xavfsiz -300 kkal defitsit
    autoAdjusted = true

    if (goal === 'mass_gain') {
      warning += ' Mass Gain tanlangan bo\'lsa ham, tibbiy xavfsizlik uchun defitsit rejimi qo\'llanildi.'
    }
  }

  return {
    bmi,
    bmiCategory:   category,
    safeCalories:  Math.round(safeCalories),
    warning,
    suggestion,
    autoAdjusted,
  }
}

/**
 * Dashboard uchun BMI banner ma'lumotlari
 */
function getBMIBannerData(bmi) {
  const cat = getBMICategory(bmi)

  const colorMap = {
    underweight: { color: '#00d4ff',  icon: '⚠️' },
    normal:      { color: '#7fff00',  icon: '✅' },
    overweight:  { color: '#ffaa00',  icon: '⚠️' },
    obese_1:     { color: '#ff8c00',  icon: '🔴' },
    obese_2:     { color: '#ff6b6b',  icon: '🔴' },
    obese_3:     { color: '#ff0000',  icon: '🚨' },
  }

  const style = colorMap[cat.code] || colorMap.normal

  return {
    bmi,
    label:  cat.label,
    code:   cat.code,
    color:  style.color,
    icon:   style.icon,
    show:   cat.code !== 'normal', // Normal holat uchun banner ko'rsatilmaydi
  }
}

export { applyBMIFilter, getBMICategory, getBMIBannerData, validatePhysicalBounds, BMI_CATEGORIES, SAFETY_BOUNDS }