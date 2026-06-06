// src/config/env.js
// MUHIM: bu fayl boshqa barcha modullardan OLDIN import qilinishi kerak.
// ESM importlari "hoist" bo'lgani uchun, dotenv.config() ni index.js ichida
// chaqirish kech bo'ladi — modullar process.env ni undan oldin o'qib olishi mumkin.
// Shu sababli env yuklashni alohida, birinchi importga chiqaramiz.
import dotenv from 'dotenv'

dotenv.config()
