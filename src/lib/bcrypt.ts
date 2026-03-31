type BcryptLike = {
  hash(
    data: string,
    saltOrRounds: string | number,
    callback: (err: unknown, encrypted: string) => void
  ): void
  compare(
    data: string,
    encrypted: string,
    callback: (err: unknown, same: boolean) => void
  ): void
}

let bcryptPromise: Promise<BcryptLike> | undefined

async function loadBcrypt(): Promise<BcryptLike> {
  if (!bcryptPromise) {
    bcryptPromise = (async () => {
      try {
        const mod: any = await import('bcrypt')
        return (mod?.default ?? mod) as BcryptLike
      } catch {
        const mod: any = await import('bcryptjs')
        return (mod?.default ?? mod) as BcryptLike
      }
    })()
  }
  return bcryptPromise
}

export async function hash(data: string, saltOrRounds: string | number): Promise<string> {
  const bcrypt = await loadBcrypt()
  return await new Promise<string>((resolve, reject) => {
    bcrypt.hash(data, saltOrRounds, (err, encrypted) => {
      if (err) reject(err)
      else resolve(encrypted)
    })
  })
}

export async function compare(data: string, encrypted: string): Promise<boolean> {
  const bcrypt = await loadBcrypt()
  return await new Promise<boolean>((resolve, reject) => {
    bcrypt.compare(data, encrypted, (err, same) => {
      if (err) reject(err)
      else resolve(same)
    })
  })
}

