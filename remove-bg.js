const { removeBackground } = require('@imgly/background-removal-node');
const fs = require('fs');
const path = require('path');

async function main() {
  const inputPath = path.join(__dirname, 'public', 'assets', 'lobby_char.png');
  const outputPath = path.join(__dirname, 'public', 'assets', 'lobby_char_transparent.png');
  
  console.log('Removing background...');
  
  try {
    const blob = await removeBackground(inputPath);
    const buffer = Buffer.from(await blob.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    console.log('Successfully saved to', outputPath);
  } catch (err) {
    console.error('Error removing background:', err);
  }
}

main();
