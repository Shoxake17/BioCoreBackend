// src/services/mifflinEngine.js

const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,    
  moderate:  1.375,
  active:    1.725,  
}

const GOAL_ADJUSTMENTS = {
  mass_gain: +500,   
  fat_loss:  -400,  
  maintain:  0,      
}


function calcBMR({ weight, height, age, gender }) {
  if (!weight || !height || !age) return 1800

  const base = (10 * weight) + (6.25 * height) - (5 * age)
  const genderOffset = gender === 'Erkak' ? 5 : -161
  return Math.round(base + genderOffset)
}

/**
 * TDEE hisoblash — BMR × faollik ko'paytmasi
 */
function calcTDEE(bmr, activityLevel) {
  const multiplier = ACTIVITY_MULTIPLIERS[activityLevel] || ACTIVITY_MULTIPLIERS.sedentary
  return Math.round(bmr * multiplier)
}

/**
 * BMI hisoblash
 * BMI = vazn (kg) / bo'y (m)²
 */
function calcBMI(weight, height) {
  if (!weight || !height) return 0
  const heightM = height / 100
  return parseFloat((weight / (heightM * heightM)).toFixed(1))
}

/**
 * Maqsadga qarab kunlik kaloriya maqsadini hisoblash
 */
function calcCalorieTarget(tdee, goal) {
  const adjustment = GOAL_ADJUSTMENTS[goal] ?? 0
  return Math.max(1200, tdee + adjustment) // Minimum 1200 kkal xavfsizlik chegarasi
}

/**
 * Makronutrientlarni hisoblash (BJU)
 * Oqsil: 2.2g / kg tana vazni
 * Yog': kunlik kkaloriyaning 28%
 * Uglevod: qolgan kkaloriyalar
 */
function calcMacros(calorieTarget, weight) {
  const protein = Math.round(weight * 2.2)         // 4 kkal/g
  const fat     = Math.round(calorieTarget * 0.28 / 9) // 9 kkal/g
  const carbCal = calorieTarget - (protein * 4) - (fat * 9)
  const carbs   = Math.max(50, Math.round(carbCal / 4)) // 4 kkal/g, min 50g

  return { protein, fat, carbs }
}

/**
 * To'liq hisoblash — barcha ko'rsatkichlar
 */
function calcFullProfile(user) {
  const { weight, height, age, gender, goal, activityLevel } = user

  const bmr     = calcBMR({ weight, height, age, gender })
  const tdee    = calcTDEE(bmr, activityLevel)
  const bmi     = calcBMI(weight, height)
  const calories = calcCalorieTarget(tdee, goal)
  const macros  = calcMacros(calories, weight)

  return {
    bmr,
    tdee,
    bmi,
    calorieTarget: calories,
    proteinTarget: macros.protein,
    fatTarget:     macros.fat,
    carbTarget:    macros.carbs,
  }
}

export { calcBMR, calcTDEE, calcBMI, calcCalorieTarget, calcMacros, calcFullProfile, ACTIVITY_MULTIPLIERS, GOAL_ADJUSTMENTS }