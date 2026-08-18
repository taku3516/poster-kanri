// ログイン方式の判定ロジックのテスト。
// Firebase への通信を伴わない純粋関数だけを対象にしている。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isWebKitIOS,
  isSameAuthDomain,
  chooseSignInMethod,
} from '../public/js/sign-in-method.js';

// 実際の端末が送る User-Agent（判定の根拠を明示するためベタ書きする）
const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  // iPadOS 13以降は「Macintosh」を名乗る。タッチ点数でしか見分けられない
  ipad:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  iosChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
  mac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

test('iPhone は iOS と判定する', () => {
  assert.equal(isWebKitIOS(UA.iphone, 5, 'iPhone'), true);
});

test('iOS版Chrome も iOS と判定する（中身が WebKit のため）', () => {
  assert.equal(isWebKitIOS(UA.iosChrome, 5, 'iPhone'), true);
});

test('iPad は Macintosh を名乗るが、タッチ点数で iOS と判定する', () => {
  assert.equal(isWebKitIOS(UA.ipad, 5, 'MacIntel'), true);
});

test('タッチ非対応の Mac は iOS ではない', () => {
  assert.equal(isWebKitIOS(UA.mac, 0, 'MacIntel'), false);
});

test('Windows は iOS ではない', () => {
  assert.equal(isWebKitIOS(UA.windows, 0, 'Win32'), false);
});

test('User-Agent が空でも例外を投げない', () => {
  assert.equal(isWebKitIOS('', 0, ''), false);
});

test('ホストと authDomain が同一なら一致とみなす', () => {
  assert.equal(isSameAuthDomain('poster.web.app', 'poster.web.app'), true);
});

test('大文字小文字の違いは無視する', () => {
  assert.equal(isSameAuthDomain('Poster.Web.App', 'poster.web.app'), true);
});

test('GitHub Pages と firebaseapp.com は不一致と判定する', () => {
  assert.equal(
    isSameAuthDomain('taku3516.github.io', 'poster-xxx.firebaseapp.com'),
    false,
  );
});

test('authDomain が未設定なら不一致として扱う', () => {
  assert.equal(isSameAuthDomain('poster.web.app', ''), false);
});

test('パソコンでは popup を選ぶ（動いている環境を変えない）', () => {
  const method = chooseSignInMethod({
    userAgent: UA.windows,
    maxTouchPoints: 0,
    platform: 'Win32',
    host: 'poster.web.app',
    authDomain: 'poster.web.app',
  });
  assert.equal(method, 'popup');
});

test('iOS かつドメイン一致なら redirect を選ぶ', () => {
  const method = chooseSignInMethod({
    userAgent: UA.iphone,
    maxTouchPoints: 5,
    platform: 'iPhone',
    host: 'poster.web.app',
    authDomain: 'poster.web.app',
  });
  assert.equal(method, 'redirect');
});

test('iOS かつドメイン不一致なら blocked（案内を出す）', () => {
  // GitHub Pages 配信のまま iPhone で開いた場合。redirect でも通らないため
  // 試させずに理由を説明する
  const method = chooseSignInMethod({
    userAgent: UA.iphone,
    maxTouchPoints: 5,
    platform: 'iPhone',
    host: 'taku3516.github.io',
    authDomain: 'poster-xxx.firebaseapp.com',
  });
  assert.equal(method, 'blocked');
});

test('判定材料が取れないときは popup に任せる', () => {
  const method = chooseSignInMethod({
    userAgent: '',
    maxTouchPoints: 0,
    platform: '',
    host: '',
    authDomain: '',
  });
  assert.equal(method, 'popup');
});
