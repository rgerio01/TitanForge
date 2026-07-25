#!/usr/bin/env node

/**
 * VORTEX LAUNCHER - Script de Preparação para Produção
 *
 * Este script verifica e prepara o projeto para build de produção:
 * - Verifica credenciais do Supabase
 * - Remove arquivos de build antigos
 * - Verifica se há dados sensíveis expostos
 * - Prepara o ambiente para build
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Cores para output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function error(message) {
  log(`❌ ERRO: ${message}`, 'red');
}

function warning(message) {
  log(`⚠️  AVISO: ${message}`, 'yellow');
}

function success(message) {
  log(`✅ ${message}`, 'green');
}

function info(message) {
  log(`ℹ️  ${message}`, 'cyan');
}

// Verificar credenciais do Supabase
function checkSupabaseCredentials() {
  log('\n📋 Verificando credenciais do Supabase...', 'blue');

  const supabasePath = path.join(__dirname, 'src', 'renderer', 'services', 'supabase.ts');

  if (!fs.existsSync(supabasePath)) {
    error('Arquivo supabase.ts não encontrado!');
    return false;
  }

  const content = fs.readFileSync(supabasePath, 'utf8');

  // Verificar se tem credenciais padrão/desenvolvimento
  if (content.includes('localhost') || content.includes('127.0.0.1')) {
    error('Detectado URL localhost no supabase.ts!');
    log('   Por favor, substitua por sua URL de produção do Supabase.', 'red');
    return false;
  }

  if (content.includes('your-project-url-here') || content.includes('sua-url-aqui')) {
    error('Credenciais do Supabase não configuradas!');
    log('   Edite src/renderer/services/supabase.ts com suas credenciais reais.', 'red');
    return false;
  }

  // Verificar se há service role key (não deveria ter)
  if (content.includes('service_role') || content.includes('SERVICE_ROLE')) {
    error('PERIGO: Detectada Service Role Key no código!');
    log('   NUNCA use Service Role Key no frontend. Use apenas ANON KEY!', 'red');
    return false;
  }

  success('Credenciais do Supabase parecem corretas');
  return true;
}

// Limpar builds antigos
function cleanOldBuilds() {
  log('\n🧹 Limpando builds antigos...', 'blue');

  const dirsToClean = ['dist', 'release', 'out', '.webpack'];
  let cleaned = false;

  dirsToClean.forEach(dir => {
    const dirPath = path.join(__dirname, dir);
    if (fs.existsSync(dirPath)) {
      log(`   Removendo ${dir}/...`, 'yellow');
      fs.rmSync(dirPath, { recursive: true, force: true });
      cleaned = true;
    }
  });

  if (cleaned) {
    success('Builds antigos removidos');
  } else {
    info('Nenhum build antigo encontrado');
  }

  return true;
}

// Verificar arquivos sensíveis
function checkSensitiveFiles() {
  log('\n🔒 Verificando arquivos sensíveis...', 'blue');

  const sensitivePatterns = [
    { pattern: '.env', message: 'Arquivo .env encontrado (OK se não for commitado)' },
    { pattern: 'credentials.json', message: 'PERIGO: credentials.json encontrado!' },
    { pattern: 'secrets.json', message: 'PERIGO: secrets.json encontrado!' },
  ];

  let hasDanger = false;

  sensitivePatterns.forEach(({ pattern, message }) => {
    const filePath = path.join(__dirname, pattern);
    if (fs.existsSync(filePath)) {
      if (pattern.includes('.env')) {
        info(message);
      } else {
        error(message);
        hasDanger = true;
      }
    }
  });

  if (!hasDanger) {
    success('Nenhum arquivo sensível perigoso encontrado');
  }

  return !hasDanger;
}

// Verificar SQL migration
function checkSQLMigration() {
  log('\n📊 Verificando arquivo SQL...', 'blue');

  const sqlPath = path.join(__dirname, 'supabase-migration.sql');

  if (!fs.existsSync(sqlPath)) {
    warning('Arquivo supabase-migration.sql não encontrado');
    log('   Certifique-se de ter executado o SQL no Supabase!', 'yellow');
    return true; // Não bloqueia build
  }

  success('Arquivo SQL encontrado');
  info('Lembre-se: Execute o SQL no Supabase antes de distribuir!');
  return true;
}

// Verificar node_modules
function checkNodeModules() {
  log('\n📦 Verificando dependências...', 'blue');

  const nodeModulesPath = path.join(__dirname, 'node_modules');

  if (!fs.existsSync(nodeModulesPath)) {
    error('node_modules não encontrado!');
    log('   Execute: npm install', 'red');
    return false;
  }

  success('Dependências instaladas');
  return true;
}

// Main
async function main() {
  log('\n╔══════════════════════════════════════════════════╗', 'magenta');
  log('║   VORTEX LAUNCHER - PREPARAÇÃO PARA PRODUÇÃO    ║', 'magenta');
  log('╚══════════════════════════════════════════════════╝\n', 'magenta');

  const checks = [
    { name: 'Credenciais Supabase', fn: checkSupabaseCredentials },
    { name: 'Dependências', fn: checkNodeModules },
    { name: 'Arquivos Sensíveis', fn: checkSensitiveFiles },
    { name: 'SQL Migration', fn: checkSQLMigration },
    { name: 'Limpeza de Builds', fn: cleanOldBuilds },
  ];

  let allPassed = true;

  for (const check of checks) {
    const passed = check.fn();
    if (!passed) {
      allPassed = false;
    }
  }

  log('\n' + '='.repeat(50), 'blue');

  if (allPassed) {
    success('\n🎉 TUDO PRONTO PARA PRODUÇÃO!\n');
    log('Próximos passos:', 'cyan');
    log('  1. npm run build', 'white');
    log('  2. npm run package', 'white');
    log('  3. Distribua: release/Vortex-Launcher-2.0-Setup.exe\n', 'white');
  } else {
    error('\n⛔ CORRIJA OS ERROS ACIMA ANTES DE CONTINUAR!\n');
    process.exit(1);
  }
}

main().catch(err => {
  error(`Erro inesperado: ${err.message}`);
  process.exit(1);
});
