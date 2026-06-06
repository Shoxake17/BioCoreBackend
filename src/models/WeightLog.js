// src/models/WeightLog.js — vazn loglari (har bir o'lchov alohida)
import mongoose from 'mongoose'

const weightLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  weight: { type: Number, required: true },
  date:   { type: String, required: true }, // YYYY-MM-DD
}, { timestamps: true })

export default mongoose.models.WeightLog || mongoose.model('WeightLog', weightLogSchema)
