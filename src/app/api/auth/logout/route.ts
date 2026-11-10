import { handleLogout } from '@/server/auth/handlers';
import { liveDeps } from '@/server/auth/route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function POST(req: Request): Promise<Response> {
  return handleLogout(req, liveDeps());
}
