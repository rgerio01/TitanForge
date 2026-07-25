-- =====================================================
-- Umbra Launcher 2.4.0 — Universal PIX + Products + Coupons V2
-- Cole no SQL Editor depois do 001 e clique RUN
-- =====================================================

-- 1. Tabela de produtos premium (preços e regras de liberação)
CREATE TABLE IF NOT EXISTS products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL UNIQUE,                                -- ex: 'bypass', 'premiumaccounts', 'multiplayer', 'nsfw', 'add_games'
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  permission_field TEXT NOT NULL,                           -- coluna em keyvortex que vai virar 'enable'
  duration_days INTEGER,                                    -- NULL = vitalício
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS products_set_updated_at ON products;
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "products_read" ON products;
CREATE POLICY "products_read" ON products FOR SELECT USING (active = TRUE);

-- Seed inicial dos produtos (ajuste preços conforme quiser)
INSERT INTO products (type, name, description, price, permission_field, duration_days) VALUES
  ('bypass',          'Bypass Premium',         'Acesso a todos os bypasses premium',           29.90, 'bypass',          NULL),
  ('premiumaccounts', 'Contas Oficiais',        'Acesso a contas premium oficiais',             39.90, 'premiumaccounts', NULL),
  ('multiplayer',     'Multiplayer Premium',    'Recursos online com amigos',                   34.90, 'multiplayer',     NULL),
  ('nsfw',            'Conteúdo +18',           'Acesso a jogos adultos',                       19.90, 'nsfw',            NULL),
  ('add_games',       'Adicionar Jogos',        'Permissão para adicionar jogos personalizados',24.90, 'add_games',       NULL)
ON CONFLICT (type) DO NOTHING;

-- 2. Cupons V2 — escopo flexível por tipo de produto
ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS applies_to TEXT[];               -- NULL ou {} = vale para tudo; ['bypass','denuvo'] = só esses

-- 3. Tabela universal de pedidos PIX (denuvo + premium)
CREATE TABLE IF NOT EXISTS pix_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  license_key TEXT NOT NULL,
  product_type TEXT NOT NULL,                               -- 'denuvo' | 'bypass' | 'premiumaccounts' | 'multiplayer' | 'nsfw' | 'add_games'
  product_ref TEXT,                                          -- p/ denuvo: game_id; p/ permissão: NULL
  product_name TEXT NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  original_amount NUMERIC(10, 2) NOT NULL,
  coupon_code TEXT,
  txid TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'canceled', 'fulfilled')),
  qr_code_text TEXT,
  qr_code_image TEXT,
  paid_at TIMESTAMPTZ,
  fulfilled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pix_orders_license ON pix_orders(license_key);
CREATE INDEX IF NOT EXISTS idx_pix_orders_status ON pix_orders(status);
CREATE INDEX IF NOT EXISTS idx_pix_orders_txid ON pix_orders(txid);

DROP TRIGGER IF EXISTS pix_orders_set_updated_at ON pix_orders;
CREATE TRIGGER pix_orders_set_updated_at BEFORE UPDATE ON pix_orders
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

ALTER TABLE pix_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pix_orders_all" ON pix_orders;
CREATE POLICY "pix_orders_all" ON pix_orders FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 4. NOVA validate_coupon — recebe product_type, valida escopo + retorna sem ambiguidade
DROP FUNCTION IF EXISTS validate_coupon(TEXT);
DROP FUNCTION IF EXISTS validate_coupon(TEXT, TEXT);

CREATE OR REPLACE FUNCTION validate_coupon(p_code TEXT, p_product_type TEXT DEFAULT NULL)
RETURNS TABLE(
  ok BOOLEAN,
  msg TEXT,
  d_type TEXT,
  d_value NUMERIC
) AS $$
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
  IF p_product_type IS NOT NULL
     AND c.applies_to IS NOT NULL
     AND array_length(c.applies_to, 1) > 0
     AND NOT (p_product_type = ANY(c.applies_to)) THEN
    RETURN QUERY SELECT FALSE, 'Cupom não vale para este produto'::TEXT, NULL::TEXT, NULL::NUMERIC; RETURN;
  END IF;
  RETURN QUERY SELECT TRUE, 'OK'::TEXT, c.discount_type::TEXT, c.discount_value::NUMERIC;
END;
$$ LANGUAGE plpgsql;

-- 5. NOVA redeem_coupon — atomic: valida + debita uso
DROP FUNCTION IF EXISTS redeem_coupon(TEXT);
DROP FUNCTION IF EXISTS redeem_coupon(TEXT, TEXT);

CREATE OR REPLACE FUNCTION redeem_coupon(p_code TEXT, p_product_type TEXT DEFAULT NULL)
RETURNS TABLE(
  ok BOOLEAN,
  msg TEXT,
  d_type TEXT,
  d_value NUMERIC
) AS $$
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
  IF p_product_type IS NOT NULL
     AND c.applies_to IS NOT NULL
     AND array_length(c.applies_to, 1) > 0
     AND NOT (p_product_type = ANY(c.applies_to)) THEN
    RETURN QUERY SELECT FALSE, 'Cupom não vale para este produto'::TEXT, NULL::TEXT, NULL::NUMERIC; RETURN;
  END IF;
  UPDATE coupons SET uses = uses + 1 WHERE id = c.id;
  RETURN QUERY SELECT TRUE, 'OK'::TEXT, c.discount_type::TEXT, c.discount_value::NUMERIC;
END;
$$ LANGUAGE plpgsql;

-- 6. Função para liberar permissão na licença (chamada quando paga)
CREATE OR REPLACE FUNCTION grant_license_permission(
  p_license_key TEXT,
  p_permission_field TEXT,
  p_duration_days INTEGER DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  q TEXT;
  r BOOLEAN;
BEGIN
  -- Whitelist de campos permitidos (segurança contra SQL injection)
  IF p_permission_field NOT IN ('bypass','premiumaccounts','multiplayer','nsfw','add_games') THEN
    RETURN FALSE;
  END IF;

  IF p_duration_days IS NULL THEN
    q := format('UPDATE keyvortex SET %I = ''enable'', updated_at = NOW() WHERE UPPER(key) = UPPER($1)', p_permission_field);
    EXECUTE q USING p_license_key;
  ELSE
    q := format('UPDATE keyvortex SET %I = ''enable'', expires_at = NOW() + ($2 || '' days'')::INTERVAL, updated_at = NOW() WHERE UPPER(key) = UPPER($1)', p_permission_field);
    EXECUTE q USING p_license_key, p_duration_days::TEXT;
  END IF;

  GET DIAGNOSTICS r = ROW_COUNT;
  RETURN r > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Migra orders Denuvo antigos (opcional, se já tinha alguns)
INSERT INTO pix_orders (
  license_key, product_type, product_ref, product_name,
  amount, original_amount, coupon_code, txid, status,
  qr_code_text, qr_code_image, paid_at, created_at, updated_at
)
SELECT
  license_key, 'denuvo'::TEXT, game_id, game_name,
  amount, original_amount, coupon_code, txid, status,
  qr_code_text, qr_code_image, paid_at, created_at, updated_at
FROM denuvo_orders
ON CONFLICT (txid) DO NOTHING;
