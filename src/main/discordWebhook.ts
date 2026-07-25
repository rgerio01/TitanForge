import axios from 'axios';

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_ORDERS || '';

export interface ChargebackEvent {
  licenseKey: string;
  productName: string;
  productType: string;
  amount: number;
  efiStatus?: string;
  reason?: string;
  action: string;            // license_suspended | permission_revoked | order_marked
  permissionRevoked?: string | null;
}

export async function notifyChargeback(event: ChargebackEvent): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    await axios.post(
      DISCORD_WEBHOOK_URL,
      {
        content: '@here',
        embeds: [
          {
            title: '🚨 CHARGEBACK DETECTADO — LICENÇA SUSPENSA',
            description: '**A licença foi automaticamente suspensa e todas as permissões zeradas.** Cliente não consegue mais usar o launcher até intervenção manual.',
            color: 0xdc2626,
            fields: [
              { name: '🔒 Ação automática', value: 'Licença `suspended` + todas as permissões `disable`', inline: false },
              { name: 'Produto contestado', value: event.productName, inline: true },
              { name: 'Tipo', value: `\`${event.productType}\``, inline: true },
              { name: 'Valor', value: `R$ ${event.amount.toFixed(2)}`, inline: true },
              { name: 'Licença', value: `\`${event.licenseKey}\``, inline: false },
              { name: 'Status EFI', value: `\`${event.efiStatus || '?'}\``, inline: true },
              ...(event.reason ? [{ name: 'Motivo', value: event.reason, inline: false }] : []),
            ],
            timestamp: new Date().toISOString(),
            footer: { text: 'Umbra Launcher · Anti-Chargeback automático' },
          },
        ],
      },
      { timeout: 10000 }
    );
  } catch (e: any) {
    console.error('❌ Falha ao notificar Discord (chargeback):', e?.message || e);
  }
}

interface DenuvoOrderEvent {
  status: 'created' | 'paid';
  licenseKey: string;
  licenseName?: string | null;
  gameName: string;
  gameId: string;
  amount: number;
  originalAmount: number;
  couponCode?: string | null;
  txid: string;
}

export async function notifyDenuvoOrder(event: DenuvoOrderEvent): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    const isPaid = event.status === 'paid';
    const title = isPaid ? '💰 Pagamento confirmado — Denuvo' : '🛒 Nova ordem Denuvo (pendente)';
    const color = isPaid ? 0x4ade80 : 0x7c5cfc;
    const discountField =
      event.couponCode && event.amount !== event.originalAmount
        ? [
            {
              name: 'Cupom',
              value: `\`${event.couponCode}\` (de R$ ${event.originalAmount.toFixed(2)} → R$ ${event.amount.toFixed(2)})`,
              inline: false,
            },
          ]
        : [];

    await axios.post(
      DISCORD_WEBHOOK_URL,
      {
        embeds: [
          {
            title,
            color,
            fields: [
              { name: 'Jogo', value: `${event.gameName} (\`${event.gameId}\`)`, inline: true },
              { name: 'Valor', value: `R$ ${event.amount.toFixed(2)}`, inline: true },
              { name: 'Cliente', value: event.licenseName || 'Sem nome', inline: false },
              { name: 'Licença', value: `\`${event.licenseKey}\``, inline: false },
              ...discountField,
              { name: 'TxID', value: `\`${event.txid}\``, inline: false },
            ],
            timestamp: new Date().toISOString(),
            footer: { text: 'Umbra Launcher · Denuvo Removal' },
          },
        ],
      },
      { timeout: 10000 }
    );
  } catch (e: any) {
    console.error('❌ Falha ao enviar webhook Discord:', e?.message || e);
  }
}
