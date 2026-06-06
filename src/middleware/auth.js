import jwt from 'jsonwebtoken'
import User from '../models/User.js'

export const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '')
    if (!token) return res.status(401).json({ message: 'Token kerak' })

    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const user = await User.findById(decoded.userId).select('-password')
    if (!user) return res.status(401).json({ message: 'Foydalanuvchi topilmadi' })

    req.user = user
    next()
  } catch (err) {
    res.status(401).json({ message: 'Token noto\'g\'ri' })
  }
}
