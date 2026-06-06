// src/models/Fast.js — intervalli ovqatlanish (IF) sessiyalari
import mongoose from 'mongoose'

const fastSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  startedAt:   { type: Date, default: Date.now },
  targetHours: { type: Number, required: true }, // masalan 16 (16:8)
  endedAt:     { type: Date, default: null },     // null = hozir faol ochlik
}, { timestamps: true })

export default mongoose.model('Fast', fastSchema)
