/**
 * DepotBox API Integration
 *
 * API Documentation: https://depotbox.org/api
 *
 * This service provides integration with the DepotBox API for downloading
 * Steam game manifests and depot files.
 */

const DEPOTBOX_API_BASE = 'https://depotbox.org/api';

// Rate limiting: 60 requests per minute (handled by API)
// API Key is now handled in the main process (src/main/index.ts) to avoid CORS

interface DepotBoxGame {
  appid: number;
  name: string;
  is_dlc: boolean;
  drm_notice: string | null;
  ext_user_account_notice: string | null;
  header_image_url: string;
}

interface SearchGamesParams {
  searchTerm: string;
  limit?: number; // Default: 25, Max: 100
  filter_dlc?: 'only' | 'exclude';
  filter_protection?: 'require' | 'exclude';
  filter_availability?: boolean; // Only games with confirmed manifests
}

interface SearchGamesResponse {
  success: boolean;
  games: DepotBoxGame[];
}

interface GameDetailsResponse {
  success: boolean;
  data: {
    appid: number;
    name: string;
    is_dlc: boolean;
    drm_notice: string | null;
    header_image_url: string;
    availability: {
      db1_primary: boolean;
      db2_alternative: boolean;
    };
    dlcs: Array<{
      appid: number;
      name: string;
      header_image_url: string;
    }>;
  };
}

interface DownloadInitResponse {
  status: 'processing' | 'error';
  token?: string;
  polling_url?: string;
  message?: string;
}

interface DownloadStatusResponse {
  status: 'processing' | 'completed' | 'error';
  message: string;
  progress?: number;
  logs?: string[];
  finalUserZipName?: string;
  download_link?: string;
  expiry_minutes?: number;
}

interface StatsResponse {
  success: boolean;
  data: {
    tracked_games_db1: number;
    total_downloads_last_24h: number;
    api_requests_last_24h: number;
    most_popular_depot_last_24h: {
      appid: number;
      name: string;
      downloads: number;
    };
    public_lists_count: number;
  };
}

/**
 * Makes an authenticated request to the DepotBox API
 * Uses IPC to bypass CORS restrictions
 */
async function makeRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  // LOG REQUEST
  console.log('🌐 [DepotBox] Request:', {
    endpoint,
    method: options.method || 'GET',
    body: options.body
  });

  try {
    // Use IPC handler to make request from main process (bypasses CORS)
    const response = await window.electron.depotboxApiRequest(endpoint, {
      method: options.method || 'GET',
      body: options.body,
      headers: options.headers,
    });

    // LOG RESPONSE
    console.log('✅ [DepotBox] Response:', {
      status: response.status,
      ok: response.ok,
      statusText: response.statusText
    });

    if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please wait a moment and try again.');
    }

    if (!response.ok) {
      console.error('❌ [DepotBox] Error response:', response.data);
      throw new Error(`DepotBox API error: ${response.status} - ${JSON.stringify(response.data)}`);
    }

    console.log('📦 [DepotBox] Response data:', response.data);
    return response.data;
  } catch (error: any) {
    console.error('❌ [DepotBox] Request failed:', {
      error: error.message,
      stack: error.stack,
      type: error.name
    });
    throw error;
  }
}

/**
 * Search for games in the DepotBox database
 * Minimum 3 characters required for search
 */
export async function searchGames(params: SearchGamesParams): Promise<DepotBoxGame[]> {
  // Permitir AppIDs numéricos sem mínimo de 3 chars
  const isAppId = /^\d+$/.test(params.searchTerm);
  if (!isAppId && params.searchTerm.length < 3) {
    throw new Error('Search term must be at least 3 characters');
  }

  const response = await makeRequest<SearchGamesResponse>('/search-games', {
    method: 'POST',
    body: JSON.stringify({
      searchTerm: params.searchTerm,
      limit: params.limit || 50,
      filter_dlc: params.filter_dlc || 'exclude', // Exclude DLCs by default
      filter_availability: params.filter_availability !== false, // Only available games by default
    }),
  });

  if (!response.success) {
    throw new Error('Failed to search games');
  }

  return response.games;
}

/**
 * Get detailed information about a specific game
 */
export async function getGameDetails(appid: string | number): Promise<GameDetailsResponse['data']> {
  const response = await makeRequest<GameDetailsResponse>(`/games/${appid}`);

  if (!response.success) {
    throw new Error('Failed to get game details');
  }

  return response.data;
}

/**
 * Get list of available manifests for a game
 */
export async function getManifests(appid: string | number) {
  return makeRequest(`/manifests/${appid}`);
}

/**
 * Check if one or more AppIDs are DLC
 */
export async function checkDLC(appids: string[]): Promise<any> {
  return makeRequest('/check-dlc', {
    method: 'POST',
    body: JSON.stringify({ appids }),
  });
}

/**
 * Get public statistics about DepotBox service
 * This endpoint does not require authentication
 */
export async function getStats(): Promise<StatsResponse['data']> {
  const response = await window.electron.depotboxApiRequest('/stats', {
    method: 'GET'
  });

  if (!response.ok) {
    throw new Error('Failed to get stats');
  }

  if (!response.data.success) {
    throw new Error('Failed to get stats');
  }

  return response.data.data;
}

/**
 * ASYNCHRONOUS DOWNLOAD FLOW
 * Recommended for user-facing applications
 */

/**
 * Initiate download for a single game (async)
 * Returns a token for polling
 */
export async function initiateDownload(appid: string | number): Promise<string> {
  const response = await makeRequest<DownloadInitResponse>('/download', {
    method: 'POST',
    body: JSON.stringify({ appid: String(appid) }),
  });

  if (response.status === 'error' || !response.token) {
    throw new Error(response.message || 'Failed to initiate download');
  }

  return response.token;
}

/**
 * Initiate batch download for multiple games (async)
 * Max 50 AppIDs per request
 */
export async function initiateBatchDownload(
  appids: (string | number)[],
  mergeFolders: boolean = false
): Promise<string> {
  if (appids.length > 50) {
    throw new Error('Maximum 50 games per batch download');
  }

  const response = await makeRequest<DownloadInitResponse>('/download/batch', {
    method: 'POST',
    body: JSON.stringify({
      appids: appids.map(String),
      mergeFolders,
    }),
  });

  if (response.status === 'error' || !response.token) {
    throw new Error(response.message || 'Failed to initiate batch download');
  }

  return response.token;
}

/**
 * Poll the status of a download
 */
export async function pollDownloadStatus(token: string): Promise<DownloadStatusResponse> {
  return makeRequest<DownloadStatusResponse>(`/status/${token}`);
}

/**
 * Get the download URL for a completed download
 */
export function getDownloadUrl(token: string): string {
  return `${DEPOTBOX_API_BASE}/download/${token}`;
}

/**
 * Download the completed file
 * Returns the blob data
 */
export async function downloadFile(token: string): Promise<Blob> {
  const response = await window.electron.depotboxApiRequest(`/download/${token}`, {
    method: 'GET'
  });

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status}`);
  }

  // Note: For blob downloads, we'll need to handle this differently
  // The IPC handler returns JSON, not blob data
  // This may need additional handling in the main process
  return new Blob([JSON.stringify(response.data)]);
}

/**
 * SYNCHRONOUS DOWNLOAD FLOW
 * Ideal for scripts and backend automation
 * WARNING: Can timeout on large files
 */

/**
 * Direct download for a single game (synchronous)
 * Returns the blob data directly
 */
export async function directDownload(appid: string | number): Promise<Blob> {
  const response = await window.electron.depotboxApiRequest('/direct-download', {
    method: 'POST',
    body: JSON.stringify({ appid: String(appid) })
  });

  if (!response.ok) {
    throw new Error(`Direct download failed: ${response.status}`);
  }

  // Note: For blob downloads, we'll need to handle this differently
  // The IPC handler returns JSON, not blob data
  return new Blob([JSON.stringify(response.data)]);
}

/**
 * Direct batch download (synchronous)
 * Max 50 AppIDs per request
 */
export async function directBatchDownload(
  appids: (string | number)[],
  mergeFolders: boolean = false
): Promise<Blob> {
  if (appids.length > 50) {
    throw new Error('Maximum 50 games per batch download');
  }

  const response = await window.electron.depotboxApiRequest('/direct-download/batch', {
    method: 'POST',
    body: JSON.stringify({
      appids: appids.map(String),
      mergeFolders,
    })
  });

  if (!response.ok) {
    throw new Error(`Direct batch download failed: ${response.status}`);
  }

  // Note: For blob downloads, we'll need to handle this differently
  // The IPC handler returns JSON, not blob data
  return new Blob([JSON.stringify(response.data)]);
}

/**
 * HELPER FUNCTIONS
 */

/**
 * Poll download status until completion
 * Calls onProgress callback with status updates
 */
export async function pollUntilComplete(
  token: string,
  onProgress?: (status: DownloadStatusResponse) => void,
  pollInterval: number = 2000 // Poll every 2 seconds
): Promise<DownloadStatusResponse> {
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const status = await pollDownloadStatus(token);

        if (onProgress) {
          onProgress(status);
        }

        if (status.status === 'completed') {
          clearInterval(interval);
          resolve(status);
        } else if (status.status === 'error') {
          clearInterval(interval);
          reject(new Error(status.message || 'Download failed'));
        }
      } catch (error) {
        clearInterval(interval);
        reject(error);
      }
    }, pollInterval);
  });
}

/**
 * Complete download flow: initiate, poll, and get download URL
 */
export async function completeDownloadFlow(
  appid: string | number,
  onProgress?: (status: DownloadStatusResponse) => void
): Promise<string> {
  // Step 1: Initiate download
  const token = await initiateDownload(appid);

  // Step 2: Poll until complete
  const finalStatus = await pollUntilComplete(token, onProgress);

  // Step 3: Return download URL
  if (!finalStatus.download_link) {
    throw new Error('Download completed but no download link received');
  }

  return finalStatus.download_link;
}

/**
 * Complete batch download flow
 */
export async function completeBatchDownloadFlow(
  appids: (string | number)[],
  onProgress?: (status: DownloadStatusResponse) => void,
  mergeFolders: boolean = false
): Promise<string> {
  // Step 1: Initiate batch download
  const token = await initiateBatchDownload(appids, mergeFolders);

  // Step 2: Poll until complete
  const finalStatus = await pollUntilComplete(token, onProgress);

  // Step 3: Return download URL
  if (!finalStatus.download_link) {
    throw new Error('Batch download completed but no download link received');
  }

  return finalStatus.download_link;
}

export type {
  DepotBoxGame,
  SearchGamesParams,
  GameDetailsResponse,
  DownloadStatusResponse,
  DownloadInitResponse,
};
