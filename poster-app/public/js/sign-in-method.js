/**
 * ログイン方式の判定。
 *
 * iOS（iPhone / iPad）で Firebase の Google ログインを通すには
 * 「配信元と authDomain のドメイン一致」と「signInWithRedirect」の
 * 両方が必要である。片方だけでは通らない。
 *
 * 認証ハンドラーは Google へ遷移する前に sessionStorage へ状態を書き、
 * 戻った後に読む。WebKit はストレージをドメイン単位で分割するため、
 * ドメインが異なると書き込み先と読み出し先が別領域になり失敗する
 * （Unable to process request due to missing initial state）。
 * これは iOS 版 Chrome でも起きる（中身が WebKit のため）。
 *
 * このモジュールは Firebase に依存しない純粋関数のみで構成する。
 */

/**
 * ログイン方式。
 * - popup    … 別窓を開く方式。パソコン向け
 * - redirect … ページ自体が遷移する方式。iOS 向け
 * - blocked  … 試しても通らないため、理由を案内する
 * @typedef {'popup' | 'redirect' | 'blocked'} SignInMethod
 */

/**
 * 実行環境が iOS（WebKit）かどうかを判定する。
 *
 * iPadOS 13 以降は User-Agent が「Macintosh」を名乗るため、
 * タッチ点数を併用しないとパソコンの Mac と区別できない。
 *
 * @param {string} userAgent navigator.userAgent
 * @param {number} maxTouchPoints navigator.maxTouchPoints
 * @param {string} platform navigator.platform
 * @returns {boolean} iOS なら true
 */
export function isWebKitIOS(userAgent, maxTouchPoints, platform) {
  const ua = String(userAgent ?? '');
  const plat = String(platform ?? '');
  const touch = Number(maxTouchPoints ?? 0);

  if (/iPhone|iPod|iPad/.test(ua)) return true;

  // iPadOS 13以降。Macintosh を名乗るがタッチ操作を受け付ける
  if (/Macintosh/.test(ua) && plat === 'MacIntel' && touch > 1) return true;

  return false;
}

/**
 * 配信元のホストと Firebase の authDomain が一致しているかを判定する。
 *
 * どちらかが空のときは「一致していない」として扱う。
 * 判定できないまま一致とみなすと、通らない方式を選んでしまうため。
 *
 * @param {string} currentHost location.hostname
 * @param {string} authDomain Firebase の設定値
 * @returns {boolean} 一致していれば true
 */
export function isSameAuthDomain(currentHost, authDomain) {
  const host = String(currentHost ?? '').toLowerCase();
  const auth = String(authDomain ?? '').toLowerCase();

  if (host === '' || auth === '') return false;

  return host === auth;
}

/**
 * 環境に応じたログイン方式を決める。
 *
 * 判定材料が取れないときは popup に任せる。
 * 誤判定で「今動いている環境」を壊さないことを優先する。
 *
 * @param {object} env
 * @param {string} env.userAgent
 * @param {number} env.maxTouchPoints
 * @param {string} env.platform
 * @param {string} env.host 配信元のホスト名
 * @param {string} env.authDomain Firebase の authDomain
 * @returns {SignInMethod}
 */
export function chooseSignInMethod(env) {
  const { userAgent, maxTouchPoints, platform, host, authDomain } = env;

  if (!isWebKitIOS(userAgent, maxTouchPoints, platform)) {
    return 'popup';
  }

  // ここから先は iOS。ドメインが一致していなければ遷移方式でも通らない
  return isSameAuthDomain(host, authDomain) ? 'redirect' : 'blocked';
}

/**
 * 実行中のブラウザからログイン方式を決める。
 * 画面側はこの関数だけを呼べばよい。
 *
 * @param {string} authDomain Firebase の authDomain
 * @returns {SignInMethod}
 */
export function detectSignInMethod(authDomain) {
  return chooseSignInMethod({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    platform: navigator.platform,
    host: location.hostname,
    authDomain,
  });
}
