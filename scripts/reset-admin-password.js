const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'autoads.db');
const db = new Database(dbPath);

const newPassword = 'LYTudFbrAfTDmwvtn4+IjowdJn1AZgZyNebCjinHhjk=';
const hashedPassword = bcrypt.hashSync(newPassword, 10);

db.prepare('UPDATE users SET password = ? WHERE username = ?').run(hashedPassword, 'autoads');
console.log('✅ 管理员密码已重置');

const user = db.prepare('SELECT username, role FROM users WHERE username = ?').get('autoads');
console.log('👤 管理员账号:', user);

db.close();
