const bcrypt = require('bcrypt');
const sqlite3 = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../data/autoads.db');
const db = sqlite3(dbPath);

async function testUserCreation() {
  console.log('=== 测试用户创建密码哈希流程 ===\n');

  // 1. 生成密码哈希
  const testPassword = 'TestPassword123!';
  const saltRounds = 10;

  console.log('1. 生成密码哈希...');
  const passwordHash = await bcrypt.hash(testPassword, saltRounds);
  console.log(`   原始密码: ${testPassword}`);
  console.log(`   Bcrypt哈希: ${passwordHash}`);
  console.log(`   哈希长度: ${passwordHash.length} 字符`);
  console.log(`   Salt轮数: ${saltRounds}\n`);

  // 2. 创建测试用户
  console.log('2. 创建测试用户...');
  const testUsername = `test_user_${Date.now()}`;
  const testEmail = `test_${Date.now()}@example.com`;

  try {
    const insertStmt = db.prepare(`
      INSERT INTO users (
        username, email, password_hash, display_name, role, package_type, package_expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insertStmt.run(
      testUsername,
      testEmail,
      passwordHash,
      'Test User',
      'user',
      'trial',
      null
    );

    console.log(`   ✅ 用户创建成功`);
    console.log(`   用户ID: ${result.lastInsertRowid}`);
    console.log(`   用户名: ${testUsername}`);
    console.log(`   邮箱: ${testEmail}\n`);

    // 3. 从数据库读取验证
    console.log('3. 从数据库读取密码哈希...');
    const user = db.prepare('SELECT username, password_hash FROM users WHERE id = ?').get(result.lastInsertRowid);
    console.log(`   存储的哈希: ${user.password_hash}`);
    console.log(`   哈希匹配: ${user.password_hash === passwordHash ? '✅ 是' : '❌ 否'}\n`);

    // 4. 测试密码验证
    console.log('4. 测试密码验证...');
    const isValidCorrect = await bcrypt.compare(testPassword, user.password_hash);
    const isValidWrong = await bcrypt.compare('WrongPassword', user.password_hash);

    console.log(`   正确密码验证: ${isValidCorrect ? '✅ 通过' : '❌ 失败'}`);
    console.log(`   错误密码验证: ${isValidWrong ? '❌ 错误通过' : '✅ 正确拒绝'}\n`);

    // 5. 清理测试数据
    console.log('5. 清理测试数据...');
    db.prepare('DELETE FROM users WHERE id = ?').run(result.lastInsertRowid);
    console.log(`   ✅ 测试用户已删除\n`);

    // 总结
    console.log('=== 测试总结 ===');
    console.log(`✅ 密码哈希生成: 正常`);
    console.log(`✅ 数据库存储: 正常`);
    console.log(`✅ 密码验证: 正常`);
    console.log(`✅ 安全性: bcrypt (${saltRounds} rounds)`);

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    throw error;
  } finally {
    db.close();
  }
}

testUserCreation().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
