#!/usr/bin/env node
/**
 * Docker 容器启动时的数据库初始化脚本
 * 检查数据库是否已初始化，如果没有则执行初始化
 */

import postgres from 'postgres';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import crypto from 'crypto';
import { hashPassword } from '../src/lib/crypto.js';
import { splitSqlStatements } from '../src/lib/sql-splitter';

const DATABASE_URL = process.env.DATABASE_URL;
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD;
const STARTUP_MIGRATION_LOCK_TIMEOUT_MS = parsePositiveInt(
  process.env.STARTUP_MIGRATION_LOCK_TIMEOUT_MS,
  5000
);
const STARTUP_MIGRATION_STATEMENT_TIMEOUT_MS = parsePositiveInt(
  process.env.STARTUP_MIGRATION_STATEMENT_TIMEOUT_MS,
  30000
);
const STARTUP_MIGRATION_MAX_DURATION_MS = parsePositiveInt(
  process.env.STARTUP_MIGRATION_MAX_DURATION_MS,
  90000
);
const STARTUP_MIGRATION_SKIP = parseCsvSet(process.env.STARTUP_MIGRATION_SKIP);

if (!DATABASE_URL) {
  console.error('❌ 错误: DATABASE_URL 环境变量未设置');
  process.exit(1);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseCsvSet(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  );
}

/**
 * 从 DATABASE_URL 中提取数据库名和基础连接字符串
 * 例如: postgresql://user:pass@host:port/autoads -> { dbName: 'autoads', baseUrl: 'postgresql://user:pass@host:port/postgres' }
 * 如果URL末尾没有数据库名，默认使用'postgres'
 */
function parseDatabaseUrl(url: string): { dbName: string; baseUrl: string } {
  // 匹配带数据库名的URL: postgresql://user:pass@host:port/dbname
  const matchWithDb = url.match(/^(postgresql?:\/\/[^/]+)\/([^/?]+)(\?.*)?$/);
  if (matchWithDb) {
    const [, baseWithoutDb, dbName, queryString = ''] = matchWithDb;
    return {
      dbName,
      baseUrl: `${baseWithoutDb}/postgres${queryString}`,
    };
  }

  // 匹配不带数据库名的URL: postgresql://user:pass@host:port/ 或 postgresql://user:pass@host:port
  const matchWithoutDb = url.match(/^(postgresql?:\/\/[^/]+)\/?(\?.*)?$/);
  if (matchWithoutDb) {
    const [, baseWithoutDb, queryString = ''] = matchWithoutDb;
    console.log('⚠️  DATABASE_URL未指定数据库名，使用默认数据库: postgres');
    return {
      dbName: 'postgres',  // 默认使用postgres数据库
      baseUrl: `${baseWithoutDb}/postgres${queryString}`,
    };
  }

  throw new Error('无效的 DATABASE_URL 格式');
}

/**
 * 检查目标数据库是否存在
 */
async function checkDatabaseExists(sql: ReturnType<typeof postgres>, dbName: string): Promise<boolean> {
  const result = await sql`
    SELECT 1 FROM pg_database WHERE datname = ${dbName}
  `;
  return result.length > 0;
}

/**
 * 创建目标数据库
 */
async function createDatabase(sql: ReturnType<typeof postgres>, dbName: string): Promise<void> {
  console.log(`📦 创建数据库: ${dbName}...`);
  await sql.unsafe(`CREATE DATABASE "${dbName}"`);
  console.log(`✅ 数据库 ${dbName} 创建成功`);
}

async function waitForDatabase(sql: ReturnType<typeof postgres>, maxRetries = 30): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      // 🔥 FIX: 添加查询超时保护
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Query timeout')), 3000)
      );
      await Promise.race([sql`SELECT 1`, timeoutPromise]);
      console.log(`✅ 数据库连接成功 (尝试 ${i + 1}/${maxRetries})`);
      return true;
    } catch (error) {
      console.log(`⏳ 等待数据库就绪... (${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return false;
}

async function checkDatabaseInitialized(sql: ReturnType<typeof postgres>): Promise<boolean> {
  try {
    // 检查多个核心表是否存在，确保数据库完整初始化
    const coreTables = ['users', 'offers', 'ad_creatives', 'campaigns', 'prompt_versions'];

    const result = await sql`
      SELECT COUNT(*) as count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY(${coreTables})
    `;

    const existingTables = parseInt(result[0].count);
    const allTablesExist = existingTables === coreTables.length;

    if (existingTables > 0 && !allTablesExist) {
      console.log(`⚠️  数据库部分初始化: ${existingTables}/${coreTables.length} 核心表存在`);
    }

    return allTablesExist;
  } catch (error) {
    return false;
  }
}

async function initializeDatabase(sql: ReturnType<typeof postgres>): Promise<void> {
  // 支持本地开发和 Docker 容器两种路径
  const possiblePaths = [
    resolve('/app/pg-migrations/000_init_schema_consolidated.pg.sql'),  // Docker 容器（推荐）
    resolve(__dirname, '../pg-migrations/000_init_schema_consolidated.pg.sql'),  // 本地开发（推荐）
    resolve(process.cwd(), 'pg-migrations/000_init_schema_consolidated.pg.sql'),  // 当前目录（推荐）

    // 兼容旧版本文件名
    resolve('/app/pg-migrations/000_init_schema_v2.pg.sql'),
    resolve(__dirname, '../pg-migrations/000_init_schema_v2.pg.sql'),
    resolve(process.cwd(), 'pg-migrations/000_init_schema_v2.pg.sql'),
  ];

  let migrationPath = '';
  for (const path of possiblePaths) {
    if (existsSync(path)) {
      migrationPath = path;
      break;
    }
  }

  if (!migrationPath) {
    throw new Error(`找不到迁移文件，尝试过以下路径:\n${possiblePaths.join('\n')}`);
  }

  console.log(`📄 使用迁移文件: ${migrationPath}`);

  const migration = readFileSync(migrationPath, 'utf8');

  // 🔥 FIX: 添加SQL执行超时保护（5分钟）
  console.log('⏳ 执行数据库初始化SQL（最多5分钟）...');
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('SQL execution timeout after 5m')), 300000)
  );

  await Promise.race([sql.unsafe(migration), timeoutPromise]);

  console.log('✅ 数据库初始化完成');
}

function calculateFileHash(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

async function ensureMigrationHistorySchema(sql: ReturnType<typeof postgres>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS migration_history (
      id SERIAL PRIMARY KEY,
      migration_name TEXT NOT NULL UNIQUE,
      file_hash TEXT,
      executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'migration_history'
          AND column_name = 'file_hash'
      ) THEN
        ALTER TABLE migration_history ADD COLUMN file_hash TEXT;
      END IF;
    END $$;
  `);

  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'migration_history'
          AND column_name = 'executed_at'
      ) THEN
        ALTER TABLE migration_history ADD COLUMN executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      END IF;
    END $$;
  `);
}

function isIgnorablePostgresMigrationError(errorMessage: string): boolean {
  return (
    errorMessage.includes('already exists') ||
    errorMessage.includes('duplicate key value violates unique constraint')
  );
}

async function runPendingMigrations(sql: ReturnType<typeof postgres>): Promise<void> {
  const startedAt = Date.now();
  const possiblePaths = [
    resolve('/app/pg-migrations'),
    resolve(__dirname, '../pg-migrations'),
    resolve(process.cwd(), 'pg-migrations'),
  ];

  const migrationsPath = possiblePaths.find(p => existsSync(p));
  if (!migrationsPath) {
    console.log(`⚠️  增量迁移目录不存在，跳过:\n${possiblePaths.join('\n')}`);
    return;
  }

  await ensureMigrationHistorySchema(sql);

  const appliedRows = await sql<{ migration_name: string; file_hash: string | null }[]>`
    SELECT migration_name, file_hash
    FROM migration_history
  `;
  const applied = new Map<string, string | null>(
    appliedRows.map((row: { migration_name: string; file_hash: string | null }) => [
      row.migration_name,
      row.file_hash,
    ])
  );

  const migrationFiles = readdirSync(migrationsPath)
    .filter(name => name.endsWith('.pg.sql'))
    .filter(name => !name.startsWith('000_'))
    .sort();

  if (migrationFiles.length === 0) {
    console.log('📋 未发现增量迁移文件');
    return;
  }

  const pending: Array<{ file: string; hash: string; reason: 'new' | 'changed' }> = [];
  for (const file of migrationFiles) {
    const content = readFileSync(resolve(migrationsPath, file), 'utf8');
    const hash = calculateFileHash(content);
    const recorded = applied.get(file);
    if (recorded == null) {
      pending.push({ file, hash, reason: 'new' });
      continue;
    }
    if (recorded !== hash) {
      pending.push({ file, hash, reason: 'changed' });
    }
  }

  if (pending.length === 0) {
    console.log('✅ 增量迁移已是最新状态');
    return;
  }

  console.log(`⏱️  增量迁移执行配置: lock_timeout=${STARTUP_MIGRATION_LOCK_TIMEOUT_MS}ms, statement_timeout=${STARTUP_MIGRATION_STATEMENT_TIMEOUT_MS}ms, budget=${STARTUP_MIGRATION_MAX_DURATION_MS}ms`);

  if (STARTUP_MIGRATION_SKIP.size > 0) {
    console.log(`⚙️  启动阶段跳过迁移配置: ${Array.from(STARTUP_MIGRATION_SKIP).join(', ')}`);
  }

  const skipped = pending.filter(item => STARTUP_MIGRATION_SKIP.has(item.file));
  const pendingToRun = pending.filter(item => !STARTUP_MIGRATION_SKIP.has(item.file));

  if (skipped.length > 0) {
    console.log(`⏭️  启动阶段跳过 ${skipped.length} 个迁移（由 STARTUP_MIGRATION_SKIP 指定）`);
    for (const item of skipped) {
      console.log(`   - ${item.file}`);
    }
  }

  if (pendingToRun.length === 0) {
    console.log('✅ 待执行迁移已全部按策略跳过，启动继续');
    return;
  }

  console.log(`📦 发现 ${pendingToRun.length} 个待执行增量迁移`);
  for (const item of pendingToRun) {
    const reasonLabel = item.reason === 'new' ? 'new' : 'changed';
    console.log(`   - ${item.file} (${reasonLabel})`);
  }

  for (const item of pendingToRun) {
    const elapsedBeforeRun = Date.now() - startedAt;
    if (elapsedBeforeRun > STARTUP_MIGRATION_MAX_DURATION_MS) {
      throw new Error(
        `启动阶段增量迁移超时（已用时${elapsedBeforeRun}ms，预算${STARTUP_MIGRATION_MAX_DURATION_MS}ms），终止启动`
      );
    }

    const migrationPath = resolve(migrationsPath, item.file);
    const sqlContent = readFileSync(migrationPath, 'utf8');
    const statements = splitSqlStatements(sqlContent);

    console.log(`🔄 执行增量迁移: ${item.file}`);
    try {
      await sql.begin(async tx => {
        await tx.unsafe(`SET LOCAL lock_timeout = '${STARTUP_MIGRATION_LOCK_TIMEOUT_MS}ms'`);
        await tx.unsafe(`SET LOCAL statement_timeout = '${STARTUP_MIGRATION_STATEMENT_TIMEOUT_MS}ms'`);

        for (const stmt of statements) {
          const trimmed = stmt.trim();
          if (!trimmed) continue;
          try {
            await tx.savepoint(async sp => {
              await sp.unsafe(trimmed);
            });
          } catch (error: any) {
            const errorMsg = error?.message ? String(error.message) : String(error);
            if (isIgnorablePostgresMigrationError(errorMsg)) {
              console.log(`   ⏭️  跳过幂等语句: ${trimmed.substring(0, 80)}...`);
              continue;
            }

            if (errorMsg.includes('canceling statement due to lock timeout')) {
              throw new Error(`语句触发 lock_timeout(${STARTUP_MIGRATION_LOCK_TIMEOUT_MS}ms): ${trimmed.substring(0, 120)}...`);
            }
            if (errorMsg.includes('canceling statement due to statement timeout')) {
              throw new Error(`语句触发 statement_timeout(${STARTUP_MIGRATION_STATEMENT_TIMEOUT_MS}ms): ${trimmed.substring(0, 120)}...`);
            }

            throw error;
          }
        }

        await tx.unsafe(
          `
            INSERT INTO migration_history (migration_name, file_hash, executed_at)
            VALUES ($1, $2, CURRENT_TIMESTAMP)
            ON CONFLICT (migration_name) DO UPDATE SET
              file_hash = EXCLUDED.file_hash,
              executed_at = CURRENT_TIMESTAMP
          `,
          [item.file, item.hash]
        );
      });
    } catch (error: any) {
      const errorMsg = error?.message ? String(error.message) : String(error);
      throw new Error(`增量迁移失败: ${item.file}\n${errorMsg}`);
    }

    console.log(`✅ 增量迁移完成: ${item.file}`);
  }
}

async function ensureAdminAccount(sql: ReturnType<typeof postgres>): Promise<void> {
  if (!DEFAULT_ADMIN_PASSWORD) {
    console.log('⚠️  警告: DEFAULT_ADMIN_PASSWORD 未设置，跳过管理员账号初始化');
    return;
  }

  console.log('👤 检查管理员账号...');

  // 检查管理员是否存在
  const existingAdmin = await sql`
    SELECT id, username, email FROM users WHERE username = 'autoads'
  `;

  const passwordHash = await hashPassword(DEFAULT_ADMIN_PASSWORD);

  if (existingAdmin.length === 0) {
    // 创建新管理员
    console.log('➕ 管理员账号不存在，正在创建...');

    await sql`
      INSERT INTO users (
        username, email, password_hash, display_name, role,
        package_type, package_expires_at, must_change_password,
        is_active, created_at, updated_at
      ) VALUES (
        'autoads', 'admin@autoads.com', ${passwordHash}, 'AutoAds Administrator', 'admin',
        'lifetime', '2099-12-31 23:59:59', false,
        true, NOW(), NOW()
      )
    `;

    console.log('✅ 管理员账号创建成功');
    console.log('   用户名: autoads');
    console.log('   邮箱: admin@autoads.com');
  } else {
    // 重置密码
    console.log('🔄 管理员账号已存在，正在重置密码...');

    await sql`
      UPDATE users SET password_hash = ${passwordHash}, updated_at = NOW()
      WHERE username = 'autoads'
    `;

    console.log('✅ 管理员密码已重置');
  }
}

/**
 * 安全关闭数据库连接（带超时保护）
 */
async function safeCloseConnection(sql: ReturnType<typeof postgres>, name: string): Promise<void> {
  try {
    console.log(`🔌 关闭${name}连接...`);
    const closePromise = sql.end({ timeout: 5 });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection close timeout')), 6000)
    );
    await Promise.race([closePromise, timeoutPromise]);
    console.log(`✅ ${name}连接已关闭`);
  } catch (error) {
    console.warn(`⚠️  ${name}连接关闭超时，强制继续`);
  }
}

async function main() {
  console.log('========================================');
  console.log('🚀 AutoAds 数据库初始化');
  console.log('========================================');
  console.log('');
  console.log('📦 数据库类型: PostgreSQL');

  // 🔥 FIX: 添加整体超时保护（2分钟）
  const TOTAL_TIMEOUT = 120000; // 2分钟
  const startTime = Date.now();

  // 解析 DATABASE_URL 获取数据库名
  const { dbName, baseUrl } = parseDatabaseUrl(DATABASE_URL!);
  console.log(`🎯 目标数据库: ${dbName}`);
  console.log(`⏱️  初始化超时限制: ${TOTAL_TIMEOUT / 1000}秒`);
  console.log('🔗 连接到 PostgreSQL 服务器...');

  // 首先连接到默认的 postgres 数据库，检查目标数据库是否存在
  const adminSql = postgres(baseUrl, {
    connect_timeout: 10,
    idle_timeout: 20,
    max_lifetime: 60
  });

  let targetSql: ReturnType<typeof postgres> | null = null;

  try {
    // 等待数据库服务器可用
    const serverReady = await waitForDatabase(adminSql);
    if (!serverReady) {
      console.error('❌ 错误: 无法连接到 PostgreSQL 服务器（30秒超时）');
      process.exit(1);
    }

    // 检查目标数据库是否存在
    console.log(`🔍 检查数据库 ${dbName} 是否存在...`);
    const dbExists = await checkDatabaseExists(adminSql, dbName);

    if (!dbExists) {
      await createDatabase(adminSql, dbName);
    } else {
      console.log(`✅ 数据库 ${dbName} 已存在`);
    }

    // 关闭管理连接
    await safeCloseConnection(adminSql, '管理');

    // 检查是否超时
    const elapsed = Date.now() - startTime;
    if (elapsed > TOTAL_TIMEOUT) {
      throw new Error(`初始化超时（已用时${elapsed}ms）`);
    }

    // 连接到目标数据库
    console.log(`🔗 连接到数据库 ${dbName}...`);
    targetSql = postgres(DATABASE_URL!, {
      connect_timeout: 10,
      idle_timeout: 20,
      max_lifetime: 60
    });

    // 等待目标数据库可用
    const connected = await waitForDatabase(targetSql);
    if (!connected) {
      console.error('❌ 错误: 无法连接到目标数据库（30秒超时）');
      process.exit(1);
    }

    // 检查数据库是否已初始化
    console.log('🔍 检查数据库表结构...');
    const initialized = await checkDatabaseInitialized(targetSql);

    if (!initialized) {
      console.log('📋 数据库未初始化，开始初始化...');
      await initializeDatabase(targetSql);
    } else {
      console.log('✅ 数据库表结构已初始化');
    }

    console.log('🔄 检查并执行增量迁移...');
    await runPendingMigrations(targetSql);
    console.log('✅ 增量迁移检查完成');

    // 确保管理员账号存在
    await ensureAdminAccount(targetSql);

    const totalTime = Date.now() - startTime;
    console.log('');
    console.log('========================================');
    console.log(`✅ 数据库初始化完成（用时${totalTime}ms）`);
    console.log('========================================');

    await safeCloseConnection(targetSql, '目标数据库');

  } catch (error) {
    console.error('❌ 初始化失败:', (error as Error).message);
    console.error('📊 错误堆栈:', (error as Error).stack);

    // 确保连接被关闭
    if (targetSql) {
      await safeCloseConnection(targetSql, '目标数据库');
    }

    process.exit(1);
  }
}

main();
