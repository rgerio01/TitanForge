import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Credenciais de serviço não encontradas no bundle. Verifique o build.');
}

export const supabase: SupabaseClient = createClient(
  SUPABASE_URL || '',
  SUPABASE_KEY || ''
);

// Tipos
export interface License {
  id: string;
  key: string;
  status: 'active' | 'inactive' | 'suspended';
  license_type: number; // 1 = mensal, 2 = vitalícia, 3 = teste
  expires_at: string | null; // Data de expiração (apenas para licenças mensais)
  hwid: string | null;
  ip_address: string | null;
  first_activated_at: string | null;
  created_at: string;
  updated_at: string;
  add_games: 'enable' | 'disable' | null; // Permissão para adicionar jogos
  nome: string | null; // Nome completo do usuário
  bypass: 'enable' | 'disable' | null; // NOVO: Permissão para Bypass Premium
  premiumaccounts: 'enable' | 'disable' | null; // NOVO: Permissão para Contas Oficiais Premium
  multiplayer: 'enable' | 'disable' | null; // NOVO: Permissão para Multiplayer
  nsfw: 'enable' | 'disable' | null; // Permissão para conteúdo +18
  numero: string | null;
  email: string | null;
  friend_code: string | null;
  referred_by: string | null;
  referral_count: number | null;
  referral_balance: number | null;
}
