/**
 * google / gapi 전역의 최소 타입 (이 앱이 쓰는 부분만).
 * @types 패키지 없이 쓰기 위해 직접 선언한다.
 */
export interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export interface TokenClientError {
  type: 'popup_failed_to_open' | 'popup_closed' | 'unknown' | string;
  message?: string;
}

export interface TokenClientConfig {
  client_id: string;
  scope: string;
  callback: (resp: TokenResponse) => void;
  error_callback?: (err: TokenClientError) => void;
  prompt?: string;
  login_hint?: string;
}

export interface OverridableTokenClientConfig {
  prompt?: string;
  login_hint?: string;
  scope?: string;
}

export interface TokenClient {
  requestAccessToken(overrides?: OverridableTokenClientConfig): void;
}

export interface GoogleOAuth2 {
  initTokenClient(config: TokenClientConfig): TokenClient;
  revoke(token: string, done?: () => void): void;
}

export interface PickerDocument {
  id: string;
  name?: string;
  mimeType?: string;
  url?: string;
}

export interface PickerResponse {
  action: string;
  docs?: PickerDocument[];
}

export interface DocsView {
  setMimeTypes(mimeTypes: string): DocsView;
  setIncludeFolders(include: boolean): DocsView;
  setSelectFolderEnabled?(enabled: boolean): DocsView;
}

export interface Picker {
  setVisible(visible: boolean): Picker;
  dispose?(): void;
}

export interface PickerBuilder {
  addView(view: DocsView | string): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(appId: string): PickerBuilder;
  setLocale(locale: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  setOrigin(origin: string): PickerBuilder;
  setCallback(cb: (data: PickerResponse) => void): PickerBuilder;
  build(): Picker;
}

export interface GooglePickerNamespace {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new (viewId?: string) => DocsView;
  ViewId: { SPREADSHEETS: string } & Record<string, string>;
  Action: { PICKED: string; CANCEL: string } & Record<string, string>;
}

export interface GoogleNamespace {
  accounts?: { oauth2?: GoogleOAuth2 };
  picker?: GooglePickerNamespace;
}

export interface Gapi {
  load(
    name: string,
    options: { callback: () => void; onerror?: () => void; timeout?: number; ontimeout?: () => void } | (() => void),
  ): void;
}

export interface GoogleGlobals {
  google?: GoogleNamespace;
  gapi?: Gapi;
}

export function googleGlobals(): GoogleGlobals {
  return globalThis as unknown as GoogleGlobals;
}
