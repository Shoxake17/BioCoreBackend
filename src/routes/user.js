// src/routes/user.js
import express   from 'express'
import User      from '../models/User.js'
import Meal      from '../models/Meal.js'
import WeightLog from '../models/WeightLog.js'
import { auth } from '../middleware/auth.js'
import { calcFullProfile }                                         from '../services/mifflinEngine.js'
import { applyBMIFilter, getBMIBannerData, validatePhysicalBounds } from '../services/bmiFilter.js'
import { applyAdaptiveTarget, adaptMacros }                        from '../services/adaptiveTarget.js'

const router = express.Router()

/* ─── Helpers ────────────────────────────────────────────────── */
function calcMealTotals(meals) {
  return meals.reduce((a, m) => ({
    calories: a.calories + (m.totalCalories || 0),
    protein:  a.protein  + (m.totalProtein  || 0),
    fat:      a.fat      + (m.totalFat      || 0),
    carbs:    a.carbs    + (m.totalCarbs    || 0),
  }), { calories: 0, protein: 0, fat: 0, carbs: 0 })
}

function calcGoalDeadline(user) {
  if (!user.targetTime) return null
  const m = user.targetTime.match(/(\d+)\s*(oy|hafta|kun)/i)
  if (!m) return null
  const d = new Date()
  const n = parseInt(m[1])
  if (m[2].toLowerCase() === 'oy')    d.setMonth(d.getMonth() + n)
  if (m[2].toLowerCase() === 'hafta') d.setDate(d.getDate() + n * 7)
  if (m[2].toLowerCase() === 'kun')   d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

/* ─── POST /api/user/onboarding ──────────────────────────────── */
router.post('/onboarding', auth, async (req, res) => {
  try {
    const { age, height, weight, goal, targetWeight, targetTime, activityLevel,
            sleepTime, wakeTime, symptoms, hemoglobin, tsh } = req.body

    const { clamped, warnings } = validatePhysicalBounds({ age, height, weight })
    const safeAge = clamped.age||age, safeH = clamped.height||height, safeW = clamped.weight||weight

    const profile  = calcFullProfile({ weight: safeW, height: safeH, age: safeAge, gender: req.user.gender, goal, activityLevel })
    const bmiRes   = applyBMIFilter({ weight: safeW, height: safeH, goal, tdee: profile.tdee })
    const adaptive = applyAdaptiveTarget({ baseCalories: bmiRes.safeCalories, goal, symptoms: symptoms||[], hemoglobin, tsh, gender: req.user.gender })
    const macros   = adaptMacros({ protein: profile.proteinTarget, fat: profile.fatTarget, carbs: profile.carbTarget, symptoms: symptoms||[], goal })

    const user = await User.findByIdAndUpdate(req.user._id, {
      age: safeAge, height: safeH, weight: safeW, goal, targetWeight, targetTime,
      activityLevel, sleepTime, wakeTime, symptoms, hemoglobin, tsh, onboardingDone: true,
      calorieTarget: adaptive.adaptedCalories, proteinTarget: macros.protein,
      fatTarget: macros.fat, carbTarget: macros.carbs,
      bmr: profile.bmr, tdee: profile.tdee, bmi: profile.bmi,
      adaptiveLabel: adaptive.finalLabel,
    }, { new: true, runValidators: true }).select('-password')

    // Boshlang'ich vaznni vazn tarixiga BIR MARTA yozamiz (agar hali hech qanday log bo'lmasa)
    const hasWeightLog = await WeightLog.findOne({ userId: req.user._id })
    if (!hasWeightLog) {
      const onbDate = new Date().toISOString().split('T')[0]
      await WeightLog.create({ userId: req.user._id, weight: safeW, date: onbDate }).catch(() => {})
    }

    res.json({ user, analysis: { bmr: profile.bmr, tdee: profile.tdee, bmi: profile.bmi, bmiCategory: bmiRes.bmiCategory.label, bmiWarning: bmiRes.warning, adaptiveLabel: adaptive.finalLabel, safetyWarnings: warnings } })
  } catch (err) {
    console.error('[onboarding]', err)
    res.status(500).json({ message: err.message })
  }
})

/* ─── GET /api/user/daily ────────────────────────────────────── */
router.get('/daily', auth, async (req, res) => {
  try {
    const today      = new Date().toISOString().split('T')[0]
    const user       = req.user
    const weekAgoStr = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]

    const [meals, latestW, baselineW] = await Promise.all([
      Meal.find({ userId: user._id, date: today }),
      WeightLog.findOne({ userId: user._id }).sort({ createdAt: -1 }),
      WeightLog.findOne({ userId: user._id, date: { $lte: weekAgoStr } }).sort({ date: -1 }),
    ])
    const t   = calcMealTotals(meals)
    const bmi = user.bmi ? getBMIBannerData(user.bmi) : null

    // Haftalik vazn o'zgarishi (gramm): oxirgi vazn vs ~7 kun oldingi vazn
    const currentWeight = latestW?.weight ?? user.weight ?? 0
    const weeklyChange  = (latestW && baselineW)
      ? Math.round((latestW.weight - baselineW.weight) * 1000)
      : 0

    res.json({
      calorieTarget:    user.calorieTarget || 2000,
      caloriesConsumed: Math.round(t.calories),
      currentWeight,
      weeklyChange,
      protein: { current: Math.round(t.protein), target: user.proteinTarget || 100 },
      fat:     { current: Math.round(t.fat),     target: user.fatTarget     || 70  },
      carbs:   { current: Math.round(t.carbs),   target: user.carbTarget    || 250 },
      bmr:  user.bmr  || null,
      tdee: user.tdee || null,
      bmi:  user.bmi  || null,
      bmiCode:       bmi?.code    || null,
      bmiWarning:    (bmi?.show)  ? bmi.label : null,
      adaptiveLabel: user.adaptiveLabel || null,
      adaptiveReasons: [],
      habits: [],
      meals,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* ─── GET /api/user/weekly ───────────────────────────────────── */
router.get('/weekly', auth, async (req, res) => {
  try {
    const user  = req.user
    const dayNames = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh']
    // 7 kunning sanalari
    const dateObjs = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      dateObjs.push({ d, str: d.toISOString().split('T')[0], isToday: i === 0 })
    }
    const dateStrs = dateObjs.map(x => x.str)

    // Hammasini IKKI so'rovda olamiz (N+1 emas)
    const [allMeals, allWeights] = await Promise.all([
      Meal.find({ userId: user._id, date: { $in: dateStrs } }),
      WeightLog.find({ userId: user._id, date: { $in: dateStrs } }).sort({ createdAt: 1 }),
    ])

    // Sana bo'yicha guruhlash
    const mealsByDate = {}
    for (const m of allMeals) (mealsByDate[m.date] ||= []).push(m)
    const weightByDate = {}
    for (const w of allWeights) weightByDate[w.date] = w.weight // createdAt asc → oxirgisi (eng yangi) qoladi

    const days = dateObjs.map(({ d, str, isToday }) => {
      const meals = mealsByDate[str] || []
      const t = calcMealTotals(meals)
      return {
        date:     str,
        dayLabel: dayNames[d.getDay()],
        isToday,
        calories: Math.round(t.calories),
        protein:  Math.round(t.protein),
        fat:      Math.round(t.fat),
        carbs:    Math.round(t.carbs),
        weight:   weightByDate[str] ?? (isToday ? user.weight : null),
        target:   user.calorieTarget || 2000,
        mealsCount: meals.length,
      }
    })

    // Haftalik o'rtachalar
    const activeDays  = days.filter(d => d.calories > 0)
    const avgCalories = activeDays.length
      ? Math.round(activeDays.reduce((s, d) => s + d.calories, 0) / activeDays.length)
      : 0

    res.json({
      days,
      avgCalories,
      currentWeight:  user.weight,
      targetWeight:   user.targetWeight,
      goalDeadline:   calcGoalDeadline(user),
      calorieTarget:  user.calorieTarget || 2000,
      goal:           user.goal,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* ─── GET /api/user/logs ─────────────────────────────────────── */
router.get('/logs', auth, async (req, res) => {
  try {
    const { date } = req.query
    const filter   = { userId: req.user._id }
    if (date) filter.date = date

    const meals = await Meal.find(filter).sort({ createdAt: -1 }).limit(30)
    const totals = calcMealTotals(meals)
    res.json({ meals, totals })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* ─── POST /api/user/weight ──────────────────────────────────── */
router.post('/weight', auth, async (req, res) => {
  try {
    const { weight } = req.body
    if (!weight || weight < 20 || weight > 300) return res.status(400).json({ message: 'Noto\'g\'ri vazn' })
    const today = new Date().toISOString().split('T')[0]

    await Promise.all([
      // Har bir vazn ALOHIDA saqlanadi (ustiga yozilmaydi)
      WeightLog.create({ userId: req.user._id, weight, date: today }),
      User.findByIdAndUpdate(req.user._id, { weight }),
    ])
    res.json({ success: true, weight, date: today })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* ─── GET /api/user/weight/history ──────────────────────────── */
router.get('/weight/history', auth, async (req, res) => {
  try {
    // Eskidan yangiga (yaratilish vaqti bo'yicha) — har bir yozuvning o'zgarishini hisoblash uchun
    const raw = await WeightLog.find({ userId: req.user._id }).sort({ createdAt: 1 }).limit(60)

    const round = n => Math.round(n * 10) / 10
    const logs = raw.map((l, i) => ({
      date:   l.date,
      time:   l.createdAt,
      weight: l.weight,
      change: i === 0 ? null : round(l.weight - raw[i - 1].weight), // oldingi yozuvga nisbatan
    }))

    const startWeight   = logs.length ? logs[0].weight : (req.user.weight || null)
    const currentWeight = logs.length ? logs[logs.length - 1].weight : (req.user.weight || null)
    const totalChange   = (startWeight != null && currentWeight != null)
      ? round(currentWeight - startWeight)
      : 0

    res.json({
      logs: logs.reverse(), // eng yangisi yuqorida
      startWeight,
      currentWeight,
      totalChange,
      count: logs.length,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* ─── POST /api/user/meals ───────────────────────────────────── */
router.post('/meals', auth, async (req, res) => {
  try {
    const { foods, text } = req.body
    if (!Array.isArray(foods) || foods.length === 0) {
      return res.status(400).json({ message: 'Taom (foods) ro\'yxati bo\'sh yoki noto\'g\'ri' })
    }
    const today = new Date().toISOString().split('T')[0]
    const totals = foods.reduce((a, f) => ({
      calories: a.calories + (Number(f.calories)||0),
      protein:  a.protein  + (Number(f.protein) ||0),
      fat:      a.fat      + (Number(f.fat)      ||0),
      carbs:    a.carbs    + (Number(f.carbs)    ||0),
    }), { calories:0, protein:0, fat:0, carbs:0 })

    const meal = await new Meal({
      userId: req.user._id, text, foods, date: today,
      totalCalories: Math.round(totals.calories), totalProtein: Math.round(totals.protein),
      totalFat:      Math.round(totals.fat),      totalCarbs:   Math.round(totals.carbs),
    }).save()

    res.status(201).json({ meal })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* ─── GET /api/user/meals/history ────────────────────────────── */
router.get('/meals/history', auth, async (req, res) => {
  try {
    const meals = await Meal.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50)
    res.json({ meals })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* ─── POST /api/user/habits/:id/toggle ──────────────────────── */
router.post('/habits/:id/toggle', auth, (req, res) => res.json({ success: true }))

export default router