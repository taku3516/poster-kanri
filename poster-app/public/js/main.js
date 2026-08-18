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
import { summarize, byDistrict, stalest, lastRefreshedOn } from './stats.js';
import { geocodeAddress, reverseGeocode } from './geocode.js';

/** @param {string} id @returns {HTMLElement} */
function el(id) {
  const node = document.getElementById(id);
  if (node === null) throw new Error('要素が見つかりません: ' + id);
  return node;
}

/** @param {'loading'|'signin'|'setup'|'empty'|'app'} name @returns {void} */
function showView(name) {
  for (const key of ['loading', 'signin', 'setup', 'empty', 'app']) {
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
  uid: '', candidates: [], currentId: '',
  posters: [], unwatch: null,
  sortKey: 'no', sortDir: 'asc', search: '',
  editingId: null, draft: null,
  map: null,
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
      (posters) => {
        state.posters = posters;
        showError('list-error', 'list-error-text', '');
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

    const filtered = filterPosters(state.posters, candidate.columns, state.search);
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
    el('poster-head').replaceChildren(...columns.map((column) => {
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
      tr.addEventListener('click', () => openEditor(poster));

      for (const column of columns) {
        const td = document.createElement('td');
        if (column.type === 'number') td.className = 'is-number';
        if (column.type === 'check') td.className = 'is-check';
        td.textContent = formatValue(posterValue(poster, column), column.type);
        tr.append(td);
      }
      return tr;
    }));

    const total = state.posters.length;
    el('list-count').textContent = state.search.trim() === ''
      ? total + ' 件'
      : rows.length + ' 件 / 全 ' + total + ' 件';

    el('list-empty').hidden = rows.length > 0;
  }

  el('search').addEventListener('input', (event) => {
    state.search = /** @type {HTMLInputElement} */ (event.target).value;
    renderTable();
  });

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
    state.draft = poster === null
      ? { ...createEmptyPoster(candidate.columns), ...(prefill ?? {}) }
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
    /** @type {HTMLDialogElement} */ (el('edit-dialog')).showModal();
  }

  el('poster-add').addEventListener('click', () => openEditor(null));
  el('edit-cancel').addEventListener('click', () => {
    /** @type {HTMLDialogElement} */ (el('edit-dialog')).close();
  });

  el('edit-save').addEventListener('click', async () => {
    const candidate = current();
    if (candidate === undefined || state.draft === null) return;

    try {
      showError('edit-error', 'edit-error-text', '');
      if (state.editingId === null) {
        await db.createPoster(state.uid, candidate.id, state.draft);
      } else {
        await db.savePoster(state.uid, candidate.id, state.editingId, state.draft);
      }
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
      /** @type {HTMLDialogElement} */ (el('edit-dialog')).close();
    } catch (error) {
      showError('edit-error', 'edit-error-text', toMessage(error));
    }
  });


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

    const shown = state.map.setPosters(state.posters, candidate.columns);
    const pending = state.posters.filter(needsGeocoding).length;
    const hidden = state.posters.filter((p) => p.showOnMap === false).length;

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

    try {
      showError('map-error', 'map-error-text', '');
      await db.savePoster(state.uid, candidate.id, posterId, {
        ...poster, lat, lng, coordFixed: true,
      });
    } catch (error) {
      showError('map-error', 'map-error-text', toMessage(error));
    }
  }

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

  el('map-add-mode').addEventListener('change', (event) => {
    const on = /** @type {HTMLInputElement} */ (event.target).checked;
    state.map?.setAddMode(on);
    if (on) el('map-status').textContent = '地図を押すと、その場所に新しい掲示場所を作ります。';
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
   * @param {{label: string, value: number|string, unit?: string, note?: string, tone?: string}} spec
   * @returns {HTMLElement}
   */
  function buildKpi(spec) {
    const box = document.createElement('div');
    box.className = 'kpi' + (spec.tone ? ' kpi--' + spec.tone : '');

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
   * @param {{label: string, value: number, tone?: string}[]} rows
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
      const label = document.createElement('div');
      label.className = 'bars__label';
      label.textContent = row.label;

      const track = document.createElement('div');
      track.className = 'bars__track';
      const fill = document.createElement('div');
      fill.className = 'bars__fill' + (row.tone ? ' bars__fill--' + row.tone : '');
      fill.style.width = Math.round((row.value / max) * 100) + '%';
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
                 note: s.removed > 0 ? '撤去済 ' + s.removed + ' 件を除く' : '' }),
      buildKpi({ label: '掲示枚数', value: s.sheets, unit: '枚' }),
      buildKpi({ label: '貼替から1年以上', value: s.overOneYear, unit: '件',
                 tone: s.overOneYear > 0 ? 'attention' : undefined,
                 note: '次に回る候補' }),
      buildKpi({ label: '日付が不明', value: s.unknownDate, unit: '件',
                 tone: s.unknownDate > 0 ? 'alert' : undefined,
                 note: '掲示日も貼替日も未入力' }),
      buildKpi({ label: '地図に出ていない', value: s.noCoord + s.hiddenOnMap, unit: '件',
                 tone: s.noCoord > 0 ? 'attention' : undefined,
                 note: '座標なし ' + s.noCoord + ' ／ 掲載を外している ' + s.hiddenOnMap }),
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
      { label: '要脚立', value: s.needLadder, tone: 'attention' },
      { label: 'プラ段', value: s.plaDan, tone: 'muted' },
      { label: '室内', value: s.indoor, tone: 'muted' },
      { label: '他党あり', value: s.otherParty, tone: 'muted' },
    ], ' 件');

    // --- 地区別 ---
    renderBars('bars-district',
      byDistrict(state.posters).map((row) => ({ label: row.district, value: row.count })),
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
    state.search = '';
    /** @type {HTMLInputElement} */ (el('search')).value = '';
    renderCandidate();
    renderColumns();
    renderVisibility();
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

  auth.observeUser(async (user) => {
    if (user === null) {
      stopWatching();
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

    el('diagnostics').textContent =
      '配信元 ' + location.hostname +
      '／認証 ' + firebaseConfig.authDomain +
      '／方式 ' + auth.signInMethod;

    showView('loading');
    showTab('list');
    try {
      await reload();
    } catch (error) {
      el('setup-error-text').textContent = toMessage(error);
      showView('setup');
    }
  });
}

void start();
