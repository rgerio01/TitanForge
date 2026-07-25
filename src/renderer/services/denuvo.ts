import { getRyuuGames, getRyuuGameByIdSync, RYUU_PLACEHOLDER } from './ryuuGames';

export interface DenuvoGame {
  id: string;
  game_id: string;
  name: string;
  price: number;
  active: boolean;
}

export interface DenuvoGameWithThumb extends DenuvoGame {
  displayName: string;
  thumbnail: string;
}

export async function listDenuvoGames(): Promise<DenuvoGameWithThumb[]> {
  const result = await window.electron.denuvoListGames();
  if (!result.success || !result.games) return [];

  await getRyuuGames().catch(() => {});

  return result.games.map((g) => {
    const ryuu = getRyuuGameByIdSync(String(g.game_id));
    return {
      ...g,
      price: Number(g.price),
      displayName: ryuu?.name || g.name,
      thumbnail: ryuu?.header_image || RYUU_PLACEHOLDER,
    };
  });
}

export async function validateCoupon(code: string, productType: string = 'denuvo') {
  return window.electron.couponValidate(code, productType);
}

export async function createDenuvoOrder(payload: {
  licenseKey: string;
  licenseName?: string;
  gameId: string;
  gameName: string;
  couponCode?: string;
}) {
  // Cliente NÃO envia preço — servidor busca em denuvo_games
  return window.electron.denuvoCreateOrder(payload);
}

export async function checkOrderStatus(txid: string) {
  return window.electron.denuvoCheckStatus(txid);
}

export async function listMyOrders(licenseKey: string) {
  return window.electron.denuvoListMyOrders(licenseKey);
}
