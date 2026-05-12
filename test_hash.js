const bcrypt = require('bcrypt');
async function test() {
  const isMatch = await bcrypt.compare('admin123', '$2b$10$8K1p/a0dL1LXMIgoEDFrwOfMQkfAjkMBcGmFfPwkYmPz8fFk2qKGi');
  console.log('admin123 matches?', isMatch);
}
test();
