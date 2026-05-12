const bcrypt = require('bcrypt');
async function run() {
  console.log(await bcrypt.hash('admin123', 10));
}
run();
