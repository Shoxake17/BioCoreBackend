// src/models/DailyLog.js
// Kunlik bio-trackerlar uchun yagona hujjat (har user + har kun uchun bitta).
// Kelajakda kengaytiriladi: supplementsTaken, mood, sleepHours, steps va h.k.
import mongoose from 'mongoose'

const dailyLogSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date:    { type: String, required: true }, // YYYY-MM-DD
  waterMl: { type: Number, default: 0 },
  supplementsTaken: { type: [String], default: [] }, // bugun qabul qilingan qo'shimchalar
  sleepHours:   { type: Number, default: null },      // o'tgan tunda necha soat uxladi
  sleepQuality: { type: String, default: null },      // 'Yaxshi' | "O'rta" | 'Yomon'
}, { timestamps: true })

// Har user + kun uchun bitta hujjat
dailyLogSchema.index({ userId: 1, date: 1 }, { unique: true })

export default mongoose.model('DailyLog', dailyLogSchema)
