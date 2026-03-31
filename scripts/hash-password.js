const bcrypt = require('bcrypt');

const password = process.argv[2] || 'LYTudFbrAfTDmwvtn4+IjowdJn1AZgZyNebCjinHhjk=';

bcrypt.hash(password, 10).then(hash => {
  console.log('Password:', password);
  console.log('Bcrypt hash:', hash);
  console.log('\nSQL command:');
  console.log(`UPDATE users SET password_hash='${hash}' WHERE username='autoads';`);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
