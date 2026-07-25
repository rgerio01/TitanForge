const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const toIco = require('to-ico');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const ICONS_DIR = path.join(ASSETS_DIR, 'icons');
const LOGO_PATH = path.join(ASSETS_DIR, 'logo.png');

// Criar pasta icons se não existir
if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
}

console.log('🎨 Iniciando geração de ícones...\n');

// Verificar se logo.png existe
if (!fs.existsSync(LOGO_PATH)) {
  console.error('❌ Erro: assets/logo.png não encontrado!');
  process.exit(1);
}

async function generateIcons() {
  try {
    // 1. Gerar icon.png (1024x1024 base)
    console.log('📐 Gerando icon.png (1024x1024)...');
    await sharp(LOGO_PATH)
      .resize(1024, 1024, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(path.join(ICONS_DIR, 'icon.png'));
    console.log('✅ icon.png gerado!\n');

    // 2. Gerar múltiplas resoluções para .ico
    console.log('🪟 Gerando icon.ico (Windows)...');
    const icoSizes = [16, 24, 32, 48, 64, 128, 256];
    const icoBuffers = [];

    for (const size of icoSizes) {
      console.log(`  Gerando ${size}x${size}...`);
      const buffer = await sharp(LOGO_PATH)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toBuffer();
      icoBuffers.push(buffer);
    }

    // Combinar em .ico
    const ico = await toIco(icoBuffers);
    fs.writeFileSync(path.join(ICONS_DIR, 'icon.ico'), ico);
    console.log('✅ icon.ico gerado!\n');

    // 3. Gerar icon.icns (macOS)
    // Nota: Geração de .icns requer ferramentas específicas do macOS
    // Por simplicidade, vamos gerar PNGs e instruir usuário a usar ferramenta online
    console.log('🍎 Preparando arquivos para icon.icns (macOS)...');
    const icnsSizes = [16, 32, 64, 128, 256, 512, 1024];
    const icnsTempDir = path.join(ICONS_DIR, 'icns_temp');

    if (!fs.existsSync(icnsTempDir)) {
      fs.mkdirSync(icnsTempDir, { recursive: true });
    }

    for (const size of icnsSizes) {
      console.log(`  Gerando icon_${size}x${size}.png...`);
      await sharp(LOGO_PATH)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toFile(path.join(icnsTempDir, `icon_${size}x${size}.png`));
    }

    console.log('\n⚠️ NOTA: Geração de .icns requer macOS ou ferramenta externa.');
    console.log('Opções:');
    console.log('  1. Se estiver no macOS: Use iconutil');
    console.log('  2. Use https://cloudconvert.com/png-to-icns');
    console.log('  3. Use https://iconverticons.com/online/');
    console.log(`\nArquivos PNG preparados em: ${icnsTempDir}`);
    console.log('Faça upload do icon_1024x1024.png em uma das ferramentas acima.\n');

    // Copiar o 1024x1024 como .icns temporário (placeholder)
    fs.copyFileSync(
      path.join(icnsTempDir, 'icon_1024x1024.png'),
      path.join(ICONS_DIR, 'icon.icns')
    );
    console.log('✅ icon.icns (placeholder) criado - SUBSTITUA com versão real!\n');

    console.log('🎉 Geração de ícones concluída!');
    console.log(`\nÍcones salvos em: ${ICONS_DIR}`);
    console.log('  - icon.png ✅');
    console.log('  - icon.ico ✅');
    console.log('  - icon.icns ⚠️ (substitua com versão real)');

  } catch (error) {
    console.error('❌ Erro ao gerar ícones:', error);
    process.exit(1);
  }
}

generateIcons();
