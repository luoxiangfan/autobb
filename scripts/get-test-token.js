#!/usr/bin/env node

// Generate a test token for automated testing
const { generateToken } = require('../src/lib/jwt')
const { getDatabase } = require('../src/lib/db')

// Get the first active user from the database
const db = getDatabase()
const user = db.prepare('SELECT * FROM users WHERE is_active = 1 LIMIT 1').get()

if (!user) {
  console.error('No active user found in database')
  process.exit(1)
}

// Generate JWT token
const token = generateToken({
  userId: user.id,
  email: user.email,
  role: user.role,
  packageType: user.package_type,
})

console.log(token)
