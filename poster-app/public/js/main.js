// 画面の制御。
//   認証        auth.js / sign-in-method.js
//   列定義      schema.js
//   並べ替え等  table.js
//   Firestore   db.js
// このファイルは「何を表示し、どの操作で何を呼ぶか」だけを扱う。

import {
  orderedColumns,
  addCustomColumn,
  removeColumn,
  createEmptyPoster,
  COLUMN_TYPES,
  STATUS_OPTIONS,
} from './schema.js';

import {
  posterValue,
  setPosterValue,
  formatValue,
  parseValue,
  sortPosters,
  filterPosters,
} from './table.js';

import { createMap } from './map.js';
import {
  emptyFilters, isFiltered, applyFilters, describeFilters, nextPosterNo,
  FLAG_OPTIONS, DAYS_OPTIONS, TIMES_OPTIONS,
} from './filters.js';
import { distanceOf, formatDistance, sortByDistance } from './distance.js';
import {
  summarize, byDistrict, stalest, lastRefreshedOn, ageDistribution, byIntroducer,
  monthlyReplacements, byOwner, replaceCountDistribution,
} from './stats.js';
import { coverageByTown, formatPer10k, BASIS } from './coverage.js';
import { hasChanges } from './changes.js';
import { historyOf, addReplacement, correctLatest } from './replacements.js';
import { parseCsv, buildCsv, csvColumns, decodeCsvBytes, withBom } from './csv.js';
import { buildImportPlan } from './import-plan.js';
import { TOWN_POPULATION, POPULATION_AS_OF } from './population.js';
import {
  PALETTE, modeForColumn, defaultRuleFor, REFRESHED_FIELD, bucketOf, buildLegend,
} from './color-rules.js';
import { geocodeAddress, reverseGeocode } from './geocode.js';
import { buildShareSummary, summaryToText, postersToText } from './share.js';
import { drawSummary } from './share-image.js';

/** @param {string} id @returns {HTMLElement} */
function el(id) {
  const node = document.getElementById(id);
  if (node === null) throw new Error('要素が見つかりません: ' + id);
  return node;
}

/** @param {'loading'|'setup'|'empty'|'app'} name @returns {void} */
function showView(name) {
  for (const key of ['loading', 'setup', 'empty', 'app']) {
    el(key + '-view').hidden = key !== name;
  }
}

/** @param {string} noticeId @param {string} textId @param {string} message @returns {void} */
function showError(noticeId, textId, message) {
  el(textId).textContent = message;
  el(noticeId).hidden = message === '';
}

/** @param {unknown} error @returns {string} */
function toMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** 型の表示名 */
const TYPE_LABELS = {
  text: '文字', number: '数値', date: '日付', check: 'チェック', select: '選択',
};

/**
 * 画面の状態。
 * @type {{
 *   uid: string,
 *   mode: 'local' | 'cloud',
 *   candidates: any[],
 *   currentId: string,
 *   posters: Record<string, *>[],
 *   unwatch: (() => void) | null,
 *   sortKey: string,
 *   sortDir: 'asc' | 'desc',
 *   search: string,
 *   editingId: string | null,
 *   draft: Record<string, *> | null,
 * }}
 */
const state = {
  // mode は保存先。'local' は端末の中だけ、'cloud' はアカウント（同期あり）
  uid: '', mode: 'local', candidates: [], currentId: '',
  posters: [], unwatch: null,
  sortKey: 'no', sortDir: 'asc', filters: emptyFilters(),
  editingId: null, draft: null,
  map: null,
  editingRule: null,
  lastMove: null,
  here: null,
  selected: new Set(),
  coverageBasis: BASIS.voters,
  editingOriginal: null,
  sync: { fromCache: false, pending: false },
  editingCell: null,
  importRows: null,
  importPlan: null,
};

/** @returns {any} */
function current() {
  return state.candidates.find((c) => c.id === state.currentId);
}

/** @param {string} uid @returns {string} */
function lastCandidateKey(uid) {
  return 'poster-app:last-candidate:' + uid;
}

async function start() {
  // 端末内保存で立ち上げる。
  // ログインは「複数の端末で同じデータを見る」ためのもので、使用の条件ではない。
  const { createLocalDb, LOCAL_UID } = await import('./local-db.js');
  const { createIdbStorage, clearLocalData } = await import('./idb.js');

  const localDb = createLocalDb(createIdbStorage());

  /**
   * いま使っている保存先。ログインの前後で差し替える。
   * 画面側はこの変数しか見ないため、切り替えても呼び出し方は変わらない。
   * @type {*}
   */
  let db = localDb;

  state.uid = LOCAL_UID;
  state.mode = 'local';

  /**
   * ログインを試みたことがある端末かどうかの印。
   *
   * 「成功したか」ではなく「試みたか」で付ける。
   * 遷移方式のログインは Google の画面へ飛んで戻ってくる間にページが読み直される。
   * 成功したときに付ける作りだと、戻ってきた時点ではまだ印が無いため
   * 認証を読み込まず、ログインしたのに端末内保存のままになる。
   */
  const SIGNED_IN_KEY = 'poster-app:has-signed-in';

  /** @type {typeof import('./auth.js') | null} */
  let auth = null;
  /** @type {typeof import('./db.js') | null} */
  let cloudDb = null;
  /** @type {{authDomain?: string} | null} */
  let firebaseConfig = null;
  /** 取り込みの案内を閉じたか（この表示のあいだだけ覚える） */
  let migrateDismissed = false;

  // 接続設定が置かれているかだけを先に確かめる。
  // firebase-config.js は値の入れ物で SDK を読み込まないため、
  // ここを読んでも Firebase への通信は起きない
  let canSignIn = false;
  try {
    ({ firebaseConfig } = await import('./firebase-config.js'));
    canSignIn = true;
  } catch {
    // 設定が無い環境では同期が使えないだけ。端末内保存でそのまま使える
    canSignIn = false;
  }

  /**
   * 認証と Firestore を読み込む。一度だけ行う。
   *
   * ログインしたことがない端末ではこの関数が呼ばれず、
   * Firebase SDK の読み込み自体が起きない。圏外でも起動できる。
   *
   * @returns {Promise<{ok: boolean, message: string}>}
   */
  async function loadFirebase() {
    if (auth !== null) return { ok: true, message: '' };
    if (!canSignIn) {
      return { ok: false, message: 'この配信環境には Firebase の接続設定がありません。同期は使えません。' };
    }

    try {
      const loadedAuth = await import('./auth.js');
      cloudDb = await import('./db.js');
      auth = loadedAuth;

      // 遷移方式で戻ってきた場合の結果を先に受け取る
      const redirect = await loadedAuth.handleRedirectResult();

      if (loadedAuth.signInMethod === 'blocked') el('domain-warning').hidden = false;

      // 最初の状態が分かるまで待つ。待たずに進むと、ログイン済みの端末で
      // 一瞬だけ「この端末に保存中」と表示されてから切り替わる
      await new Promise((resolve) => {
        let settled = false;
        loadedAuth.observeUser((user) => {
          void onUserChanged(user);
          if (!settled) {
            settled = true;
            resolve(undefined);
          }
        });
      });

      return redirect.ok ? { ok: true, message: '' } : { ok: false, message: redirect.message };
    } catch (error) {
      auth = null;
      cloudDb = null;
      return { ok: false, message: '同期の準備ができませんでした（' + toMessage(error) + '）' };
    }
  }

  /**
   * ログイン状態が変わったときに保存先を切り替える。
   *
   * @param {*} user ログインしていなければ null
   * @returns {Promise<void>}
   */
  async function onUserChanged(user) {
    stopWatching();
    state.candidates = [];
    state.currentId = '';
    state.posters = [];

    if (user === null) {
      db = localDb;
      state.uid = LOCAL_UID;
      state.mode = 'local';
      el('migrate-notice').hidden = true;
    } else {
      db = cloudDb;
      state.uid = user.uid;
      state.mode = 'cloud';
      localStorage.setItem(SIGNED_IN_KEY, '1');
      el('user-name').textContent = user.email ?? user.displayName ?? '';
    }

    renderAccountArea();
    await reloadSafely();

    if (user !== null && !migrateDismissed) await offerMigration();
  }

  /**
   * 台帳を読み直す。失敗したときは原因を画面に出す。
   * @returns {Promise<void>}
   */
  async function reloadSafely() {
    showView('loading');
    showTab('list');
    try {
      await reload();
    } catch (error) {
      el('setup-error-text').textContent = toMessage(error);
      showView('setup');
    }
  }

  /**
   * ヘッダと診断表示を、いまの保存先に合わせて描く。
   * @returns {void}
   */
  function renderAccountArea() {
    const cloud = state.mode === 'cloud';

    el('local-badge').hidden = cloud;
    /** @type {HTMLButtonElement} */ (el('signin-button')).hidden = cloud || !canSignIn;
    el('user-name').hidden = !cloud;
    el('signout-button').hidden = !cloud;

    el('diagnostics').textContent = cloud
      ? '配信元 ' + location.hostname
        + '／認証 ' + (firebaseConfig?.authDomain ?? '—')
        + '／方式 ' + (auth?.signInMethod ?? '—')
      : '配信元 ' + location.hostname + '／保存先 この端末（IndexedDB）';

    void renderStoragePanel();
  }

  /**
   * 端末内に残っているデータの量を数える。
   * @returns {Promise<{candidates: number, posters: number}>}
   */
  async function countLocalData() {
    try {
      const candidates = await localDb.listCandidates(LOCAL_UID, { includeArchived: true });

      let posters = 0;
      for (const candidate of candidates) {
        posters += await localDb.countPosters(LOCAL_UID, candidate.id);
      }

      return { candidates: candidates.length, posters };
    } catch {
      // 端末内保存が使えない環境。ここで止める理由は無いので0として扱う
      return { candidates: 0, posters: 0 };
    }
  }

  /**
   * 設定タブの「データの保存先」を描く。
   * @returns {Promise<void>}
   */
  async function renderStoragePanel() {
    const cloud = state.mode === 'cloud';
    const local = await countLocalData();

    el('storage-mode-text').textContent = cloud
      ? 'ログイン中です。データはアカウントに保存され、'
        + '同じアカウントでログインした端末すべてで自動的に同期されます。'
      : 'ログインしていません。データはこの端末の中だけに保存されています。'
        + '他の端末には表示されず、ブラウザのデータを消すと失われます。'
        + 'ログインすると、複数の端末で同じ台帳を見られるようになります。';

    el('storage-signin').hidden = cloud || !canSignIn;
    el('storage-migrate').hidden = !cloud || local.candidates === 0;
    el('storage-clear').hidden = !cloud || local.candidates === 0;
  }

  /**
   * ログイン直後に、端末内のデータを取り込むか尋ねる。
   * 黙って移さないのは、アカウント側に同じ名前の台帳がある場合に
   * どちらが正しいかを機械では決められないため。
   *
   * @returns {Promise<void>}
   */
  async function offerMigration() {
    const local = await countLocalData();

    if (local.candidates === 0) {
      el('migrate-notice').hidden = true;
      return;
    }

    el('migrate-notice-text').textContent =
      'ログインせずに作った台帳が' + local.candidates + '件'
      + '（掲示場所' + local.posters + '件）この端末に残っています。'
      + 'アカウントに取り込むと、他の端末でも見られるようになります。';
    el('migrate-notice').hidden = false;
  }

  /**
   * 端末内のデータをアカウントへ取り込む。
   * @returns {Promise<void>}
   */
  async function runMigrationNow() {
    if (state.mode !== 'cloud' || cloudDb === null) return;

    const local = await countLocalData();
    if (local.candidates === 0) return;

    if (!window.confirm(
      'この端末に保存されている台帳' + local.candidates + '件を、'
      + 'いまログインしているアカウントに取り込みます。\n\n'
      + '・新しい台帳として追加します（アカウント側の既存の台帳は変わりません）\n'
      + '・同じ名前の台帳がある場合は、名前に印を付けて区別します\n'
      + '・取り込んだ後も、この端末のデータは残ります\n\n'
      + 'よろしいですか？',
    )) return;

    const button = /** @type {HTMLButtonElement} */ (el('storage-migrate'));
    button.disabled = true;
    showError('storage-error', 'storage-error-text', '');

    try {
      const { runMigration } = await import('./migrate.js');

      const result = await runMigration(localDb, cloudDb, state.uid, (progress) => {
        el('migrate-notice-text').textContent =
          '取り込んでいます… ' + progress.done + '/' + progress.total + '（' + progress.name + '）';
      });

      el('migrate-notice').hidden = true;
      migrateDismissed = true;

      el('storage-done-text').textContent =
        '台帳' + result.candidates + '件・掲示場所' + result.posters + '件を取り込みました。'
        + 'この端末のデータはそのまま残しています。'
        + '確認できたら「端末内のデータを消す」で片付けられます。';
      el('storage-done').hidden = false;

      await reloadSafely();
    } catch (error) {
      el('migrate-notice').hidden = true;
      showError('storage-error', 'storage-error-text',
        '取り込みに失敗しました（' + toMessage(error) + '）。'
        + '端末内のデータは残っているので、もう一度お試しください。');
      showTab('settings');
    } finally {
      button.disabled = false;
      void renderStoragePanel();
    }
  }

  /**
   * 端末内のデータを消す。取り消せない。
   * @returns {Promise<void>}
   */
  async function clearLocalNow() {
    const local = await countLocalData();
    if (local.candidates === 0) return;

    if (!window.confirm(
      'この端末に保存されている台帳' + local.candidates + '件'
      + '（掲示場所' + local.posters + '件）を消します。\n'
      + 'アカウント側のデータは消えません。\n\n'
      + 'この操作は取り消せません。よろしいですか？',
    )) return;

    // 取り消せない操作なので二度尋ねる
    if (!window.confirm('本当に消してよろしいですか？')) return;

    try {
      showError('storage-error', 'storage-error-text', '');
      await clearLocalData();

      el('storage-done-text').textContent = 'この端末に保存されていたデータを消しました。';
      el('storage-done').hidden = false;
      el('migrate-notice').hidden = true;
    } catch (error) {
      showError('storage-error', 'storage-error-text', toMessage(error));
    } finally {
      void renderStoragePanel();
    }
  }

  /**
   * ログインを始める。押されたときに初めて Firebase を読み込む。
   * @returns {Promise<void>}
   */
  async function startSignIn() {
    showError('signin-error', 'signin-error-text', '');

    const loaded = await loadFirebase();
    if (!loaded.ok) {
      showError('signin-error', 'signin-error-text', loaded.message);
      return;
    }

    // 既にログイン済みだった場合（読み込みの中で切り替わっている）
    if (state.mode === 'cloud') return;

    // 遷移方式では次の行から戻ってこない。飛ぶ前に印を付ける
    localStorage.setItem(SIGNED_IN_KEY, '1');

    const result = await /** @type {*} */ (auth).startSignIn();
    if (!result.ok) {
      showError('signin-error', 'signin-error-text', result.message);
      // 同期の準備自体ができないなら印を残さない。
      // 残すと、以後この端末は毎回 Firebase を読みに行くだけになる
      if (state.mode !== 'cloud') localStorage.removeItem(SIGNED_IN_KEY);
    }
  }

  el('signin-button').addEventListener('click', () => void startSignIn());
  el('storage-signin').addEventListener('click', () => void startSignIn());

  el('signout-button').addEventListener('click', () => {
    if (!window.confirm(
      'ログアウトすると、アカウントに保存された台帳は表示されなくなります。\n'
      + '（データは消えません。ログインし直せば元に戻ります）\n\n'
      + 'よろしいですか？',
    )) return;
    localStorage.removeItem(SIGNED_IN_KEY);
    void /** @type {*} */ (auth)?.doSignOut();
  });

  el('migrate-run').addEventListener('click', () => void runMigrationNow());
  el('storage-migrate').addEventListener('click', () => void runMigrationNow());
  el('storage-clear').addEventListener('click', () => void clearLocalNow());

  el('migrate-later').addEventListener('click', () => {
    migrateDismissed = true;
    el('migrate-notice').hidden = true;
    el('storage-done-text').textContent =
      '端末内のデータはそのまま残しています。'
      + 'この画面の「端末内のデータをアカウントに取り込む」からいつでも取り込めます。';
    el('storage-done').hidden = false;
  });

  // ================================================================ タブ

  /** @param {'list'|'map'|'dash'|'settings'} name @returns {void} */
  function showTab(name) {
    for (const key of ['list', 'map', 'dash', 'settings']) {
      el('panel-' + key).hidden = key !== name;
      el('tab-' + key).setAttribute('aria-selected', String(key === name));
    }

    if (name === 'map') {
      ensureMap();
      // 隠れている間に作られた地図は大きさが 0 のままなので測り直す
      state.map?.refresh();
      renderMap();
    }

    if (name === 'dash') renderDashboard();
  }

  el('tab-list').addEventListener('click', () => showTab('list'));
  el('tab-map').addEventListener('click', () => showTab('map'));
  el('tab-dash').addEventListener('click', () => showTab('dash'));
  el('tab-settings').addEventListener('click', () => showTab('settings'));

  // ================================================================ 候補者

  /** @returns {Promise<void>} */
  async function reload() {
    state.candidates = await db.listCandidates(state.uid);

    if (state.candidates.length === 0) {
      stopWatching();
      state.currentId = '';
      el('candidate-area').hidden = true;
      showView('empty');
      return;
    }

    const remembered = localStorage.getItem(lastCandidateKey(state.uid)) ?? '';
    if (!state.candidates.some((c) => c.id === state.currentId)) {
      state.currentId = state.candidates.some((c) => c.id === remembered)
        ? remembered
        : state.candidates[0].id;
    }
    localStorage.setItem(lastCandidateKey(state.uid), state.currentId);

    el('candidate-area').hidden = false;
    showView('app');
    renderSelect();
    renderCandidate();
    renderColumns();
    renderVisibility();
    renderRuleSelect();
    watchCurrent();
  }

  /** @returns {void} */
  function renderSelect() {
    const select = /** @type {HTMLSelectElement} */ (el('candidate-select'));
    select.replaceChildren(...state.candidates.map((c) => {
      const option = document.createElement('option');
      option.value = c.id;
      option.textContent = c.name;
      option.selected = c.id === state.currentId;
      return option;
    }));
  }

  /** @returns {void} */
  function renderCandidate() {
    const candidate = current();
    if (candidate === undefined) return;
    el('candidate-title').textContent = candidate.name + ' の台帳';
    /** @type {HTMLInputElement} */ (el('rename-candidate-name')).value = candidate.name;
    el('fact-columns').textContent =
      orderedColumns(candidate.columns, { includeHidden: true }).length + ' 列';
  }

  // ================================================================ ポスター

  /** @returns {void} */
  function stopWatching() {
    if (state.unwatch !== null) {
      state.unwatch();
      state.unwatch = null;
    }
    state.posters = [];
  }

  /**
   * 表示中の候補者のポスターを見張る。
   * 端末をまたいだ同期はここで効いている。
   * @returns {void}
   */
  function watchCurrent() {
    stopWatching();
    const candidate = current();
    if (candidate === undefined) return;

    el('list-count').textContent = '読み込んでいます…';

    state.unwatch = db.watchPosters(
      state.uid,
      candidate.id,
      (posters, sync) => {
        state.posters = posters;
        state.sync = sync;
        renderSyncBar();
        showError('list-error', 'list-error-text', '');
        renderFilterControls();
        renderTable();
        renderMap();
        renderDashboard();
        el('fact-posters').textContent = posters.length + ' 件';
      },
      (error) => {
        showError('list-error', 'list-error-text', toMessage(error));
        el('list-count').textContent = '';
      },
    );
  }

  /**
   * 現在の絞り込みと並べ替えを適用した行を返す。
   * @returns {Record<string, *>[]}
   */
  function visibleRows() {
    const candidate = current();
    if (candidate === undefined) return [];

    const filtered = applyFilters(state.posters, candidate.columns, state.filters, todayText());

    // 現在地からの距離は列ではないので、並べ替えを別に扱う
    if (state.sortKey === DISTANCE_KEY) {
      const near = sortByDistance(filtered, state.here);
      return state.sortDir === 'desc' ? near.reverse() : near;
    }

    const sortColumn = candidate.columns.find((c) => c.key === state.sortKey);
    return sortColumn === undefined
      ? filtered
      : sortPosters(filtered, sortColumn, state.sortDir);
  }

  /** @returns {void} */
  function renderTable() {
    const candidate = current();
    if (candidate === undefined) return;

    const columns = orderedColumns(candidate.columns);
    const rows = visibleRows();

    // --- 見出し ---
    const headCells = [];

    // 選択列。見出しの印は「いま出ている行を全部選ぶ」
    const selectTh = document.createElement('th');
    selectTh.className = 'is-select';
    const selectAll = document.createElement('input');
    selectAll.type = 'checkbox';
    selectAll.setAttribute('aria-label', '表示中の行をすべて選ぶ');
    const visibleIds = rows.map((r) => r.id);
    selectAll.checked = visibleIds.length > 0 && visibleIds.every((id) => state.selected.has(id));
    selectAll.addEventListener('change', () => {
      if (selectAll.checked) for (const id of visibleIds) state.selected.add(id);
      else for (const id of visibleIds) state.selected.delete(id);
      renderTable();
    });
    selectTh.append(selectAll);
    headCells.push(selectTh);

    // 現在地が分かっているときだけ距離を出す
    if (state.here !== null) {
      const th = document.createElement('th');
      th.className = 'is-distance';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sorter';
      button.textContent = '距離';
      if (state.sortKey === DISTANCE_KEY) {
        const mark = document.createElement('span');
        mark.className = 'sorter__mark';
        mark.textContent = state.sortDir === 'asc' ? '▲' : '▼';
        button.append(mark);
      }
      button.addEventListener('click', () => {
        if (state.sortKey === DISTANCE_KEY) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = DISTANCE_KEY;
          state.sortDir = 'asc';
        }
        renderTable();
      });
      th.append(button);
      headCells.push(th);
    }

    el('poster-head').replaceChildren(...headCells, ...columns.map((column) => {
      const th = document.createElement('th');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sorter';
      button.textContent = column.label;

      if (state.sortKey === column.key) {
        const mark = document.createElement('span');
        mark.className = 'sorter__mark';
        // 記号だけでなく読み上げ用の説明も持たせる
        mark.textContent = state.sortDir === 'asc' ? '▲' : '▼';
        button.append(mark);
        button.setAttribute('aria-label',
          column.label + '（' + (state.sortDir === 'asc' ? '昇順' : '降順') + '）');
      }

      button.addEventListener('click', () => {
        if (state.sortKey === column.key) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = column.key;
          state.sortDir = 'asc';
        }
        renderTable();
      });

      th.append(button);
      return th;
    }));

    // --- 本体 ---
    el('poster-body').replaceChildren(...rows.map((poster) => {
      const tr = document.createElement('tr');
      tr.classList.toggle('is-selected', state.selected.has(poster.id));

      const selectTd = document.createElement('td');
      selectTd.className = 'is-select';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = state.selected.has(poster.id);
      check.setAttribute('aria-label', 'この行を選ぶ');
      // 行を押すと編集が開くので、印の操作は行に伝えない
      check.addEventListener('click', (event) => event.stopPropagation());
      check.addEventListener('change', () => {
        if (check.checked) state.selected.add(poster.id);
        else state.selected.delete(poster.id);
        renderTable();
      });
      selectTd.append(check);
      tr.append(selectTd);

      if (state.here !== null) {
        const td = document.createElement('td');
        td.className = 'is-distance';
        td.textContent = formatDistance(distanceOf(poster, state.here));
        tr.append(td);
      }

      for (const column of columns) {
        tr.append(buildCell(poster, column));
      }
      return tr;
    }));

    const total = state.posters.length;
    const filtered = isFiltered(state.filters);
    el('list-count').textContent = filtered
      ? rows.length + ' 件 / 全 ' + total + ' 件（' + describeFilters(state.filters) + '）'
      : total + ' 件';
    el('list-count').classList.toggle('is-filtered', filtered);
    el('filter-clear').hidden = !filtered;

    el('list-empty').hidden = rows.length > 0;
    renderBulkBar();
  }

  el('search').addEventListener('input', (event) => {
    state.filters.text = /** @type {HTMLInputElement} */ (event.target).value;
    onFiltersChanged();
  });




  /**
   * 通信と同期の状態を出す。
   *
   * 圏外でも編集はできる（手元に控えて後で送る）。ただしそれが分からないと
   * 「保存できたのか」が不安になり、二重入力の原因になる。
   *
   * @returns {void}
   */
  function renderSyncBar() {
    const bar = el('sync-bar');

    // 端末内保存のときは同期そのものが無い。
    // ここで「オフライン」と出すと、通信の不具合だと誤解させる。
    // 保存先はヘッダの「この端末に保存中」が伝えている
    if (state.mode === 'local') {
      bar.hidden = true;
      return;
    }

    const offline = navigator.onLine === false;

    if (offline) {
      bar.hidden = false;
      bar.classList.remove('syncbar--ok');
      el('sync-label').textContent = 'オフライン';
      el('sync-text').textContent =
        '編集はできます。この端末に控えて、電波が戻ったときにまとめて送ります。';
      return;
    }

    if (state.sync.pending) {
      bar.hidden = false;
      bar.classList.remove('syncbar--ok');
      el('sync-label').textContent = '送信中';
      el('sync-text').textContent = 'まだ送れていない変更があります。';
      return;
    }

    // 復帰した直後だけ短く知らせる。常時出していると読まなくなる
    if (bar.hidden === false && bar.classList.contains('syncbar--ok') === false) {
      bar.classList.add('syncbar--ok');
      el('sync-label').textContent = '同期しました';
      el('sync-text').textContent = 'この端末の変更はすべて反映されています。';
      setTimeout(() => { bar.hidden = true; }, 4000);
      return;
    }

    bar.hidden = true;
  }

  window.addEventListener('online', renderSyncBar);
  window.addEventListener('offline', renderSyncBar);

  // ================================================================ 一括操作・現在地

  /** 距離での並べ替えを表す印。列ではないので通常のキーと分ける */
  const DISTANCE_KEY = '__distance';

  /** 一括操作の帯を描く @returns {void} */
  function renderBulkBar() {
    const count = state.selected.size;
    el('bulk-bar').hidden = count === 0;
    if (count === 0) return;

    el('bulk-count').textContent = count + ' 件を選択中';

    const status = /** @type {HTMLSelectElement} */ (el('bulk-status'));
    if (status.options.length <= 1) {
      status.replaceChildren(
        Object.assign(document.createElement('option'), { value: '', textContent: '状態を変える…' }),
        ...STATUS_OPTIONS.map((option) => Object.assign(document.createElement('option'), {
          value: option, textContent: option + ' にする',
        })),
      );
    }

    const flag = /** @type {HTMLSelectElement} */ (el('bulk-flag'));
    if (flag.options.length <= 1) {
      const items = [
        Object.assign(document.createElement('option'), { value: '', textContent: '条件を設定…' }),
      ];
      for (const option of FLAG_OPTIONS) {
        items.push(Object.assign(document.createElement('option'), {
          value: option.key + ':on', textContent: option.label + ' をつける',
        }));
        items.push(Object.assign(document.createElement('option'), {
          value: option.key + ':off', textContent: option.label + ' をはずす',
        }));
      }
      items.push(Object.assign(document.createElement('option'), {
        value: 'showOnMap:on', textContent: 'マップ掲載 をつける',
      }));
      items.push(Object.assign(document.createElement('option'), {
        value: 'showOnMap:off', textContent: 'マップ掲載 をはずす',
      }));
      flag.replaceChildren(...items);
    }
  }

  /**
   * 選んだ行に同じ内容をまとめて当てる。
   * 件数を明示して確認を取る。取り消せない操作のため。
   *
   * @param {Record<string, *>} patch
   * @param {string} description 確認文に出す説明
   * @returns {Promise<void>}
   */
  async function applyBulk(patch, description) {
    const candidate = current();
    if (candidate === undefined || state.selected.size === 0) return;

    const ids = [...state.selected];
    if (!window.confirm(
      ids.length + ' 件を ' + description + '。\n元に戻せません。よろしいですか？',
    )) return;

    try {
      showError('list-error', 'list-error-text', '');
      await db.updatePostersBulk(state.uid, candidate.id, ids, patch);
      state.selected.clear();
      renderTable();
    } catch (error) {
      showError('list-error', 'list-error-text', toMessage(error));
    }
  }

  /**
   * 選んだ行に「今日貼り替えた」を記録する。
   *
   * 行ごとに履歴が違うため、共通の内容ではなく行ごとの差分を作る。
   * 既に今日の記録がある行は書かない（二度押しで実績が二重にならない）。
   *
   * @returns {Promise<void>}
   */
  async function markReplacedToday() {
    const candidate = current();
    if (candidate === undefined || state.selected.size === 0) return;

    const today = todayText();

    /** @type {{id: string, patch: Record<string, *>}[]} */
    const patches = [];
    for (const poster of state.posters) {
      if (!state.selected.has(poster.id)) continue;

      const change = addReplacement(poster, today);
      if (change === null) continue;

      const stored = Array.isArray(poster.replacements) ? poster.replacements : null;
      const unchanged = stored !== null
        && stored.join(',') === change.replacements.join(',')
        && (poster.lastReplacedOn ?? null) === change.lastReplacedOn;
      if (unchanged) continue;

      patches.push({ id: poster.id, patch: change });
    }

    if (patches.length === 0) {
      showError('list-error', 'list-error-text', '選んだ行には既に ' + today + ' の貼替が記録されています。');
      return;
    }

    if (!window.confirm(
      patches.length + ' 件に ' + today + ' の貼替を記録します。\n元に戻せません。よろしいですか？',
    )) return;

    try {
      showError('list-error', 'list-error-text', '');
      await db.updatePostersEach(state.uid, candidate.id, patches);
      state.selected.clear();
      renderTable();
    } catch (error) {
      showError('list-error', 'list-error-text', toMessage(error));
    }
  }

  el('bulk-today').addEventListener('click', () => {
    void markReplacedToday();
  });

  el('bulk-status').addEventListener('change', (event) => {
    const select = /** @type {HTMLSelectElement} */ (event.target);
    const value = select.value;
    select.selectedIndex = 0;
    if (value === '') return;
    void applyBulk({ status: value }, '状態を「' + value + '」にします');
  });

  el('bulk-flag').addEventListener('change', (event) => {
    const select = /** @type {HTMLSelectElement} */ (event.target);
    const value = select.value;
    select.selectedIndex = 0;
    if (value === '') return;

    const [key, onOff] = value.split(':');
    const on = onOff === 'on';
    const label = FLAG_OPTIONS.find((o) => o.key === key)?.label
      ?? (key === 'showOnMap' ? 'マップ掲載' : key);
    void applyBulk({ [key]: on }, '「' + label + '」を' + (on ? 'つけます' : 'はずします'));
  });

  el('bulk-clear').addEventListener('click', () => {
    state.selected.clear();
    renderTable();
  });

  el('list-locate').addEventListener('click', async () => {
    const button = /** @type {HTMLButtonElement} */ (el('list-locate'));
    button.disabled = true;
    try {
      showError('list-error', 'list-error-text', '');
      const position = await new Promise((resolve, reject) => {
        if (navigator.geolocation === undefined) {
          reject(new Error('この端末では現在地を取得できません'));
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, (error) => {
          const messages = {
            1: '位置情報の利用が許可されていません。端末の設定をご確認ください。',
            2: '現在地を取得できませんでした。屋外でお試しください。',
            3: '現在地の取得に時間がかかっています。もう一度お試しください。',
          };
          reject(new Error(messages[error.code] ?? '現在地を取得できませんでした'));
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
      });

      state.here = { lat: position.coords.latitude, lng: position.coords.longitude };
      state.sortKey = DISTANCE_KEY;
      state.sortDir = 'asc';
      renderTable();
    } catch (error) {
      showError('list-error', 'list-error-text', toMessage(error));
    } finally {
      button.disabled = false;
    }
  });

  // ================================================================ 絞り込み

  /**
   * 絞り込みが変わったときに、一覧・地図・見出しをまとめて描き直す。
   * @returns {void}
   */
  function onFiltersChanged() {
    renderTable();
    renderMap();
  }

  /**
   * 絞り込み欄の選択肢を、いまのデータから作る。
   * 実際に使われている値だけを並べる（存在しない地区を選べても意味がないため）。
   * @returns {void}
   */
  function renderFilterControls() {
    const candidate = current();
    if (candidate === undefined) return;

    /** @param {string} id @param {string[]} values @param {string} allLabel @param {string} selected */
    const fill = (id, values, allLabel, selected) => {
      const select = /** @type {HTMLSelectElement} */ (el(id));
      const all = document.createElement('option');
      all.value = '';
      all.textContent = allLabel;
      all.selected = selected === '';
      select.replaceChildren(all, ...values.map((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        option.selected = value === selected;
        return option;
      }));
    };

    const distinct = (key) => [...new Set(
      state.posters.map((p) => String(p[key] ?? '').trim()).filter((v) => v !== ''),
    )].sort((a, b) => a.localeCompare(b, 'ja'));

    fill('filter-district', distinct('district'), 'すべての地区', state.filters.district);
    fill('filter-status', distinct('status'), 'すべての状態', state.filters.status);

    const days = /** @type {HTMLSelectElement} */ (el('filter-days'));
    days.replaceChildren(...DAYS_OPTIONS.map((option) => {
      const node = document.createElement('option');
      node.value = option.value === null ? '' : String(option.value);
      node.textContent = option.value === null ? '経過は問わない' : option.label;
      node.selected = option.value === state.filters.minDays;
      return node;
    }));

    const times = /** @type {HTMLSelectElement} */ (el('filter-times'));
    times.replaceChildren(...TIMES_OPTIONS.map((option) => {
      const node = document.createElement('option');
      node.value = option.value === null ? '' : String(option.value);
      node.textContent = option.value === null ? '貼替回数は問わない' : '貼替 ' + option.label;
      node.selected = option.value === (state.filters.times ?? null);
      return node;
    }));

    el('filter-flags').replaceChildren(...FLAG_OPTIONS.map((option) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = state.filters.flags.includes(option.key);
      input.addEventListener('change', () => {
        state.filters.flags = input.checked
          ? [...state.filters.flags, option.key]
          : state.filters.flags.filter((k) => k !== option.key);
        onFiltersChanged();
      });
      label.append(input, document.createTextNode(option.label));
      return label;
    }));

    /** @type {HTMLInputElement} */ (el('filter-nocoord')).checked = state.filters.onlyNoCoord;
  }

  el('filter-district').addEventListener('change', (event) => {
    state.filters.district = /** @type {HTMLSelectElement} */ (event.target).value;
    onFiltersChanged();
  });

  el('filter-status').addEventListener('change', (event) => {
    state.filters.status = /** @type {HTMLSelectElement} */ (event.target).value;
    onFiltersChanged();
  });

  el('filter-days').addEventListener('change', (event) => {
    const value = /** @type {HTMLSelectElement} */ (event.target).value;
    state.filters.minDays = value === '' ? null : Number(value);
    onFiltersChanged();
  });

  el('filter-times').addEventListener('change', (event) => {
    const value = /** @type {HTMLSelectElement} */ (event.target).value;
    state.filters.times = value === '' ? null : Number(value);
    onFiltersChanged();
  });

  el('filter-nocoord').addEventListener('change', (event) => {
    state.filters.onlyNoCoord = /** @type {HTMLInputElement} */ (event.target).checked;
    onFiltersChanged();
  });

  /** 絞り込みをすべて解除する @returns {void} */
  function clearFilters() {
    state.filters = emptyFilters();
    state.selected.clear();
    /** @type {HTMLInputElement} */ (el('search')).value = '';
    renderFilterControls();
    onFiltersChanged();
  }

  el('filter-clear').addEventListener('click', clearFilters);
  el('map-filter-clear').addEventListener('click', clearFilters);

  /**
   * 指定した絞り込みを当てて、一覧を開く。
   * ダッシュボードの数字から飛んでくるときに使う。
   * @param {Partial<import('./filters.js').Filters>} patch
   * @returns {void}
   */
  function focusList(patch) {
    state.filters = { ...emptyFilters(), ...patch };
    /** @type {HTMLInputElement} */ (el('search')).value = state.filters.text;
    renderFilterControls();
    showTab('list');
    onFiltersChanged();
  }



  /**
   * 絞り込んだ結果を印刷する。
   *
   * 画面のままだと道具立て（検索欄や操作ボタン）まで載ってしまう。
   * 紙で見たいのは「いつの・どの条件の・何件か」と表そのものなので、
   * 見出しを付けてそれ以外を隠す。
   *
   * @returns {void}
   */
  function printList() {
    const candidate = current();
    if (candidate === undefined) return;

    const rows = visibleRows();
    const condition = isFiltered(state.filters)
      ? describeFilters(state.filters)
      : 'すべての掲示場所';

    const head = el('print-head');
    head.replaceChildren();

    const title = document.createElement('div');
    title.className = 'print-head__title';
    title.textContent = candidate.name + ' ポスター掲示場所';

    const meta = document.createElement('div');
    meta.className = 'print-head__meta';
    meta.textContent = condition + '　' + rows.length + ' 件　（' + todayText() + ' 時点）';

    head.append(title, meta);
    window.print();
  }

  el('list-print').addEventListener('click', printList);

  /**
   * いま一覧に出ている行を、そのまま送れる文章にして共有する。
   *
   * 絞り込んだ結果を送る形にしてある（「脚立が要る場所だけ」など）。
   * 台帳を丸ごと送るより、**送る範囲を自分で決めてから送る**方が安全で、
   * 受け取る側にとっても読める量になる。
   *
   * 氏名と連絡先は、その場で確認を取ったときだけ含める。
   *
   * @returns {Promise<void>}
   */
  async function shareList() {
    const candidate = current();
    if (candidate === undefined) return;

    const rows = visibleRows();
    if (rows.length === 0) {
      showError('list-error', 'list-error-text', '共有できる行がありません。');
      return;
    }

    const includeContact = window.confirm(
      rows.length + ' 件を共有します。\n\n'
      + '所有者・紹介者の氏名と、電話・携帯・メール・連絡先住所も含めますか？\n\n'
      + '［OK］含める　／　［キャンセル］含めない\n\n'
      + '含めた場合、送り先の端末とトーク履歴に残り、転送もでき、取り消せません。',
    );

    const text = postersToText(rows, candidate.columns, {
      title: candidate.name + ' ポスター掲示場所',
      asOf: todayText(),
      condition: isFiltered(state.filters) ? describeFilters(state.filters) : '',
      includeContact,
    });

    try {
      showError('list-error', 'list-error-text', '');

      if (typeof navigator.share === 'function') {
        await navigator.share({ text });
        return;
      }

      await navigator.clipboard.writeText(text);
      showError('list-error', 'list-error-text',
        '文章をコピーしました。貼り付けて送れます。');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      showError('list-error', 'list-error-text', toMessage(error));
    }
  }

  el('list-share').addEventListener('click', () => void shareList());

  // ================================================================ 表の中で直接編集

  /**
   * 表のセルを1つ作る。
   *
   * 押したセルだけを入力欄に変える。全セルを常時入力欄にすると
   * 「行を押して詳細を開く」操作と衝突し、誤入力も増えるため。
   *
   * @param {Record<string, *>} poster
   * @param {import('./schema.js').Column} column
   * @returns {HTMLTableCellElement}
   */
  function buildCell(poster, column) {
    const td = document.createElement('td');
    if (column.type === 'number') td.className = 'is-number';
    if (column.type === 'check') td.className = 'is-check';

    // 番号は詳細を開く入口にする。全セルが直接編集になると
    // 詳細を開く手段が無くなるため、先頭列にその役割を持たせる
    if (column.key === 'no') {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'cell-open';
      open.textContent = String(poster.no ?? '') || '(番号なし)';
      open.title = '詳細を開く';
      open.addEventListener('click', (event) => {
        event.stopPropagation();
        openEditor(poster);
      });
      td.append(open);
      return td;
    }

    const editing = state.editingCell !== null
      && state.editingCell.posterId === poster.id
      && state.editingCell.key === column.key;

    if (editing) {
      td.classList.add('is-editing');
      td.append(buildCellInput(poster, column));
      return td;
    }

    // チェックは押した瞬間に切り替える。入力欄にする手間が要らない
    if (column.type === 'check') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cell-check';
      button.textContent = poster[column.key] === true ? '✓' : '－';
      button.setAttribute('aria-label',
        column.label + '：' + (poster[column.key] === true ? 'あり' : 'なし'));
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        void saveCell(poster, column, poster[column.key] !== true);
      });
      td.append(button);
      return td;
    }

    const text = formatValue(posterValue(poster, column), column.type);
    td.textContent = text;

    // 導出する列は直せない。押せるように見せると、直したのに戻ると受け取られる
    if (column.readOnly === true) {
      td.classList.add('is-derived');
      td.title = 'この列は他の記録から自動で数えています';
      return td;
    }

    td.classList.add('is-editable');
    td.title = '押すとこの場で直せます';
    td.addEventListener('click', (event) => {
      event.stopPropagation();
      state.editingCell = { posterId: poster.id, key: column.key };
      renderTable();
      /** @type {HTMLElement | null} */ (document.querySelector('.is-editing input, .is-editing select'))?.focus();
    });
    return td;
  }

  /**
   * セルの入力欄を作る。Enterで確定、Escで取り消し。
   * @param {Record<string, *>} poster
   * @param {import('./schema.js').Column} column
   * @returns {HTMLElement}
   */
  function buildCellInput(poster, column) {
    const value = posterValue(poster, column);

    if (column.key === 'status') {
      const select = document.createElement('select');
      select.className = 'select cell-input';
      select.replaceChildren(...STATUS_OPTIONS.map((option) => {
        const node = document.createElement('option');
        node.value = option;
        node.textContent = option;
        node.selected = option === value;
        return node;
      }));
      select.addEventListener('click', (event) => event.stopPropagation());
      select.addEventListener('change', () => void saveCell(poster, column, select.value));
      select.addEventListener('blur', () => void saveCell(poster, column, select.value));
      return select;
    }

    const input = document.createElement('input');
    input.className = 'input cell-input';
    input.autocomplete = 'off';
    input.type = column.type === 'date' ? 'date' : column.type === 'number' ? 'number' : 'text';
    input.value = value === null || value === undefined ? '' : String(value);

    input.addEventListener('click', (event) => event.stopPropagation());

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void saveCell(poster, column, parseValue(input.value, column.type));
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        state.editingCell = null;
        renderTable();
      }
    });

    // 画面外を押したときも確定する。押し直す手間を減らす
    input.addEventListener('blur', () => {
      void saveCell(poster, column, parseValue(input.value, column.type));
    });

    return input;
  }

  /**
   * セル1つ分の変更を保存する。値が変わっていなければ何もしない。
   *
   * @param {Record<string, *>} poster
   * @param {import('./schema.js').Column} column
   * @param {*} value
   * @returns {Promise<void>}
   */
  async function saveCell(poster, column, value) {
    const candidate = current();
    state.editingCell = null;

    if (candidate === undefined) {
      renderTable();
      return;
    }

    const before = posterValue(poster, column);
    const unchanged = before === value
      || ((before === null || before === undefined || before === '')
          && (value === null || value === undefined || value === ''));

    if (unchanged) {
      renderTable();
      return;
    }

    try {
      showError('list-error', 'list-error-text', '');
      const next = setPosterValue(poster, column, value);
      await db.savePoster(state.uid, candidate.id, poster.id, next);
    } catch (error) {
      showError('list-error', 'list-error-text', toMessage(error));
      renderTable();
    }
  }

  // ================================================================ 編集

  /**
   * その列に使える選択肢を、既存データから集める。
   * 地区や詳細エリアは決め打ちの一覧を持たず、入力された値を候補にする。
   * @param {import('./schema.js').Column} column
   * @returns {string[]}
   */
  function suggestionsFor(column) {
    if (column.key === 'status') return [...STATUS_OPTIONS];
    const values = new Set();
    for (const poster of state.posters) {
      const value = posterValue(poster, column);
      if (typeof value === 'string' && value !== '') values.add(value);
    }
    return [...values].sort((a, b) => a.localeCompare(b, 'ja'));
  }

  /**
   * 1つの列の入力欄を作る。
   * @param {import('./schema.js').Column} column
   * @returns {HTMLElement}
   */
  function buildField(column) {
    const value = posterValue(state.draft, column);

    // 導出する列は入力欄にしない。書けない欄を入力欄の形で出さない
    if (column.readOnly === true) {
      const span = document.createElement('span');
      span.className = 'form-grid__derived';
      span.id = 'f-' + column.key;
      span.textContent = formatValue(value, column.type);
      return span;
    }

    if (column.type === 'check') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = 'f-' + column.key;
      input.checked = value === true;
      input.addEventListener('change', () => {
        state.draft = setPosterValue(state.draft, column, input.checked);
      });
      return input;
    }

    if (column.key === 'status') {
      const select = document.createElement('select');
      select.className = 'select';
      select.id = 'f-' + column.key;
      select.replaceChildren(...STATUS_OPTIONS.map((option) => {
        const node = document.createElement('option');
        node.value = option;
        node.textContent = option;
        node.selected = option === value;
        return node;
      }));
      select.addEventListener('change', () => {
        state.draft = setPosterValue(state.draft, column, select.value);
      });
      return select;
    }

    const input = document.createElement('input');
    input.className = 'input';
    input.id = 'f-' + column.key;
    input.autocomplete = 'off';
    input.type = column.type === 'date' ? 'date'
      : column.type === 'number' ? 'number'
      : 'text';
    input.value = value === null || value === undefined ? '' : String(value);

    // 選択式は、既存の入力値を候補として出す（決め打ちの一覧は持たない）
    if (column.type === 'select') {
      const options = suggestionsFor(column);
      if (options.length > 0) {
        const listId = 'dl-' + column.key;
        const datalist = document.createElement('datalist');
        datalist.id = listId;
        datalist.replaceChildren(...options.map((option) => {
          const node = document.createElement('option');
          node.value = option;
          return node;
        }));
        input.setAttribute('list', listId);
        input.append(datalist);
      }
    }

    input.addEventListener('input', () => {
      state.draft = setPosterValue(state.draft, column, parseValue(input.value, column.type));
    });

    return input;
  }

  /**
   * 編集画面を開く。poster が null なら新規。
   * @param {Record<string, *> | null} poster
   * @param {Record<string, *> | null} [prefill] 新規のときの初期値
   * @returns {void}
   */
  function openEditor(poster, prefill = null) {
    const candidate = current();
    if (candidate === undefined) return;

    state.editingId = poster === null ? null : poster.id;
    // 閉じるときに変更の有無を見るため、開いた時点の内容を控える
    state.editingOriginal = poster === null ? null : { ...poster, custom: { ...(poster.custom ?? {}) } };
    state.draft = poster === null
      // 新規は番号を自動で入れる。手で入れ直すこともできる
      ? { ...createEmptyPoster(candidate.columns), no: nextPosterNo(state.posters), ...(prefill ?? {}) }
      : { ...poster, custom: { ...(poster.custom ?? {}) } };

    el('edit-title').textContent = poster === null ? '掲示場所の新規追加' : '掲示場所の編集';
    /** @type {HTMLButtonElement} */ (el('edit-delete')).hidden = poster === null;
    showError('edit-error', 'edit-error-text', '');

    const grid = document.createElement('div');
    grid.className = 'form-grid';

    let lastGroup = '';
    for (const column of orderedColumns(candidate.columns, { includeHidden: true })) {
      if (column.group !== lastGroup) {
        const heading = document.createElement('div');
        heading.className = 'form-grid__group';
        heading.textContent = column.group;
        grid.append(heading);
        lastGroup = column.group;
      }

      const label = document.createElement('label');
      label.className = 'form-grid__label';
      label.htmlFor = 'f-' + column.key;
      label.textContent = column.label;

      grid.append(label, buildField(column));
    }

    el('edit-fields').replaceChildren(grid);
    renderReplaceArea(poster === null);
    /** @type {HTMLDialogElement} */ (el('edit-dialog')).showModal();
  }

  /**
   * 貼替の記録欄を描く。
   *
   * 新規登録では出さない。まだ貼っていない場所に「貼り替えた」は無いため。
   *
   * @param {boolean} isNew
   * @returns {void}
   */
  function renderReplaceArea(isNew) {
    el('edit-replace-area').hidden = isNew;
    if (isNew) return;

    const history = historyOf(state.draft ?? {});
    el('edit-replace-count').textContent = history.length === 0
      ? 'まだ貼替の記録がありません'
      : '貼替の記録 ' + history.length + ' 件（最新 ' + history[history.length - 1] + '）';
  }

  el('edit-replaced-today').addEventListener('click', () => {
    if (state.draft === null) return;

    const today = todayText();
    const change = addReplacement(state.draft, today);
    if (change === null) return;

    if (historyOf(state.draft).includes(today)) {
      showError('edit-error', 'edit-error-text', today + ' の貼替は既に記録されています。');
      return;
    }

    showError('edit-error', 'edit-error-text', '');
    state.draft = { ...state.draft, ...change };

    // 「最新貼替日」の欄も合わせる。欄と記録が食い違って見えないようにする
    const field = /** @type {HTMLInputElement | null} */ (document.getElementById('f-lastReplacedOn'));
    if (field !== null) field.value = change.lastReplacedOn ?? '';

    renderReplaceArea(false);
  });

  el('poster-add').addEventListener('click', () => openEditor(null));

  el('poster-duplicate').addEventListener('click', () => {
    const candidate = current();
    if (candidate === undefined) return;

    if (state.selected.size !== 1) {
      showError('list-error', 'list-error-text', '複製したい行を1つだけ選んでください。');
      return;
    }

    const source = state.posters.find((p) => state.selected.has(p.id));
    if (source === undefined) return;

    // 連絡先はそのまま引き継ぎ、その場所に固有のものは引き継がない。
    // 同じ所有者の別の掲示場所を足す、という使い方を想定している
    const { id, createdAt, updatedAt, updatedBy, ...rest } = source;
    showError('list-error', 'list-error-text', '');
    state.selected.clear();

    openEditor(null, {
      ...rest,
      custom: { ...(source.custom ?? {}) },
      no: nextPosterNo(state.posters),
      placeName: '',
      address: '',
      postalCode: '',
      lat: null,
      lng: null,
      coordFixed: false,
      postedOn: null,
      lastReplacedOn: null,
      replacements: [],
    });
  });
  /**
   * 編集を閉じてよいか。変更があるときだけ確認する。
   * 何も触っていないのに毎回聞かれると、読まずに押すようになるため。
   * @returns {boolean}
   */
  function canCloseEditor() {
    const candidate = current();
    if (candidate === undefined || state.draft === null) return true;
    if (!hasChanges(state.editingOriginal, state.draft, candidate.columns)) return true;
    return window.confirm('入力した内容が保存されていません。\n破棄して閉じてよろしいですか？');
  }

  el('edit-cancel').addEventListener('click', () => {
    if (!canCloseEditor()) return;
    /** @type {HTMLDialogElement} */ (el('edit-dialog')).close();
  });

  // Esc や画面外の操作で閉じようとしたときも同じ確認を通す
  el('edit-dialog').addEventListener('cancel', (event) => {
    if (canCloseEditor()) return;
    event.preventDefault();
  });

  /**
   * 編集内容の「最新貼替日」を貼替履歴に反映する。
   *
   * **欄を直す操作は「貼り替えた」ではなく「入力を直した」とみなす。**
   * 履歴の件数を増やさないため、打ち間違いを直しても実績が水増しされない。
   * 貼り替えたことの記録は「選んだ行を今日にする」で足す。
   *
   * 保存は merge:false（書かない項目は消える）なので、
   * 欄を触っていない場合も履歴を必ず持たせて渡す。
   *
   * @param {Record<string, *> | null} original 編集前。新規なら null
   * @param {Record<string, *>} draft 保存しようとしている内容
   * @returns {Record<string, *>}
   */
  function withReplacementHistory(original, draft) {
    const before = historyOf(original ?? {});
    const drafted = Array.isArray(draft.replacements) ? draft.replacements : null;

    // 「今日 貼り替えた」で履歴を足していれば、それをそのまま通す
    if (drafted !== null && drafted.join(',') !== before.join(',')) {
      return { ...draft, replacements: drafted, lastReplacedOn: drafted[drafted.length - 1] ?? null };
    }

    const after = draft.lastReplacedOn ?? null;

    // 欄を触っていないなら履歴も動かさない。
    // 履歴を持たない既存データには、ここで履歴を作っておく
    if (original !== null && (original.lastReplacedOn ?? null) === after) {
      return { ...draft, replacements: before };
    }

    return { ...draft, ...correctLatest(original ?? {}, String(after ?? '')) };
  }

  el('edit-save').addEventListener('click', async () => {
    const candidate = current();
    if (candidate === undefined || state.draft === null) return;

    const poster = withReplacementHistory(state.editingOriginal, state.draft);

    try {
      showError('edit-error', 'edit-error-text', '');
      if (state.editingId === null) {
        await db.createPoster(state.uid, candidate.id, poster);
      } else {
        await db.savePoster(state.uid, candidate.id, state.editingId, poster);
      }
      state.editingOriginal = null;
      state.draft = null;
      /** @type {HTMLDialogElement} */ (el('edit-dialog')).close();
    } catch (error) {
      showError('edit-error', 'edit-error-text', toMessage(error));
    }
  });

  el('edit-delete').addEventListener('click', async () => {
    const candidate = current();
    if (candidate === undefined || state.editingId === null) return;

    const label = String(state.draft?.placeName || state.draft?.no || 'この掲示場所');
    if (!window.confirm(label + ' を削除します。元に戻せません。よろしいですか？')) return;

    try {
      await db.deletePoster(state.uid, candidate.id, state.editingId);
      state.editingOriginal = null;
      state.draft = null;
      /** @type {HTMLDialogElement} */ (el('edit-dialog')).close();
    } catch (error) {
      showError('edit-error', 'edit-error-text', toMessage(error));
    }
  });


  // ================================================================ 外部への共有

  /**
   * 共有する内容を組み立てる。
   *
   * **氏名・連絡先・掲示住所は入らない**（判断は share.js 側にある）。
   * ここで対象にするのは撤去済を含む台帳全体ではなく、いま画面に出ている
   * ダッシュボードと同じ集計。画面と送ったものが食い違わないようにする。
   *
   * @returns {import('./share.js').ShareSummary | null}
   */
  function currentShareSummary() {
    const candidate = current();
    if (candidate === undefined) return null;

    return buildShareSummary(state.posters, todayText(), candidate.name, {
      includePersonal: /** @type {HTMLInputElement} */ (el('share-personal')).checked,
    });
  }

  /**
   * いま何を共有しようとしているのかを、操作の隣に出す。
   *
   * 送ってからでは取り消せないので、押す前に読める位置に置く。
   *
   * @returns {void}
   */
  function renderShareScope() {
    const on = /** @type {HTMLInputElement} */ (el('share-personal')).checked;
    const note = el('share-scope');

    note.classList.toggle('is-personal', on);
    note.textContent = on
      ? '所有者・紹介者の氏名と、掲示場所・掲示住所を含めます。'
        + '送った先の端末とトーク履歴に残り、転送もでき、取り消せません。'
      : '件数と地区名だけを含めます。氏名・掲示住所・連絡先は入りません。';
  }

  el('share-personal').addEventListener('change', () => {
    showShareDone('');
    renderShareScope();
  });

  /**
   * 共有できたことを短く知らせる。
   * @param {string} message
   * @returns {void}
   */
  function showShareDone(message) {
    showError('share-error', 'share-error-text', '');
    el('share-done').hidden = message === '';
    el('share-done-text').textContent = message;
  }

  /**
   * ダッシュボードを画像にして共有する。
   *
   * 共有シートに対応していない環境（多くのパソコン）では画像を保存する。
   * 「共有できません」で終わらせず、手で送れる形にして渡す。
   *
   * @returns {Promise<void>}
   */
  async function shareDashboardImage() {
    const summary = currentShareSummary();
    if (summary === null) return;

    try {
      showShareDone('');
      showError('share-error', 'share-error-text', '');

      const canvas = document.createElement('canvas');
      drawSummary(canvas, summary);

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b === null ? reject(new Error('画像を作れませんでした')) : resolve(b)), 'image/png');
      });

      const fileName = summary.title.replace(/\s+/g, '_') + '_' + summary.asOf + '.png';
      const file = new File([blob], fileName, { type: 'image/png' });

      if (typeof navigator.canShare === 'function'
        && navigator.canShare({ files: [file] })
        && typeof navigator.share === 'function') {
        await navigator.share({ files: [file], title: summary.title });
        showShareDone('共有しました。');
        return;
      }

      // 共有シートが使えない環境。保存して手で送ってもらう
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      showShareDone('この端末は共有シートに対応していないため、画像を保存しました。');
    } catch (error) {
      // 共有シートを閉じただけ。失敗として出すと、やめる操作が毎回エラーになる
      if (error instanceof Error && error.name === 'AbortError') return;
      showError('share-error', 'share-error-text', toMessage(error));
    }
  }

  /**
   * ダッシュボードの数字を文章にして写す。
   *
   * 画像は検索も引用もできない。文章なら送り先で拾える。
   *
   * @returns {Promise<void>}
   */
  async function shareDashboardText() {
    const summary = currentShareSummary();
    if (summary === null) return;

    const text = summaryToText(summary);

    try {
      showShareDone('');
      showError('share-error', 'share-error-text', '');

      if (typeof navigator.share === 'function') {
        await navigator.share({ text });
        showShareDone('共有しました。');
        return;
      }

      await navigator.clipboard.writeText(text);
      showShareDone('文章をコピーしました。貼り付けて送れます。');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      showError('share-error', 'share-error-text', toMessage(error));
    }
  }

  renderShareScope();

  el('share-image').addEventListener('click', () => void shareDashboardImage());
  el('share-text').addEventListener('click', () => void shareDashboardText());

  // ================================================================ 地図

  /**
   * その掲示場所が住所からの座標計算の対象かどうか。
   * 座標が既にあるものは対象にしない（手で直した位置を壊さないため）。
   * @param {Record<string, *>} poster
   * @returns {boolean}
   */
  function needsGeocoding(poster) {
    if (typeof poster.lat === 'number' && typeof poster.lng === 'number') return false;
    return String(poster.address ?? '').trim() !== '';
  }

  /** 地図をまだ作っていなければ作る @returns {void} */
  function ensureMap() {
    if (state.map !== null) return;
    try {
      state.map = createMap('map', {
        onMarkerClick: (posterId) => {
          const poster = state.posters.find((p) => p.id === posterId);
          if (poster !== undefined) openEditor(poster);
        },
        onMarkerMoved: (posterId, lat, lng) => void onMarkerMoved(posterId, lat, lng),
        onMapClick: (lat, lng) => void onMapClick(lat, lng),
      });
    } catch (error) {
      showError('map-error', 'map-error-text', toMessage(error));
    }
  }

  /** ピンを描き直し、状況を伝える @returns {void} */
  function renderMap() {
    if (state.map === null) return;
    const candidate = current();
    if (candidate === undefined) return;

    const rows = visibleRows();
    const shown = state.map.setPosters(rows, candidate.columns, colorForFactory(rows));
    // 描き直すと印が作り直されるので、切り替えの状態を入れ直す
    state.map.setDragEnabled(
      /** @type {HTMLInputElement} */ (el('map-drag-mode')).checked,
    );
    state.map.setLabelsVisible(
      /** @type {HTMLInputElement} */ (el('map-labels')).checked,
    );
    renderLegend();
    const pending = rows.filter(needsGeocoding).length;
    const hidden = rows.filter((p) => p.showOnMap === false).length;

    // 絞り込みに気づかないまま「ピンが足りない」と悩まないようにする
    const filtered = isFiltered(state.filters);
    el('map-filtered').hidden = !filtered;
    if (filtered) {
      el('map-filtered-text').textContent =
        describeFilters(state.filters) + '（' + rows.length + ' 件 / 全 ' + state.posters.length + ' 件）';
    }

    const parts = ['ピン ' + shown + ' 件'];
    if (pending > 0) parts.push('座標なし ' + pending + ' 件');
    if (hidden > 0) parts.push('マップ掲載を外している ' + hidden + ' 件');
    el('map-status').textContent = parts.join('／');
  }

  /**
   * ピンを動かした。動かした位置を「確定」として印を付ける。
   * これが無いと、次に住所から座標を求めたときに元へ戻ってしまう。
   *
   * @param {string} posterId
   * @param {number} lat
   * @param {number} lng
   * @returns {Promise<void>}
   */
  async function onMarkerMoved(posterId, lat, lng) {
    const candidate = current();
    const poster = state.posters.find((p) => p.id === posterId);
    if (candidate === undefined || poster === undefined) return;

    // 動かす前の位置を控える。誤操作をその場で取り消せるようにするため
    state.lastMove = {
      posterId,
      lat: poster.lat,
      lng: poster.lng,
      coordFixed: poster.coordFixed === true,
      label: String(poster.placeName || poster.no || 'この掲示場所'),
    };

    try {
      showError('map-error', 'map-error-text', '');
      await db.savePoster(state.uid, candidate.id, posterId, {
        ...poster, lat, lng, coordFixed: true,
      });

      el('map-undo-text').textContent = state.lastMove.label;
      el('map-undo').hidden = false;
    } catch (error) {
      showError('map-error', 'map-error-text', toMessage(error));
    }
  }

  /**
   * 直前の移動を取り消す。
   * 元が「座標なし」だった場合は座標なしに戻す。
   * @returns {Promise<void>}
   */
  async function undoLastMove() {
    const candidate = current();
    const move = state.lastMove;
    if (candidate === undefined || move === null) return;

    const poster = state.posters.find((p) => p.id === move.posterId);
    if (poster === undefined) return;

    try {
      showError('map-error', 'map-error-text', '');
      await db.savePoster(state.uid, candidate.id, move.posterId, {
        ...poster, lat: move.lat, lng: move.lng, coordFixed: move.coordFixed,
      });

      if (typeof move.lat === 'number' && typeof move.lng === 'number') {
        state.map?.moveMarker(move.posterId, move.lat, move.lng);
      }

      state.lastMove = null;
      el('map-undo').hidden = true;
    } catch (error) {
      showError('map-error', 'map-error-text', toMessage(error));
    }
  }

  el('map-undo-button').addEventListener('click', () => void undoLastMove());

  el('map-drag-mode').addEventListener('change', (event) => {
    const on = /** @type {HTMLInputElement} */ (event.target).checked;
    state.map?.setDragEnabled(on);
    el('map-status').textContent = on
      ? 'ピンをドラッグして位置を直せます。終わったらこの許可を外してください。'
      : 'ピンは固定されています。';
  });

  /**
   * 地図を押して新規追加。押した場所の住所を引いて初期値に入れる。
   * 番地までは分からないため、利用者に足してもらう。
   *
   * @param {number} lat
   * @param {number} lng
   * @returns {Promise<void>}
   */
  async function onMapClick(lat, lng) {
    showError('map-error', 'map-error-text', '');
    const found = await reverseGeocode(lat, lng);

    openEditor(null, {
      lat,
      lng,
      coordFixed: true, // 地図で置いた位置なので、再計算で動かさない
      address: found?.address ?? '',
      district: found?.district ?? '',
      areaDetail: found?.areaDetail ?? '',
    });
  }

  /**
   * 座標が無いものを、住所から一括で求める。
   *
   * 座標があるものには触れない。地区・詳細エリアは空のときだけ埋める
   * （手で直した値を上書きしないため）。
   *
   * @returns {Promise<void>}
   */
  async function onGeocodeAll() {
    const candidate = current();
    if (candidate === undefined) return;

    const targets = state.posters.filter(needsGeocoding);
    const button = /** @type {HTMLButtonElement} */ (el('map-geocode'));

    if (targets.length === 0) {
      el('map-status').textContent = '座標を求める対象がありません。';
      return;
    }

    button.disabled = true;
    showError('map-error', 'map-error-text', '');

    let done = 0;
    let failed = 0;

    try {
      for (const poster of targets) {
        el('map-status').textContent =
          '住所から座標を求めています… ' + (done + failed + 1) + ' / ' + targets.length;

        const found = await geocodeAddress(String(poster.address));
        if (found === null) {
          failed += 1;
          continue;
        }

        await db.savePoster(state.uid, candidate.id, poster.id, {
          ...poster,
          lat: found.lat,
          lng: found.lng,
          // 自動で求めた座標は「確定」にしない。あとで直せるようにする
          coordFixed: poster.coordFixed === true,
          district: String(poster.district ?? '') === '' ? found.district : poster.district,
          areaDetail: String(poster.areaDetail ?? '') === '' ? found.areaDetail : poster.areaDetail,
        });
        done += 1;
      }

      el('map-status').textContent =
        '完了：' + done + ' 件に座標を付けました' +
        (failed > 0 ? '／' + failed + ' 件は住所から特定できませんでした' : '');

      state.map?.fit();
    } catch (error) {
      showError('map-error', 'map-error-text', toMessage(error));
    } finally {
      button.disabled = false;
    }
  }

  el('map-geocode').addEventListener('click', () => void onGeocodeAll());
  el('map-fit').addEventListener('click', () => state.map?.fit());

  el('map-locate').addEventListener('click', async () => {
    try {
      showError('map-error', 'map-error-text', '');
      await state.map?.locate();
    } catch (error) {
      showError('map-error', 'map-error-text', toMessage(error));
    }
  });

  el('map-labels').addEventListener('change', (event) => {
    state.map?.setLabelsVisible(/** @type {HTMLInputElement} */ (event.target).checked);
  });

  el('map-add-mode').addEventListener('change', (event) => {
    const on = /** @type {HTMLInputElement} */ (event.target).checked;
    state.map?.setAddMode(on);
    if (on) el('map-status').textContent = '地図を押すと、その場所に新しい掲示場所を作ります。';
  });



  // ================================================================ 色分け

  /**
   * 色分けに使える軸の一覧。
   * 「最後に手を入れた日」は貼替日と掲示日を組み合わせた特別な軸。
   * @returns {import('./schema.js').Column[]}
   */
  function colorFields() {
    const candidate = current();
    if (candidate === undefined) return [];

    const refreshed = {
      key: REFRESHED_FIELD,
      label: '最後に手を入れた日（貼替日／無ければ掲示日）',
      type: 'date',
      system: true,
      group: '日付',
    };

    // 色分けの軸にしても意味の薄い列は外す
    const skip = new Set(['lat', 'lng', 'note', 'contactAddress', 'email', 'phone', 'mobile']);
    return [refreshed, ...candidate.columns.filter((c) => !skip.has(c.key))];
  }

  /** いま選ばれている色分けルール @returns {object | null} */
  function activeRule() {
    const candidate = current();
    if (candidate === undefined) return null;
    return (candidate.colorRules ?? []).find((r) => r.id === candidate.activeRuleId) ?? null;
  }

  /** 色分けの選択欄を描く @returns {void} */
  function renderRuleSelect() {
    const candidate = current();
    if (candidate === undefined) return;

    const select = /** @type {HTMLSelectElement} */ (el('color-rule-select'));
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'なし';
    none.selected = !candidate.activeRuleId;

    select.replaceChildren(none, ...(candidate.colorRules ?? []).map((rule) => {
      const option = document.createElement('option');
      option.value = rule.id;
      option.textContent = rule.name;
      option.selected = rule.id === candidate.activeRuleId;
      return option;
    }));
  }

  /** 凡例を描く @returns {void} */
  function renderLegend() {
    const rule = activeRule();
    const container = el('map-legend');

    if (rule === null) {
      container.replaceChildren();
      return;
    }

    const legend = buildLegend(rule, visibleRows(), todayText());

    container.replaceChildren(...legend.map((row) => {
      const item = document.createElement('span');
      item.className = 'legend__item';

      const swatch = document.createElement('span');
      swatch.className = 'legend__swatch';
      swatch.style.background = PALETTE[row.color]?.hex ?? PALETTE.gray.hex;

      const label = document.createElement('span');
      label.textContent = row.label;

      const count = document.createElement('span');
      count.className = 'legend__count';
      count.textContent = row.count + '件';

      item.append(swatch, label, count);
      return item;
    }));
  }

  /**
   * ピンの色を決める関数を返す。色分けしていなければ null。
   * @returns {((poster: Record<string, *>) => {label: string, hex: string}) | null}
   */
  function colorForFactory(posters = null) {
    const rule = activeRule();
    if (rule === null) return null;

    const today = todayText();
    const source = posters ?? state.posters;
    // カテゴリのときは凡例で決めた割り当てに従う。毎回作り直さない
    const legend = rule.mode === 'category' ? buildLegend(rule, source, today) : null;

    return (poster) => {
      const bucket = bucketOf(rule, poster, today, legend);
      return { label: bucket.label, hex: PALETTE[bucket.color]?.hex ?? PALETTE.gray.hex };
    };
  }

  el('color-rule-select').addEventListener('change', async (event) => {
    const candidate = current();
    if (candidate === undefined) return;

    const id = /** @type {HTMLSelectElement} */ (event.target).value;
    candidate.activeRuleId = id;
    renderMap();

    try {
      await db.saveColorRules(state.uid, candidate.id, candidate.colorRules ?? [], id);
    } catch (error) {
      showError('map-error', 'map-error-text', toMessage(error));
    }
  });

  // ---------------------------------------------------------------- 設定画面

  /** 区切りの編集欄を描く @returns {void} */
  function renderBucketEditor() {
    const rule = state.editingRule;
    const area = el('color-buckets-area');
    if (rule === null) return;

    if (rule.mode === 'category') {
      area.hidden = true;
      el('color-mode-note').textContent =
        '値ごとに自動で色を割り当てます（多い順に6色まで。残りは「その他」）。';
      return;
    }

    area.hidden = false;

    if (rule.mode === 'days') {
      el('color-mode-note').textContent = '経過した日数で色を分けます。';
      el('color-buckets-note').textContent =
        '「何日まで」を変えると、要対応とみなす基準を調整できます。最後の区切りは上限なしです。';
    } else if (rule.mode === 'number') {
      el('color-mode-note').textContent = '数値の大きさで色を分けます。';
      el('color-buckets-note').textContent = '「いくつまで」を変えられます。最後の区切りは上限なしです。';
    } else {
      el('color-mode-note').textContent = 'あり・なしの2色で分けます。';
      el('color-buckets-note').textContent = 'それぞれの色を選べます。';
    }

    const head = document.createElement('div');
    head.className = 'bucket__head';
    head.append(
      Object.assign(document.createElement('span'), { textContent: '区切りの名前' }),
      Object.assign(document.createElement('span'), {
        textContent: rule.mode === 'days' ? '何日まで' : rule.mode === 'number' ? 'いくつまで' : '',
      }),
      Object.assign(document.createElement('span'), { textContent: '色' }),
    );

    const rows = rule.buckets.map((bucket, index) => {
      const row = document.createElement('div');
      row.className = 'bucket';

      const label = document.createElement('input');
      label.className = 'input';
      label.type = 'text';
      label.value = bucket.label;
      label.addEventListener('input', () => { bucket.label = label.value; });

      let limit;
      if (rule.mode === 'check') {
        limit = document.createElement('span');
      } else if (bucket.upTo === null) {
        limit = document.createElement('span');
        limit.className = 'bucket__label';
        limit.textContent = 'それ以上';
      } else {
        limit = document.createElement('input');
        limit.className = 'input';
        limit.type = 'number';
        limit.min = '0';
        limit.value = String(bucket.upTo);
        limit.addEventListener('input', () => {
          bucket.upTo = Number(limit.value);
        });
      }

      const color = document.createElement('select');
      color.className = 'select';
      color.replaceChildren(...Object.entries(PALETTE).map(([key, def]) => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = def.label;
        option.selected = key === bucket.color;
        return option;
      }));
      color.addEventListener('change', () => { bucket.color = color.value; });

      row.append(label, limit, color);
      return row;
    });

    el('color-buckets').replaceChildren(head, ...rows);
  }

  /** 軸の選択欄を描く @returns {void} */
  function renderFieldSelect() {
    const select = /** @type {HTMLSelectElement} */ (el('color-field'));
    const rule = state.editingRule;

    select.replaceChildren(...colorFields().map((column) => {
      const option = document.createElement('option');
      option.value = column.key;
      option.textContent = column.label;
      option.selected = column.key === rule?.field;
      return option;
    }));
  }

  el('color-rule-edit').addEventListener('click', () => {
    const candidate = current();
    if (candidate === undefined) return;

    const existing = activeRule();
    // 何も選んでいなければ、最初の軸で新しい設定を作る
    state.editingRule = existing === null
      ? defaultRuleFor(colorFields()[0])
      : JSON.parse(JSON.stringify(existing));

    /** @type {HTMLButtonElement} */ (el('color-delete')).hidden = existing === null;
    /** @type {HTMLInputElement} */ (el('color-name')).value = state.editingRule.name;
    showError('color-error', 'color-error-text', '');

    renderFieldSelect();
    renderBucketEditor();
    /** @type {HTMLDialogElement} */ (el('color-dialog')).showModal();
  });

  el('color-field').addEventListener('change', (event) => {
    const key = /** @type {HTMLSelectElement} */ (event.target).value;
    const column = colorFields().find((c) => c.key === key);
    if (column === undefined) return;

    // 軸を変えたら、その型に合う既定の区切りを作り直す
    const previousId = state.editingRule?.id;
    state.editingRule = { ...defaultRuleFor(column), id: previousId ?? defaultRuleFor(column).id };
    /** @type {HTMLInputElement} */ (el('color-name')).value = state.editingRule.name;
    renderBucketEditor();
  });

  el('color-cancel').addEventListener('click', () => {
    /** @type {HTMLDialogElement} */ (el('color-dialog')).close();
  });

  el('color-save').addEventListener('click', async () => {
    const candidate = current();
    const rule = state.editingRule;
    if (candidate === undefined || rule === null) return;

    try {
      showError('color-error', 'color-error-text', '');

      const name = /** @type {HTMLInputElement} */ (el('color-name')).value.trim();
      if (name === '') throw new Error('この設定の名前を入力してください');
      rule.name = name;

      // しきい値が小さい順になっていないと、色が意図と違う区切りに入る
      if (rule.mode === 'days' || rule.mode === 'number') {
        const limits = rule.buckets.map((b) => b.upTo).filter((v) => v !== null);
        for (let i = 1; i < limits.length; i += 1) {
          if (limits[i - 1] >= limits[i]) {
            throw new Error('区切りの数値は小さい順に並べてください');
          }
        }
      }

      const rules = (candidate.colorRules ?? []).slice();
      const index = rules.findIndex((r) => r.id === rule.id);
      if (index === -1) rules.push(rule); else rules[index] = rule;

      candidate.colorRules = rules;
      candidate.activeRuleId = rule.id;

      await db.saveColorRules(state.uid, candidate.id, rules, rule.id);

      /** @type {HTMLDialogElement} */ (el('color-dialog')).close();
      renderRuleSelect();
      renderMap();
    } catch (error) {
      showError('color-error', 'color-error-text', toMessage(error));
    }
  });

  el('color-delete').addEventListener('click', async () => {
    const candidate = current();
    const rule = state.editingRule;
    if (candidate === undefined || rule === null) return;
    if (!window.confirm('色分けの設定「' + rule.name + '」を削除します。よろしいですか？')) return;

    try {
      const rules = (candidate.colorRules ?? []).filter((r) => r.id !== rule.id);
      candidate.colorRules = rules;
      candidate.activeRuleId = '';
      await db.saveColorRules(state.uid, candidate.id, rules, '');

      /** @type {HTMLDialogElement} */ (el('color-dialog')).close();
      renderRuleSelect();
      renderMap();
    } catch (error) {
      showError('color-error', 'color-error-text', toMessage(error));
    }
  });

  // ================================================================ ダッシュボード

  /**
   * 今日の日付を 'YYYY-MM-DD' で返す。端末の暦で数える。
   * @returns {string}
   */
  function todayText() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }

  /**
   * 数値の見出し（KPI）を1枚作る。
   * @param {{label: string, value: number|string, unit?: string, note?: string,
   *          tone?: string, onClick?: () => void}} spec
   * @returns {HTMLElement}
   */
  function buildKpi(spec) {
    const clickable = typeof spec.onClick === 'function';
    const box = document.createElement(clickable ? 'button' : 'div');
    if (clickable) {
      /** @type {HTMLButtonElement} */ (box).type = 'button';
      box.addEventListener('click', spec.onClick);
    }
    box.className = 'kpi' + (spec.tone ? ' kpi--' + spec.tone : '')
      + (clickable ? ' kpi--link' : '');

    const label = document.createElement('div');
    label.className = 'kpi__label';
    label.textContent = spec.label;

    const value = document.createElement('div');
    value.className = 'kpi__value';
    value.textContent = String(spec.value);
    if (spec.unit !== undefined) {
      const unit = document.createElement('span');
      unit.className = 'kpi__unit';
      unit.textContent = spec.unit;
      value.append(unit);
    }

    box.append(label, value);

    if (spec.note !== undefined && spec.note !== '') {
      const note = document.createElement('div');
      note.className = 'kpi__note';
      note.textContent = spec.note;
      box.append(note);
    }
    return box;
  }

  /**
   * 横棒グラフを描く。最大値を基準に幅の比率で表す。
   * @param {string} containerId
   * @param {{label: string, value: number, tone?: string, onClick?: () => void}[]} rows
   * @param {string} unit
   * @returns {void}
   */
  function renderBars(containerId, rows, unit) {
    const container = el(containerId);
    const max = rows.reduce((m, r) => Math.max(m, r.value), 0);

    if (rows.length === 0 || max === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-sub';
      empty.textContent = 'まだデータがありません。';
      container.replaceChildren(empty);
      return;
    }

    const nodes = [];
    for (const row of rows) {
      const clickable = typeof row.onClick === 'function';

      const label = document.createElement(clickable ? 'button' : 'div');
      if (clickable) {
        /** @type {HTMLButtonElement} */ (label).type = 'button';
        label.addEventListener('click', row.onClick);
        label.title = row.label + ' で絞り込む';
      }
      label.className = 'bars__label' + (clickable ? ' bars__label--link' : '');
      label.textContent = row.label;

      const track = document.createElement('div');
      track.className = 'bars__track';
      const fill = document.createElement('div');
      fill.className = 'bars__fill' + (row.tone ? ' bars__fill--' + row.tone : '');
      fill.style.width = Math.round((row.value / max) * 100) + '%';
      // 0件のときは棒を出さない。最小幅のせいで「少しある」ように見えるため
      if (row.value === 0) fill.style.minWidth = '0';
      track.append(fill);

      const value = document.createElement('div');
      value.className = 'bars__value';
      value.textContent = row.value + unit;

      nodes.push(label, track, value);
    }
    container.replaceChildren(...nodes);
  }

  /** ダッシュボード全体を描く @returns {void} */
  function renderDashboard() {
    const candidate = current();
    if (candidate === undefined) return;
    if (el('panel-dash').hidden) return; // 見ていないときは組み立てない

    const today = todayText();
    const s = summarize(state.posters, today);

    // --- 数値の見出し ---
    el('kpi-row').replaceChildren(
      buildKpi({ label: '掲示場所', value: s.total, unit: '件',
                 note: s.removed > 0 ? '撤去済 ' + s.removed + ' 件を除く' : '',
                 onClick: () => focusList({}) }),
      buildKpi({ label: '掲示枚数', value: s.sheets, unit: '枚' }),
      buildKpi({ label: '貼替から1年以上', value: s.overOneYear, unit: '件',
                 tone: s.overOneYear > 0 ? 'attention' : undefined,
                 note: '押すと一覧に出ます',
                 onClick: () => focusList({ minDays: 365 }) }),
      buildKpi({ label: '日付が不明', value: s.unknownDate, unit: '件',
                 tone: s.unknownDate > 0 ? 'alert' : undefined,
                 note: '掲示日も貼替日も未入力' }),
      buildKpi({ label: '地図に出ていない', value: s.noCoord + s.hiddenOnMap, unit: '件',
                 tone: s.noCoord > 0 ? 'attention' : undefined,
                 note: '座標なし ' + s.noCoord + ' ／ 掲載を外している ' + s.hiddenOnMap,
                 onClick: () => focusList({ onlyNoCoord: true }) }),
    );

    // --- 種別 ---
    renderBars('bars-type', [
      { label: '3連大', value: s.byType.size3L },
      { label: '3連小', value: s.byType.size3S },
      { label: '2連大', value: s.byType.size2L },
      { label: '2連小', value: s.byType.size2S },
    ], ' 枚');

    // --- 現場の条件 ---
    renderBars('bars-condition', [
      { label: '要脚立', value: s.needLadder, tone: 'attention', flag: 'needLadder' },
      { label: 'プラ段', value: s.plaDan, tone: 'muted', flag: 'plaDan' },
      { label: '室内', value: s.indoor, tone: 'muted', flag: 'indoor' },
      { label: '他党あり', value: s.otherParty, tone: 'muted', flag: 'otherParty' },
    ].map((row) => ({ ...row, onClick: () => focusList({ flags: [row.flag] }) })), ' 件');

    // --- 経過の分布 ---
    renderBars('bars-age',
      ageDistribution(state.posters, today).map((row) => ({
        label: row.label,
        value: row.count,
        // 古い区切りほど注意を引く色にする
        tone: row.label === '2年超' || row.label === '日付なし' ? 'attention' : undefined,
        onClick: row.minDays === null && row.label !== '半年以内'
          ? undefined
          : () => focusList(row.minDays === null ? {} : { minDays: row.minDays }),
      })),
      ' 件');

    // --- 貼替の回数 ---
    renderBars('bars-replace-count',
      replaceCountDistribution(state.posters).map((row) => ({
        label: row.label,
        // 一度も貼り替えていない場所が一番見たいもの
        value: row.count,
        tone: row.times === 0 ? 'attention' : undefined,
        onClick: () => focusList({ times: row.times }),
      })),
      ' 件');

    // --- 月別の貼替実績 ---
    renderBars('bars-monthly',
      monthlyReplacements(state.posters, today, 12).map((row) => ({
        // 画面が狭いので「2026-08」ではなく「8月」だけ出す
        label: String(Number(row.month.slice(5, 7))) + '月',
        value: row.count,
      })),
      ' 件');

    // --- 複数か所の所有者 ---
    const owners = byOwner(state.posters);
    renderBars('bars-owner',
      owners.slice(0, 10).map((row) => ({
        label: row.owner,
        value: row.count,
        onClick: () => focusList({ text: row.owner }),
      })),
      ' か所');
    el('owner-note').textContent = owners.length === 0
      ? '2か所以上を貸してくださっている方はまだいません。'
      : (owners.length > 10 ? '全部で ' + owners.length + ' 名。上位10名を表示しています。' : '');

    // --- 人口あたりのカバー率 ---
    renderCoverage();

    // --- 紹介者別 ---
    const introducers = byIntroducer(state.posters);
    renderBars('bars-introducer',
      introducers.slice(0, 12).map((row) => ({
        label: row.introducer,
        value: row.count,
        onClick: () => focusList({ introducer: row.introducer }),
      })),
      ' 件');
    el('introducer-note').textContent = introducers.length > 12
      ? '紹介者は全部で ' + introducers.length + ' 名。上位12名を表示しています。'
      : '';

    // --- 地区別 ---
    renderBars('bars-district',
      byDistrict(state.posters).map((row) => ({
        label: row.district,
        value: row.count,
        onClick: () => focusList({ district: row.district === '未設定' ? '' : row.district }),
      })),
      ' 件');

    // --- 貼替が古い順 ---
    const rows = stalest(state.posters, today, 20);
    el('stale-body').replaceChildren(...rows.map(({ poster, days }) => {
      const tr = document.createElement('tr');
      tr.addEventListener('click', () => openEditor(poster));

      const cells = [
        String(poster.no ?? ''),
        String(poster.placeName ?? ''),
        String(poster.district ?? ''),
        lastRefreshedOn(poster) ?? '未入力',
      ];
      for (const text of cells) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }

      const daysCell = document.createElement('td');
      daysCell.className = 'is-number';
      if (days === null) {
        daysCell.textContent = '不明';
        daysCell.classList.add('days--unknown');
      } else {
        daysCell.textContent = days + ' 日';
        if (days >= 365) daysCell.classList.add('days--long');
      }
      tr.append(daysCell);

      const owner = document.createElement('td');
      owner.textContent = String(poster.owner ?? '');
      tr.append(owner);

      return tr;
    }));
  }


  /**
   * 人口あたりのカバー率を描く。
   * 手薄な地区が上に来る。掲示が無い地区も並ぶ。
   * @returns {void}
   */
  function renderCoverage() {
    // 分母が1000人に満たない地区は順位から外す。
    // 広町（有権者184人）のような地区は1枚の増減で率が跳ね、
    // 外れ値として他の地区の棒を潰してしまう
    const MIN_PEOPLE = 1000;
    const rows = coverageByTown(
      state.posters, TOWN_POPULATION, state.coverageBasis, MIN_PEOPLE);

    const withRate = rows.filter((row) => row.per10k !== null);
    const zero = withRate.filter((row) => row.sheets === 0).length;

    // 外した地区を黙って消すと、そこに掲示している分が見えなくなる
    const small = rows.smallPopulation;
    const smallSheets = small.reduce((sum, row) => sum + row.sheets, 0);

    renderBars('bars-coverage', withRate.map((row) => ({
      label: row.district,
      value: Math.round(row.per10k * 10) / 10,
      // 掲示が1枚も無い地区は目を引くようにする
      tone: row.sheets === 0 ? 'attention' : undefined,
      onClick: () => focusList({ district: row.district }),
    })), ' 枚/万人');

    const basisLabel = state.coverageBasis === BASIS.population ? '総人口' : '有権者（18歳以上）';
    const parts = [
      '分母は' + basisLabel + '（品川区オープンデータ ' + POPULATION_AS_OF + '時点）。',
    ];
    if (zero > 0) parts.push('掲示が1枚も無い地区が ' + zero + ' あります。');
    if (rows.excluded > 0) {
      parts.push('区外・地区未設定の ' + rows.excluded + ' 件は分母が無いため対象外です。');
    }
    if (small.length > 0) {
      parts.push(
        '居住者が少ない ' + small.length + ' 地区（'
        + small.map((row) => row.district).join('・')
        + '）は率が実態を表さないため順位から外しています'
        + (smallSheets > 0 ? '（掲示 ' + smallSheets + ' 枚）' : '') + '。',
      );
    }
    el('coverage-note').textContent = parts.join(' ');
  }

  el('coverage-basis').addEventListener('change', (event) => {
    state.coverageBasis = /** @type {HTMLSelectElement} */ (event.target).value;
    renderCoverage();
  });


  // ================================================================ CSV

  /**
   * いま一覧に出ている行をCSVで書き出す。
   *
   * 全件ではなく絞り込んだ結果を出す。「脚立が要る場所だけ渡す」
   * といった使い方ができるようにするため。
   *
   * @returns {void}
   */
  function exportCsv() {
    const candidate = current();
    if (candidate === undefined) return;

    const rows = visibleRows();
    const text = buildCsv(rows, candidate.columns);

    // BOMを付けないとExcelがUTF-8と見なさず文字化けする
    const blob = new Blob([withBom(text)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);

    const name = candidate.name.replace(/[\\/:*?"<>|]/g, '_')
      + '_' + todayText() + '.csv';

    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  el('list-export').addEventListener('click', exportCsv);

  /** 選ばれている取り込み方 @returns {'merge'|'replace'} */
  function importMode() {
    const checked = document.querySelector('input[name="import-mode"]:checked');
    return /** @type {HTMLInputElement} */ (checked)?.value === 'replace' ? 'replace' : 'merge';
  }

  /**
   * 取り込み計画を組み直して確認画面に映す。
   * 知らない列を足す指定があれば、その列を加えた状態で組み立てる。
   * @returns {void}
   */
  function refreshImportPlan() {
    const candidate = current();
    if (candidate === undefined || state.importRows === null) return;

    let columns = candidate.columns;

    const addColumns = /** @type {HTMLInputElement} */ (el('import-add-columns')).checked;
    if (addColumns) {
      const first = buildImportPlan(state.importRows, state.posters, columns, importMode());
      for (const label of first.unknownColumns) {
        columns = addCustomColumn(columns, { label, type: 'text' });
      }
    }

    state.importColumns = columns;
    state.importPlan = buildImportPlan(state.importRows, state.posters, columns, importMode());
    renderImportPreview();
  }

  /** 確認画面を描く @returns {void} */
  function renderImportPreview() {
    const plan = state.importPlan;
    if (plan === null) return;

    el('import-counts').replaceChildren(
      buildKpi({ label: '追加', value: plan.add.length, unit: '件' }),
      buildKpi({ label: '更新', value: plan.update.length, unit: '件' }),
      buildKpi({
        label: '削除', value: plan.remove.length, unit: '件',
        tone: plan.remove.length > 0 ? 'alert' : undefined,
        note: plan.remove.length > 0 ? '元に戻せません' : '',
      }),
    );

    // 台帳に無い列
    el('import-unknown').hidden = plan.unknownColumns.length === 0;
    el('import-unknown-list').textContent = plan.unknownColumns.join('、');

    // 警告（止めはしないが見てほしいもの）
    const warnings = [];
    if (plan.duplicateAddresses.length > 0) {
      warnings.push('同じ掲示住所が複数あります: ' + plan.duplicateAddresses.join('、')
        + '（同じ建物に複数枚なら問題ありません）');
    }
    if (plan.remove.length > 0) {
      warnings.push('全置換のため、CSVに無い ' + plan.remove.length + ' 件が削除されます。');
    }
    if (plan.historyConflicts.length > 0) {
      // 黙って捨てない。どちらを採ったかを言う
      warnings.push('「貼替」の列と「最新貼替日」が食い違う行があります: '
        + plan.historyConflicts.join('、')
        + '（貼替の列を正として取り込みます）');
    }
    el('import-warnings').hidden = warnings.length === 0;
    el('import-warning-list').replaceChildren(...warnings.map((text) => {
      const li = document.createElement('li');
      li.className = 'list__item';
      li.textContent = text;
      return li;
    }));

    // 取り込めない理由
    el('import-errors').hidden = plan.errors.length === 0;
    el('import-error-list').replaceChildren(...plan.errors.slice(0, 20).map((text) => {
      const li = document.createElement('li');
      li.className = 'list__item';
      li.textContent = text;
      return li;
    }));

    // 取り込み後の例
    const columns = orderedColumns(state.importColumns ?? [], { includeHidden: false }).slice(0, 8);
    el('import-preview-head').replaceChildren(...columns.map((column) => {
      const th = document.createElement('th');
      th.textContent = column.label;
      return th;
    }));

    const samples = [...plan.add.map((a) => a.poster), ...plan.update.map((u) => u.poster)]
      .slice(0, 5);
    el('import-preview-body').replaceChildren(...samples.map((poster) => {
      const tr = document.createElement('tr');
      for (const column of columns) {
        const td = document.createElement('td');
        td.textContent = formatValue(posterValue(poster, column), column.type);
        tr.append(td);
      }
      return tr;
    }));

    /** @type {HTMLButtonElement} */ (el('import-run')).disabled = plan.blocked;
  }

  el('import-file').addEventListener('change', async (event) => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    const file = input.files?.[0];
    if (file === undefined) return;

    try {
      showError('import-error', 'import-error-text', '');
      const bytes = new Uint8Array(await file.arrayBuffer());
      state.importRows = parseCsv(decodeCsvBytes(bytes));
      /** @type {HTMLInputElement} */ (el('import-add-columns')).checked = false;
      refreshImportPlan();
      /** @type {HTMLDialogElement} */ (el('import-dialog')).showModal();
    } catch (error) {
      showError('import-error', 'import-error-text', toMessage(error));
    } finally {
      // 同じファイルを選び直せるようにする
      input.value = '';
    }
  });

  el('import-add-columns').addEventListener('change', refreshImportPlan);
  for (const radio of document.querySelectorAll('input[name="import-mode"]')) {
    radio.addEventListener('change', refreshImportPlan);
  }

  el('import-cancel').addEventListener('click', () => {
    state.importRows = null;
    state.importPlan = null;
    /** @type {HTMLDialogElement} */ (el('import-dialog')).close();
  });

  el('import-run').addEventListener('click', async () => {
    const candidate = current();
    const plan = state.importPlan;
    if (candidate === undefined || plan === null || plan.blocked) return;

    const summary = '追加 ' + plan.add.length + ' 件／更新 ' + plan.update.length + ' 件'
      + (plan.remove.length > 0 ? '／削除 ' + plan.remove.length + ' 件' : '');
    if (!window.confirm(summary + ' を実行します。\n元に戻せません。よろしいですか？')) return;

    const button = /** @type {HTMLButtonElement} */ (el('import-run'));
    button.disabled = true;

    try {
      showError('import-error', 'import-error-text', '');

      // 列を増やした場合は先に保存する。値の置き場所が無いと取り込めないため
      if (state.importColumns !== undefined && state.importColumns !== candidate.columns) {
        await db.saveColumns(state.uid, candidate.id, state.importColumns);
        candidate.columns = state.importColumns;
      }

      if (plan.add.length > 0) {
        await db.createPostersBulk(state.uid, candidate.id, plan.add.map((a) => a.poster));
      }
      for (const item of plan.update) {
        await db.savePoster(state.uid, candidate.id, item.id, item.poster);
      }
      for (const item of plan.remove) {
        await db.deletePoster(state.uid, candidate.id, item.id);
      }

      state.importRows = null;
      state.importPlan = null;
      /** @type {HTMLDialogElement} */ (el('import-dialog')).close();
      await reload();
      showTab('list');
    } catch (error) {
      showError('import-error', 'import-error-text', toMessage(error));
      /** @type {HTMLDialogElement} */ (el('import-dialog')).close();
    } finally {
      button.disabled = false;
    }
  });

  // ================================================================ デモ台帳

  el('create-demo').addEventListener('click', async () => {
    const button = /** @type {HTMLButtonElement} */ (el('create-demo'));
    if (!window.confirm(
      '見本データ44件を入れた「デモ」台帳を作ります。\n' +
      '既存の台帳には影響しません。よろしいですか？',
    )) return;

    button.disabled = true;
    try {
      showError('candidate-error', 'candidate-error-text', '');
      const { DEMO_POSTERS } = await import('./demo-data.js');
      const id = await db.createCandidate(state.uid, 'デモ（見本データ）');
      await db.createPostersBulk(state.uid, id, DEMO_POSTERS);
      state.currentId = id;
      await reload();
      showTab('list');
    } catch (error) {
      showError('candidate-error', 'candidate-error-text', toMessage(error));
    } finally {
      button.disabled = false;
    }
  });

  // ================================================================ 列

  /** @returns {void} */
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

    list.replaceChildren(...custom.map((column) => {
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
    }));
  }

  /** @returns {void} */
  function renderVisibility() {
    const candidate = current();
    if (candidate === undefined) return;

    el('visibility-list').replaceChildren(
      ...orderedColumns(candidate.columns, { includeHidden: true }).map((column) => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = column.visible !== false;
        input.addEventListener('change', () => void onToggleVisibility(column, input.checked));
        label.append(input, document.createTextNode(column.label));
        return label;
      }),
    );
  }

  /**
   * @param {import('./schema.js').Column} column
   * @param {boolean} visible
   * @returns {Promise<void>}
   */
  async function onToggleVisibility(column, visible) {
    const candidate = current();
    if (candidate === undefined) return;

    try {
      showError('column-error', 'column-error-text', '');
      const next = candidate.columns.map((c) =>
        c.key === column.key ? { ...c, visible } : c);
      await db.saveColumns(state.uid, candidate.id, next);
      candidate.columns = next;
      renderTable();
    } catch (error) {
      showError('column-error', 'column-error-text', toMessage(error));
    }
  }

  /**
   * @param {import('./schema.js').Column} column
   * @returns {Promise<void>}
   */
  async function onRemoveColumn(column) {
    if (!window.confirm(
      '列「' + column.label + '」を削除します。\n' +
      'この列に入力した値は表示されなくなります。よろしいですか？',
    )) return;

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

  // ================================================================ 候補者の操作

  el('candidate-select').addEventListener('change', (event) => {
    state.currentId = /** @type {HTMLSelectElement} */ (event.target).value;
    localStorage.setItem(lastCandidateKey(state.uid), state.currentId);
    state.filters = emptyFilters();
    state.selected.clear();
    /** @type {HTMLInputElement} */ (el('search')).value = '';
    renderCandidate();
    renderColumns();
    renderVisibility();
    renderRuleSelect();
    watchCurrent();
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

    if (!window.confirm(
      '「' + candidate.name + '」を保管します。\n' +
      '一覧から外れますが、データは消えません。よろしいですか？',
    )) return;

    try {
      showError('candidate-error', 'candidate-error-text', '');
      await db.archiveCandidate(state.uid, candidate.id);
      state.currentId = '';
      await reload();
    } catch (error) {
      showError('candidate-error', 'candidate-error-text', toMessage(error));
    }
  });

  // ================================================================ 起動

  renderAccountArea();

  // 一度でもログインしたことのある端末だけ、認証を読み込んで状態を引き継ぐ。
  // そうでなければ Firebase に一切触れずに端末内保存で立ち上がる。
  // ここが「ログインしなくても使える」の実体で、圏外でも起動できる。
  if (localStorage.getItem(SIGNED_IN_KEY) === '1' && canSignIn) {
    const loaded = await loadFirebase();
    if (!loaded.ok) showError('signin-error', 'signin-error-text', loaded.message);

    // 読み込めた場合、表示は onUserChanged が済ませている
    if (auth !== null) return;
  }

  await reloadSafely();
}

void start();
