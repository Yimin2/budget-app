import { getGoogleConfig } from './config';
import { GoogleError } from './errors';
import { GAPI_SRC, loadScript } from './script';
import { googleGlobals, type GooglePickerNamespace, type PickerResponse } from './types';

export const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';

let pickerLoad: Promise<GooglePickerNamespace> | null = null;

function loadPickerApi(): Promise<GooglePickerNamespace> {
  const ready = googleGlobals().google?.picker;
  if (ready) return Promise.resolve(ready);
  if (pickerLoad) return pickerLoad;
  pickerLoad = loadScript(GAPI_SRC, () => !!googleGlobals().gapi)
    .then(
      () =>
        new Promise<GooglePickerNamespace>((resolve, reject) => {
          const gapi = googleGlobals().gapi;
          if (!gapi) {
            reject(new GoogleError('script_failed', 'gapi missing'));
            return;
          }
          gapi.load('picker', {
            callback: () => {
              const ns = googleGlobals().google?.picker;
              if (ns) resolve(ns);
              else reject(new GoogleError('script_failed', 'google.picker missing'));
            },
            onerror: () => reject(new GoogleError('script_failed', 'gapi.load picker')),
            timeout: 15_000,
            ontimeout: () => reject(new GoogleError('timeout', 'gapi.load picker')),
          });
        }),
    )
    .catch((e: unknown) => {
      pickerLoad = null;
      throw e;
    });
  return pickerLoad;
}

export interface PickOptions {
  /**
   * 초대 링크로 열 때: 이 파일만 보이게 미리 골라 둔다 (DocsView.setFileIds). 사용자는 '선택'만 누르면 된다.
   * 고르는 순간 drive.file 권한이 이 파일에 생긴다
   */
  fileId?: string;
}

/** 파일 선택 창. 토큰은 호출하는 쪽이 넘긴다 (getAccessToken) */
export async function pickSpreadsheetWith(
  getToken: () => Promise<string>,
  opts: PickOptions = {},
): Promise<{ id: string; name: string } | null> {
  const { apiKey, appId, clientId } = getGoogleConfig();
  if (!clientId || !apiKey) throw new GoogleError('not_configured', 'NEXT_PUBLIC_GOOGLE_API_KEY missing');

  const [ns, token] = await Promise.all([loadPickerApi(), getToken()]);

  return new Promise((resolve) => {
    let view = new ns.DocsView(ns.ViewId.SPREADSHEETS).setMimeTypes(SPREADSHEET_MIME).setIncludeFolders(false);
    const fileId = opts.fileId?.trim();
    if (fileId && view.setFileIds) view = view.setFileIds(fileId);
    let builder = new ns.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setLocale('ko')
      .setTitle(fileId ? '초대받은 가계부 열기' : '가계부 시트 고르기')
      .setCallback((data: PickerResponse) => {
        if (data.action === ns.Action.PICKED) {
          const doc = data.docs?.[0];
          resolve(doc ? { id: doc.id, name: doc.name ?? '' } : null);
        } else if (data.action === ns.Action.CANCEL) {
          resolve(null);
        }
      });
    if (appId) builder = builder.setAppId(appId);
    if (typeof window !== 'undefined' && window.location?.origin) builder = builder.setOrigin(window.location.origin);
    builder.build().setVisible(true);
  });
}

/** 테스트용 */
export function resetPickerCache(): void {
  pickerLoad = null;
}
