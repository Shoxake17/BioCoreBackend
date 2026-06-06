// src/models/Measurement.js — tana o'lchovlari snapshotlari (vaqti-vaqti bilan)
import mongoose from 'mongoose'

const measurementSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  date:   { type: String, required: true }, // YYYY-MM-DD
  waist:  { type: Number, default: null },  // bel (sm)
  chest:  { type: Number, default: null },  // ko'krak (sm)
  hip:    { type: Number, default: null },  // son/dumba (sm)
  arm:    { type: Number, default: null },  // bilak (sm)
}, { timestamps: true })

export default mongoose.model('Measurement', measurementSchema)
