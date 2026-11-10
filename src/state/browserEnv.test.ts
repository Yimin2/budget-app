import { describe, expect, it, vi } from 'vitest';
import {
  SAFARI_FALLBACK_MS, chromeIntentUrl, detectBrowserEnv, kakaoOpenExternalUrl, openInSafari, safariSchemeUrl, type BrowserEnvInput,
} from './browserEnv';

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  ipadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  androidWebView:
    'Mozilla/5.0 (Linux; Android 15; SM-S928N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36',
  kakaoIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.9.0',
  kakaoAndroid:
    'Mozilla/5.0 (Linux; Android 15; SM-S928N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36;KAKAOTALK 2410960',
  naverIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NAVER(inapp; search; 2000; 12.10.1; 15PRO)',
  instagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 357.0.0.25.101 (iPhone16,1; iOS 18_1; ko_KR)',
  facebook:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/490.0.0.40.107;FBBV/1]',
  line: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.19.0',
  daum: 'Mozilla/5.0 (Linux; Android 15; SM-S928N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 DaumApps/8.3.0',
  everytime:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 everytimeApp/5.0',
  desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

describe('환경 알아보기', () => {
  const cases: [string, BrowserEnvInput, { os: string; inApp: string | null; kind: string }][] = [
    ['아이폰 Safari', { userAgent: UA.iphoneSafari }, { os: 'ios', inApp: null, kind: 'normal' }],
    ['아이폰 홈 화면 앱 (navigator.standalone)', { userAgent: UA.iphoneSafari, navigatorStandalone: true }, { os: 'ios', inApp: null, kind: 'ios-standalone' }],
    ['아이폰 홈 화면 앱 (display-mode)', { userAgent: UA.iphoneSafari, displayModeStandalone: true }, { os: 'ios', inApp: null, kind: 'ios-standalone' }],
    ['아이패드 (Mac 처럼 보이는 UA + 터치) 홈 화면 앱', { userAgent: UA.ipadDesktop, maxTouchPoints: 5, navigatorStandalone: true }, { os: 'ios', inApp: null, kind: 'ios-standalone' }],
    ['Mac Safari', { userAgent: UA.macSafari, maxTouchPoints: 0 }, { os: 'other', inApp: null, kind: 'normal' }],
    ['안드로이드 Chrome', { userAgent: UA.androidChrome }, { os: 'android', inApp: null, kind: 'normal' }],
    ['안드로이드 설치한 앱 (standalone 그대로)', { userAgent: UA.androidChrome, displayModeStandalone: true }, { os: 'android', inApp: null, kind: 'normal' }],
    ['안드로이드 WebView', { userAgent: UA.androidWebView }, { os: 'android', inApp: 'webview', kind: 'in-app' }],
    ['카카오톡 (아이폰)', { userAgent: UA.kakaoIos }, { os: 'ios', inApp: 'kakaotalk', kind: 'in-app' }],
    ['카카오톡 (안드로이드)', { userAgent: UA.kakaoAndroid }, { os: 'android', inApp: 'kakaotalk', kind: 'in-app' }],
    ['네이버 앱', { userAgent: UA.naverIos }, { os: 'ios', inApp: 'naver', kind: 'in-app' }],
    ['인스타그램', { userAgent: UA.instagram }, { os: 'ios', inApp: 'instagram', kind: 'in-app' }],
    ['페이스북', { userAgent: UA.facebook }, { os: 'ios', inApp: 'facebook', kind: 'in-app' }],
    ['라인', { userAgent: UA.line }, { os: 'ios', inApp: 'line', kind: 'in-app' }],
    ['다음 앱', { userAgent: UA.daum }, { os: 'android', inApp: 'daum', kind: 'in-app' }],
    ['에브리타임', { userAgent: UA.everytime }, { os: 'ios', inApp: 'everytime', kind: 'in-app' }],
    ['데스크톱 Chrome', { userAgent: UA.desktopChrome }, { os: 'other', inApp: null, kind: 'normal' }],
    ['앱 안 브라우저가 standalone 이라고 해도 앱 안이 먼저', { userAgent: UA.kakaoIos, navigatorStandalone: true }, { os: 'ios', inApp: 'kakaotalk', kind: 'in-app' }],
  ];
  it.each(cases)('%s', (_, input, want) => {
    expect(detectBrowserEnv(input)).toMatchObject(want);
  });
});

describe('바깥 브라우저로 여는 주소', () => {
  const href = 'https://budget.example/start?open=1AbC_def-ghi#x';
  it('안드로이드 Chrome intent', () => {
    expect(chromeIntentUrl(href)).toBe('intent://budget.example/start?open=1AbC_def-ghi#Intent;scheme=https;package=com.android.chrome;end');
    expect(chromeIntentUrl('http://localhost:3000/start')).toBe('intent://localhost:3000/start#Intent;scheme=http;package=com.android.chrome;end');
    expect(chromeIntentUrl('not a url')).toBeNull();
    expect(chromeIntentUrl('kakaotalk://x')).toBeNull();
  });
  it('카카오톡 바깥 브라우저', () => {
    expect(kakaoOpenExternalUrl('https://budget.example/start?open=1')).toBe(
      'kakaotalk://web/openExternal?url=https%3A%2F%2Fbudget.example%2Fstart%3Fopen%3D1',
    );
  });
  it('Safari 주소 (x-safari-https)', () => {
    expect(safariSchemeUrl('https://budget.example/start?open=1')).toBe('x-safari-https://budget.example/start?open=1');
    expect(safariSchemeUrl('http://localhost:3000/')).toBe('x-safari-http://localhost:3000/');
    expect(safariSchemeUrl('/start')).toBeNull();
  });
});

describe('Safari 로 열기', () => {
  function deps(hidden: boolean) {
    const timers: (() => void)[] = [];
    return {
      timers,
      d: {
        navigate: vi.fn(),
        open: vi.fn(),
        isHidden: () => hidden,
        later: vi.fn((fn: () => void, ms: number) => {
          expect(ms).toBe(SAFARI_FALLBACK_MS);
          timers.push(fn);
        }),
      },
    };
  }
  const link = 'https://budget.example/start?open=1';

  it('홈 화면 앱: x-safari-https 를 먼저, Safari 로 넘어갔으면 그대로', () => {
    const { d, timers } = deps(true);
    openInSafari(link, d, { standalone: true });
    expect(d.navigate).toHaveBeenCalledWith('x-safari-https://budget.example/start?open=1');
    timers.forEach((f) => f());
    expect(d.open).not.toHaveBeenCalled();
  });
  it('홈 화면 앱: 넘어가지 않으면 window.open 으로 다시', () => {
    const { d, timers } = deps(false);
    openInSafari(link, d, { standalone: true });
    timers.forEach((f) => f());
    expect(d.open).toHaveBeenCalledWith(link);
  });
  it('주소 이동이 막히면 바로 window.open', () => {
    const { d } = deps(false);
    d.navigate.mockImplementation(() => {
      throw new Error('blocked');
    });
    openInSafari(link, d, { standalone: true });
    expect(d.open).toHaveBeenCalledWith(link);
    expect(d.later).not.toHaveBeenCalled();
  });
  it('홈 화면 앱이 아니면 window.open 만', () => {
    const { d } = deps(false);
    openInSafari(link, d, { standalone: false });
    expect(d.navigate).not.toHaveBeenCalled();
    expect(d.open).toHaveBeenCalledWith(link);
  });
});
