// 地図（Leaflet + OpenStreetMap）。
//
// Leaflet は ES モジュールではないため、index.html の script タグで
// 読み込んだ window.L を使う。改ざん検知（integrity）を付けてある。
//
// タイルは OpenStreetMap の公開サーバを使う。利用規約により
// 出典の表示が必須なので、attribution を外さないこと。

import { posterValue } from './table.js';

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
  });
  map.addLayer(cluster);

  /** 現在地の印 @type {object | null} */
  let hereMarker = null;

  /** 地図を押してピンを足す状態か */
  let addMode = false;

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
     * @returns {number} 表示したピンの数
     */
    setPosters(posters, columns) {
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

        const marker = L.marker([poster.lat, poster.lng], { draggable: true });

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
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'button button--quiet';
        open.style.marginTop = '8px';
        open.textContent = 'この掲示場所を開く';
        open.addEventListener('click', () => handlers.onMarkerClick(poster.id));
        box.append(strong, sub, open);

        marker.bindPopup(box);

        marker.on('dragend', () => {
          const { lat, lng } = marker.getLatLng();
          handlers.onMarkerMoved(poster.id, lat, lng);
        });

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
     * @returns {void}
     */
    refresh() {
      map.invalidateSize();
    },
  };
}
