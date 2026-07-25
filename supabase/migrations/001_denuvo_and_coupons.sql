-- =====================================================
-- Umbra Launcher 2.4.0 — Denuvo Removal & Coupons
-- Cole tudo no SQL Editor do Supabase e clique em RUN
-- =====================================================

-- 1. Jogos disponíveis para remoção de Denuvo
CREATE TABLE IF NOT EXISTS denuvo_games (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  game_id TEXT NOT NULL UNIQUE,
  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Sistema de cupons (com escopo: denuvo / all)
CREATE TABLE IF NOT EXISTS coupons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value NUMERIC(10, 2) NOT NULL CHECK (discount_value >= 0),
  max_uses INTEGER,
  uses INTEGER DEFAULT 0,
  valid_until TIMESTAMPTZ,
  active BOOLEAN DEFAULT TRUE,
  scope TEXT DEFAULT 'denuvo' CHECK (scope IN ('denuvo', 'all')),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Pedidos de remoção de Denuvo
CREATE TABLE IF NOT EXISTS denuvo_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  license_key TEXT NOT NULL,
  game_id TEXT NOT NULL,
  game_name TEXT NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  original_amount NUMERIC(10, 2) NOT NULL,
  coupon_code TEXT,
  txid TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'canceled', 'fulfilled')),
  qr_code_text TEXT,
  qr_code_image TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_denuvo_games_active ON denuvo_games(active);
CREATE INDEX IF NOT EXISTS idx_denuvo_orders_license ON denuvo_orders(license_key);
CREATE INDEX IF NOT EXISTS idx_denuvo_orders_status ON denuvo_orders(status);
CREATE INDEX IF NOT EXISTS idx_denuvo_orders_txid ON denuvo_orders(txid);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(active);

-- Trigger genérico de updated_at
CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS denuvo_games_set_updated_at ON denuvo_games;
CREATE TRIGGER denuvo_games_set_updated_at BEFORE UPDATE ON denuvo_games
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS denuvo_orders_set_updated_at ON denuvo_orders;
CREATE TRIGGER denuvo_orders_set_updated_at BEFORE UPDATE ON denuvo_orders
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- Função atômica para validar e debitar uso de cupom
CREATE OR REPLACE FUNCTION redeem_coupon(p_code TEXT)
RETURNS TABLE(success BOOLEAN, message TEXT, discount_type TEXT, discount_value NUMERIC) AS $$
DECLARE c RECORD;
BEGIN
  SELECT * INTO c FROM coupons WHERE UPPER(code) = UPPER(p_code) FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Cupom não encontrado'::TEXT, NULL::TEXT, NULL::NUMERIC; RETURN;
  END IF;
  IF NOT c.active THEN
    RETURN QUERY SELECT FALSE, 'Cupom inativo'::TEXT, NULL::TEXT, NULL::NUMERIC; RETURN;
  END IF;
  IF c.valid_until IS NOT NULL AND c.valid_until < NOW() THEN
    RETURN QUERY SELECT FALSE, 'Cupom expirado'::TEXT, NULL::TEXT, NULL::NUMERIC; RETURN;
  END IF;
  IF c.max_uses IS NOT NULL AND c.uses >= c.max_uses THEN
    RETURN QUERY SELECT FALSE, 'Cupom esgotado'::TEXT, NULL::TEXT, NULL::NUMERIC; RETURN;
  END IF;
  UPDATE coupons SET uses = uses + 1 WHERE id = c.id;
  RETURN QUERY SELECT TRUE, 'OK'::TEXT, c.discount_type, c.discount_value;
END;
$$ LANGUAGE plpgsql;

-- Função apenas para validar (sem debitar) - usada para preview antes do pagamento
CREATE OR REPLACE FUNCTION validate_coupon(p_code TEXT)
RETURNS TABLE(success BOOLEAN, message TEXT, discount_type TEXT, discount_value NUMERIC) AS $$
DECLARE c RECORD;
BEGIN
  SELECT * INTO c FROM coupons WHERE UPPER(code) = UPPER(p_code);
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Cupom não encontrado'::TEXT, NULL::TEXT, NULL::NUMERIC; RETURN;
  END IF;
  IF NOT c.active THEN
    RETURN QUERY SELECT FALSE, 'Cupom inativo'::TEXT, NULL::TEXT, NULL::NUMERIC; RETURN;
  END IF;
  IF c.valid_until IS NOT NULL AND c.valid_until < NOW() THEN
    RETURN QUERY SELECT FALSE, 'Cupom expirado'::TEXT, NULL::TEXT, NULL::NUMERIC; RETURN;
  END IF;
  IF c.max_uses IS NOT NULL AND c.uses >= c.max_uses THEN
    RETURN QUERY SELECT FALSE, 'Cupom esgotado'::TEXT, NULL::TEXT, NULL::NUMERIC; RETURN;
  END IF;
  RETURN QUERY SELECT TRUE, 'OK'::TEXT, c.discount_type, c.discount_value;
END;
$$ LANGUAGE plpgsql;

-- Habilita RLS — anon pode ler denuvo_games, criar denuvo_orders e usar funções
ALTER TABLE denuvo_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE denuvo_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "denuvo_games_read" ON denuvo_games;
CREATE POLICY "denuvo_games_read" ON denuvo_games FOR SELECT USING (active = TRUE);

DROP POLICY IF EXISTS "denuvo_orders_insert" ON denuvo_orders;
CREATE POLICY "denuvo_orders_insert" ON denuvo_orders FOR INSERT WITH CHECK (TRUE);

DROP POLICY IF EXISTS "denuvo_orders_select_own" ON denuvo_orders;
CREATE POLICY "denuvo_orders_select_own" ON denuvo_orders FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "denuvo_orders_update_status" ON denuvo_orders;
CREATE POLICY "denuvo_orders_update_status" ON denuvo_orders FOR UPDATE USING (TRUE);

-- Cupons só são lidos via função RPC (validate_coupon / redeem_coupon)
-- Painel admin lê via SERVICE_KEY no servidor
