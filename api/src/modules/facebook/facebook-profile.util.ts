// Facebook profile links come in a few shapes. Reduce each to a tidy,
// comparable form (lowercase vanity path), or pull out a numeric ID.
//   https://www.facebook.com/Funktryboy/          → { profileUrl: 'facebook.com/funktryboy' }
//   https://m.facebook.com/profile.php?id=100012  → { facebookUserId: '100012' }
//   https://www.facebook.com/people/Jane-Doe/100012 → { facebookUserId: '100012' }
export function parseFacebookProfile(raw: string | null | undefined): {
  profileUrl: string | null;
  facebookUserId: string | null;
} {
  if (!raw?.trim()) return { profileUrl: null, facebookUserId: null };
  let url: URL;
  try {
    url = new URL(raw.trim().startsWith('http') ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return { profileUrl: null, facebookUserId: null };
  }
  if (!/(^|\.)facebook\.com$/i.test(url.hostname) && !/(^|\.)fb\.com$/i.test(url.hostname)) {
    return { profileUrl: null, facebookUserId: null };
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0]?.toLowerCase() === 'profile.php') {
    const id = url.searchParams.get('id');
    return { profileUrl: null, facebookUserId: id && /^\d+$/.test(id) ? id : null };
  }
  if (segments[0]?.toLowerCase() === 'people') {
    const id = segments[segments.length - 1];
    return { profileUrl: null, facebookUserId: id && /^\d+$/.test(id) ? id : null };
  }
  if (segments.length === 0) return { profileUrl: null, facebookUserId: null };
  return { profileUrl: `facebook.com/${segments[0].toLowerCase()}`, facebookUserId: null };
}

// For name suggestions only — case, accents and spacing don't matter.
export function normalizePersonName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
