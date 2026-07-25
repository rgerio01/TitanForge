# Vortex Launcher 2.0

Launcher desktop profissional desenvolvido com Electron + TypeScript + React para gerenciamento de jogos Steam com sistema de licenciamento.

## 🚀 Características

- **Sistema de Licenciamento**: Validação via Supabase com HWID binding
- **Heartbeat System**: Verificação automática a cada 5 minutos
- **Atualização da Steam**: Download e instalação automática de arquivos
- **Interface Moderna**: Design roxo/violeta com animações suaves
- **Segurança**: Remoção automática de arquivos quando licença inativa

## 📋 Pré-requisitos

- Node.js 18+ (recomendado: 20.x)
- npm ou yarn
- Steam instalada no computador

## 🔧 Instalação

1. **Instalar dependências**:
```bash
npm install
```

2. **Configurar variáveis de ambiente**:
O arquivo `.env` já está configurado com as credenciais do Supabase.

3. **Executar em modo desenvolvimento**:
```bash
npm run dev
```

4. **Build para produção**:
```bash
npm run build
```

5. **Gerar executável**:
```bash
npm run package:win
```

O executável será gerado na pasta `release/`.

## 📁 Estrutura do Projeto

```
vortex-launcher/
├── src/
│   ├── main/              # Electron main process
│   │   ├── index.ts       # Entry point do Electron
│   │   ├── hwid.ts        # Geração de HWID
│   │   ├── steam.ts       # Detecção e instalação Steam
│   │   └── download.ts    # Download do Google Drive
│   ├── preload/
│   │   └── index.ts       # Bridge entre main e renderer
│   └── renderer/          # React app
│       ├── App.tsx        # Componente principal
│       ├── pages/
│       │   ├── Login.tsx  # Tela de login
│       │   └── Launcher.tsx # Tela principal
│       ├── services/
│       │   ├── supabase.ts   # Cliente Supabase
│       │   ├── license.ts    # Lógica de licenciamento
│       │   └── heartbeat.ts  # Sistema de heartbeat
│       └── styles/
│           └── global.css    # Estilos globais
├── assets/                # Imagens e ícones
├── .env                   # Variáveis de ambiente
└── package.json
```

## 🎨 Design System

### Cores
- **Primary**: `#8B5CF6` (roxo vibrante)
- **Secondary**: `#A855F7`
- **Accent**: `#C084FC`
- **Blue**: `#3B82F6` (para CTAs)
- **Background**: `#0F172A` (dark blue)

### Tipografia
- Fonte: Inter
- Títulos: Bold, 24-32px
- Body: Regular, 14-16px

## 🔐 Sistema de Licenciamento

### Fluxo de Validação

1. **Primeira Ativação**:
   - Usuário insere chave de licença
   - Sistema verifica se a chave existe no Supabase
   - Se válida, vincula ao HWID da máquina e IP do usuário
   - Salva localmente e redireciona para o launcher

2. **Ativações Subsequentes**:
   - Sistema verifica se HWID corresponde ao registrado
   - Se corresponder, permite acesso
   - Se não, exibe mensagem de erro

3. **Heartbeat** (a cada 5 minutos):
   - Verifica status da licença no Supabase
   - Se `status = 'inactive'`: remove arquivos e faz logout

### Estrutura da Tabela `licenses` no Supabase

```sql
CREATE TABLE licenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  hwid TEXT,
  ip_address TEXT,
  first_activated_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## 🎮 Sistema de Atualização da Steam

### Fluxo de Instalação

1. Detecta automaticamente o caminho da Steam
2. Baixa `VORTEX LAUNCHER.zip` do Google Drive
3. Extrai e localiza `ARENA.zip`
4. Instala os arquivos:
   - `hid.dll` → Raiz da Steam
   - `depotcache/` → `Steam/config/depotcache`
   - `stplug-in/` → `Steam/config/stplug-in`

### Detecção da Steam

O sistema verifica:
1. Caminhos comuns (`C:\Program Files (x86)\Steam`, etc.)
2. Registro do Windows (`HKCU\Software\Valve\Steam`)

## ⚠️ Importante sobre o Google Drive

**NOTA**: O link fornecido é de uma pasta compartilhada do Google Drive. Para funcionar automaticamente, você precisa:

1. **Opção 1**: Hospedar o arquivo em um serviço com download direto (Dropbox, etc.)
2. **Opção 2**: Converter para link direto do Google Drive (somente para arquivos individuais)
3. **Opção 3**: Implementar Google Drive API com OAuth

Atualize a URL no arquivo `.env`:
```
GOOGLE_DRIVE_DIRECT_LINK=https://seu-link-direto-aqui.com/arquivo.zip
```

## 🛡️ Segurança

- Credenciais do Supabase em variáveis de ambiente
- HWID binding para prevenir compartilhamento de licenças
- Remoção automática de arquivos quando licença inativa
- Verificação periódica (heartbeat) do status da licença

## 🐛 Debugging

### Modo Desenvolvimento

O app abre com DevTools habilitado em modo desenvolvimento:
```bash
npm run dev
```

### Logs

Todos os logs importantes são exibidos no console:
- Validação de licença
- Download de arquivos
- Instalação na Steam
- Heartbeat checks

## 📦 Build e Distribuição

### Gerar executável Windows

```bash
npm run package:win
```

O executável será gerado em `release/vortex-launcher-setup-2.0.0.exe`.

### Assinatura de Código (Recomendado)

Para distribuição profissional, considere assinar o executável para evitar avisos de segurança do Windows:
1. Obtenha um certificado de assinatura de código
2. Configure no `package.json` em `build.win.certificateFile`

## 🤝 Suporte

Para suporte e dúvidas:
- Email: suporte@vortex.com
- Discord: discord.gg/vortex

## 📄 Licença

© 2024 Vortex Launcher. Todos os direitos reservados.

---

**Desenvolvido com ❤️ usando Electron, React e TypeScript**
