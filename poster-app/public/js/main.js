// 画面の制御。
// 認証まわりの判断は auth.js に、方式の判定は sign-in-method.js に置き、
// このファイルは「どの画面を出すか」だけを扱う。

/**
 * 要素を取り出す。取れなければ組み立てを間違えているので即座に落とす。
 * @param {string} id
 * @returns {HTMLElement}
 */
function el(id) {
  const node = document.getElementById(id);
  if (node === null) throw new Error('要素が見つかりません: ' + id);
  return node;
}

/**
 * 指定した画面だけを表示する。
 * @param {'loading' | 'signin' | 'setup' | 'app'} name
 * @returns {void}
 */
function showView(name) {
  for (const key of ['loading', 'signin', 'setup', 'app']) {
    el(key + '-view').hidden = key !== name;
  }
}

/**
 * ログイン方式ごとの補足説明。実機で確認するときの手掛かりになる。
 * @param {string} method
 * @returns {string}
 */
function describeMethod(method) {
  /** @type {Record<string, string>} */
  const notes = {
    popup: '別画面を開く方式（popup）でログインしました。パソコン向けの経路です。',
    redirect:
      'ページ遷移方式（redirect）でログインしました。iPhone・iPadで必要な経路です。',
    blocked: 'ログインできない構成として判定されました。',
  };
  return notes[method] ?? '';
}

/**
 * 起動処理。
 * @returns {Promise<void>}
 */
async function start() {
  // 設定ファイルが無いときに真っ白な画面にせず、原因を出す
  /** @type {typeof import('./auth.js')} */
  let auth;
  try {
    auth = await import('./auth.js');
  } catch (error) {
    el('setup-error-text').textContent = String(error?.message ?? error);
    showView('setup');
    return;
  }

  const { firebaseConfig } = await import('./firebase-config.js');

  // 遷移方式で戻ってきた場合の結果を先に受け取る
  const redirect = await auth.handleRedirectResult();
  if (!redirect.ok) {
    el('signin-error-text').textContent = redirect.message;
    el('signin-error').hidden = false;
  }

  // この端末でログインできない構成なら、押す前に理由を出す
  if (auth.signInMethod === 'blocked') {
    el('domain-warning').hidden = false;
    /** @type {HTMLButtonElement} */ (el('signin-button')).disabled = true;
  }

  el('signin-button').addEventListener('click', async () => {
    // popup は押下との結び付きが要るため、ここより前に await を挟まない
    el('signin-error').hidden = true;
    const result = await auth.startSignIn();
    if (!result.ok) {
      el('signin-error-text').textContent = result.message;
      el('signin-error').hidden = false;
    }
  });

  el('signout-button').addEventListener('click', () => {
    void auth.doSignOut();
  });

  auth.observeUser((user) => {
    if (user === null) {
      el('user-area').hidden = true;
      showView('signin');
      return;
    }

    el('user-name').textContent = user.email ?? user.displayName ?? '';
    el('user-area').hidden = false;

    el('fact-email').textContent = user.email ?? '(取得できません)';
    el('fact-uid').textContent = user.uid;
    el('fact-host').textContent = location.hostname;
    el('fact-authdomain').textContent = firebaseConfig.authDomain;
    el('fact-method').textContent = auth.signInMethod;

    const note = describeMethod(auth.signInMethod);
    if (note !== '') {
      el('method-note-text').textContent = note;
      el('method-note').hidden = false;
    }

    showView('app');
  });
}

void start();
