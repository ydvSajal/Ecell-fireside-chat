import { readState } from '../../../lib/store';

export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    await readState();
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json({ ok: false }, { headers, status: 503 });
  }
}
