// src/routes/ai.js
import express     from 'express'
import Meal        from '../models/Meal.js'
import ChatMessage from '../models/ChatMessage.js'
import DailyLog    from '../models/DailyLog.js'
import WeightLog   from '../models/WeightLog.js'
import User        from '../models/User.js'
import { auth } from '../middleware/auth.js'
import { addIngredients, ingredientsText } from '../services/ingredientsStore.js'

const router   = express.Router()
const DS_URL   = 'https://api.deepseek.com/v1/chat/completions'
const DS_MODEL = 'deepseek-chat'
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct'

/* ─── DeepSeek helper ─────────────────────────────────────────── */
async function ds({ system, messages, maxTokens = 800, json = false }) {
  const body = {
    model:      DS_MODEL,
    max_tokens: maxTokens,
    temperature: json ? 0.0 : 0.7,
    messages:   system
      ? [{ role: 'system', content: system }, ...messages]
      : messages,
  }
  if (json) body.response_format = { type: 'json_object' }

  const res = await fetch(DS_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    body:    JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() || ''
}

/* ─── Groq Vision helper (rasm tahlili — bepul) ──────────────── */
async function groqVision({ prompt, dataUrl }) {
  const res = await fetch(GROQ_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      }],
      temperature: 0.2,
      max_tokens: 1200,
    }),
  })
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() || ''
}

/* ─── Meal totals helper ──────────────────────────────────────── */
function calcTotals(meals) {
  return meals.reduce((a, m) => ({
    calories: a.calories + (m.totalCalories || 0),
    protein:  a.protein  + (m.totalProtein  || 0),
    fat:      a.fat      + (m.totalFat      || 0),
    carbs:    a.carbs    + (m.totalCarbs    || 0),
  }), { calories: 0, protein: 0, fat: 0, carbs: 0 })
}

/* ─── 1. Taom tahlili ────────────────────────────────────────── */
router.post('/analyze-food', auth, async (req, res) => {
  try {
    const { text } = req.body
    if (!text?.trim()) return res.status(400).json({ message: 'Matn kiriting' })

    const responseText = await ds({
      json: true,
      messages: [{ role: 'user', content: `Sen dietolog. Quyidagi taomlarni BJU va kcal ga tahlil qil.
Matn: "${text}"
FAQAT JSON qaytар:
{"foods":[{"name":"...","amount":"...","calories":0,"protein":0.0,"fat":0.0,"carbs":0.0}]}` }],
      maxTokens: 1200,
    })

    let parsed
    try {
      parsed = JSON.parse(responseText.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim())
    } catch {
      return res.status(500).json({ message: "AI javobni tahlil qilib bo'lmadi" })
    }
    res.json({ foods: parsed.foods || [] })
  } catch (err) {
    console.error('[analyze-food]', err.message)
    res.status(500).json({ message: 'AI xizmati vaqtincha ishlamayapti' })
  }
})

/* ─── 1b. Rasmdan taom tahlili (Gemini Vision) ──────────────── */
router.post('/analyze-photo', auth, async (req, res) => {
  try {
    const { image } = req.body
    if (!image) return res.status(400).json({ message: 'Rasm yuborilmadi' })
    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({ message: "Groq API kaliti sozlanmagan (.env: GROQ_API_KEY)" })
    }
    // Groq to'liq data URL kutadi (data:image/...;base64,...)
    const dataUrl = String(image).startsWith('data:') ? image : `data:image/jpeg;base64,${image}`

    const prompt = `Sen dietolog. Rasmdagi taomlarni aniqla va har birini BJU (oqsil, yog', uglevod) va kkal ga tahlil qil.
Porsiyani rasmga qarab taxminiy baholang. FAQAT JSON qaytar, boshqa matn yozma:
{"foods":[{"name":"...","amount":"taxminiy porsiya","calories":0,"protein":0.0,"fat":0.0,"carbs":0.0}]}
Agar rasmda taom bo'lmasa: {"foods":[]}`

    const text = await groqVision({ prompt, dataUrl })

    let parsed
    try {
      parsed = JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
    } catch {
      console.error('[analyze-photo] JSON parse xato:', (text || '').slice(0, 300))
      return res.status(502).json({ message: "AI rasmni tahlil qila olmadi. Aniqroq rasm bilan urinib ko'ring." })
    }
    res.json({ foods: parsed.foods || [] })
  } catch (err) {
    console.error('[analyze-photo]', err.message)
    const isQuota = /429|rate.?limit|quota/i.test(err.message)
    res.status(isQuota ? 429 : 500).json({
      message: isQuota
        ? "Groq limiti vaqtincha to'ldi — bir daqiqadan keyin qayta urinib ko'ring."
        : `Rasm tahlili xatosi: ${err.message}`,
    })
  }
})

/* ─── 2. AI Chat — to'liq kontekst bilan ────────────────────── */
router.post('/chat', auth, async (req, res) => {
  try {
    const { message, history = [] } = req.body
    const user  = req.user
    const today = new Date().toISOString().split('T')[0]

    // Parallel data fetch (bugun + kecha taomlari)
    const [todayMeals, yesterdayMeals] = await Promise.all([
      Meal.find({ userId: user._id, date: today }),
      Meal.find({ userId: user._id, date: new Date(Date.now()-86400000).toISOString().split('T')[0] }),
    ])
    // Uy mahsulotlari — MongoDB'dan (req.user allaqachon yuklangan)
    const ingredients = ingredientsText(user)

    const todayT  = calcTotals(todayMeals)
    const yesterT = calcTotals(yesterdayMeals)
    const target  = user.calorieTarget || 2000
    const pct     = Math.round((todayT.calories / target) * 100)

    // Kecha defitsitini hisoblash
    const yesterdayDeficit = target - yesterT.calories // + = kam yedi, - = ko'p yedi

    // Bugungi qo'shimcha yoki kamaytirishni hisoblash
    let carryNote = ''
    if (Math.abs(yesterdayDeficit) > 50) {
      if (yesterdayDeficit > 0 && user.goal === 'mass_gain') {
        carryNote = `⚡ Kecha ${yesterdayDeficit} kkal kam yedingiz. Bugun +${yesterdayDeficit} kkal qo'shimcha tavsiya etiladi.`
      } else if (yesterdayDeficit < 0 && user.goal === 'fat_loss') {
        carryNote = `⚡ Kecha ${Math.abs(yesterdayDeficit)} kkal ortiqcha yedingiz. Bugun ${Math.abs(yesterdayDeficit)} kkal kamroq tavsiya etiladi.`
      }
    }

    // Ingredientlarni aniqlash — agar user ingredient haqida yozsa, saqla
    const ingredientSignals = ['uyimda', 'mahsulot bor', 'oziq-ovqat bor', "quyidagilar bor", 'productlar bor']
    if (ingredientSignals.some(kw => message.toLowerCase().includes(kw))) {
      addIngredients(user._id, message).catch(() => {})
    }

    const systemPrompt = `Sen BioCore AI — 100% professional biohacking va sog'liq maslahatchisisan.

━━ FOYDALANUVCHI PROFILI ━━
Jinsi: ${user.gender || "—"} | Yosh: ${user.age || "—"} | Bo'y: ${user.height}sm | Vazn: ${user.weight}kg
BMI: ${user.bmi || "—"} | BMR: ${user.bmr || "—"}kkal | TDEE: ${user.tdee || "—"}kkal
Maqsad: ${user.goal} | Maqsad vazn: ${user.targetWeight || "—"}kg | Muddat: ${user.targetTime || "—"}
Faollik: ${user.activityLevel} | Simptomlar: ${user.symptoms?.join(', ') || 'yo\'q'}
Gemoglobin: ${user.hemoglobin || "—"} | TSH: ${user.tsh || "—"}

━━ BUGUN (${today}) ━━
Iste'mol: ${todayT.calories}/${target} kkal (${pct}%) | Oqsil: ${Math.round(todayT.protein)}/${user.proteinTarget||100}g | Yog': ${Math.round(todayT.fat)}/${user.fatTarget||70}g | Uglevod: ${Math.round(todayT.carbs)}/${user.carbTarget||250}g
Bugungi taomlar soni: ${todayMeals.length}

━━ KECHA QOLDIQ / CARRY-OVER ━━
${carryNote || 'Kecha hisob-kitob yo\'q yoki maqsadga erishildi.'}

━━ UY MAHSULOTLARI ━━
${ingredients || 'Foydalanuvchi hali uy mahsulotlarini kiritmagan. Agar so\'rasa, "Uyimda quyidagilar bor: ..." deb yozishni tavsiya qil.'}

━━ QOIDALAR ━━
1. Uy mahsulotlaridan real retseptlar tavsiya qil — xayoliy mahsulot qo'shma.
2. Kecha defitsiti bo'lsa, bugun uchun aniq portsiyon moslash ko'rsat.
3. Maqsad (${user.goal}) va jins (${user.gender}) ga mos maslahat ber.
4. Javoblar qisqa, aniq, o'zbek tilida. Kerakli joylarda raqamlar ko'rsat.
5. Foydalanuvchi "haftalik reja" so'rasa — 7 kunlik taom jadvalini tuz.
6. MUHIM: Markdown ishlatma. Yulduzcha (*, **), # sarlavha, backtick (\`) kabi belgilarni umuman qo'llama — faqat oddiy, sodda matn yoz. Ro'yxat kerak bo'lsa har bir bandni yangi qatordan boshla.`

    const aiResponse = await ds({
      system:    systemPrompt,
      messages:  [
        ...history.slice(-6).map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: message },
      ],
      maxTokens: 700,
    })

    // Suhbat tarixini MongoDB'ga saqlaymiz
    ChatMessage.insertMany([
      { userId: user._id, role: 'user',      content: message },
      { userId: user._id, role: 'assistant', content: aiResponse },
    ]).catch(() => {})

    res.json({ message: aiResponse, meta: { todayCalories: todayT.calories, target, carryNote } })
  } catch (err) {
    console.error('[chat]', err.message)
    res.status(500).json({ message: 'AI xizmati vaqtincha ishlamayapti' })
  }
})

/* ─── 2b. Chat tarixini olish / tozalash ────────────────────── */
router.get('/chat/history', auth, async (req, res) => {
  try {
    const msgs = await ChatMessage.find({ userId: req.user._id })
      .sort({ createdAt: 1 })
      .limit(200)
    res.json({ messages: msgs.map(m => ({ role: m.role, content: m.content, time: m.createdAt })) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.delete('/chat/history', auth, async (req, res) => {
  try {
    await ChatMessage.deleteMany({ userId: req.user._id })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* ─── 3. Uy mahsulotlarini saqlash ──────────────────────────── */
router.post('/ingredients', auth, async (req, res) => {
  try {
    const { text } = req.body
    if (!text?.trim()) return res.status(400).json({ message: 'Mahsulotlarni kiriting' })
    // MongoDB'ga saqlash (eski bilan birlashtirib, takrorlanmasdan)
    const merged = await addIngredients(req.user._id, text)
    res.json({ success: true, message: 'Mahsulotlar saqlandi', ingredients: merged.join(', ') })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.get('/ingredients', auth, async (req, res) => {
  // MongoDB'dan (req.user allaqachon yuklangan)
  res.json({ ingredients: ingredientsText(req.user) })
})

/* ─── 4. Haftalik taom rejasi (SAQLANADI — 7 kunda yangilanadi) ── */
const planToday  = () => new Date().toISOString().split('T')[0]
const daysBetween = (a, b) => Math.floor((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000)

// AI orqali yangi 7 kunlik reja yaratish
async function generatePlanForUser(user) {
  const ingredients = ingredientsText(user)
  const prompt = `Sen dietolog. Quyidagi foydalanuvchi uchun 7 kunlik taom rejasi tuz.

Profil: ${user.gender}, ${user.age}yosh, ${user.weight}kg, Maqsad: ${user.goal}
Kaloriya maqsadi: ${user.calorieTarget||2000}kkal/kun | Oqsil: ${user.proteinTarget||100}g | Yog': ${user.fatTarget||70}g | Uglevod: ${user.carbTarget||250}g
Uy mahsulotlari: ${ingredients || 'Keng assortiment (oddiy mahsulotlar bilan reja tuz)'}
Simptomlar: ${user.symptoms?.join(', ') || 'yo\'q'}

JSON formatida qaytар (1-kun bugundan boshlanadi):
{"plan":[{"day":"1-kun","meals":[{"time":"07:30","name":"...","calories":0,"protein":0,"fat":0,"carbs":0}],"totalCalories":0}],"notes":"..."}`

  const responseText = await ds({ json: true, messages: [{ role: 'user', content: prompt }], maxTokens: 3500 })
  let parsed
  try {
    parsed = JSON.parse(responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
  } catch {
    throw new Error('AI reja JSON formatini buzdi')
  }
  return { days: parsed.plan || [], notes: parsed.notes || '' }
}

// Saqlangan rejani qaytaradi; reja yo'q yoki 7 kun tugagan bo'lsa — YANGISINI yaratib saqlaydi
router.get('/plan', auth, async (req, res) => {
  try {
    const user  = req.user
    const today = planToday()
    let mp = user.mealPlan
    let dayIndex = (mp && mp.startDate) ? daysBetween(mp.startDate, today) : 999

    if (!mp || !Array.isArray(mp.days) || !mp.days.length || dayIndex < 0 || dayIndex >= 7) {
      const gen = await generatePlanForUser(user)
      mp = { startDate: today, days: gen.days, notes: gen.notes }
      await User.findByIdAndUpdate(user._id, { mealPlan: mp })
      dayIndex = 0
    }
    res.json({ plan: mp.days, notes: mp.notes, startDate: mp.startDate, dayIndex, todayPlan: mp.days[dayIndex] || null })
  } catch (err) {
    console.error('[plan get]', err.message)
    res.status(500).json({ message: `Reja xatosi: ${err.message}` })
  }
})

// Foydalanuvchi "yangilash" tugmasini bosganda — MAJBURIY qayta yaratish
router.post('/plan/regenerate', auth, async (req, res) => {
  try {
    const user  = req.user
    const today = planToday()
    const gen = await generatePlanForUser(user)
    const mp = { startDate: today, days: gen.days, notes: gen.notes }
    await User.findByIdAndUpdate(user._id, { mealPlan: mp })
    res.json({ plan: mp.days, notes: mp.notes, startDate: mp.startDate, dayIndex: 0, todayPlan: mp.days[0] || null })
  } catch (err) {
    console.error('[plan regenerate]', err.message)
    res.status(500).json({ message: `Reja xatosi: ${err.message}` })
  }
})

// Faqat BUGUNGI reja (Dashboard uchun — yaratmaydi, faqat saqlangandan oladi)
router.get('/plan/today', auth, async (req, res) => {
  try {
    const mp = req.user.mealPlan
    if (!mp || !Array.isArray(mp.days) || !mp.days.length || !mp.startDate) {
      return res.json({ todayPlan: null })
    }
    const dayIndex = daysBetween(mp.startDate, planToday())
    if (dayIndex < 0 || dayIndex >= 7) return res.json({ todayPlan: null, expired: true })
    res.json({ todayPlan: mp.days[dayIndex] || null, dayIndex })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* ─── 5. Kunlik check-in ─────────────────────────────────────── */
router.get('/checkin', auth, async (req, res) => {
  try {
    const user  = req.user
    const today = new Date().toISOString().split('T')[0]
    const yStr  = new Date(Date.now() - 86400000).toISOString().split('T')[0]

    const [todayMeals, yesterdayMeals] = await Promise.all([
      Meal.find({ userId: user._id, date: today }),
      Meal.find({ userId: user._id, date: yStr }),
    ])
    const ingredients = ingredientsText(user)   // MongoDB'dan

    const todayT  = calcTotals(todayMeals)
    const yesterT = calcTotals(yesterdayMeals)
    const target  = user.calorieTarget || 2000
    const pct     = Math.round((todayT.calories / target) * 100)
    const remaining = target - todayT.calories
    // Kecha defitsiti — MongoDB taomlaridan hisoblanadi
    const yesterdayDeficit = yesterdayMeals.length ? (target - yesterT.calories) : 0

    const prompt = `Foydalanuvchi bugun ${target} kkaldan ${todayT.calories} kkal yedi (${pct}%).
${remaining > 0 ? `Yana ${remaining} kkal yeyishi kerak.` : `${Math.abs(remaining)} kkal ortiqcha yedi.`}
${yesterdayDeficit ? `Kecha defitsit: ${yesterdayDeficit} kkal.` : ''}
Uy mahsulotlari: ${ingredients || 'noma\'lum'}
Maqsad: ${user.goal}. Qisqa, do'stona eslatma va kechki taom tavsiyasi ber. O'zbek tilida.`

    const message = await ds({
      messages:  [{ role: 'user', content: prompt }],
      maxTokens: 300,
    })

    res.json({
      message,
      stats: {
        consumed: todayT.calories, target, pct, remaining,
        protein:  Math.round(todayT.protein),
        fat:      Math.round(todayT.fat),
        carbs:    Math.round(todayT.carbs),
      },
      deficit: yesterdayDeficit,
    })
  } catch (err) {
    console.error('[checkin]', err.message)
    res.status(500).json({ message: 'Xatolik' })
  }
})

/* ─── 6. Haftalik AI hisobot ─────────────────────────────────── */
router.get('/report', auth, async (req, res) => {
  try {
    const user  = req.user
    const dates = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      dates.push(d.toISOString().split('T')[0])
    }

    const [meals, logs, weights] = await Promise.all([
      Meal.find({ userId: user._id, date: { $in: dates } }),
      DailyLog.find({ userId: user._id, date: { $in: dates } }),
      WeightLog.find({ userId: user._id }).sort({ createdAt: 1 }),
    ])

    // Kaloriya: kunlik jami → o'rtacha (faqat faol kunlar)
    const calByDate = {}
    for (const m of meals) calByDate[m.date] = (calByDate[m.date] || 0) + (m.totalCalories || 0)
    const calDays = Object.values(calByDate)
    const avgCal  = calDays.length ? Math.round(calDays.reduce((a, b) => a + b, 0) / calDays.length) : 0

    // Suv / uyqu o'rtachalari
    const waters = logs.map(l => l.waterMl || 0).filter(x => x > 0)
    const avgWater = waters.length ? Math.round(waters.reduce((a, b) => a + b, 0) / waters.length) : 0
    const sleeps = logs.map(l => l.sleepHours).filter(x => x != null)
    const avgSleep = sleeps.length ? Math.round((sleeps.reduce((a, b) => a + b, 0) / sleeps.length) * 10) / 10 : null

    // Haftalik vazn o'zgarishi
    const recent   = weights[weights.length - 1]
    const baseline = weights.find(w => w.date >= dates[0]) || weights[0]
    const weightChange = (recent && baseline) ? Math.round((recent.weight - baseline.weight) * 10) / 10 : null

    const stats = { avgCal, activeDays: calDays.length, avgWaterMl: avgWater, avgSleep, weightChange, target: user.calorieTarget || 2000 }

    const prompt = `Foydalanuvchining so'nggi 7 kunlik ma'lumotlari:
- O'rtacha kunlik kaloriya: ${avgCal} kkal (maqsad: ${stats.target})
- Faol kunlar: ${stats.activeDays}/7
- O'rtacha suv: ${(avgWater / 1000).toFixed(1)} L/kun
- O'rtacha uyqu: ${avgSleep != null ? avgSleep + ' soat' : 'qayd etilmagan'}
- Haftalik vazn o'zgarishi: ${weightChange != null ? weightChange + ' kg' : 'ma\'lumot yo\'q'}
- Maqsad: ${user.goal}

Shu ma'lumotlar asosida qisqa (3-4 jumla), do'stona va motivatsion haftalik xulosa hamda 1-2 ta aniq tavsiya ber. O'zbek tilida. Markdown belgilaridan (*, #) foydalanma — faqat oddiy matn.`

    const message = await ds({ messages: [{ role: 'user', content: prompt }], maxTokens: 450 })
    res.json({ message, stats })
  } catch (err) {
    console.error('[report]', err.message)
    res.status(500).json({ message: `Hisobot xatosi: ${err.message}` })
  }
})

export default router