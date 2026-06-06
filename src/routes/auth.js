import express from 'express'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { auth } from '../middleware/auth.js'

const router = express.Router()

const signToken = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' })

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password, gender } = req.body
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ message: 'Majburiy maydonlar to\'ldirilmagan' })
    }
    const exists = await User.findOne({ email })
    if (exists) return res.status(400).json({ message: 'Bu email allaqachon ro\'yxatdan o\'tgan' })

    const user = new User({ firstName, lastName, email, phone, password, gender })
    await user.save()

    const token = signToken(user._id)
    res.status(201).json({ token, user: user.toPublic() })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body
    const user = await User.findOne({ email })
    if (!user) return res.status(400).json({ message: 'Email yoki parol noto\'g\'ri' })

    const valid = await user.comparePassword(password)
    if (!valid) return res.status(400).json({ message: 'Email yoki parol noto\'g\'ri' })

    const token = signToken(user._id)
    res.json({ token, user: user.toPublic() })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/auth/me
router.get('/me', auth, (req, res) => {
  res.json({ user: req.user })
})

export default router
