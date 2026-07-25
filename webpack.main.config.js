const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');
const fs = require('fs');
const dotenv = require('dotenv');

// Carregar credenciais dos arquivos .env em ordem de prioridade
const envFiles = ['.env.local', '.env.production', '.env.development', '.env', '.env.efi'];
for (const envFile of envFiles) {
  if (fs.existsSync(path.resolve(__dirname, envFile))) {
    dotenv.config({ path: path.resolve(__dirname, envFile), override: false });
  }
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('❌ SUPABASE_URL ou SUPABASE_ANON_KEY não encontradas!');
  process.exit(1);
}

if (!process.env.SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_KEY não encontrada! O main process precisa dela pra acessar tabelas com RLS.');
  process.exit(1);
}

if (!process.env.TITANFORGE_SUPABASE_URL || !process.env.TITANFORGE_SUPABASE_ANON_KEY) {
  console.error('❌ TITANFORGE_SUPABASE_URL ou TITANFORGE_SUPABASE_ANON_KEY não encontradas! Necessárias para validação de licença.');
  process.exit(1);
}

module.exports = {
  target: 'electron-main',
  entry: './src/main/index.ts',
  output: {
    path: path.resolve(__dirname, 'dist/main'),
    filename: 'index.js',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.SUPABASE_URL': JSON.stringify(process.env.SUPABASE_URL),
      'process.env.SUPABASE_ANON_KEY': JSON.stringify(process.env.SUPABASE_ANON_KEY),
      'process.env.SUPABASE_SERVICE_KEY': JSON.stringify(process.env.SUPABASE_SERVICE_KEY),
      // Projeto Supabase dedicado à licença/acesso. Só a anon/publishable key —
      // a tabela `licenses` não tem policy de RLS liberada, então essa chave só
      // consegue chamar as RPCs (validate_license/check_license_status/get_license_info).
      'process.env.TITANFORGE_SUPABASE_URL': JSON.stringify(process.env.TITANFORGE_SUPABASE_URL),
      'process.env.TITANFORGE_SUPABASE_ANON_KEY': JSON.stringify(process.env.TITANFORGE_SUPABASE_ANON_KEY),
      // Webhooks Discord e API keys ficam embutidos no bundle do main (que é minificado).
      // Mesmo embutidos no .exe, são MUITO mais difíceis de extrair do que estarem em texto puro
      // num repo público — e nunca devem voltar pro git.
      'process.env.DISCORD_WEBHOOK_ORDERS': JSON.stringify(process.env.DISCORD_WEBHOOK_ORDERS || ''),
      'process.env.DISCORD_WEBHOOK_REDEMPTIONS': JSON.stringify(process.env.DISCORD_WEBHOOK_REDEMPTIONS || ''),
      'process.env.DEPOTBOX_API_KEY': JSON.stringify(process.env.DEPOTBOX_API_KEY || ''),
      'process.env.GH_TOKEN': JSON.stringify(process.env.GH_TOKEN || ''),
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: 'assets',
          to: '../assets',
          noErrorOnMissing: true,
        },
      ],
    }),
  ],
  node: {
    __dirname: false,
    __filename: false,
  },
  externals: {
    'electron': 'commonjs electron',
    'regedit': 'commonjs regedit',
    'electron-updater': 'commonjs electron-updater'
  }
};
