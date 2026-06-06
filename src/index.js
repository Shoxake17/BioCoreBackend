// server.js
// MUHIM: env o'zgaruvchilarini ENG BIRINCHI yuklaymiz (boshqa importlardan oldin).
import './config/env.js'

import express from 'express'
import cors from 'cors'
import mongoose from 'mongoose'
import authRoutes from './routes/auth.js'
import userRoutes from './routes/user.js'
import aiRoutes from './routes/ai.js'
import trackerRoutes from './routes/tracker.js'

const app = express()

// Middleware
app.use(cors({ origin: '*', credentials: true }))
app.use(express.json({ limit: '12mb' })) // rasm (base64) yuborish uchun

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/user', userRoutes)
app.use('/api/ai', aiRoutes)
app.use('/api/tracker', trackerRoutes)

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() })
})

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ message: err.message || 'Server xatosi' })
})

const PORT = process.env.PORT || 5000

// Serverni ishga tushirish
function startServer(isDbConnected = true) {
  app.listen(PORT, () => {
    const dbStatus = isDbConnected ? "MongoDB ulandi" : "DB'siz"
    console.log(`🚀 BioCoreAI Server (${dbStatus}) http://localhost:${PORT} da ishlayapti`)
  })
}

// Connect DB & start
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB ulandi')
    startServer(true)
  })
  .catch(err => {
    console.error('❌ MongoDB ulanmadi:', err.message)
    // Start without DB for development
    startServer(false)
  })

export default app