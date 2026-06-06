// src/models/Meal.js
import mongoose from 'mongoose'

const foodItemSchema = new mongoose.Schema({
  name: String,
  amount: String,
  calories: Number,
  protein: Number,
  fat: Number,
  carbs: Number,
})

const mealSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: String,
  foods: [foodItemSchema],
  totalCalories: Number,
  totalProtein: Number,
  totalFat: Number,
  totalCarbs: Number,
  date: { type: String, required: true }, // YYYY-MM-DD
}, { timestamps: true })

export default mongoose.model('Meal', mealSchema)
