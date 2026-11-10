import { processEnv } from './config';
import type { AuthDeps } from './handlers';

/** 라우트 파일이 쓰는 실제 의존성 (요청 때마다 환경 변수를 읽는다) */
export function liveDeps(): AuthDeps {
  return { env: processEnv(), fetch: (input, init) => fetch(input, init), now: () => Date.now() };
}
