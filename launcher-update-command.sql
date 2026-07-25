-- =====================================================
-- TABELA: launcher_update_config
-- Armazena o comando PowerShell para atualização do launcher
-- =====================================================

-- 1. Criar tabela se não existir
CREATE TABLE IF NOT EXISTS public.launcher_update_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comando_powershell TEXT NOT NULL DEFAULT 'iwr -useb "https://seu-servidor.com/update.ps1" | iex',
  ativo BOOLEAN DEFAULT true,
  descricao TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Inserir comando padrão (se a tabela estiver vazia)
INSERT INTO public.launcher_update_config (comando_powershell, ativo, descricao)
SELECT
  'iwr -useb "https://seu-servidor.com/update.ps1" | iex',
  true,
  'Comando padrão para atualizar o launcher'
WHERE NOT EXISTS (SELECT 1 FROM public.launcher_update_config);

-- 3. Habilitar RLS (Row Level Security)
ALTER TABLE public.launcher_update_config ENABLE ROW LEVEL SECURITY;

-- 4. Criar política de leitura (todos podem ler)
DROP POLICY IF EXISTS "Enable read access for all users" ON public.launcher_update_config;
CREATE POLICY "Enable read access for all users"
ON public.launcher_update_config
FOR SELECT
USING (ativo = true);

-- 5. Criar política de escrita (apenas autenticados)
DROP POLICY IF EXISTS "Enable write access for authenticated users only" ON public.launcher_update_config;
CREATE POLICY "Enable write access for authenticated users only"
ON public.launcher_update_config
FOR ALL
USING (true);

-- 6. Criar trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_launcher_update_config_updated_at ON public.launcher_update_config;
CREATE TRIGGER update_launcher_update_config_updated_at
    BEFORE UPDATE ON public.launcher_update_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- EXEMPLOS DE USO
-- =====================================================

-- Consultar o comando ativo atual:
-- SELECT comando_powershell FROM launcher_update_config WHERE ativo = true LIMIT 1;

-- Atualizar o comando:
-- UPDATE launcher_update_config
-- SET comando_powershell = 'iwr -useb "https://novo-servidor.com/update.ps1" | iex',
--     descricao = 'Novo servidor de atualizações'
-- WHERE ativo = true;

-- Adicionar um novo comando:
-- INSERT INTO launcher_update_config (comando_powershell, ativo, descricao)
-- VALUES (
--   'powershell -Command "Start-Process ''https://github.com/seu-repo/releases/latest''"',
--   false,
--   'Abrir página de releases do GitHub'
-- );

-- =====================================================
-- IMPORTANTE: COMANDOS POWERSHELL SEGUROS
-- =====================================================

-- ✅ RECOMENDADO: Usar iwr (Invoke-WebRequest) com script hospedado
-- Exemplo: iwr -useb "https://seu-servidor.com/update.ps1" | iex

-- ✅ ALTERNATIVA: Abrir navegador com URL de download
-- Exemplo: Start-Process "https://github.com/seu-repo/releases/latest"

-- ⚠️ CUIDADO: Nunca usar comandos que possam comprometer o sistema
-- ❌ NÃO USE: Remove-Item, Format-Volume, etc.

-- =====================================================
-- FIM DO SCRIPT
-- =====================================================
