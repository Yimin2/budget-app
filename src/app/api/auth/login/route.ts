import { handleLogin } from '@/server/auth/handlers';
import { liveDeps } from '@/server/auth/route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(req: Request): Promise<Response> {
  return handleLogin(req, liveDeps());
}
