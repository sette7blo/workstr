// Library exercises own their images locally: never keep an external http(s) link
// (slow on mobile, breaks offline, leaks a request off the box on every render).
// Any remote image is downloaded into a data URL so it lives in the DB and serves
// from the cached /image endpoint. On any failure the image is dropped rather than
// left as an external link. Already-local data URLs pass through untouched.
export async function localizeImage(imageUrl) {
  const url = String(imageUrl || '');
  if (!/^https?:\/\//i.test(url)) return imageUrl;
  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) return '';
    const type = (r.headers.get('content-type') || '').split(';')[0].trim();
    if (!type.startsWith('image/')) return '';
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.byteLength > 5 * 1024 * 1024) return '';
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return '';
  }
}
