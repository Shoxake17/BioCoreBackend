// src/routes/tracker.js — kunlik bio-trackerlar (suv, ...)
import express     from 'express'
import DailyLog    from '../models/DailyLog.js'
import Fast        from '../models/Fast.js'
import User        from '../models/User.js'
import Measurement from '../models/Measurement.js'
import Meal        from '../models/Meal.js'
import { auth } from '../middleware/auth.js'

const router = express.Router()

const todayStr = () => new Date().toISOString().split('T')[0]

// Suv maqsadi: tana vazniga qarab (~35 ml/kg), 1.5–4 L oralig'ida
function waterGoal(user) {
  const byWeight = Math.round(((user?.weight || 70) * 35) / 50) * 50 // 50ml ga yaxlitlash
  return Math.min(4000, Math.max(1500, byWeight))
}

/* ─── GET /api/tracker/today ─────────────────────────────────── */
router.get('/today', auth, async (req, res) => {
  try {
    const date = todayStr()
    const log  = await DailyLog.findOne({ userId: req.user._id, date })
    res.json({
      date,
      water: { ml: log?.waterMl || 0, goalMl: waterGoal(req.user) },
      sleep: { hours: log?.sleepHours ?? null, quality: log?.sleepQuality || null },
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* ─── POST /api/tracker/water  { deltaMl } ───────────────────── */
router.post('/water', auth, async (req, res) => {
  try {
    const delta = Number(req.body?.deltaMl)
    if (!Number.isFinite(delta) || delta === 0) {
      return res.status(400).json({ message: 'deltaMl noto\'g\'ri' })
    }
    const date = todayStr()
    const log = await DailyLog.findOneAndUpdate(
      { userId: req.user._id, date },
      { $inc: { waterMl: delta }, $setOnInsert: { userId: req.user._id, date } },
      { upsert: true, new: true }
    )
    // Manfiy bo'lib ketmasin
    if (log.waterMl < 0) { log.waterMl = 0; await log.save() }
    res.json({ ml: log.waterMl, goalMl: waterGoal(req.user) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* ─── IF (intervalli ovqatlanish) ────────────────────────────── */
const fastView = (f) => f ? { id: f._id, startedAt: f.startedAt, targetHours: f.targetHours } : null

router.get('/fasting', auth, async (req, res) => {
  try {
    const active = await Fast.findOne({ userId: req.user._id, endedAt: null }).sort({ startedAt: -1 })
    res.json({ active: fastView(active) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/fasting/start', auth, async (req, res) => {
  try {
    const targetHours = Number(req.body?.targetHours)
    if (!Number.isFinite(targetHours) || targetHours < 1 || targetHours > 48) {
      return res.status(400).json({ message: 'targetHours 1–48 oralig\'ida bo\'lishi kerak' })
    }
    // Bittadan ortiq faol ochlik bo'lmasin — eskisini yopamiz
    await Fast.updateMany({ userId: req.user._id, endedAt: null }, { endedAt: new Date() })
    const fast = await Fast.create({ userId: req.user._id, startedAt: new Date(), targetHours })
    res.status(201).json({ active: fastView(fast) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/fasting/stop', auth, async (req, res) => {
  try {
    await Fast.updateMany({ userId: req.user._id, endedAt: null }, { endedAt: new Date() })
    res.json({ success: true, active: null })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* ─── Qo'shimchalar (vitamin/BAD) ────────────────────────────── */
// Jinsga qarab tavsiya etiladigan qo'shimchalar
function suggestSupplements(user) {
  const base = ['Vitamin D3', 'Omega-3', 'Magniy']
  if (user?.gender === 'Ayol')  return [...base, 'Temir']
  if (user?.gender === 'Erkak') return [...base, 'Rux (Zinc)']
  return base
}

router.get('/supplements', auth, async (req, res) => {
  try {
    const date = todayStr()
    const log  = await DailyLog.findOne({ userId: req.user._id, date })
    const list = req.user.supplementList || []
    const suggestions = suggestSupplements(req.user).filter(s => !list.includes(s))
    res.json({ list, taken: log?.supplementsTaken || [], suggestions })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/supplements', auth, async (req, res) => {
  try {
    const name = (req.body?.name || '').trim()
    if (!name) return res.status(400).json({ message: 'Nom kiriting' })
    await User.findByIdAndUpdate(req.user._id, { $addToSet: { supplementList: name } })
    const user = await User.findById(req.user._id).select('supplementList gender')
    res.json({ list: user.supplementList, suggestions: suggestSupplements(user).filter(s => !user.supplementList.includes(s)) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.delete('/supplements', auth, async (req, res) => {
  try {
    const name = (req.body?.name || '').trim()
    if (!name) return res.status(400).json({ message: 'Nom kiriting' })
    await User.findByIdAndUpdate(req.user._id, { $pull: { supplementList: name } })
    const date = todayStr()
    await DailyLog.updateOne({ userId: req.user._id, date }, { $pull: { supplementsTaken: name } })
    const user = await User.findById(req.user._id).select('supplementList gender')
    res.json({ list: user.supplementList, suggestions: suggestSupplements(user).filter(s => !user.supplementList.includes(s)) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/supplements/toggle', auth, async (req, res) => {
  try {
    const name = (req.body?.name || '').trim()
    if (!name) return res.status(400).json({ message: 'Nom kiriting' })
    const date = todayStr()
    let log = await DailyLog.findOne({ userId: req.user._id, date })
    if (!log) log = await DailyLog.create({ userId: req.user._id, date })
    const taken = log.supplementsTaken || []
    const idx = taken.indexOf(name)
    if (idx >= 0) taken.splice(idx, 1)
    else taken.push(name)
    log.supplementsTaken = taken
    await log.save()
    res.json({ taken: log.supplementsTaken })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* ─── Uyqu logi ──────────────────────────────────────────────── */
router.post('/sleep', auth, async (req, res) => {
  try {
    const hours   = Number(req.body?.hours)
    const quality = (req.body?.quality || '').trim() || null
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
      return res.status(400).json({ message: 'Uyqu soati 0–24 oralig\'ida bo\'lishi kerak' })
    }
    const date = todayStr()
    const log = await DailyLog.findOneAndUpdate(
      { userId: req.user._id, date },
      { $set: { sleepHours: hours, sleepQuality: quality }, $setOnInsert: { userId: req.user._id, date } },
      { upsert: true, new: true }
    )
    res.json({ sleep: { hours: log.sleepHours, quality: log.sleepQuality } })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* ─── Tana o'lchovlari ───────────────────────────────────────── */
const MEASURE_FIELDS = ['waist', 'chest', 'hip', 'arm']

router.get('/measurements', auth, async (req, res) => {
  try {
    const history  = await Measurement.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(20)
    res.json({
      latest:   history[0] || null,
      previous: history[1] || null,
      history,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/measurements', auth, async (req, res) => {
  try {
    const doc = { userId: req.user._id, date: todayStr() }
    let any = false
    for (const f of MEASURE_FIELDS) {
      const v = Number(req.body?.[f])
      if (req.body?.[f] !== undefined && req.body?.[f] !== '' && Number.isFinite(v) && v > 0) {
        doc[f] = v; any = true
      }
    }
    if (!any) return res.status(400).json({ message: 'Kamida bitta o\'lchov kiriting' })
    const m = await Measurement.create(doc)
    res.status(201).json({ measurement: m })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/* ─── Streak (ketma-ket faol kunlar) ─────────────────────────── */
// Faol kun = o'sha kuni kamida bitta taom qayd etilgan
const dateAt = (offset) => {
  const d = new Date(); d.setDate(d.getDate() - offset)
  return d.toISOString().split('T')[0]
}
const isNextDay = (a, b) => {
  const d = new Date(a + 'T00:00:00'); d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0] === b
}

router.get('/streak', auth, async (req, res) => {
  try {
    const meals = await Meal.find({ userId: req.user._id }).select('date').lean()
    const active = new Set(meals.map(m => m.date))

    const today = dateAt(0), yesterday = dateAt(1)
    const activeToday = active.has(today)

    // Joriy streak: bugundan (yoki kechadan) orqaga sanab
    let current = 0
    let startOffset = active.has(today) ? 0 : (active.has(yesterday) ? 1 : -1)
    if (startOffset >= 0) {
      let off = startOffset
      while (active.has(dateAt(off))) { current++; off++ }
    }

    // Rekord streak: butun tarixdagi eng uzun ketma-ketlik
    const sorted = [...active].sort()
    let best = 0, run = 0, prev = null
    for (const ds of sorted) {
      run = (prev && isNextDay(prev, ds)) ? run + 1 : 1
      if (run > best) best = run
      prev = ds
    }

    res.json({ current, best, activeToday })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router
