// 画面の制御。
// 認証は auth.js、方式の判定は sign-in-method.js、
// 列定義は schema.js、Firestore は db.js に置いてある。
// このファイルは「何を表示し、どの操作で何を呼ぶか」だけを扱う。

import {
  orderedColumns,
  addCustomColumn,
  removeColumn,
  COLUMN_TYPES,
} from './schema.js';

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
 * @param {'loading' | 'signin' | 'setup' | 'empty' | 'app'} name
 * @returns {void}
 */
function showView(name) {
  for (const key of ['loading', 'signin', 'setup', 'empty', 'app']) {
    el(key + '-view').hidden = key !== name;
  }
}

/**
 * 通知欄にエラーを出す。message が空なら隠す。
 * @param {string} noticeId
 * @param {string} textId
 * @param {string} message
 * @returns {void}
 */
function showError(noticeId, textId, message) {
  el(textId).textContent = message;
  el(noticeId).hidden = message === '';
}

/**
 * 例外の中身を利用者向けの文言にする。
 * @param {unknown} error
 * @returns {string}
 */
function toMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** 型の表示名 */
const TYPE_LABELS = {
  text: '文字', number: '数値', date: '日付', check: 'チェック', select: '選択',
};

/**
 * 画面の状態。
 * @type {{uid: string, candidates: import('./db.js').Candidate[], currentId: string}}
 */
const state = { uid: '', candidates: [], currentId: '' };

/**
 * 表示中の候補者を返す。
 * @returns {import('./db.js').Candidate | undefined}
 */
function current() {
  return state.candidates.find((c) => c.id === state.currentId);
}

/**
 * 最後に見ていた候補者を覚えておく鍵。
 * 利用者ごとに分ける（同じ端末を別アカウントで使う場合のため）。
 * @param {string} uid
 * @returns {string}
 */
function lastCandidateKey(uid) {
  return 'poster-app:last-candidate:' + uid;
}

async function start() {
  /** @type {typeof import('./auth.js')} */
  let auth;
  try {
    auth = await import('./auth.js');
  } catch (error) {
    el('setup-error-text').textContent = toMessage(error);
    showView('setup');
    return;
  }

  const { firebaseConfig } = await import('./firebase-config.js');
  const db = await import('./db.js');

  const redirect = await auth.handleRedirectResult();
  if (!redirect.ok) showError('signin-error', 'signin-error-text', redirect.message);

  if (auth.signInMethod === 'blocked') {
    el('domain-warning').hidden = false;
    /** @type {HTMLButtonElement} */ (el('signin-button')).disabled = true;
  }

  el('signin-button').addEventListener('click', async () => {
    showError('signin-error', 'signin-error-text', '');
    const result = await auth.startSignIn();
    if (!result.ok) showError('signin-error', 'signin-error-text', result.message);
  });

  el('signout-button').addEventListener('click', () => void auth.doSignOut());

  // ---------------------------------------------------------------- 描画

  /**
   * 候補者を読み直して画面全体を描き直す。
   * @returns {Promise<void>}
   */
  async function reload() {
    state.candidates = await db.listCandidates(state.uid);

    if (state.candidates.length === 0) {
      state.currentId = '';
      el('candidate-area').hidden = true;
      showView('empty');
      return;
    }

    const remembered = localStorage.getItem(lastCandidateKey(state.uid)) ?? '';
    const stillExists = state.candidates.some((c) => c.id === remembered);
    if (!state.candidates.some((c) => c.id === state.currentId)) {
      state.currentId = stillExists ? remembered : state.candidates[0].id;
    }
    localStorage.setItem(lastCandidateKey(state.uid), state.currentId);

    el('candidate-area').hidden = false;
    showView('app');
    renderSelect();
    renderCandidate();
    renderColumns();
    void renderCount();
  }

  /** 候補者の選択欄を描く @returns {void} */
  function renderSelect() {
    const select = /** @type {HTMLSelectElement} */ (el('candidate-select'));
    select.replaceChildren(
      ...state.candidates.map((c) => {
        const option = document.createElement('option');
        option.value = c.id;
        option.textContent = c.name;
        option.selected = c.id === state.currentId;
        return option;
      }),
    );
  }

  /** 表示中の候補者の情報を描く @returns {void} */
  function renderCandidate() {
    const candidate = current();
    if (candidate === undefined) return;

    el('candidate-title').textContent = candidate.name + ' の台帳';
    /** @type {HTMLInputElement} */ (el('rename-candidate-name')).value = candidate.name;
    el('fact-columns').textContent =
      orderedColumns(candidate.columns, { includeHidden: true }).length + ' 列';
  }

  /** ポスター件数を数えて出す。通信を伴うので個別に呼ぶ @returns {Promise<void>} */
  async function renderCount() {
    const candidate = current();
    if (candidate === undefined) return;
    try {
      const count = await db.countPosters(state.uid, candidate.id);
      el('fact-posters').textContent = count + ' 件';
    } catch {
      // 圏外などで数えられないことがある。画面を壊さず伏せる
      el('fact-posters').textContent = '—';
    }
  }

  /** 追加した列の一覧を描く @returns {void} */
  function renderColumns() {
    const candidate = current();
    if (candidate === undefined) return;

    const custom = candidate.columns.filter((c) => !c.system);
    const list = el('custom-column-list');

    if (custom.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'list__empty';
      empty.textContent = 'まだ追加した列はありません。';
      list.replaceChildren(empty);
      return;
    }

    list.replaceChildren(
      ...custom.map((column) => {
        const item = document.createElement('li');
        item.className = 'list__item';

        const name = document.createElement('span');
        name.className = 'list__name';
        name.textContent = column.label;

        const type = document.createElement('span');
        type.className = 'list__type';
        type.textContent = TYPE_LABELS[column.type] ?? column.type;
        name.append(type);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'button button--quiet';
        remove.textContent = '削除';
        remove.addEventListener('click', () => void onRemoveColumn(column));

        item.append(name, remove);
        return item;
      }),
    );
  }

  // ---------------------------------------------------------------- 操作

  /**
   * 列を消す。入っている値も一緒に見えなくなるため確認を取る。
   * @param {import('./schema.js').Column} column
   * @returns {Promise<void>}
   */
  async function onRemoveColumn(column) {
    const ok = window.confirm(
      '列「' + column.label + '」を削除します。\n' +
      'この列に入力した値は表示されなくなります。よろしいですか？',
    );
    if (!ok) return;

    const candidate = current();
    if (candidate === undefined) return;

    try {
      const next = removeColumn(candidate.columns, column.key);
      await db.saveColumns(state.uid, candidate.id, next);
      await reload();
    } catch (error) {
      showError('column-error', 'column-error-text', toMessage(error));
    }
  }

  el('candidate-select').addEventListener('change', (event) => {
    state.currentId = /** @type {HTMLSelectElement} */ (event.target).value;
    localStorage.setItem(lastCandidateKey(state.uid), state.currentId);
    renderCandidate();
    renderColumns();
    void renderCount();
  });

  el('first-candidate-create').addEventListener('click', async () => {
    const input = /** @type {HTMLInputElement} */ (el('first-candidate-name'));
    try {
      showError('empty-error', 'empty-error-text', '');
      state.currentId = await db.createCandidate(state.uid, input.value);
      input.value = '';
      await reload();
    } catch (error) {
      showError('empty-error', 'empty-error-text', toMessage(error));
    }
  });

  el('new-candidate-create').addEventListener('click', async () => {
    const input = /** @type {HTMLInputElement} */ (el('new-candidate-name'));
    try {
      showError('candidate-error', 'candidate-error-text', '');
      state.currentId = await db.createCandidate(state.uid, input.value);
      input.value = '';
      await reload();
    } catch (error) {
      showError('candidate-error', 'candidate-error-text', toMessage(error));
    }
  });

  el('rename-candidate-save').addEventListener('click', async () => {
    const input = /** @type {HTMLInputElement} */ (el('rename-candidate-name'));
    try {
      showError('candidate-error', 'candidate-error-text', '');
      await db.renameCandidate(state.uid, state.currentId, input.value);
      await reload();
    } catch (error) {
      showError('candidate-error', 'candidate-error-text', toMessage(error));
    }
  });

  el('archive-candidate').addEventListener('click', async () => {
    const candidate = current();
    if (candidate === undefined) return;

    const ok = window.confirm(
      '「' + candidate.name + '」を保管します。\n' +
      '一覧から外れますが、データは消えません。よろしいですか？',
    );
    if (!ok) return;

    try {
      showError('candidate-error', 'candidate-error-text', '');
      await db.archiveCandidate(state.uid, candidate.id);
      state.currentId = '';
      await reload();
    } catch (error) {
      showError('candidate-error', 'candidate-error-text', toMessage(error));
    }
  });

  el('new-column-add').addEventListener('click', async () => {
    const labelInput = /** @type {HTMLInputElement} */ (el('new-column-label'));
    const typeSelect = /** @type {HTMLSelectElement} */ (el('new-column-type'));
    const candidate = current();
    if (candidate === undefined) return;

    try {
      showError('column-error', 'column-error-text', '');
      const type = /** @type {import('./schema.js').ColumnType} */ (typeSelect.value);
      if (!COLUMN_TYPES.includes(type)) throw new Error('知らない列の型です');

      const next = addCustomColumn(candidate.columns, { label: labelInput.value, type });
      await db.saveColumns(state.uid, candidate.id, next);
      labelInput.value = '';
      await reload();
    } catch (error) {
      showError('column-error', 'column-error-text', toMessage(error));
    }
  });

  // ---------------------------------------------------------------- 起動

  auth.observeUser(async (user) => {
    if (user === null) {
      state.uid = '';
      state.candidates = [];
      el('user-area').hidden = true;
      el('candidate-area').hidden = true;
      showView('signin');
      return;
    }

    state.uid = user.uid;
    el('user-name').textContent = user.email ?? user.displayName ?? '';
    el('user-area').hidden = false;

    // ログイン経路の記録。不具合が出たときの切り分けに使う
    el('diagnostics').textContent =
      '配信元 ' + location.hostname +
      '／認証 ' + firebaseConfig.authDomain +
      '／方式 ' + auth.signInMethod;

    showView('loading');
    try {
      await reload();
    } catch (error) {
      el('setup-error-text').textContent = toMessage(error);
      showView('setup');
    }
  });
}

void start();
