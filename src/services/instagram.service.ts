export interface InstagramMediaItem {
  id: string;
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  mediaUrl: string;    // image URL for IMAGE/CAROUSEL; thumbnail URL for VIDEO
  videoUrl?: string;   // mp4 URL, only present for VIDEO (reels included)
  permalink: string;
  caption?: string;
  timestamp: string;
}

interface Cache {
  items: InstagramMediaItem[];
  fetchedAt: number;
}

const _cache = new Map<string, Cache>();
const TTL_MS = 15 * 60 * 1000; // 15 minutes

export async function fetchInstagramFeed(
  accessToken: string,
  limit = 6
): Promise<InstagramMediaItem[]> {
  const key = accessToken.slice(-12);
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) {
    return hit.items.slice(0, limit);
  }

  const fields = 'id,media_type,media_url,thumbnail_url,permalink,timestamp,caption';
  const url =
    `https://graph.instagram.com/me/media` +
    `?fields=${fields}&limit=24&access_token=${accessToken}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Instagram API ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as { data?: any[] };
  const items: InstagramMediaItem[] = (json.data ?? []).map((item) => ({
    id: item.id,
    mediaType: item.media_type,
    mediaUrl:
      item.media_type === 'VIDEO'
        ? (item.thumbnail_url ?? item.media_url)
        : item.media_url,
    videoUrl: item.media_type === 'VIDEO' ? item.media_url : undefined,
    permalink: item.permalink,
    caption: item.caption,
    timestamp: item.timestamp,
  }));

  _cache.set(key, { items, fetchedAt: Date.now() });
  return items.slice(0, limit);
}

export function invalidateInstagramCache() {
  _cache.clear();
}
