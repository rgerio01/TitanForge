export const RYUU_PLACEHOLDER = 'https://ryuu.lol/manifests/placeholder.png';

export interface RyuuDlc {
  appid: string;
  name: string;
  header_image?: string;
}

export interface RyuuGame {
  appid: string;
  name: string;
  header_image: string;
  type: string;
  drm?: boolean;
  nsfw?: boolean;
  dlc?: RyuuDlc[];
}

/**
 * Parseia o campo `dlc` do games.json.
 * O campo é um objeto { [appid]: value } onde value pode ser:
 *   1. string simples                          → apenas o nome
 *   2. objeto JSON { name, header_image }      → objeto normal
 *   3. string no formato Python dict           → "{'name': '...', 'header_image': '...'}"
 */
function parseDlcField(raw: any): RyuuDlc[] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw as Record<string, any>);
  if (entries.length === 0) return undefined;

  return entries.map(([appid, val]) => {
    // Case 1: plain object { name, header_image }
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return {
        appid: String(appid),
        name: String(val.name || ''),
        header_image: val.header_image || undefined,
      };
    }

    if (typeof val === 'string') {
      const trimmed = val.trim();

      // Case 2: Python-style dict string "{'name': '...', 'header_image': '...'}"
      if (trimmed.startsWith('{')) {
        try {
          // Convert Python dict to valid JSON: replace single quotes around keys/values
          const jsonLike = trimmed
            .replace(/'/g, '"')                          // ' → "
            .replace(/None/g, 'null')
            .replace(/True/g, 'true')
            .replace(/False/g, 'false');
          const parsed = JSON.parse(jsonLike);
          return {
            appid: String(appid),
            name: String(parsed.name || ''),
            header_image: parsed.header_image || undefined,
          };
        } catch {
          // fallthrough to plain string
        }
      }

      // Case 3: plain string = just the name
      return {
        appid: String(appid),
        name: trimmed,
        header_image: undefined,
      };
    }

    // Fallback
    return { appid: String(appid), name: String(appid), header_image: undefined };
  });
}

let cachedGames: RyuuGame[] | null = null;
let pendingFetch: Promise<RyuuGame[]> | null = null;

export async function getRyuuGames(): Promise<RyuuGame[]> {
  if (cachedGames) return cachedGames;
  if (pendingFetch) return pendingFetch;

  pendingFetch = (async () => {
    const result = await window.electron.fetchRyuuGames();
    if (!result.success || !result.games) {
      pendingFetch = null;
      throw new Error(result.error || 'Falha ao buscar games.json da Ryuu');
    }
    const games: RyuuGame[] = result.games.map((item: any) => ({
      appid: String(item.appid),
      name: String(item.name || ''),
      header_image: item.header_image || RYUU_PLACEHOLDER,
      type: String(item.type || ''),
      drm: item.drm === true,
      nsfw: item.nsfw === true,
      dlc: parseDlcField(item.dlc),
    }));
    cachedGames = games;
    pendingFetch = null;
    return games;
  })();

  return pendingFetch;
}

export async function getRyuuGameById(appId: string): Promise<RyuuGame | null> {
  const games = await getRyuuGames();
  return games.find(g => g.appid === String(appId)) || null;
}

export function getRyuuGameByIdSync(appId: string): RyuuGame | null {
  if (!cachedGames) return null;
  return cachedGames.find(g => g.appid === String(appId)) || null;
}
