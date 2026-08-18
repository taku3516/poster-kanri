// 地図（Leaflet + OpenStreetMap）。
//
// Leaflet は ES モジュールではないため、index.html の script タグで
// 読み込んだ window.L を使う。改ざん検知（integrity）を付けてある。
//
// タイルは OpenStreetMap の公開サーバを使う。利用規約により
// 出典の表示が必須なので、attribution を外さないこと。

import { posterValue } from './table.js';

/**
 * 色付きのピンの絵柄を作る。
 *
 * 色は決められた配色から来るが、念のため書式を確かめてから埋め込む。
 * 外から来た文字列をそのまま絵柄に入れないため。
 *
 * @param {string} hex '#rrggbb'
 * @returns {string} SVG
 */
function pinSvg(hex) {
  const color = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#626264';
  return '<svg width="26" height="36" viewBox="0 0 26 36" xmlns="http://www.w3.org/2000/svg">'
    + '<path d="M13 0C5.8 0 0 5.8 0 13c0 9.8 13 23 13 23s13-13.2 13-23C26 5.8 20.2 0 13 0z"'
    + ' fill="' + color + '" stroke="#ffffff" stroke-width="2"/>'
    + '<circle cx="13" cy="13" r="4.8" fill="#ffffff"/></svg>';
}

/** 品川区がおおよそ収まる範囲。起動時はここを映す */
const SHINAGAWA_BOUNDS = [[35.5800, 139.6880], [35.6450, 139.7900]];

/**
 * 地図を作る。
 *
 * @param {string} elementId 地図を入れる要素のid
 * @param {{
 *   onMarkerClick: (posterId: string) => void,
 *   onMarkerMoved: (posterId: string, lat: number, lng: number) => void,
 *   onMapClick: (lat: number, lng: number) => void,
 * }} handlers
 * @returns {object} 地図の操作口
 */
export function createMap(elementId, handlers) {
  const L = window.L;
  if (L === undefined) throw new Error('地図の部品を読み込めませんでした');

  const map = L.map(elementId, { zoomControl: true });
  map.fitBounds(SHINAGAWA_BOUNDS);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    // 出典の表示は OpenStreetMap の利用規約で必須
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 45,
    // 既定のクラスタは件数に応じて緑・黄・赤に変わる。
    // ピンの色分けと意味が衝突し、「緑＝最近貼り替えた」と誤読されるため、
    // 件数だけを表す中立の灰色にする
    iconCreateFunction(group) {
      const count = group.getChildCount();
      const size = count < 10 ? 34 : count < 50 ? 40 : 46;
      const node = document.createElement('div');
      node.className = 'cluster';
      node.style.width = size + 'px';
      node.style.height = size + 'px';
      node.style.lineHeight = size + 'px';
      node.textContent = String(count);
      return L.divIcon({
        html: node.outerHTML,
        className: 'cluster-wrap',
        iconSize: [size, size],
      });
    },
  });
  map.addLayer(cluster);

  /** 現在地の印 @type {object | null} */
  let hereMarker = null;

  /** 地図を押してピンを足す状態か */
  let addMode = false;

  /**
   * ピンを動かせる状態か。
   * 既定は「動かせない」。地図を掴んだつもりでピンが動く誤操作を防ぐため、
   * 動かすには明示的な操作（移動を許可する／その1本だけ解除する）を要する。
   */
  let dragEnabled = false;

  map.on('click', (event) => {
    if (!addMode) return;
    handlers.onMapClick(event.latlng.lat, event.latlng.lng);
  });

  return {
    /** Leaflet の地図そのもの（大きさの再計算などに使う） */
    raw: map,

    /**
     * 表示するピンを差し替える。
     * @param {Record<string, *>[]} posters
     * @param {import('./schema.js').Column[]} columns
     * @param {((poster: Record<string, *>) => {label: string, hex: string}) | null} colorFor
     *        色分けしないときは null
     * @returns {number} 表示したピンの数
     */
    setPosters(posters, columns, colorFor = null) {
      cluster.clearLayers();

      const byKey = new Map(columns.map((c) => [c.key, c]));
      const placeCol = byKey.get('placeName');
      const noCol = byKey.get('no');
      const addressCol = byKey.get('address');

      let shown = 0;

      for (const poster of posters) {
        // 地図に出さない指定、または座標が無いものは飛ばす
        if (poster.showOnMap === false) continue;
        if (typeof poster.lat !== 'number' || typeof poster.lng !== 'number') continue;

        // 色分けが指定されていれば色付きの絵柄を使う
        const paint = colorFor === null ? null : colorFor(poster);
        const icon = paint === null ? undefined : L.divIcon({
          className: 'pin',
          html: pinSvg(paint.hex),
          iconSize: [26, 36],
          iconAnchor: [13, 36],
          popupAnchor: [0, -32],
        });

        const marker = L.marker([poster.lat, poster.lng],
          icon === undefined
            ? { draggable: dragEnabled }
            : { draggable: dragEnabled, icon });

        const title = [
          noCol === undefined ? '' : posterValue(poster, noCol),
          placeCol === undefined ? '' : posterValue(poster, placeCol),
        ].filter((t) => t !== '' && t !== undefined && t !== null).join(' ');

        const address = addressCol === undefined ? '' : (posterValue(poster, addressCol) ?? '');

        // 文字列の組み立てで HTML を作らない（住所や所有者名がそのまま入るため）
        const box = document.createElement('div');
        const strong = document.createElement('div');
        strong.style.fontWeight = '700';
        strong.textContent = title === '' ? '(名称未設定)' : title;
        const sub = document.createElement('div');
        sub.textContent = String(address);

        // どの区切りで色が付いているかを吹き出しにも出す（色だけに頼らない）
        const legend = document.createElement('div');
        if (paint !== null) {
          legend.style.marginTop = '4px';
          legend.style.color = '#626264';
          legend.textContent = '色分け: ' + paint.label;
        }
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'button button--quiet';
        open.style.marginTop = '8px';
        open.textContent = 'この掲示場所を開く';
        open.addEventListener('click', () => handlers.onMarkerClick(poster.id));

        // このピン1本だけ移動を許す。全体を移動可能にせずに直せる
        const unlock = document.createElement('button');
        unlock.type = 'button';
        unlock.className = 'button button--quiet';
        unlock.style.marginTop = '4px';
        const setUnlockLabel = () => {
          const on = marker.dragging?.enabled() === true;
          unlock.textContent = on ? '移動できます（ドラッグ）' : 'このピンの位置を動かす';
          unlock.disabled = on;
        };
        unlock.addEventListener('click', () => {
          marker.dragging?.enable();
          setUnlockLabel();
        });
        marker.on('popupopen', setUnlockLabel);
        setUnlockLabel();
        box.append(strong, sub, legend, open, unlock);

        marker.bindPopup(box);

        marker.on('dragend', () => {
          const { lat, lng } = marker.getLatLng();
          handlers.onMarkerMoved(poster.id, lat, lng);
        });

        marker.__posterId = poster.id;
        cluster.addLayer(marker);
        shown += 1;
      }

      return shown;
    },

    /**
     * 全部のピンが収まるように寄せる。ピンが無ければ品川区全体を映す。
     * @returns {void}
     */
    fit() {
      const bounds = cluster.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [32, 32] });
      } else {
        map.fitBounds(SHINAGAWA_BOUNDS);
      }
    },

    /**
     * ピンを動かせるようにするかどうか。
     * 既にある印にもその場で反映する。
     *
     * @param {boolean} enabled
     * @returns {void}
     */
    setDragEnabled(enabled) {
      dragEnabled = enabled;
      cluster.eachLayer((marker) => {
        if (marker.dragging === undefined) return;
        if (enabled) marker.dragging.enable();
        else marker.dragging.disable();
      });
    },

    /**
     * 指定した掲示場所のピンを、その位置へ戻す。
     * 動かしたのを取り消すときに使う。
     *
     * @param {string} posterId
     * @param {number} lat
     * @param {number} lng
     * @returns {void}
     */
    moveMarker(posterId, lat, lng) {
      cluster.eachLayer((marker) => {
        if (marker.__posterId === posterId) marker.setLatLng([lat, lng]);
      });
    },

    /**
     * 地図を押したときにピンを足すかどうか。
     * @param {boolean} enabled
     * @returns {void}
     */
    setAddMode(enabled) {
      addMode = enabled;
      const container = map.getContainer();
      container.style.cursor = enabled ? 'crosshair' : '';
    },

    /**
     * 現在地を出して、そこへ寄せる。
     * @returns {Promise<void>}
     */
    locate() {
      return new Promise((resolve, reject) => {
        if (navigator.geolocation === undefined) {
          reject(new Error('この端末では現在地を取得できません'));
          return;
        }

        navigator.geolocation.getCurrentPosition(
          (position) => {
            const { latitude, longitude } = position.coords;
            if (hereMarker !== null) map.removeLayer(hereMarker);

            // ポスターのピンと見分けが付くよう、印の形を変える
            hereMarker = L.circleMarker([latitude, longitude], {
              radius: 8,
              color: '#0053a3',
              fillColor: '#0053a3',
              fillOpacity: 0.9,
            }).addTo(map).bindPopup('現在地');

            map.setView([latitude, longitude], 17);
            resolve();
          },
          (error) => {
            const messages = {
              1: '位置情報の利用が許可されていません。端末の設定をご確認ください。',
              2: '現在地を取得できませんでした。屋外でお試しください。',
              3: '現在地の取得に時間がかかっています。もう一度お試しください。',
            };
            reject(new Error(messages[error.code] ?? '現在地を取得できませんでした'));
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
        );
      });
    },

    /**
     * 隠れていた状態から表示したときは、大きさを計算し直す必要がある。
     *
     * 一度だけでは間に合わないことがある。表示に切り替えた直後は
     * まだ要素の大きさが確定しておらず、タイルが片側に寄って
     * 白い隙間が残る。少し遅らせてもう一度測り直す。
     * requestAnimationFrame は裏のタブで発火しないため使わない。
     *
     * @returns {void}
     */
    refresh() {
      map.invalidateSize();
      setTimeout(() => map.invalidateSize(), 120);
    },
  };
}
