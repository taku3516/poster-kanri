// Firebase 認証のまとめ役。
// 画面側（main.js）はこのモジュールの関数だけを呼ぶ。

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';

import { firebaseConfig } from './firebase-config.js';
import { detectSignInMethod } from './sign-in-method.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = 'ja';

const provider = new GoogleAuthProvider();
// 毎回アカウントを選ばせる。候補者ごとにアカウントを使い分けるため
provider.setCustomParameters({ prompt: 'select_account' });

/** この端末で使うログイン方式 @type {import('./sign-in-method.js').SignInMethod} */
export const signInMethod = detectSignInMethod(firebaseConfig.authDomain);

/**
 * 遷移方式で戻ってきた場合の結果を受け取る。
 * ページ読み込み時に必ず一度呼ぶこと。
 *
 * @returns {Promise<{ok: boolean, message: string}>} 失敗時のみ message を持つ
 */
export async function handleRedirectResult() {
  try {
    await getRedirectResult(auth);
    return { ok: true, message: '' };
  } catch (error) {
    return { ok: false, message: toJapaneseMessage(error) };
  }
}

/**
 * ログインを開始する。
 *
 * popup 方式は「利用者の操作」と結び付いている必要がある。
 * この関数より前に await を挟むとブラウザが別窓を塞ぐため、
 * 呼び出し側は押下イベントから直接呼ぶこと。
 *
 * @returns {Promise<{ok: boolean, message: string}>}
 */
export async function startSignIn() {
  if (signInMethod === 'blocked') {
    return {
      ok: false,
      message:
        'この端末（iPhone・iPad）では、配信元とFirebaseのドメインが違うためログインできません。' +
        'Firebase Hosting の URL から開き直してください。',
    };
  }

  if (signInMethod === 'redirect') {
    try {
      await signInWithRedirect(auth, provider);
      return { ok: true, message: '' };
    } catch (error) {
      return { ok: false, message: toJapaneseMessage(error) };
    }
  }

  // popup 方式。別窓が塞がれた場合などは遷移方式に切り替えて再挑戦する
  try {
    await signInWithPopup(auth, provider);
    return { ok: true, message: '' };
  } catch (error) {
    if (shouldFallbackToRedirect(error)) {
      try {
        await signInWithRedirect(auth, provider);
        return { ok: true, message: '' };
      } catch (redirectError) {
        return { ok: false, message: toJapaneseMessage(redirectError) };
      }
    }
    return { ok: false, message: toJapaneseMessage(error) };
  }
}

/**
 * ログイン状態の変化を監視する。
 * @param {(user: import('https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js').User | null) => void} callback
 * @returns {() => void} 監視を止める関数
 */
export function observeUser(callback) {
  return onAuthStateChanged(auth, callback);
}

/**
 * ログアウトする。
 * @returns {Promise<void>}
 */
export function doSignOut() {
  return signOut(auth);
}

/**
 * popup が使えなかったときに遷移方式へ切り替えるべきかを判定する。
 * 利用者が自分で閉じた場合は切り替えない（意図を尊重する）。
 *
 * @param {{code?: string}} error
 * @returns {boolean}
 */
function shouldFallbackToRedirect(error) {
  const fallbackCodes = [
    'auth/popup-blocked',
    'auth/operation-not-supported-in-this-environment',
    'auth/web-storage-unsupported',
    'auth/missing-initial-state',
  ];
  return fallbackCodes.includes(String(error?.code ?? ''));
}

/**
 * Firebase のエラーを日本語の説明に変換する。
 * 原因ごとに次の行動が分かる文言にする。
 *
 * @param {{code?: string, message?: string}} error
 * @returns {string}
 */
function toJapaneseMessage(error) {
  const code = String(error?.code ?? '');

  /** @type {Record<string, string>} */
  const messages = {
    'auth/popup-closed-by-user': 'ログイン用の画面が閉じられました。もう一度お試しください。',
    'auth/cancelled-popup-request': 'ログインの操作が重なりました。もう一度お試しください。',
    'auth/popup-blocked':
      'ブラウザが別画面を塞ぎました。ポップアップを許可するか、もう一度お試しください。',
    'auth/unauthorized-domain':
      'このドメインはFirebaseに登録されていません。コンソールの「承認済みドメイン」に追加してください。',
    'auth/network-request-failed':
      '通信に失敗しました。電波の届く場所でもう一度お試しください。',
    'auth/internal-error': 'Firebase側で問題が起きました。時間をおいてお試しください。',
  };

  if (messages[code]) return messages[code];

  // sessionStorage の分割によるもの。原因が分かりにくいので個別に説明する
  if (String(error?.message ?? '').includes('missing initial state')) {
    return (
      'ログインの途中経過が保持できませんでした。' +
      '配信元とFirebaseのドメインが一致しているか確認してください。'
    );
  }

  return 'ログインに失敗しました（' + (code || '原因不明') + '）。';
}
