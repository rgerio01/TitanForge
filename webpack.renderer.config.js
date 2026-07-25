const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const dotenv = require('dotenv');
const fs = require('fs');

// Carregar variáveis de ambiente com prioridade explícita
// Ordem: .env.local > .env.production > .env.development > .env
const envFiles = ['.env.local', '.env.production', '.env.development', '.env'];
for (const envFile of envFiles) {
  if (fs.existsSync(path.resolve(__dirname, envFile))) {
    dotenv.config({ path: path.resolve(__dirname, envFile), override: false });
    console.log(`✅ Carregando variáveis de: ${envFile}`);
  }
}

// .env.efi também — para expor o EFI_PAYEE_CODE no renderer (tokenização cartão)
if (fs.existsSync(path.resolve(__dirname, '.env.efi'))) {
  dotenv.config({ path: path.resolve(__dirname, '.env.efi'), override: false });
}

// Garantir que as variáveis críticas foram carregadas
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('❌ SUPABASE_URL ou SUPABASE_ANON_KEY não encontradas nos arquivos .env!');
  process.exit(1);
}

console.log(`🔑 SUPABASE_URL: ${process.env.SUPABASE_URL?.slice(0, 30)}...`);

module.exports = {
  target: 'web',
  entry: './src/renderer/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist/renderer'),
    filename: 'bundle.js',
  },
  node: {
    __dirname: false,
    __filename: false,
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    fallback: {
      "crypto": require.resolve("crypto-browserify"),
      "stream": require.resolve("stream-browserify"),
      "util": require.resolve("util/"),
      "buffer": require.resolve("buffer/"),
      "process": require.resolve("process/browser"),
      "events": require.resolve("events/"),
      "path": require.resolve("path-browserify"),
      "url": require.resolve("url/"),
      "querystring": require.resolve("querystring-es3"),
      "http": require.resolve("stream-http"),
      "https": require.resolve("https-browserify"),
      "os": require.resolve("os-browserify/browser"),
      "assert": require.resolve("assert/"),
      "constants": require.resolve("constants-browserify"),
      "vm": require.resolve("vm-browserify"),
      "zlib": require.resolve("browserify-zlib"),
      "fs": false,
      "net": false,
      "tls": false,
      "child_process": false,
    },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: [
          'style-loader',
          'css-loader',
          {
            loader: 'postcss-loader',
            options: {
              postcssOptions: {
                plugins: [
                  require('tailwindcss'),
                  require('autoprefixer'),
                ],
              },
            },
          },
        ],
      },
      {
        test: /\.(png|jpg|jpeg|gif|svg)$/,
        type: 'asset/resource',
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/renderer/index.html',
    }),
    new webpack.ProvidePlugin({
      process: 'process/browser',
      Buffer: ['buffer', 'Buffer'],
    }),
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
      'process.env.SUPABASE_URL': JSON.stringify(process.env.SUPABASE_URL),
      'process.env.SUPABASE_ANON_KEY': JSON.stringify(process.env.SUPABASE_ANON_KEY),
      'process.env.EFI_PAYEE_CODE': JSON.stringify(process.env.EFI_PAYEE_CODE || ''),
      'global.GENTLY': false,
    }),
    new webpack.NormalModuleReplacementPlugin(/node:/, (resource) => {
      resource.request = resource.request.replace(/^node:/, '');
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: 'assets',
          to: 'assets',
          noErrorOnMissing: true,
        },
        {
          from: 'games.json',
          to: 'games.json',
          noErrorOnMissing: false,
        },
      ],
    }),
  ],
  externals: {
    'electron': 'commonjs electron',
  },
  devServer: {
    port: 3000,
    hot: true,
  },
};
