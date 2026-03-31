import { SignJWT } from 'jose'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'default-secret-please-change-in-production'
)

async function generateTestToken(userId: number, email: string) {
  const payload = {
    userId,
    email,
    role: 'admin',
    packageType: 'unlimited',
  }

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET)

  console.log('Test Auth Token:')
  console.log(token)
  console.log('\nUse in cookie: auth_token=' + token)
  console.log('\nUse in curl:')
  console.log(`  -H "Cookie: auth_token=${token}"`)

  return token
}

generateTestToken(1, 'admin@autoads.local')
