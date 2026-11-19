/**
 * Session environment picker — Web (browser) half.
 *
 * A compact trigger in the composer tool row shows the session's current Python,
 * Node.js, C/C++ and Java environments; it opens a frosted picker above the
 * composer card. Picks run the Host `/env` command, so the Host owns validation,
 * the durable log record, and the pushed `envPicker` projection both halves read.
 */
window.__ModuleLoader__.load({
  id: 'dshen-env-picker',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Shared open/closed state for the trigger and the dock panel. */
    const panel = { open: false, listeners: new Set() }
    const notify = () => {
      for (const listener of panel.listeners) listener()
    }
    const setOpen = (next) => {
      if (panel.open === next) return
      panel.open = next
      notify()
    }
    const usePanelOpen = () => {
      const [, force] = React.useState(0)
      React.useEffect(() => {
        const listener = () => { force(value => value + 1) }
        panel.listeners.add(listener)
        return () => { panel.listeners.delete(listener) }
      }, [])
      return panel.open
    }

    /** Package-owned stylesheet; disposed with the plugin. */
    const CSS = `
.env-picker-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  max-width: 420px;
  overflow: hidden;
  transition: background .12s ease, color .12s ease;
}
.env-picker-trigger:hover,
.env-picker-trigger[aria-expanded="true"] {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.env-picker-trigger .env-picker-icon,
.env-picker-group-label .env-picker-icon {
  display: inline-flex;
  align-items: center;
}
.env-picker-icon svg { display: block; }
.env-picker-trigger .env-picker-value {
  max-width: 104px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.env-picker-trigger .env-picker-sep { opacity: .3; }
.env-picker-trigger .env-picker-chevron {
  font-size: 9px;
  opacity: .55;
  transition: transform .15s ease;
}

.env-picker-slot {
  /* Zero-height anchor: the panel floats above the composer instead of pushing it. */
  position: relative;
  display: flex;
  justify-content: center;
  width: 100%;
  height: 0;
  z-index: 40;
}
.env-picker-panel {
  box-sizing: border-box;
  position: absolute;
  left: 0;
  right: 0;
  bottom: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 70%;
  max-width: 100%;
  margin: 0 auto;
  padding: 12px 16px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 55%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 40%, transparent);
  backdrop-filter: blur(28px) saturate(1.8);
  -webkit-backdrop-filter: blur(28px) saturate(1.8);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent),
    0 12px 34px color-mix(in srgb, #000 15%, transparent);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  animation: env-picker-in .16s ease-out both;
}
@keyframes env-picker-in {
  from { opacity: 0; transform: translateY(6px) scale(.995); }
  to { opacity: 1; transform: none; }
}
.env-picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.env-picker-title { font-size: 12px; font-weight: 600; }
.env-picker-head-actions { display: inline-flex; align-items: center; gap: 4px; }
.env-picker-action {
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}
.env-picker-action:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.env-picker-close {
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.env-picker-close:hover { background: var(--dsw-alias-bg-layer-2); }
.env-picker-body {
  display: flex;
  flex-direction: column;
  max-height: 46vh;
  overflow-y: auto;
  padding-right: 2px;
}
.env-picker-group {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  align-items: center;
  column-gap: 12px;
  padding: 8px 0;
}
.env-picker-group + .env-picker-group {
  border-top: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 65%, transparent);
}
.env-picker-group-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-secondary);
}
.env-picker-values {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}
.env-picker-path {
  margin-left: auto;
  max-width: 52%;
  text-align: right;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: color-mix(in srgb, var(--dsw-alias-label-secondary) 85%, transparent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.env-picker-detail {
  grid-column: 2;
  margin: 2px 0 0 0;
  max-width: 100%;
  text-align: left;
  opacity: .85;
}
.env-picker-hint { color: var(--dsw-alias-label-secondary); font-size: 11px; }

.env-picker-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: wrap;
  padding: 2px 0 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 70%, transparent);
}
.env-picker-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: background .12s ease, color .12s ease;
}
.env-picker-tab:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.env-picker-tab[data-active="true"] {
  background: color-mix(in srgb, #2f6bff 12%, transparent);
  color: color-mix(in srgb, #2f6bff 78%, var(--dsw-alias-label-primary));
}
.env-picker-tab[data-off="true"] { opacity: .5; }
.env-picker-tab[data-off="true"] .env-picker-tab-label { text-decoration: line-through; }
.env-picker-manager { display: flex; flex-direction: column; gap: 8px; }
.env-picker-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 22px;
}
.env-picker-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}
.env-picker-toggle .env-picker-switch {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.env-picker-toggle[data-on="true"] {
  border-color: color-mix(in srgb, #2f6bff 50%, transparent);
  background: color-mix(in srgb, #2f6bff 10%, transparent);
  color: color-mix(in srgb, #2f6bff 78%, var(--dsw-alias-label-primary));
}
.env-picker-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 30vh;
  overflow-y: auto;
  padding-right: 2px;
}
.env-picker-item {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 8px;
  transition: background .12s ease;
}
.env-picker-item:hover { background: var(--dsw-alias-bg-layer-2); }
.env-picker-item[data-current="true"] { background: color-mix(in srgb, #2f6bff 9%, transparent); }
.env-picker-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.env-picker-radio { width: 10px; font-size: 10px; color: var(--dsw-alias-label-secondary); }
.env-picker-item[data-current="true"] .env-picker-radio {
  color: color-mix(in srgb, #2f6bff 78%, var(--dsw-alias-label-primary));
}
.env-picker-item-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.env-picker-item-label { display: flex; align-items: center; gap: 6px; }
.env-picker-tag {
  font-size: 9px;
  padding: 0 4px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 4px;
  color: var(--dsw-alias-label-secondary);
}
.env-picker-item-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: color-mix(in srgb, var(--dsw-alias-label-secondary) 85%, transparent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.env-picker-item-remove {
  width: 24px;
  height: 24px;
  margin-right: 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  opacity: .35;
  transition: opacity .12s ease, background .12s ease, color .12s ease;
}
.env-picker-item:hover .env-picker-item-remove,
.env-picker-item-remove:focus-visible { opacity: 1; }
.env-picker-item-remove:hover {
  background: color-mix(in srgb, #ef4444 14%, transparent);
  color: #ef4444;
}
.env-picker-add { display: flex; align-items: center; gap: 6px; }
.env-picker-input {
  height: 26px;
  width: 104px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  outline: none;
}
.env-picker-input::placeholder { color: var(--dsw-alias-label-secondary); opacity: .7; }
.env-picker-input:focus { border-color: color-mix(in srgb, #2f6bff 60%, transparent); }
.env-picker-input-path { flex: 1; min-width: 140px; width: auto; }
.env-picker-add-button {
  height: 26px;
  padding: 0 10px;
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.env-picker-add-button:disabled { opacity: .45; cursor: default; }
.env-picker-add-button:not(:disabled):hover {
  color: var(--dsw-alias-label-primary);
  border-color: color-mix(in srgb, #2f6bff 55%, transparent);
}
.env-picker-empty { font-size: 11px; color: var(--dsw-alias-label-secondary); padding: 6px 2px; }
`


    /** Brand glyphs (Simple Icons path data), bundled so the page needs no network. */
    const ICON_PATHS = {
      python: 'M14.25.18l.9.2.73.26.59.3.45.32.34.34.25.34.16.33.1.3.04.26.02.2-.01.13V8.5l-.05.63-.13.55-.21.46-.26.38-.3.31-.33.25-.35.19-.35.14-.33.1-.3.07-.26.04-.21.02H8.77l-.69.05-.59.14-.5.22-.41.27-.33.32-.27.35-.2.36-.15.37-.1.35-.07.32-.04.27-.02.21v3.06H3.17l-.21-.03-.28-.07-.32-.12-.35-.18-.36-.26-.36-.36-.35-.46-.32-.59-.28-.73-.21-.88-.14-1.05-.05-1.23.06-1.22.16-1.04.24-.87.32-.71.36-.57.4-.44.42-.33.42-.24.4-.16.36-.1.32-.05.24-.01h.16l.06.01h8.16v-.83H6.18l-.01-2.75-.02-.37.05-.34.11-.31.17-.28.25-.26.31-.23.38-.2.44-.18.51-.15.58-.12.64-.1.71-.06.77-.04.84-.02 1.27.05zm-6.3 1.98l-.23.33-.08.41.08.41.23.34.33.22.41.09.41-.09.33-.22.23-.34.08-.41-.08-.41-.23-.33-.33-.22-.41-.09-.41.09zm13.09 3.95l.28.06.32.12.35.18.36.27.36.35.35.47.32.59.28.73.21.88.14 1.04.05 1.23-.06 1.23-.16 1.04-.24.86-.32.71-.36.57-.4.45-.42.33-.42.24-.4.16-.36.09-.32.05-.24.02-.16-.01h-8.22v.82h5.84l.01 2.76.02.36-.05.34-.11.31-.17.29-.25.25-.31.24-.38.2-.44.17-.51.15-.58.13-.64.09-.71.07-.77.04-.84.01-1.27-.04-1.07-.14-.9-.2-.73-.25-.59-.3-.45-.33-.34-.34-.25-.34-.16-.33-.1-.3-.04-.25-.02-.2.01-.13v-5.34l.05-.64.13-.54.21-.46.26-.38.3-.32.33-.24.35-.2.35-.14.33-.1.3-.06.26-.04.21-.02.13-.01h5.84l.69-.05.59-.14.5-.21.41-.28.33-.32.27-.35.2-.36.15-.36.1-.35.07-.32.04-.28.02-.21V6.07h2.09l.14.01zm-6.47 14.25l-.23.33-.08.41.08.41.23.33.33.23.41.08.41-.08.33-.23.23-.33.08-.41-.08-.41-.23-.33-.33-.23-.41-.08-.41.08z',
      node: 'M11.998,24c-0.321,0-0.641-0.084-0.922-0.247l-2.936-1.737c-0.438-0.245-0.224-0.332-0.08-0.383 c0.585-0.203,0.703-0.25,1.328-0.604c0.065-0.037,0.151-0.023,0.218,0.017l2.256,1.339c0.082,0.045,0.197,0.045,0.272,0l8.795-5.076 c0.082-0.047,0.134-0.141,0.134-0.238V6.921c0-0.099-0.053-0.192-0.137-0.242l-8.791-5.072c-0.081-0.047-0.189-0.047-0.271,0 L3.075,6.68C2.99,6.729,2.936,6.825,2.936,6.921v10.15c0,0.097,0.054,0.189,0.139,0.235l2.409,1.392 c1.307,0.654,2.108-0.116,2.108-0.89V7.787c0-0.142,0.114-0.253,0.256-0.253h1.115c0.139,0,0.255,0.112,0.255,0.253v10.021 c0,1.745-0.95,2.745-2.604,2.745c-0.508,0-0.909,0-2.026-0.551L2.28,18.675c-0.57-0.329-0.922-0.945-0.922-1.604V6.921 c0-0.659,0.353-1.275,0.922-1.603l8.795-5.082c0.557-0.315,1.296-0.315,1.848,0l8.794,5.082c0.57,0.329,0.924,0.944,0.924,1.603 v10.15c0,0.659-0.354,1.273-0.924,1.604l-8.794,5.078C12.643,23.916,12.324,24,11.998,24z M19.099,13.993 c0-1.9-1.284-2.406-3.987-2.763c-2.731-0.361-3.009-0.548-3.009-1.187c0-0.528,0.235-1.233,2.258-1.233 c1.807,0,2.473,0.389,2.747,1.607c0.024,0.115,0.129,0.199,0.247,0.199h1.141c0.071,0,0.138-0.031,0.186-0.081 c0.048-0.054,0.074-0.123,0.067-0.196c-0.177-2.098-1.571-3.076-4.388-3.076c-2.508,0-4.004,1.058-4.004,2.833 c0,1.925,1.488,2.457,3.895,2.695c2.88,0.282,3.103,0.703,3.103,1.269c0,0.983-0.789,1.402-2.642,1.402 c-2.327,0-2.839-0.584-3.011-1.742c-0.02-0.124-0.126-0.215-0.253-0.215h-1.137c-0.141,0-0.254,0.112-0.254,0.253 c0,1.482,0.806,3.248,4.655,3.248C17.501,17.007,19.099,15.91,19.099,13.993z',
      c: 'M16.5921 9.1962s-.354-3.298-3.627-3.39c-3.2741-.09-4.9552 2.474-4.9552 6.14 0 3.6651 1.858 6.5972 5.0451 6.5972 3.184 0 3.5381-3.665 3.5381-3.665l6.1041.365s.36 3.31-2.196 5.836c-2.552 2.5241-5.6901 2.9371-7.8762 2.9201-2.19-.017-5.2261.034-8.1602-2.97-2.938-3.0101-3.436-5.9302-3.436-8.8002 0-2.8701.556-6.6702 4.047-9.5502C7.444.72 9.849 0 12.254 0c10.0422 0 10.7172 9.2602 10.7172 9.2602z',
      cpp: 'M22.394 6c-.167-.29-.398-.543-.652-.69L12.926.22c-.509-.294-1.34-.294-1.848 0L2.26 5.31c-.508.293-.923 1.013-.923 1.6v10.18c0 .294.104.62.271.91.167.29.398.543.652.69l8.816 5.09c.508.293 1.34.293 1.848 0l8.816-5.09c.254-.147.485-.4.652-.69.167-.29.27-.616.27-.91V6.91c.003-.294-.1-.62-.268-.91zM12 19.11c-3.92 0-7.109-3.19-7.109-7.11 0-3.92 3.19-7.11 7.11-7.11a7.133 7.133 0 016.156 3.553l-3.076 1.78a3.567 3.567 0 00-3.08-1.78A3.56 3.56 0 008.444 12 3.56 3.56 0 0012 15.555a3.57 3.57 0 003.08-1.778l3.078 1.78A7.135 7.135 0 0112 19.11zm7.11-6.715h-.79v.79h-.79v-.79h-.79v-.79h.79v-.79h.79v.79h.79zm2.962 0h-.79v.79h-.79v-.79h-.79v-.79h.79v-.79h.79v.79h.79z',
      java: 'M11.915 0 11.7.215C9.515 2.4 7.47 6.39 6.046 10.483c-1.064 1.024-3.633 2.81-3.711 3.551-.093.87 1.746 2.611 1.55 3.235-.198.625-1.304 1.408-1.014 1.939.1.188.823.011 1.277-.491a13.389 13.389 0 0 0-.017 2.14c.076.906.27 1.668.643 2.232.372.563.956.911 1.667.911.397 0 .727-.114 1.024-.264.298-.149.571-.33.91-.5.68-.34 1.634-.666 3.53-.604 1.903.062 2.872.39 3.559.704.687.314 1.15.664 1.925.664.767 0 1.395-.336 1.807-.9.412-.563.631-1.33.72-2.24.06-.623.055-1.32 0-2.066.454.45 1.117.604 1.213.424.29-.53-.816-1.314-1.013-1.937-.198-.624 1.642-2.366 1.549-3.236-.08-.748-2.707-2.568-3.748-3.586C16.428 6.374 14.308 2.394 12.13.215zm.175 6.038a2.95 2.95 0 0 1 2.943 2.942 2.95 2.95 0 0 1-2.943 2.943A2.95 2.95 0 0 1 9.148 8.98a2.95 2.95 0 0 1 2.942-2.942zM8.685 7.983a3.515 3.515 0 0 0-.145.997c0 1.951 1.6 3.55 3.55 3.55 1.95 0 3.55-1.598 3.55-3.55 0-.329-.046-.648-.132-.951.334.095.64.208.915.336a42.699 42.699 0 0 1 2.042 5.829c.678 2.545 1.01 4.92.846 6.607-.082.844-.29 1.51-.606 1.94-.315.431-.713.651-1.315.651-.593 0-.932-.27-1.673-.61-.741-.338-1.825-.694-3.792-.758-1.974-.064-3.073.293-3.821.669-.375.188-.659.373-.911.5s-.466.2-.752.2c-.53 0-.876-.209-1.16-.64-.285-.43-.474-1.101-.545-1.948-.141-1.693.176-4.069.823-6.614a43.155 43.155 0 0 1 1.934-5.783c.348-.167.749-.31 1.192-.425zm-3.382 4.362a.216.216 0 0 1 .13.031c-.166.56-.323 1.116-.463 1.665a33.849 33.849 0 0 0-.547 2.555 3.9 3.9 0 0 0-.2-.39c-.58-1.012-.914-1.642-1.16-2.08.315-.24 1.679-1.755 2.24-1.781zm13.394.01c.562.027 1.926 1.543 2.24 1.783-.246.438-.58 1.068-1.16 2.08a4.428 4.428 0 0 0-.163.309 32.354 32.354 0 0 0-.562-2.49 40.579 40.579 0 0 0-.482-1.652.216.216 0 0 1 .127-.03z',
      gdb: 'M5.072 13.931a.62.62 0 00-.52.338c-.114.211-.388.242-.516.201-.21-.07-.48-.119-.744.068-.263.187-.546.045-.495-.297.05-.34.172-.645.5-.83.713-.41.216-.695.607-1.108.394-.412.307-.537.293-1.1-1.326-.2-2.077-.58-2.915-1.63C.442 8.528.117 7.664.03 6.35-.057 5.033.02 4.18.588 3.09 1.156 2 1.756 1.475 2.788.93 3.825.383 4.84.254 5.78.271c.938.014 1.563.082 2.093.386.53.303 1.016.684 1.324.685.24.015.477-.053.673-.192.04 1.02-.878 1.108-1.698 1.13-.82.02-1.324-.317-2.08-.192-.754.128-1.992.47-2.595 1.52-.603 1.05-.624 1.42-.573 2.3.05.879.806 1.535 1.234 1.543.428.007.523-.117.898-.36.374-.246 2.284-2.61 2.934-3.14.653-.53 1.296-.696 1.99-.705.695-.008.87.015 1.433.246.56.229.903.652 1.355.91.23-.135.375-.34.584-.495.76-.552 1.152-.702 2.053-.615.518.052 1.17.347 1.56.686.693.604 1.265 1.44 1.727 2.079.36.497.785 1.09 1.392 1.277.66.2 1.157-.652 1.23-1.13.043-.27.097-.505.097-.8 0-.297-.03-.655-.115-.965a3.453 3.453 0 00-.392-.87c-.258-.415-.68-.85-1.116-1.071-.246-.125-.826-.353-1.19-.36-.449-.01-.79.14-1.202.168-.5.034-1.396.146-1.786-.24-.25-.246-.283-.41-.324-.73a.76.76 0 00.4.162c.314.026.606-.23.86-.378.21-.123.504-.34.778-.45.704-.285 1.567-.278 2.31-.2.594.06 1.367.324 1.89.62.525.297 1.03.798 1.4 1.269.465.594.72 1.104.888 1.844.216.945.277 2.365.015 3.299-.205.734-.887 1.86-1.467 2.414-.573.547-1.235.81-1.986.955.03.149.033.29.071.416.056.178.163.375.38.313.086-.025.133-.047.246.053.115.1.056.484-.266.66-.164.085-.334.103-.595.11a5.61 5.61 0 01-.953-.046c-.283-.047-.45-.272-.765-.308-.484-.055-.854-.404-1.244-.653-.162-.104-.218-.104-.31-.158.05.154.117.314.15.465.034.145.02.284.037.403.02.12.052.21.07.308.077.068.103.173.233.207.13.035.334-.018.468-.037.135-.018.224-.09.327-.07.105.02.204.096.292.166s.164.08.234.254c.07.178.135.537.146.777.01.24-.018.455-.089.648-.07.19-.135.273-.327.463s-.505.465-.818.66c.058.084.083.162.173.254.09.094.277.197.36.295.083.098.126.168.126.277a.587.587 0 01-.092.373c-.223.3-.483.352-.803.492.054.334.098.572.02.906-.03.137-.102.445-.27.525-.17.08-.492.041-.698.074-.205.031-.32.063-.48.094-.097.141-.24.297-.29.422-.05.127-.034.172.006.3.042.128.185.315.225.468a.93.93 0 01.01.463.834.834 0 01-.23.396c-.128.135-.38.24-.508.346-.125.11-.252.123-.217.303.047.248.41.646.67.744a.793.793 0 00.557-.04c-.014.208-.195.353-.315.493.322-.094.636-.27.854-.504-.067.203-.3.529-.645.816-.345.287-.343.229-.517.344.314.06.606.045.85.002a1.69 1.69 0 01-.64.207 1.876 1.876 0 01-.73-.055c-.26-.063-.499-.301-.814-.465.03.119.053.26.185.38.136.12.335.183.55.284-.273-.03-.559-.037-.825-.096a2.083 2.083 0 01-.478-.164c-.144-.07-.255-.176-.384-.264.06.117.08.256.184.352.104.098.275.135.412.199-.143-.004-.28.029-.43-.01a1.166 1.166 0 01-.443-.21 3.165 3.165 0 01-.445-.395c-.132-.145-.296-.332-.345-.463-.048-.133.03-.225.044-.338-.09.06-.2.094-.272.18-.07.088-.131.166-.1.318.03.15.171.338.27.506-.295-.242-.46-.336-.53-.625-.064-.273.104-.52.233-.725.064-.104.161-.2.22-.3-.134-.128-.284-.24-.4-.388-.112-.15-.161-.352-.276-.492-.117-.143-.274-.232-.41-.348.119.256.317.572.359.77.044.2-.048.323-.12.43-.07.108-.183.134-.291.198-.11.068-.277.016-.342.113s-.083.246-.021.344l.256.398a1.173 1.173 0 01-.327-.28c-.074-.097-.186-.189-.2-.317-.015-.13-.022-.246.064-.363.084-.117.318-.156.422-.246.105-.09.162-.148.156-.264-.006-.117-.12-.2-.217-.273-.3-.225-.68-.43-.934-.699a.931.931 0 01-.24-.379c-.03-.105.002-.188.072-.314.072-.13.315-.305.346-.443.029-.14-.095-.172-.205-.22-.111-.05-.322.024-.425-.062-.103-.086.03-.266-.086-.365-.116-.099-.38-.045-.52-.15a.724.724 0 01-.24-.395.828.828 0 01-.02-.436c.032-.113.128-.133.187-.19.06-.058.108-.105.03-.192-.074-.088-.33.004-.476-.105-.15-.113-.06-.38-.163-.494-.104-.109-.287-.066-.386-.104-.097-.035-.135.09-.194-.109-.06-.199-.063-.797-.143-1.02-.08-.223-.238-.016-.31-.236-.076-.22-.005-.574-.038-.908l-.15-.91c-.52.352-.867.463-1.428.561-.047 1.373-.176 2.182.29 3.705.466 1.521 1.409 2.42 2.68 3.707-1.68-1.256-2.478-2.279-2.98-3.588-.501-1.31-.406-2.407-.356-3.666zm8.918-.553a.837.837 0 01.376.098c.09.061.188.107.27.19.206.21.36.462.428.751.044.186.05.422.064.64-.062-.2-.103-.409-.192-.589-.14-.285-.376-.56-.672-.688a.35.35 0 00-.214-.027c.023.041.063.076.065.133 0 .06-.012.174-.112.223-.16.078-.34.021-.464-.086a.414.414 0 01-.102-.459c.08-.194.375-.194.553-.186zm-1.62-.272c.016-.332.134-.609.432-.77.187-.107.392-.18.604-.215.207-.026.713-.008 1.018.13.232.105.39.271.597.394.205.121.35.201.546.338.3.211.475.44.682.576.1.066.24.057.374.098-.104.03-.24.064-.35.03a1.565 1.565 0 01-.438-.265 2.946 2.946 0 00-.497-.359c-.124-.072-.33-.158-.466-.246-.135-.09-.37-.283-.502-.349a1.618 1.618 0 00-.65-.125c-.256.008-.626.05-.822.228-.197.18-.27.336-.227.566.073-.084.123-.19.195-.254.154-.133.33-.139.52-.113.216.027.323.15.394.354-.047-.033-.135-.109-.204-.135a.495.495 0 00-.438.043c-.18.098-.13.24-.154.396-.013.076-.04.133-.06.2a.39.39 0 01-.18-.099c0 .076-.01.141.005.223.014.084.055.184.084.273-.126-.125-.256-.24-.335-.402a1.058 1.058 0 01-.13-.517zm.218-2.4c.09-.134.12-.343.174-.515-.02.217.02.453-.083.609-.105.158-.292.129-.443.176.118-.09.258-.131.352-.268zm-2.206 3.203c.119-.096.438-.02.676-.002l-.514.133c-.017.06-.01.123-.048.174-.04.051-.114.068-.171.104.006-.155-.062-.313.057-.409zm1.682-6.65c.143.075.32.178.45.18.123.004.157-.08.231-.131.115.38.25.797.448 1.142.083.146.136.079.2.224.063.145.09.439.15.626s.137.32.207.483c-.174-.25-.4-.566-.5-.773-.098-.207-.035-.225-.115-.421-.078-.198-.238-.504-.357-.756-.086.01-.19.026-.255.006-.065-.021-.054-.091-.112-.134-.06-.045-.158-.027-.24-.1-.08-.07-.1-.217-.107-.346zm-.766 1.875c.135-.012.299.023.425.017.126-.006.216-.04.324-.06-.02-.19-.002-.537-.175-.664-.115-.08-.578-.02-.701.006-.28.06-.604.227-.873.33.258-.18.48-.346.79-.44.189-.054.622-.128.814-.075.089.023.104.06.158.135.183.255.183.475.23.773.046.07.095.119.134.194a.91.91 0 01.068.289c-.048-.07-.018-.155-.15-.206-.134-.053-.335-.005-.515.014.13.096.195.186.2.384.007.233-.19.4-.397.417-.285.022-.434-.041-.55-.285-.05-.107-.015-.236-.017-.341-.346.024-.34.013-.592.222.139.2.224.315.45.436.126.066.27.133.426.16.157.027.415.053.58.027a.629.629 0 00.38-.187c.122-.112.134-.274.181-.403a1.2 1.2 0 01-.07.37c-.14.27-.38.353-.667.353-.275 0-.616-.063-.873-.17-.205-.084-.545-.324-.625-.533-.056-.143-.012-.318-.018-.477.285-.19.354-.143.689-.198.14-.025.239-.076.374-.088zm-1.655-1.28c.007-.113.02-.11.03-.166-.26-.07-.36.099-.514.41-.057.116 0 .187-.062.264-.06.076-.16.065-.257.139-.098.074-.196.215-.29.292-.188.156-.446.25-.666.358.15-.111.443-.28.538-.44.05-.085.042-.246.12-.324.078-.075.105-.13.205-.15.1-.018.06-.135.093-.228.032-.091.097-.158.165-.251s.156-.23.29-.282c.136-.05.348.005.45-.023.103-.03.044-.105.119-.15s.219-.023.32-.072c.176-.084.26-.227.367-.377.015.326.01.56-.107.869-.131.346-.266.55-.641.763-.128.072-.257.098-.365.137.062-.086.152-.123.188-.256.034-.136.009-.4.017-.512zM15.7 9.447c-.177.014-.22-.012-.363.09l.232.36c-.006-.236.018-.284.133-.45zm-.465-.172c.246-.104.46-.19.73-.207.107-.008.274.009.383.016.094-.137.21-.244.256-.4.028-.104.015-.584-.038-.71-.146-.36-.29-.376-.495-.584-.146-.15-.152-.38-.197-.638-.015-.094-.062-.213-.084-.31a3.9 3.9 0 00-.857-.045c.148-.143.29-.271.334-.486a.959.959 0 00-.113-.667c-.12-.191-.315-.36-.494-.517-.178-.155-.436-.284-.604-.412.22-.077.444-.194.66-.235.56-.108 1.043.057 1.584.384.315.19.573.37.902.716.33.344.735.975 1.053 1.348.317.375.575.67.853.893.276.226.528.289.792.43l.412.439.335-.413.535.06.111-.601.49-.136-.079-.811.354-.252-.267-.504.27-.553-.352-.63.135-.607-.407-.348-.053-.646-.569-.217-.227-.56-.64-.008-.315-.417-.43.03-.48-.053-.27-.2-.395.26-.477-.247-.947.36.618-.538.64-.102.49-.126.662.218.582-.147.563.33.596-.03.293.525.591.067.32.58.372.206.1.746.333.315-.148.653.39.494-.363.529.39.332-.499.443.506.529-.613.2.398.566-.5.088.327.622-.563-.008.285.466-.62-.074.147.672-.468-.411-.159.814-.322-.585-.175.73-.397-.537.011.765-.439-.688c.091.39.073.817.33 1.185.793-.107 1.311-.307 1.92-.892.552-.533 1.214-1.644 1.394-2.35.204-.802.21-2.281.01-3.101-.195-.787-.447-1.163-.897-1.807-.43-.455-.853-.94-1.399-1.264-.8-.48-1.828-.608-2.74-.596a3.22 3.22 0 00-1.147.215c-.527.19-.95.61-1.487.818-.175.067-.315.068-.454-.004.135.27.28.39.62.49.243.07.824.025 1.226-.012.43-.04.654-.167 1.238-.16.57.01 1.024.225 1.272.368.511.292.877.614 1.196 1.13.175.28.298.6.383.924.086.324.124.688.13 1.006.006.318-.019.602-.097.888-.182.669-.583 1.35-1.407 1.245-.504-.063-1.263-1.01-1.518-1.357-.514-.701-1.042-1.477-1.687-2.06a2.587 2.587 0 00-1.463-.65c-.992-.09-1.287.099-2.033.716.15.047.3.074.455.145.346.156.662.357.938.615.29.27.42.442.43.829.007.259-.204.465-.4.649-.117.114-.274.218-.37.307-.128.117-.286.246-.125.432.06.07.165.123.252.189.14.103.075.488-.108.592a.61.61 0 01-.713-.061c.246-.035.402-.068.395-.27-.002-.115-.15-.213-.297-.28-.35-.16-.614-.134-.963-.386-.353-.254-.36-.393-.455-.79-.17.017-.327.02-.554.097-.226.074-.478.254-.684.299-.52.11-.623.078-.907.006-.501-.132-1.15.09-1.8.299-.107.033-.543 0-.836.102a5.518 5.518 0 00-1.457.853c-.556.469-1.286 1.869-1.698 3.477-.045.49.095.817-.213 1.055-.308.24-.3.851-.405 1.023-.103.17-.225.094-.45.336-.223.24-.337.201-.332.654.195-.125.477-.273.725-.285.22-.006.222.283.785-.273.3-.299.88-.309 1.283-.439.402-.13 1.125-.402 1.85-1.21.725-.81 1.072-1.664 1.213-2.896.02.215.06.463-.033 1.065-.095.604-.296 1.28.13 2.092l.264.504c-.157-.215-.465-.566-.56-.815l-.21-.577c-.48.752-.59.885-1.256 1.423-.026.334-.033.682.076 1.002.108.32-.064.688.02.9.082.21.273.09.336.303s-.032.635.064.842c.1.207.337.082.453.15.115.066.154.158.215.246.063.088-.023.297.103.365.126.066.32.01.453.074.13.066.15.223.12.361-.033.141-.173.205-.234.348a.365.365 0 00.02.373c.074.131.236.201.4.27.162.064.39.027.559.12.169.09.32.272.408.405a.542.542 0 01.109.363 1.038 1.038 0 01-.137.434c-.074.135-.236.3.02.555.254.254.246.145.393.313-.017-.289-.135-.52-.05-.738.089-.217.35-.256.485-.352.139-.1.219-.232.326-.348 0 .148.015.31-.002.42-.033.227-.102.432.237.467.153.016.299-.082.458-.14-.084.147-.23.27-.252.45a.793.793 0 00.13.56c.123.18.34.312.498.415.158.105.244.115.365.174.006.176-.03.363-.01.53a.962.962 0 00.17.454c.098.14.252.22.398.32-.08-.188-.242-.365-.24-.56.002-.197.06-.335.252-.51.19-.175.64-.325.85-.495a1.03 1.03 0 00.355-.436c.075-.164.055-.43.07-.576.068.205.078.27.102.486.02.217-.127.521-.19.68a1.02 1.02 0 00.51-.525c.058.035.03.125.05.301.094-.092.2-.162.293-.25.094-.088.195-.164.243-.287.046-.12.027-.252-.007-.393-.035-.143-.193-.307-.28-.463-.083-.152.017-.305.01-.492-.17-.029-.313-.117-.51-.088-.196.03-.42.248-.622.252-.2 0-.314-.188-.478-.238-.165-.053-.33-.045-.495-.07.21-.199 1.02-.295 1.576-.385a9.794 9.794 0 011.47-.133c.22-.006.506.068.66.025.153-.045.12-.15.165-.264.13-.318.066-.604-.004-.924-.444-.053-.908-.115-1.356-.082-.438.033-.956.242-1.41.256-.39.014-.975-.074-1.31-.28-.414-.25-.732-.79-.846-.966-.184-.28-.415-.836-.56-1.088-.14-.254-.171-.324-.29-.43-.116-.105-.276-.113-.417-.17.16.014.336-.035.482.047.22.127.465.648.601.877.145-.486.11-.676.53-.95-.337.378-.347.665-.429 1.11.28.46.67 1.193 1.18 1.396.186.074.502.12.7.145.622.076 1.22-.119 1.83-.27.444-.11.896-.066 1.437-.035.183.012.616-.1.707-.283a.33.33 0 00-.024-.33c-.07-.105-.255-.158-.355-.254-.1-.098-.156-.21-.235-.314a6.51 6.51 0 01-1.062.115c.22-.09.433-.14.66-.23.237-.098.463-.219.676-.359.186-.123.303-.193.438-.334.133-.143.304-.289.403-.463.1-.174.114-.369.12-.584.004-.215-.005-.516-.088-.69-.084-.173-.243-.226-.37-.265-.128-.04-.217.063-.35.076-.134.014-.258.096-.452.006a1.68 1.68 0 01-.617-.548c-.196-.274-.335-.722-.534-1.067-.343-.596-.77-1.15-1.18-1.702a3.392 3.392 0 01-.1-.508c-.032-.322-.036-.656.064-.97.075-.24.188-.493.438-.591a.48.48 0 01.317-.022c.09.032.18.135.142.252-.04.129-.127.134-.188.198a.693.693 0 00-.183.33c.11-.004.262-.011.354.013.12.03.23.11.29.279-.142-.126-.212-.185-.39-.188-.082-.002-.18.026-.27.04-.034.109-.054.244-.1.33-.05.084-.142.063-.177.16a.992.992 0 00-.02.392h.004zm1.242-.15c.056.022.075.028.146.08.07.053.165.105.22.23a.878.878 0 01.04.4c-.048-.015-.113-.005-.163-.047-.05-.043-.08-.14-.143-.18-.065-.043-.117-.034-.188-.043.038.096.05.199.036.3-.036.204-.156.308-.352.33-.084.013-.22-.015-.292-.028.034.075.09.143.126.219.164-.023.285-.02.375-.061.088-.041.183-.135.296-.173.113-.04.214-.04.338-.06-.098.085-.162.168-.26.254l.215.623c.152.096.294.146.485.263.19.116.42.327.67.44.248.112.395.176.656.224.26.05.467.262.722.295.255.032.735.041.932.021.225-.02.516-.135.542-.38-.188.044-.475.004-.619-.35-.064-.156-.034-.446-.132-.63-.099-.187-.236-.246-.4-.475-.164-.23-.43-.59-.58-.895-.15-.308-.188-.654-.313-.93-.128-.273-.319-.494-.469-.707-.323-.463-.584-.777-1.12-1.011-.257-.112-.55-.143-.823-.213-.113.05-.268.104-.295.237a.536.536 0 00.12.42c.16.166.395.343.487.604.06.168.076.73.025.883-.054.16-.178.257-.282.36zm.052 1.332c-.05.043-.087.087-.167.122-.08.036-.19.045-.295.07.148.232.305.467.447.71.143.242.266.51.4.764-.006-.147.003-.301-.018-.437-.02-.136-.083-.254-.145-.461-.06-.206-.135-.484-.222-.768zm-4-5.087a3.32 3.32 0 00.065.806c.058.267.11.404.328.564.396.295.648.245.955.416.145.08.328.217.382.359.053.146-.036.3-.146.363.192.029.408-.19.318-.41-.045-.11-.255-.16-.32-.271a.41.41 0 01-.033-.335c.053-.202.454-.388.597-.546.218-.248.3-.453.177-.77-.172-.445-.842-.804-1.242-.98-.183-.08-.287-.083-.43-.128.293.174.602.31.75.69.124.32.016.444.022.72.002.13.172.197.248.277.064.072.06.125.008.223a.256.256 0 00-.11-.2c-.113-.08-.235-.062-.295-.224-.09-.248.09-.484-.112-.762-.15-.208-.353-.441-.625-.447a1.073 1.073 0 00-.36.058l-.183-.22-.005-.003c-.372-.34-.626-.62-1.146-.852-.522-.234-.78-.27-1.38-.256-.596.013-1.19.063-1.882.66-.694.6-2.48 2.888-2.915 3.177-.43.289-.527.389-1.068.389-.54 0-1.387-.766-1.42-1.723-.032-.956-.045-1.297.62-2.45.665-1.151 1.867-1.504 2.762-1.624.895-.12 1.432.194 2.092.195.66.002 1.314-.11 1.508-.637-.095.056-.221.12-.577.1-.355-.018-.85-.43-1.402-.705C7.157.548 6.54.515 5.75.501c-.79-.015-1.777.045-2.755.574C2.018 1.6 1.35 2.16.783 3.195.215 4.228.13 5.07.223 6.322.313 7.57.7 8.5 1.442 9.42c.744.914 1.485 1.363 2.823 1.529l.283-1.242-.504.72.014-.802-.455.565-.202-.767-.367.615-.183-.855-.535.432.17-.705-.707.078.324-.491-.644.006.375-.653-.57-.091.454-.596-.698-.206.578-.555-.573-.467.448-.348-.42-.56.448-.52-.167-.684.379-.33.113-.785.426-.214.365-.61.677-.073.334-.553.68.035.642-.348.666.154.756-.228.562.13.73.108.706.564-1.08-.377-.545.26-.45-.273-.31.21-.55.056-.492-.03-.358.436-.732.007-.26.59-.65.227-.06.678-.468.366.155.637-.401.664.31.58-.305.53.403.264-.09.853.563.14.125.634.613-.063.38.434.47-.461c.859-.428 1.213-.668 1.883-1.391.76-.823 1.196-1.584 2.208-2.147.73-.405 1.32-.551 2.139-.408.766.132 1.024.593 1.59 1.077.06-.11.07-.14.168-.218-.03.142-.08.287-.093.423z',
    }
    const ICON_COLORS = { python: '#3776AB', node: '#5FA04E', c: '#659AD2', cpp: '#00599C', java: '#ED8B00', gdb: '#A42E12' }

    /** One brand glyph, sized for the composer row and the panel labels. */
    function Icon({ kind }) {
      if (ICON_PATHS[kind] === undefined) return null
      return h(
        'span',
        { className: 'env-picker-icon', 'aria-hidden': 'true' },
        h('svg', { viewBox: '0 0 24 24', width: '13', height: '13', fill: ICON_COLORS[kind] },
          h('path', { d: ICON_PATHS[kind] })),
      )
    }

    /** Full description of one option, for tooltips and the panel path lines. */
    function pathTextOf(item) {
      return item.kind === 'path' && !/[\\/]/.test(item.path) ? `PATH 中的 ${item.path}` : item.path
    }

    /** Short trigger label: the ambient PATH entry reads as PATH, names drop their parenthetical. */
    function shortLabel(item) {
      if (item.kind === 'path' && !/[\\/]/.test(item.path)) return 'PATH'
      const cut = String(item.label).split('（')[0].split('(')[0].trim()
      return cut.length > 16 ? `${cut.slice(0, 15)}…` : cut
    }

    /** Brand glyph key per group kind. */
    const ICON_KIND = { python: 'python', node: 'node', c: 'c', cpp: 'cpp', java: 'java', gdb: 'gdb' }

    /** One language tab in the manager header. */
    function Tab({ group, active, onSelect }) {
      return h(
        'button',
        {
          type: 'button',
          className: 'env-picker-tab',
          'data-active': active ? 'true' : 'false',
          'data-off': group.enabled ? 'false' : 'true',
          title: group.enabled ? group.label : `${group.label}（已关闭）`,
          onClick: () => { onSelect(group.kind) },
        },
        h(Icon, { kind: ICON_KIND[group.kind] ?? group.kind }),
        h('span', { className: 'env-picker-tab-label' }, group.label),
      )
    }

    /** One environment row: click to select, the × removes (custom) or hides (detected). */
    function EnvRow({ group, option, onSelect, onRemove }) {
      const current = group.current !== null && group.current !== undefined && group.current.id === option.id
      const pathText = pathTextOf(option)
      return h(
        'div',
        { className: 'env-picker-item', 'data-current': current ? 'true' : 'false' },
        h(
          'button',
          {
            type: 'button',
            className: 'env-picker-item-main',
            title: `选择 ${option.label}\n${pathText}`,
            onClick: () => { onSelect(option.id) },
          },
          h('span', { className: 'env-picker-radio', 'aria-hidden': 'true' }, current ? '●' : '○'),
          h(
            'span',
            { className: 'env-picker-item-text' },
            h(
              'span',
              { className: 'env-picker-item-label' },
              option.label,
              option.kind === 'custom' ? h('span', { className: 'env-picker-tag' }, '自定义') : null,
            ),
            h('span', { className: 'env-picker-item-path', title: pathText }, pathText),
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'env-picker-item-remove',
            title: option.kind === 'custom' ? '删除这个自定义环境' : '隐藏这个环境',
            'aria-label': `移除 ${option.label}`,
            onClick: () => { onRemove(option.id) },
          },
          '×',
        ),
      )
    }

    /** Inline form that adds a custom environment (name + executable path). */
    function AddForm({ onAdd }) {
      const [label, setLabel] = React.useState('')
      const [path, setPath] = React.useState('')
      const ready = label.trim().length > 0 && path.trim().length > 0
      const submit = () => {
        if (!ready) return
        onAdd(label.trim(), path.trim())
        setLabel('')
        setPath('')
      }
      return h(
        'div',
        { className: 'env-picker-add' },
        h('input', {
          className: 'env-picker-input',
          placeholder: '名称',
          value: label,
          onChange: event => { setLabel(event.target.value) },
        }),
        h('input', {
          className: 'env-picker-input env-picker-input-path',
          placeholder: '可执行文件路径，如 D:\\Python311\\python.exe',
          value: path,
          onChange: event => { setPath(event.target.value) },
          onKeyDown: event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          },
        }),
        h(
          'button',
          {
            type: 'button',
            className: 'env-picker-add-button',
            disabled: !ready,
            title: '添加环境',
            onClick: submit,
          },
          '+ 添加',
        ),
      )
    }

    /**
     * Composer trigger: the enabled groups' current environments at a glance.
     * @param props - slot props plus a projection refresh hook.
     */
    function Trigger({ useProjection, sessionId, refresh }) {
      const env = useProjection('envPicker')
      const open = usePanelOpen()
      const missing = env === undefined
      React.useEffect(() => {
        if (!missing) return undefined
        // A client that re-attached while the plugin reloaded keeps a baseline
        // without `envPicker`; retry the projection fetch a few times.
        let cancelled = false
        let attempt = 0
        const timer = setInterval(() => {
          attempt += 1
          refresh(sessionId)
          if (cancelled || attempt >= 5) clearInterval(timer)
        }, 800)
        refresh(sessionId)
        return () => { cancelled = true; clearInterval(timer) }
      }, [missing, sessionId])
      if (env === undefined) {
        // Keep the entry visible so the panel (and its retry) stays reachable.
        return h(
          'button',
          {
            type: 'button',
            className: 'env-picker-trigger',
            title: '运行环境（正在加载）',
            'aria-label': '运行环境（正在加载）',
            'aria-expanded': open ? 'true' : 'false',
            onClick: () => { setOpen(!panel.open) },
          },
          h(Icon, { kind: 'python' }),
          h(Icon, { kind: 'node' }),
          h(Icon, { kind: 'c' }),
          h(Icon, { kind: 'cpp' }),
          h(Icon, { kind: 'java' }),
          h(Icon, { kind: 'gdb' }),
          h('span', { className: 'env-picker-value' }, '环境'),
          h('span', { className: 'env-picker-chevron' }, open ? '▴' : '▾'),
        )
      }
      const groups = env.groups.filter(group => group.enabled)
      const label = groups.map(group => `${group.label} ${group.current === null ? '—' : group.current.label}`).join('，')
      // C and C++ usually resolve to the same toolchain: show one segment with both
      // icons instead of repeating the label twice.
      const segments = []
      let index = 0
      while (index < groups.length) {
        const group = groups[index]
        const next = groups[index + 1]
        const sharedToolchain = group.kind === 'c' && next !== undefined && next.kind === 'cpp'
          && next.current !== null && group.current !== null && next.current.label === group.current.label
        segments.push({
          key: group.kind,
          kinds: sharedToolchain ? ['c', 'cpp'] : [ICON_KIND[group.kind] ?? group.kind],
          label: group.current === null ? '—' : shortLabel(group.current),
        })
        index += sharedToolchain ? 2 : 1
      }
      const parts = []
      for (let position = 0; position < segments.length; position++) {
        const segment = segments[position]
        if (position > 0) parts.push(h('span', { key: `sep-${segment.key}`, className: 'env-picker-sep' }, '·'))
        for (const kind of segment.kinds) parts.push(h(Icon, { key: `icon-${segment.key}-${kind}`, kind }))
        parts.push(h('span', { key: `value-${segment.key}`, className: 'env-picker-value' }, segment.label))
      }
      return h(
        'button',
        {
          type: 'button',
          className: 'env-picker-trigger',
          title: groups.length === 0 ? '没有启用的运行环境' : `${label}\n点击管理运行环境`,
          'aria-label': `运行环境：${label}`,
          'aria-expanded': open ? 'true' : 'false',
          onClick: () => { setOpen(!panel.open) },
        },
        ...parts,
        h('span', { className: 'env-picker-chevron' }, open ? '▴' : '▾'),
      )
    }

    /**
     * Manager panel above the composer: one tab per language, the environment list
     * with add/remove, and an enable switch per language. Every mutation runs the
     * Host `/env` command, so the session log stays the only source of truth.
     * @param props - slot props plus the host command bridge.
     */
    function Panel({ useProjection, exec, sessionId, refresh }) {
      const env = useProjection('envPicker')
      const open = usePanelOpen()
      const [activeKind, setActiveKind] = React.useState(null)
      const [width, setWidth] = React.useState(null)
      const slotRef = React.useRef(null)
      React.useLayoutEffect(() => {
        if (!open) {
          setWidth(null)
          return undefined
        }
        const measure = () => {
          const editor = document.querySelector('[contenteditable="true"], textarea')
          if (editor === null) return
          setWidth(Math.round(editor.getBoundingClientRect().width * 0.7))
        }
        measure()
        window.addEventListener('resize', measure)
        return () => { window.removeEventListener('resize', measure) }
      }, [open])
      React.useEffect(() => {
        if (!open) return undefined
        // A floating panel closes on an outside click or Escape, like a popover.
        const onDown = (event) => {
          const target = event.target
          if (!(target !== null && typeof target === 'object' && 'nodeType' in target)) return
          if (slotRef.current !== null && slotRef.current.contains(target)) return
          const trigger = document.querySelector('.env-picker-trigger')
          if (trigger !== null && trigger.contains(target)) return
          setOpen(false)
        }
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', onDown, true)
        document.addEventListener('keydown', onKey, true)
        return () => {
          document.removeEventListener('mousedown', onDown, true)
          document.removeEventListener('keydown', onKey, true)
        }
      }, [open])
      if (!open) return null
      if (env === undefined) {
        // The projection has not arrived: keep the panel reachable and offer a retry.
        return h(
          'div',
          { className: 'env-picker-slot', ref: slotRef },
          h(
            'div',
            {
              className: 'env-picker-panel',
              role: 'group',
              'aria-label': '选择本会话的运行环境',
              style: width === null ? undefined : { width },
            },
            h(
              'div',
              { className: 'env-picker-head' },
              h('span', { className: 'env-picker-title' }, '本会话运行环境'),
              h(
                'span',
                { className: 'env-picker-head-actions' },
                h('button', { type: 'button', className: 'env-picker-action', onClick: () => refresh(sessionId) }, '重试'),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'env-picker-close',
                    title: '收起',
                    'aria-label': '收起环境选择',
                    onClick: () => { setOpen(false) },
                  },
                  '×',
                ),
              ),
            ),
            h('span', { className: 'env-picker-hint' }, '环境投影尚未到达；点「重试」重新拉取，或直接使用 /env 命令。'),
          ),
        )
      }
      const groups = env.groups
      const active = groups.find(group => group.kind === activeKind) ?? groups[0]
      const run = (line) => {
        void Promise.resolve(exec(sessionId, line)).catch(() => undefined)
      }
      const options = active.options
      return h(
        'div',
        { className: 'env-picker-slot', ref: slotRef },
        h(
          'div',
          {
            className: 'env-picker-panel',
            role: 'group',
            'aria-label': '选择本会话的运行环境',
            style: width === null ? undefined : { width },
          },
          h(
            'div',
            { className: 'env-picker-head' },
            h('span', { className: 'env-picker-title' }, '本会话运行环境'),
            h(
              'span',
              { className: 'env-picker-head-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'env-picker-action',
                  title: '恢复默认选择并重新开启所有语言',
                  onClick: () => { run('/env reset') },
                },
                '重置',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'env-picker-close',
                  title: '收起',
                  'aria-label': '收起环境选择',
                  onClick: () => { setOpen(false) },
                },
                '×',
              ),
            ),
          ),
          h(
            'div',
            { className: 'env-picker-tabs', role: 'tablist' },
            groups.map(group => h(Tab, {
              key: group.kind,
              group,
              active: group.kind === active.kind,
              onSelect: setActiveKind,
            })),
          ),
          h(
            'div',
            { className: 'env-picker-manager' },
            h(
              'div',
              { className: 'env-picker-toolbar' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'env-picker-toggle',
                  'data-on': active.enabled ? 'true' : 'false',
                  title: active.enabled ? `关闭 ${active.label}` : `开启 ${active.label}`,
                  onClick: () => { run(`/env ${active.enabled ? 'disable' : 'enable'} ${active.kind}`) },
                },
                h('span', { className: 'env-picker-switch', 'aria-hidden': 'true' }),
                active.enabled ? '已启用' : '已关闭',
              ),
              active.hiddenCount > 0
                ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'env-picker-action',
                    title: '恢复被隐藏的自动检测环境',
                    onClick: () => { run(`/env show all ${active.kind}`) },
                  },
                  `恢复 ${active.hiddenCount} 项`,
                )
                : null,
            ),
            h(
              'div',
              { className: 'env-picker-list' },
              options.length === 0
                ? h('span', { className: 'env-picker-empty' }, '没有可用环境：可以点「恢复」找回隐藏项，或在下面添加一个。')
                : options.map(option => h(EnvRow, {
                  key: option.id,
                  group: active,
                  option,
                  onSelect: id => { run(`/env ${active.kind} ${id}`) },
                  onRemove: id => { run(`/env remove ${active.kind} ${id}`) },
                })),
            ),
            h(AddForm, {
              key: active.kind,
              onAdd: (label, path) => { run(`/env add ${active.kind} "${label}" ${path}`) },
            }),
          ),
          h('span', { className: 'env-picker-hint' }, '改动只写进本会话日志，并作为提示词注入每个请求；也可以直接用 /env 命令。'),
        ),
      )
    }

    return {
      inject: ['slots', 'remote', 'remote.commands', 'sessions'],
      apply(ctx) {
        /** Package stylesheet, removed with the plugin. */
        const style = document.createElement('style')
        style.setAttribute('data-plugin', '@local/dsh-env-picker')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => { style.remove() })

        /** Run one Host command against this session; the Host pushes the projection back. */
        const exec = (sessionId, line) => ctx.remote.commands.execute(sessionId, line, [])
        /**
         * Pull a missing projection key again: a client that re-attached while the
         * plugin was reloaded keeps a baseline without `envPicker`, and the Host only
         * pushes frames on change.
         */
        const refresh = (sessionId) => {
          void Promise.resolve(ctx.sessions.refreshProjections(sessionId)).catch(() => undefined)
        }
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
          { name: 'conversation.input.left', id: 'env-picker-trigger', order: 40 },
          props => h(Trigger, { ...props, refresh }),
        ))
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
          { name: 'conversation.input.dock', id: 'env-picker-panel', order: 40 },
          props => h(Panel, { ...props, exec, refresh }),
        ))
      },
    }
  },
})
