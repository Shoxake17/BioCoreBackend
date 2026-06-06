// src/services/ingredientsStore.js
// Uy mahsulotlarini MongoDB (User.homeIngredients) da saqlash.
// ChromaDB EMAS — bu oddiy, ishonchli va doim ishlaydigan saqlash.
// Mantiq: yangi mahsulotlar eskisi bilan BIRLASHTIRILADI, takrorlanganlar tozalanadi.

import User from '../models/User.js'

// Matnni alohida mahsulotlarga ajratish (vergul / yangi qator / nuqta-vergul bo'yicha)
export function parseItems(text) {
  return (text || '')
    .split(/[,\n;]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

// Eski massiv + yangi matnni birlashtirish, takrorlanmaslik (case-insensitive)
export function mergeItems(oldArr = [], newText = '') {
  const seen = new Set()
  const out  = []
  for (const item of [...(oldArr || []), ...parseItems(newText)]) {
    const key = item.toLowerCase()
    if (!seen.has(key)) { seen.add(key); out.push(item) }
  }
  return out
}

// AI prompt uchun mahsulotlarni matn ko'rinishida olish (req.user'dan, qo'shimcha so'rovsiz)
export function ingredientsText(user) {
  return (user?.homeIngredients || []).join(', ')
}

// Yangi mahsulotlarni qo'shish (merge) va MongoDB'ga saqlash
export async function addIngredients(userId, text) {
  const user   = await User.findById(userId).select('homeIngredients')
  const merged = mergeItems(user?.homeIngredients || [], text)
  await User.findByIdAndUpdate(userId, { homeIngredients: merged })
  return merged
}
