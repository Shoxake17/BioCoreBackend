// src/models/User.js
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const userSchema = new mongoose.Schema({
  firstName:  { type: String, required: true, trim: true },
  lastName:   { type: String, required: true, trim: true },
  email:      { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone:      { type: String, trim: true },
  password:   { type: String, required: true, minlength: 6 },
  gender:     { type: String, enum: ['Erkak', 'Ayol', ''] },
  onboardingDone: { type: Boolean, default: false },

  // Onboarding data
  age:           Number,
  height:        Number,
  weight:        Number,
  goal:          { type: String, enum: ['mass_gain', 'maintain', 'fat_loss'] },
  targetWeight:  Number,
  targetTime:    String,
  activityLevel: { type: String, enum: ['sedentary', 'moderate', 'active'] },
  sleepTime:     String,
  wakeTime:      String,
  symptoms:      [String],
  hemoglobin:    String,
  tsh:           String,

  // Uy mahsulotlari (MongoDB'da saqlanadi — AI maslahat uchun, merge/dedupe bilan)
  homeIngredients: { type: [String], default: [] },

  // Foydalanuvchi qabul qiladigan qo'shimchalar ro'yxati (vitamin/BAD)
  supplementList:  { type: [String], default: [] },

  // Saqlangan 7 kunlik AI taom rejasi: { startDate, days:[...], notes }
  mealPlan:        { type: mongoose.Schema.Types.Mixed, default: null },

  // Computed targets (set after onboarding)
  calorieTarget: { type: Number, default: 2000 },
  proteinTarget: { type: Number, default: 100 },
  fatTarget:     { type: Number, default: 70 },
  carbTarget:    { type: Number, default: 250 },

  // Metabolizm ko'rsatkichlari (mifflinEngine tomonidan hisoblanadi)
  bmr:  { type: Number, default: null },
  tdee: { type: Number, default: null },
  bmi:  { type: Number, default: null },
}, { timestamps: true })

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next()
  this.password = await bcrypt.hash(this.password, 10)
  next()
})

userSchema.methods.comparePassword = function (pass) {
  return bcrypt.compare(pass, this.password)
}

userSchema.methods.toPublic = function () {
  const obj = this.toObject()
  delete obj.password
  return obj
}

export default mongoose.model('User', userSchema)