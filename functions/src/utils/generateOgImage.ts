import * as fs from 'fs';
import * as path from 'path';
import satori from 'satori';
import sharp from 'sharp';

const ASSETS = path.join(__dirname, '../../assets');

let _font: Buffer | null = null;
let _bgBase64: string | null = null;

function getFont(): Buffer {
  return (_font ??= fs.readFileSync(path.join(ASSETS, 'Vidopick-Bold.ttf')));
}

function getBgBase64(): string {
  if (!_bgBase64) {
    const buf = fs.readFileSync(path.join(ASSETS, 'affiliates-bg-og.jpg'));
    _bgBase64 = `data:image/jpeg;base64,${buf.toString('base64')}`;
  }
  return _bgBase64;
}

type VNode = { type: string; props: Record<string, unknown> };

function h(
  type: string,
  props: Record<string, unknown>,
  ...children: (VNode | string | null | undefined)[]
): VNode {
  const filtered = children.filter((c) => c != null) as (VNode | string)[];
  return {
    type,
    props: {
      ...props,
      ...(filtered.length > 0 ? { children: filtered.length === 1 ? filtered[0] : filtered } : {}),
    },
  };
}

const ALLOWED_PHOTO_HOSTS = new Set(['storage.googleapis.com', 'firebasestorage.googleapis.com']);

function assertStorageUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid photo URL');
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_PHOTO_HOSTS.has(parsed.hostname)) {
    throw new Error(`Photo URL host not allowed: ${parsed.hostname}`);
  }
}

export async function generateOgImage(name: string, photoUrl: string): Promise<Buffer> {
  assertStorageUrl(photoUrl);
  const photoResp = await fetch(photoUrl, { redirect: 'error' });
  if (!photoResp.ok) throw new Error(`Photo fetch failed: ${photoResp.status}`);
  const photoResized = await sharp(Buffer.from(await photoResp.arrayBuffer()))
    .resize(260, 260, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 85 })
    .toBuffer();
  const photoDataUrl = `data:image/jpeg;base64,${photoResized.toString('base64')}`;

  const fontSize = name.length > 22 ? 60 : name.length > 16 ? 72 : 84;

  const element = h(
    'div',
    { style: { display: 'flex', width: 1200, height: 630, position: 'relative' } },
    h('img', {
      src: getBgBase64(),
      style: { position: 'absolute', top: 0, left: 0, width: 1200, height: 630 },
    }),
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: 1200,
          height: 630,
          position: 'relative',
          paddingBottom: 30,
        },
      },
      h(
        'span',
        { style: { fontFamily: 'Vidopick', fontSize, fontWeight: 700, color: '#0f172a' } },
        name
      ),
      h(
        'span',
        {
          style: {
            fontFamily: 'Vidopick',
            fontSize: 42,
            fontWeight: 700,
            color: '#334155',
            marginTop: 10,
          },
        },
        'My Vidopick'
      ),
      h('img', {
        src: photoDataUrl,
        style: { width: 260, height: 260, borderRadius: 20, marginTop: 36 },
      })
    )
  );

  const svg = await satori(element as Parameters<typeof satori>[0], {
    width: 1200,
    height: 630,
    fonts: [{ name: 'Vidopick', data: getFont(), weight: 700, style: 'normal' }],
  });

  return sharp(Buffer.from(svg)).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}
