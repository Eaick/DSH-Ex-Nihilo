window.__ModuleLoader__.load({
  id: 'dshen-rewind',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'rewind';
    const zh = {
      button: '回滚',
      title: '回滚到这一轮之前',
      captionA: '文件回到这一轮之前',
      captionB: '「恢复代码并分叉」会新建一个会话并打开',
      panelTitle: '回退',
      abortedBadge: '已中止',
      turnFormat: '第 {n} 轮',
      filesFormat: '{n} 个文件',
      noticeRewound: '已回退',
      snapshotsUnit: '条快照',
      noSnapshots: '还没有文件快照。',
      code: '恢复代码',
      forkCode: '恢复代码并分叉',
      forkHint: '新建会话',
      running: '处理中…',
      failed: '回滚失败',
      draftFailed: '已回滚，但原话回填失败',
      trash: '回收站',
      trashSubtitle: '已归档的会话与被移入回收站的副本；还原后可继续使用。',
      empty: '回收站是空的。',
      loading: '读取中…',
      refresh: '刷新',
      close: '关闭',
      restore: '还原',
      purge: '彻底删除',
      confirmPurge: '确认删除',
      cancel: '取消',
      purgeAll: '清空回收站',
      confirmPurgeAll: '确认清空',
      purgeAllHint: '同时删除归档会话与副本；运行中的会话会跳过',
      skippedLive: '个运行中跳过',
      failedCount: '个失败',
      collapseAll: '折叠全部',
      expandAll: '展开全部',
      unknownWorkspace: '未知工作区',
      sessions: '个会话',
      archivedBadge: '已归档',
      deletedBadge: '已删除',
      runningBadge: '运行中',
      noticeRestore: '已还原',
      noticePurge: '已彻底删除',
      noticePurgeAll: '已清空',
      noticePrune: '已清理失效条目',
      ghosts: '个失效条目：日志已丢失，但侧栏仍在显示',
      prune: '清理失效条目',
      search: '搜索会话…',
      clearSearch: '清除搜索',
      noMatch: '没有匹配的会话。',
      pruneLive: '个会话仍在本进程运行，重启后自动清除',
      failedLoad: '读取回收站失败',
      failedAction: '操作失败',
      problems: '个条目的文件不完整',
      connectionLost: '无法连接宿主：',
    };
    const en = {
      button: 'Rewind',
      title: 'Rewind to before this turn',
      captionA: 'Files return to this turn',
      captionB: '“Restore code and fork” opens a new conversation',
      panelTitle: 'Rewind',
      abortedBadge: 'stopped',
      turnFormat: 'Turn {n}',
      filesFormat: '{n} files',
      noticeRewound: 'Rewound',
      snapshotsUnit: 'snapshots',
      noSnapshots: 'No snapshots yet.',
      code: 'Restore code',
      forkCode: 'Restore code and fork',
      forkHint: 'new chat',
      running: 'Working…',
      failed: 'Rewind failed',
      draftFailed: 'Rewound, but the prompt could not be restored',
      trash: 'Trash',
      trashSubtitle: 'Archived conversations and deleted copies. Restore one to reopen it.',
      empty: 'The trash is empty.',
      loading: 'Loading…',
      refresh: 'Refresh',
      close: 'Close',
      restore: 'Restore',
      purge: 'Delete forever',
      confirmPurge: 'Delete forever',
      cancel: 'Cancel',
      purgeAll: 'Empty trash',
      confirmPurgeAll: 'Empty trash',
      purgeAllHint: 'Also deletes archived sessions; running sessions are skipped',
      skippedLive: 'running, skipped',
      failedCount: 'failed',
      collapseAll: 'Collapse all',
      expandAll: 'Expand all',
      unknownWorkspace: 'Unknown workspace',
      sessions: 'sessions',
      archivedBadge: 'archived',
      deletedBadge: 'deleted',
      runningBadge: 'running',
      noticeRestore: 'Restored',
      noticePurge: 'Deleted forever',
      noticePurgeAll: 'Emptied',
      noticePrune: 'Orphaned entries cleaned',
      ghosts: 'sidebar entries whose log is gone',
      prune: 'Clean up',
      search: 'Search sessions…',
      clearSearch: 'Clear search',
      noMatch: 'No matching session.',
      pruneLive: 'sessions are still loaded in this process; they clear on restart',
      failedLoad: 'Could not read the trash',
      failedAction: 'The action failed',
      problems: 'entries have incomplete files',
      connectionLost: 'Cannot reach the host: ',
    };

    const DATA_MARKER = /<!--rewind:data:([A-Za-z0-9+/=]+)-->/;
    function decodeBase64Utf8(value) {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return new TextDecoder().decode(bytes);
    }
    function extractData(text) {
      const match = DATA_MARKER.exec(text);
      if (match === null) return { text: String(text ?? '').replace(/\s+/g, ' ').trim(), data: undefined };
      let data;
      try {
        data = JSON.parse(decodeBase64Utf8(match[1]));
      } catch {
        data = undefined;
      }
      return { text: String(text ?? '').replace(DATA_MARKER, '').trim(), data };
    }

    function messageOf(error) {
      if (error === null || error === undefined) return 'unknown error';
      if (typeof error.message === 'string' && error.message !== '') return error.message;
      return String(error);
    }

    // ---------------------------------------------------------------------
    // Trash data: one JSON route on the shared API channel.
    // ---------------------------------------------------------------------

    const API_PATH = 'api/dsh-rewind/trash';

    function apiUrl() {
      try {
        return new URL(API_PATH, document.baseURI).toString();
      } catch {
        return API_PATH;
      }
    }

    async function apiRequest(body) {
      const init = { method: 'GET', credentials: 'same-origin', headers: { accept: 'application/json' } };
      if (body !== undefined) {
        init.method = 'POST';
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      const response = await fetch(apiUrl(), init);
      let payload;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      if (payload === undefined || payload === null || typeof payload !== 'object') {
        throw new Error(`HTTP ${response.status}`);
      }
      if (payload.ok !== true) {
        const failure = payload.error;
        throw new Error(failure !== undefined && typeof failure.message === 'string' ? failure.message : `HTTP ${response.status}`);
      }
      return payload;
    }

    function useTrash() {
      const [state, setState] = React.useState({ entries: [], problems: [], ghosts: [], error: '', notice: '', loading: true });
      const [busy, setBusy] = React.useState('');
      const alive = React.useRef(true);
      React.useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; };
      }, []);

      const accept = (payload, notice) => {
        setState({
          entries: Array.isArray(payload.entries) ? payload.entries : [],
          problems: Array.isArray(payload.problems) ? payload.problems : [],
          ghosts: Array.isArray(payload.ghosts) ? payload.ghosts : [],
          error: '',
          notice: notice === undefined ? '' : notice,
          loading: false,
        });
      };
      const reject = (error) => {
        setState((current) => ({ ...current, loading: false, notice: '', error: messageOf(error) }));
      };

      const reload = React.useCallback(async () => {
        setState((current) => ({ ...current, loading: true, error: '', notice: '' }));
        try {
          const payload = await apiRequest();
          if (alive.current) accept(payload);
        } catch (error) {
          if (alive.current) reject(error);
        }
      }, []);

      const act = React.useCallback(async (action, sessionId, notice) => {
        setBusy(sessionId === undefined ? action : sessionId);
        try {
          const payload = await apiRequest(sessionId === undefined ? { action } : { action, sessionId });
          if (alive.current) accept(payload, notice);
          return payload;
        } catch (error) {
          if (alive.current) reject(error);
          return undefined;
        } finally {
          if (alive.current) setBusy('');
        }
      }, []);

      React.useEffect(() => {
        void reload();
      }, [reload]);

      return { ...state, busy, reload, act };
    }

    function formatTime(iso) {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return typeof iso === 'string' ? iso : '';
      try {
        return date.toLocaleString(undefined, {
          year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
        });
      } catch {
        return date.toISOString();
      }
    }

    function entryTitle(entry) {
      const title = typeof entry.title === 'string' ? entry.title.trim() : '';
      return title === '' ? entry.sessionId : title;
    }

    // ---------------------------------------------------------------------
    // Styles: only host theme tokens (with safe fallbacks), so light/dark and
    // future theme changes follow the application instead of being hardcoded.
    // Type scale mirrors DSH itself: 13px body, 12px secondary, 11px chips.
    // ---------------------------------------------------------------------

    const LABEL = 'var(--dsw-alias-label-primary)';
    const LABEL_2 = 'var(--dsw-alias-label-secondary)';
    const LABEL_3 = 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))';
    const BORDER = 'var(--dsw-alias-border-l1)';
    const LAYER_1 = 'var(--dsw-alias-bg-layer-1)';
    const LAYER_2 = 'var(--dsw-alias-bg-layer-2)';

    const columnStyle = { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0' };
    // The page head matches DSH's page shell: 20px/500 title, 13px intro, 28px top
    // inset, and a centered 960px content column.
    const headerStyle = { display: 'flex', alignItems: 'baseline', gap: '8px', padding: '24px 0 4px', flex: 'none' };
    const pageTitleStyle = { margin: '0', fontSize: '20px', lineHeight: '28px', fontWeight: '500', color: LABEL };
    const countStyle = { fontSize: '13px', lineHeight: '20px', color: LABEL_3, whiteSpace: 'nowrap' };
    const subtitleStyle = { margin: '0 0 16px', fontSize: '13px', lineHeight: '20px', color: LABEL_2 };
    const listStyle = {
      display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto',
      minHeight: '80px', flex: '1 1 auto', padding: '0 4px 12px 0',
    };
    // One workspace section of the accordion: a flat head row, then flat rows.
    const groupHeadStyle = {
      display: 'flex', alignItems: 'center', gap: '8px', width: '100%', height: '32px',
      padding: '0 8px', border: 'none', borderRadius: '6px', background: 'transparent',
      color: LABEL, font: 'inherit', fontSize: '13px', lineHeight: '20px', fontWeight: '500',
      textAlign: 'left', cursor: 'pointer',
    };
    const groupTitleStyle = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
    const groupCountStyle = {
      flex: 'none', padding: '0 6px', borderRadius: '5px', background: LAYER_2,
      color: LABEL_2, fontSize: '12px', lineHeight: '16px',
    };
    const groupPathStyle = {
      flex: 'none', maxWidth: '50%', color: LABEL_3, fontSize: '12px', lineHeight: '16px',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    };
    const rowsStyle = { display: 'flex', flexDirection: 'column', gap: '2px', padding: '2px 0 0' };
    const rowStyle = { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 8px', borderRadius: '8px' };
    const rowTitleStyle = {
      fontSize: '14px', lineHeight: '20px', fontWeight: '500', color: LABEL,
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    };
    const rowMetaStyle = {
      fontSize: '12px', lineHeight: '17px', color: LABEL_3,
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    };
    const badgeStyle = {
      flex: 'none', fontSize: '11px', lineHeight: '16px', padding: '0 6px', borderRadius: '5px',
      border: `1px solid ${BORDER}`, color: LABEL_2, whiteSpace: 'nowrap',
    };
    const actionRowStyle = { display: 'flex', alignItems: 'center', gap: '2px', flex: 'none' };

    // Borderless text actions, like DSH's own list rows; only the destructive
    // label carries color.
    function textButton(extra) {
      return {
        font: 'inherit', fontSize: '13px', lineHeight: '20px', height: '28px', padding: '0 8px',
        borderRadius: '6px', border: 'none', background: 'transparent', color: LABEL,
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        whiteSpace: 'nowrap', ...extra,
      };
    }
    const quietButtonStyle = textButton();
    // Filled action buttons use DSH's own primary pair: brand fill + on-color
    // label, so they read as buttons in both themes.
    const primaryButtonStyle = textButton({
      background: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #0f1115))',
      color: 'var(--dsw-alias-label-on-color, #ffffff)',
      padding: '0 12px',
    });
    // Destructive actions stay colourless until the pointer is on them.
    const destructiveButtonStyle = textButton({
      color: 'var(--dsw-alias-state-error-primary)',
    });

    const errorStyle = { fontSize: '13px', lineHeight: '20px', padding: '8px 2px 0', color: 'var(--dsw-alias-state-error-primary)' };
    const noticeStyle = { fontSize: '13px', lineHeight: '20px', padding: '8px 2px 0', color: 'var(--dsw-alias-state-success-primary)' };
    const footerStyle = {
      display: 'flex', alignItems: 'center', gap: '8px', padding: '18px 2px 0', marginTop: '18px',
      borderTop: `1px solid ${BORDER}`, flex: 'none',
    };
    const emptyStyle = {
      flex: '1 1 auto', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: '6px', padding: '48px 12px', textAlign: 'center',
      fontSize: '13px', lineHeight: '20px', color: LABEL_2,
    };
    const ghostStyle = {
      display: 'flex', alignItems: 'center', gap: '8px', margin: '0 2px 12px', padding: '9px 12px',
      borderRadius: '8px', background: LAYER_2, color: 'var(--dsw-alias-state-warn-primary)',
      fontSize: '13px', lineHeight: '20px',
    };

    // Hover, focus, glass, and accordion affordances; every color is a host token.
    const TRASH_CSS = `
      .dsh-rewind-trash-scroll { scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-l2) transparent; }
      .dsh-rewind-trash-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
      .dsh-rewind-trash-scroll::-webkit-scrollbar-track { background: transparent; }
      .dsh-rewind-trash-scroll::-webkit-scrollbar-thumb {
        background: var(--dsw-alias-border-l2); border-radius: 999px;
        border: 3px solid transparent; background-clip: content-box;
      }
      .dsh-rewind-trash-row { transition: background-color .12s ease; }
      .dsh-rewind-trash-row:hover { background: var(--dsw-alias-bg-layer-2); }
      .dsh-rewind-group { transition: background-color .12s ease; }
      .dsh-rewind-group:hover { background: var(--dsw-alias-bg-layer-2); }
      .dsh-rewind-group:active { background: var(--dsw-alias-bg-layer-1); }
      .dsh-rewind-group:focus-visible { outline: none; box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); }
      .dsh-rewind-chevron {
        flex: none; display: inline-flex; color: var(--dsw-alias-label-secondary);
        transition: transform .12s ease;
      }
      .dsh-rewind-chevron[data-open="true"] { transform: rotate(90deg); }
      .dsh-rewind-trash-input { outline: none; font-family: inherit; }
      .dsh-rewind-trash-input:hover { border-color: var(--dsw-alias-border-l2); }
      .dsh-rewind-trash-input:focus-visible {
        border-color: var(--dsw-alias-border-l2);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
      }
      .dsh-rewind-trash-btn { transition: background-color .12s ease; }
      .dsh-rewind-trash-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
      .dsh-rewind-trash-btn:active:not(:disabled) { background: var(--dsw-alias-bg-layer-1); }
      .dsh-rewind-trash-btn:disabled { opacity: .5; cursor: default; }
      .dsh-rewind-primary-btn { transition: background-color .12s ease, opacity .12s ease; }
      .dsh-rewind-primary-btn:hover:not(:disabled) {
        background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary, #43454a));
      }
      .dsh-rewind-primary-btn:disabled { opacity: .45; cursor: default; }
      .dsh-rewind-destructive-btn { background: transparent; transition: background-color .12s ease; }
      .dsh-rewind-destructive-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
      .dsh-rewind-destructive-btn:active:not(:disabled) { background: var(--dsw-alias-bg-layer-1); }
      .dsh-rewind-destructive-btn:disabled { opacity: .5; cursor: default; }
      .dsh-rewind-icon-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 22px; height: 22px; padding: 0; border: none; border-radius: 6px;
        background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer;
        transition: background-color .12s ease, color .12s ease;
      }
      .dsh-rewind-icon-btn:hover:not(:disabled) {
        background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
      }
      .dsh-rewind-icon-btn[aria-expanded="true"] {
        background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
      }
      .dsh-rewind-menu {
        border-radius: 12px; padding: 5px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: color-mix(in srgb, var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1)) 40%, transparent);
        -webkit-backdrop-filter: blur(18px) saturate(180%);
        backdrop-filter: blur(18px) saturate(180%);
        box-shadow: 0 10px 30px rgba(15, 18, 26, .16), 0 1px 2px rgba(15, 18, 26, .08);
        transform-origin: bottom left;
        animation: dsh-rewind-menu-in .12s ease-out;
      }
      @keyframes dsh-rewind-menu-in {
        from { opacity: 0; transform: translateY(3px) scale(.985); }
        to { opacity: 1; transform: none; }
      }
      .dsh-rewind-menu-caption {
        padding: 7px 9px 8px; font-size: 12px; line-height: 17px;
        color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
      }
      .dsh-rewind-menu-caption > div + div { margin-top: 2px; }
      .dsh-rewind-menu-sep {
        height: 1px; margin: 4px 4px 5px;
        background: var(--dsw-alias-border-l1);
      }
      .dsh-rewind-menu-item {
        display: flex; align-items: center; gap: 8px; width: 100%; height: 32px;
        padding: 0 8px; border: none; border-radius: 8px; background: transparent;
        color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px;
        line-height: 20px; text-align: left; cursor: pointer;
        transition: background-color .1s ease;
      }
      .dsh-rewind-menu-item:hover { background: var(--dsw-alias-bg-layer-2); }
      .dsh-rewind-menu-item:active { background: var(--dsw-alias-bg-layer-1); }
      .dsh-rewind-menu-item:focus-visible {
        outline: none; background: var(--dsw-alias-bg-layer-2);
        box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2);
      }
      .dsh-rewind-menu-glyph { flex: none; display: inline-flex; color: var(--dsw-alias-label-secondary); }
      .dsh-rewind-menu-hint {
        margin-left: auto; font-size: 11px; line-height: 16px;
        color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
      }
      .dsh-rewind-handle { transition: background-color .12s ease, color .12s ease; }
      .dsh-rewind-handle:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
      .dsh-rewind-caret { font-size: 11px; line-height: 16px; color: var(--dsw-alias-state-error-primary); }
    `;

    const searchIcon = h('svg', {
      viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor',
      strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': true,
    }, h('circle', { cx: 7, cy: 7, r: 4.2 }), h('path', { d: 'M10.3 10.3 13.4 13.4' }));

    const searchRowStyle = { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' };
    const searchBoxStyle = { position: 'relative', display: 'flex', alignItems: 'center', flex: '0 1 420px', minWidth: '180px' };
    const searchInputStyle = {
      width: '100%', height: '32px', boxSizing: 'border-box', padding: '0 30px',
      borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
      fontFamily: 'inherit', fontSize: '13px', lineHeight: '20px',
    };
    const searchGlyphStyle = {
      position: 'absolute', left: '9px', display: 'inline-flex',
      color: 'var(--dsw-alias-label-secondary)', pointerEvents: 'none',
    };
    const clearButtonStyle = {
      position: 'absolute', right: '6px', width: '20px', height: '20px', padding: '0',
      border: 'none', borderRadius: '4px', background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)', fontSize: '14px', lineHeight: '20px', cursor: 'pointer',
    };
    const matchStyle = { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' };

    const chevron = h('svg', {
      viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none', stroke: 'currentColor',
      strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
    }, h('path', { d: 'M6 3.5 10.5 8 6 12.5' }));

    /** Last path segment of a workspace, for the accordion head. */
    function workspaceName(workspacePath) {
      const parts = String(workspacePath).split(/[\\/]/).filter((part) => part !== '');
      return parts.length === 0 ? String(workspacePath) : parts[parts.length - 1];
    }

    /** One trash page: header, search, the scrolling list, and its actions. */
    function TrashPanel(props) {
      const t = typeof props.i18n === 'function' ? props.i18n : (key) => key;
      const data = useTrash();
      const [confirming, setConfirming] = React.useState('');
      const [query, setQuery] = React.useState('');
      const [liveNote, setLiveNote] = React.useState('');
      const [collapsed, setCollapsed] = React.useState(() => new Set());

      const needle = query.trim().toLowerCase();
      const visible = needle === ''
        ? data.entries
        : data.entries.filter((entry) => `${entry.title ?? ''} ${entry.sessionId ?? ''} ${entry.workspacePath ?? ''}`
          .toLowerCase().includes(needle));

      // One accordion section per workspace, in path order; entries without a
      // workspace (moved copies of a removed workspace) collect in a last group.
      const groups = [];
      const byPath = new Map();
      for (const entry of visible) {
        const key = typeof entry.workspacePath === 'string' && entry.workspacePath !== '' ? entry.workspacePath : '';
        if (!byPath.has(key)) {
          const items = [];
          byPath.set(key, items);
          groups.push({ key, items });
        }
        byPath.get(key).push(entry);
      }
      groups.sort((left, right) => (left.key === '' ? 1 : right.key === '' ? -1 : left.key.localeCompare(right.key)));

      const isOpen = (key) => needle !== '' || !collapsed.has(key);
      const toggleGroup = (key) => setCollapsed((previous) => {
        const next = new Set(previous);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      const anyOpen = groups.some((group) => isOpen(group.key));
      const toggleAll = () => setCollapsed(anyOpen ? new Set(groups.map((group) => group.key)) : new Set());

      const purge = async (entry) => {
        setConfirming('');
        await data.act(entry.inPlace === true ? 'purge-in-place' : 'purge', entry.sessionId, t('noticePurge'));
      };
      const restore = async (entry) => {
        setConfirming('');
        await data.act(entry.inPlace === true ? 'unarchive' : 'restore', entry.sessionId, t('noticeRestore'));
      };
      const purgeAll = async () => {
        setConfirming('');
        const payload = await data.act('purge-all', undefined, '');
        const purged = payload !== undefined && Array.isArray(payload.purged) ? payload.purged.length : 0;
        const failed = payload !== undefined && Array.isArray(payload.failed) ? payload.failed.length : 0;
        const skipped = payload !== undefined && Array.isArray(payload.skipped) ? payload.skipped.length : 0;
        const parts = [`${t('noticePurgeAll')} ${purged}`];
        if (skipped > 0) parts.push(`${skipped} ${t('skippedLive')}`);
        if (failed > 0) parts.push(`${failed} ${t('failedCount')}`);
        setLiveNote(parts.join(' · '));
      };

      const renderRow = (entry) => {
        const id = entry.sessionId;
        const busy = data.busy === id;
        const confirmingRow = confirming === `purge:${id}`;
        const meta = [id, entry.at === '' ? '' : formatTime(entry.at)]
          .filter((part) => part !== '').join(' · ');
        return h(
          'div',
          { key: id, className: 'dsh-rewind-trash-row', style: { ...rowStyle, opacity: busy ? '0.6' : '1' } },
          h(
            'div',
            { style: { ...columnStyle, flex: '1 1 auto', minWidth: '0' } },
            h('div', { style: rowTitleStyle, title: id }, entryTitle(entry)),
            h('div', { style: rowMetaStyle, title: meta }, meta),
          ),
          entry.live === true
            ? h('span', { style: { ...badgeStyle, color: 'var(--dsw-alias-state-warn-primary)' } }, t('runningBadge'))
            : null,
          entry.inPlace === true
            ? h('span', { style: badgeStyle }, t('archivedBadge'))
            : h('span', { style: { ...badgeStyle, color: 'var(--dsw-alias-state-error-primary)' } }, t('deletedBadge')),
          confirmingRow
            ? h(
              'div',
              { style: actionRowStyle },
              h('button', {
                type: 'button',
                className: 'dsh-rewind-destructive-btn', style: destructiveButtonStyle,
                onClick: () => { void purge(entry); },
              }, t('confirmPurge')),
              h('button', {
                type: 'button',
                className: 'dsh-rewind-trash-btn', style: quietButtonStyle,
                onClick: () => setConfirming(''),
              }, t('cancel')),
            )
            : h(
              'div',
              { style: actionRowStyle },
              h('button', {
                type: 'button',
                className: 'dsh-rewind-primary-btn', style: primaryButtonStyle,
                disabled: busy,
                onClick: () => { void restore(entry); },
              }, t('restore')),
              h('button', {
                type: 'button',
                className: 'dsh-rewind-destructive-btn', style: destructiveButtonStyle,
                disabled: busy,
                onClick: () => setConfirming(`purge:${id}`),
              }, t('purge')),
            ),
        );
      };

      const sections = groups.map((group) => {
        const open = isOpen(group.key);
        const label = group.key === '' ? t('unknownWorkspace') : workspaceName(group.key);
        return h(
          'div',
          { key: group.key === '' ? '__unknown__' : group.key },
          h('button', {
            type: 'button',
            className: 'dsh-rewind-group',
            style: groupHeadStyle,
            'aria-expanded': open ? 'true' : 'false',
            title: group.key === '' ? t('unknownWorkspace') : group.key,
            onClick: () => toggleGroup(group.key),
          },
          h('span', { className: 'dsh-rewind-chevron', 'data-open': open ? 'true' : 'false' }, chevron),
          h('span', { style: groupTitleStyle }, label),
          h('span', { style: groupCountStyle }, String(group.items.length)),
          h('span', { style: { flex: '1 1 auto' } }),
          group.key === '' ? null : h('span', { style: groupPathStyle }, group.key)),
          open ? h('div', { style: rowsStyle }, group.items.map(renderRow)) : null,
        );
      });

      const body = data.loading && data.entries.length === 0
        ? h('div', { style: emptyStyle }, t('loading'))
        : data.entries.length === 0
          ? h('div', { style: emptyStyle }, t('empty'))
          : visible.length === 0
            ? h('div', { style: emptyStyle }, t('noMatch'))
            : h('div', { className: 'dsh-rewind-trash-scroll', style: listStyle }, sections);

      const confirmingAll = confirming === 'purge-all';
      const busy = data.busy !== '';

      return h(
        'div',
        { style: { ...columnStyle, flex: '1 1 auto', minHeight: '0', width: '100%', maxWidth: '960px' } },
        h(
          'div',
          { style: headerStyle },
          h('h1', { style: pageTitleStyle }, t('trash')),
          h('span', { style: countStyle }, `${data.entries.length} ${t('sessions')}`),
          h('span', { style: { flex: '1 1 auto' } }),
          groups.length > 1
            ? h('button', {
              type: 'button',
              className: 'dsh-rewind-primary-btn',
              style: primaryButtonStyle,
              onClick: toggleAll,
            }, anyOpen ? t('collapseAll') : t('expandAll'))
            : null,
          h('button', {
            type: 'button',
            className: 'dsh-rewind-primary-btn',
            style: primaryButtonStyle,
            disabled: data.loading,
            onClick: () => { void data.reload(); },
          }, t('refresh')),
        ),
        h('p', { style: subtitleStyle }, t('trashSubtitle')),
        h(
          'div',
          { style: searchRowStyle },
          h(
            'div',
            { style: searchBoxStyle },
            h('span', { style: searchGlyphStyle }, searchIcon),
            h('input', {
              type: 'text',
              className: 'dsh-rewind-trash-input',
              style: searchInputStyle,
              value: query,
              placeholder: t('search'),
              'aria-label': t('search'),
              onChange: (event) => setQuery(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Escape') setQuery('');
              },
            }),
            query === ''
              ? null
              : h('button', {
                type: 'button',
                className: 'dsh-rewind-trash-btn',
                style: clearButtonStyle,
                title: t('clearSearch'),
                'aria-label': t('clearSearch'),
                onClick: () => setQuery(''),
              }, '×'),
          ),
          needle === ''
            ? null
            : h('span', { style: matchStyle }, `${visible.length} / ${data.entries.length}`),
        ),
        data.ghosts.length === 0
          ? null
          : h(
            'div',
            { style: ghostStyle },
            h('span', { style: { flex: '1 1 auto' } }, `${data.ghosts.length} ${t('ghosts')}`),
            h('button', {
              type: 'button',
              className: 'dsh-rewind-primary-btn', style: primaryButtonStyle,
              disabled: data.busy === 'prune-ghosts',
              onClick: async () => {
                const payload = await data.act('prune-ghosts', undefined, t('noticePrune'));
                const skipped = payload !== undefined && Array.isArray(payload.skipped) ? payload.skipped.length : 0;
                setLiveNote(skipped > 0 ? `${skipped} ${t('pruneLive')}` : '');
              },
            }, t('prune')),
          ),
        body,
        data.error === ''
          ? null
          : h('div', { style: errorStyle }, `${t('failedAction')}: ${data.error}`),
        data.notice === '' ? null : h('div', { style: noticeStyle }, data.notice),
        liveNote === '' ? null : h('div', { style: noticeStyle }, liveNote),
        data.problems.length === 0
          ? null
          : h('div', { style: { ...errorStyle, color: 'var(--dsw-alias-state-warn-primary)' } }, `${data.problems.length} ${t('problems')}`),
        h(
          'div',
          { style: footerStyle },
          confirmingAll
            ? h(
              'div',
              { style: actionRowStyle },
              h('button', {
                type: 'button',
                className: 'dsh-rewind-destructive-btn', style: destructiveButtonStyle,
                disabled: data.busy === 'purge-all',
                onClick: () => { void purgeAll(); },
              }, t('confirmPurgeAll')),
              h('button', {
                type: 'button',
                className: 'dsh-rewind-trash-btn', style: quietButtonStyle,
                onClick: () => setConfirming(''),
              }, t('cancel')),
            )
            : h('button', {
              type: 'button',
              className: 'dsh-rewind-destructive-btn', style: destructiveButtonStyle,
              disabled: data.entries.length === 0 || busy,
              title: t('purgeAllHint'),
              onClick: () => setConfirming('purge-all'),
            }, t('purgeAll')),
          h('span', { style: { flex: '1 1 auto' } }),
          typeof props.onClose === 'function'
            ? h('button', { type: 'button', className: 'dsh-rewind-trash-btn', style: quietButtonStyle, onClick: props.onClose }, t('close'))
            : null,
        ),
      );
    }

    /** The sidebar entry id and the `main` key it opens; both carry this id. */
    const PANEL_ID = 'dsh-rewind-trash';

    /**
     * The page uses DSH's page shell: a full-height column that centres a 960px
     * content column, so the sidebar and the trash page line up with the rest of
     * the application instead of stretching edge to edge.
     */
    const pageStyle = {
      height: '100%', minHeight: '0', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', alignItems: 'center', overflow: 'hidden',
      padding: '0 clamp(24px, 4vw, 48px) 48px',
      color: 'var(--dsw-alias-label-primary)',
    };
    const pageInnerStyle = {
      display: 'flex', flexDirection: 'column', width: '100%', maxWidth: '960px',
      flex: '1 1 auto', minHeight: '0',
    };

    /** The dedicated trash page behind the sidebar entry. */
    function TrashPage(props) {
      const t = typeof props.i18n === 'function' ? props.i18n : (key) => key;
      return h('div', { style: pageStyle },
        h('div', { style: pageInnerStyle },
          h(TrashPanel, { i18n: t })));
    }

    /** Sidebar panel-list glyph; the owner supplies its size and active color. */
    function TrashPanelIcon(props) {
      const size = Number.isFinite(props.size) ? props.size : 20;
      return h('svg', {
        viewBox: '0 0 16 16', width: size, height: size, fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      }, h('path', { d: 'M3 4.6h10' }), h('path', { d: 'M6.2 4.6V3.2h3.6v1.4' }), h('path', { d: 'M4.6 4.6l.6 8.2h5.6l.6-8.2' }));
    }

    // ---------------------------------------------------------------------
    // Rewind: the session-level panel above the composer.
    // ---------------------------------------------------------------------

    const dockStyle = {
      position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
      width: '100%', flex: 'none', padding: '2px 0 6px',
    };
    /**
     * The D-shaped capsule: flat against the column's left edge (the sidebar),
     * rounded on the chat side, so it reads as a handle attached to the sidebar.
     */
    const handleStyle = {
      display: 'inline-flex', alignItems: 'center', gap: '6px', height: '34px',
      padding: '0 14px 0 12px', border: `1.5px solid ${BORDER}`, borderLeft: 'none',
      borderRadius: '0 999px 999px 0',
      background: 'color-mix(in srgb, var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1)) 70%, transparent)',
      WebkitBackdropFilter: 'blur(12px) saturate(180%)',
      backdropFilter: 'blur(12px) saturate(180%)', color: LABEL_2,
      font: 'inherit', fontSize: '12px', lineHeight: '18px', fontWeight: '500',
      cursor: 'pointer', boxShadow: '0 2px 8px rgba(15, 18, 26, .05)',
    };
    const panelStyle = {
      position: 'absolute', bottom: 'calc(100% + 8px)', left: '0',
      width: '390px', maxWidth: 'calc(100vw - 96px)', maxHeight: '52vh', overflowY: 'auto',
      display: 'flex', flexDirection: 'column', borderRadius: '12px', padding: '6px',
      border: `1px solid ${BORDER}`,
      background: 'color-mix(in srgb, var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1)) 40%, transparent)',
      WebkitBackdropFilter: 'blur(22px) saturate(180%)',
      backdropFilter: 'blur(22px) saturate(180%)',
      boxShadow: '0 10px 30px rgba(15, 18, 26, .16), 0 1px 2px rgba(15, 18, 26, .08)',
    };
    const panelHeadStyle = { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px 6px', fontSize: '12px', color: LABEL_3 };
    const dockMetaStyle = {
      fontSize: '12px', lineHeight: '18px', color: LABEL_3,
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    };
    const dockRowStyle = { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '8px' };

    /**
     * Session-level rewind entry.
     *
     * The per-message menu only exists on a finalized assistant message, so a turn
     * the user stopped had no way back: an interrupted turn often has no final
     * assistant message at all. This capsule lists the Session's own checkpoints —
     * newest first, aborted turns labelled — so restore and fork work from a turn
     * number alone.
     */
    function RewindDock(props) {
      const t = typeof props.i18n === 'function' ? props.i18n : (key) => key;
      const sessionId = props.sessionId;
      const list = typeof props.rewindList === 'function' ? props.rewindList : async () => [];
      const act = typeof props.rewindTurn === 'function' ? props.rewindTurn : async () => ({ error: 'rewind: host action unavailable' });
      const [open, setOpen] = React.useState(false);
      const [checkpoints, setCheckpoints] = React.useState([]);
      const [error, setError] = React.useState('');
      const [notice, setNotice] = React.useState('');
      const [busy, setBusy] = React.useState('');
      const [settled, setSettled] = React.useState(false);
      const rootRef = React.useRef(null);

      const load = React.useCallback(async () => {
        if (typeof sessionId !== 'string' || sessionId === '') return;
        try {
          const items = await list(sessionId);
          setCheckpoints(Array.isArray(items) ? items : []);
          setError('');
        } catch (failure) {
          setError(messageOf(failure));
        } finally {
          setSettled(true);
        }
      }, [list, sessionId]);

      React.useEffect(() => { void load(); }, [load]);

      React.useEffect(() => {
        if (!open) return undefined;
        const close = (event) => {
          if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false);
        };
        const escape = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', escape);
        return () => {
          document.removeEventListener('mousedown', close);
          document.removeEventListener('keydown', escape);
        };
      }, [open]);

      // A blank conversation has nothing to rewind; the capsule only appears once
      // this session has at least one recorded checkpoint.
      if (!settled || checkpoints.length === 0) return null;

      const pattern = (key, fallback) => {
        const value = t(key);
        return typeof value === 'string' && value !== '' ? value : fallback;
      };
      const turnLabel = (turn) => pattern('turnFormat', '{n}').replace('{n}', String(turn));
      const filesLabel = (files) => pattern('filesFormat', '{n}').replace('{n}', String(files));

      const run = async (turn, mode) => {
        if (busy !== '') return;
        setBusy(`${turn}:${mode}`);
        setError('');
        setNotice('');
        try {
          const outcome = await act(sessionId, turn, mode);
          if (outcome !== undefined && outcome.error !== undefined) setError(outcome.error);
          else setNotice(t('noticeRewound'));
          await load();
        } catch (failure) {
          setError(messageOf(failure));
        } finally {
          setBusy('');
        }
      };

      const row = (item) => h('div', { key: item.turn, style: dockRowStyle },
        h('span', { style: { minWidth: '56px', fontWeight: '500', whiteSpace: 'nowrap' } }, turnLabel(item.turn)),
        item.aborted === true
          ? h('span', { style: { ...badgeStyle, color: 'var(--dsw-alias-state-warn-primary)' } }, t('abortedBadge'))
          : item.open === true
            ? h('span', { style: { ...badgeStyle, color: 'var(--dsw-alias-state-warn-primary)' } }, t('runningBadge'))
            : null,
        h('span', { style: { ...dockMetaStyle, flex: '1 1 auto', minWidth: '0' } },
          [formatTime(item.at), filesLabel(item.files)].filter((part) => part !== '').join(' · ')),
        h('button', {
          type: 'button',
          className: 'dsh-rewind-primary-btn',
          style: { ...primaryButtonStyle, height: '26px', fontSize: '12px', padding: '0 10px' },
          disabled: busy !== '',
          onClick: () => { void run(item.turn, 'code'); },
        }, t('code')),
        h('button', {
          type: 'button',
          className: 'dsh-rewind-trash-btn',
          style: { ...quietButtonStyle, height: '26px', fontSize: '12px', padding: '0 8px' },
          disabled: busy !== '',
          onClick: () => { void run(item.turn, 'fork-code'); },
        }, t('forkCode')));

      return h('div', { ref: rootRef, style: dockStyle },
        h('button', {
          type: 'button',
          className: 'dsh-rewind-handle',
          style: handleStyle,
          'aria-expanded': open ? 'true' : 'false',
          'aria-haspopup': 'dialog',
          title: t('panelTitle'),
          onClick: () => {
            setOpen((value) => !value);
            void load();
          },
        }, h('span', { className: 'dsh-rewind-menu-glyph', style: { display: 'inline-flex' } }, ICON),
        h('span', null, t('panelTitle'))),
        open
          ? h('div', { style: panelStyle, role: 'dialog', 'aria-label': t('panelTitle') },
            h('div', { style: panelHeadStyle },
              h('span', { style: { fontWeight: '500', color: LABEL } }, t('panelTitle')),
              h('span', null, `${checkpoints.length} ${t('snapshotsUnit')}`),
              h('span', { style: { flex: '1 1 auto' } }),
              error === '' ? null : h('span', { className: 'dsh-rewind-caret', title: error }, error),
              notice === '' ? null : h('span', { style: { color: 'var(--dsw-alias-state-success-primary)' } }, notice)),
            checkpoints.length === 0
              ? h('div', { style: { ...dockMetaStyle, padding: '10px 8px' } }, t('noSnapshots'))
              : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, checkpoints.map(row)))
          : null);
    }

    // ---------------------------------------------------------------------
    // Rewind: the per-message menu in the conversation.
    // ---------------------------------------------------------------------

    const ICON = h('svg', {
      viewBox: '0 0 16 16', width: 15, height: 15, fill: 'none', stroke: 'currentColor',
      strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
    }, h('path', { d: 'M6.2 3.2 3.6 5.8l2.6 2.6' }), h('path', { d: 'M3.8 5.8h5.4a3 3 0 0 1 0 6H7.6' }));

    /** Code-only: put the files back, keep the conversation. */
    const FILE_GLYPH = h('svg', {
      viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', stroke: 'currentColor',
      strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
    }, h('path', { d: 'M9.1 1.9H4.9a1.1 1.1 0 0 0-1.1 1.1v9.9a1.1 1.1 0 0 0 1.1 1.1h6.2a1.1 1.1 0 0 0 1.1-1.1V5L9.1 1.9Z' }), h('path', { d: 'M9.1 1.9v3.2h3.1' }));

    /** Restore + fork: files back and a new conversation opened. */
    const FORK_GLYPH = h('svg', {
      viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', stroke: 'currentColor',
      strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
    }, h('circle', { cx: 4.2, cy: 3.8, r: 1.5 }), h('circle', { cx: 4.2, cy: 12.2, r: 1.5 }), h('circle', { cx: 11.8, cy: 8, r: 1.5 }), h('path', { d: 'M5.6 4.6 10.4 7.4' }), h('path', { d: 'M5.6 11.4 10.4 8.6' }));

    const menuStyle = {
      position: 'absolute', bottom: 'calc(100% + 8px)', left: '0', zIndex: 60,
      minWidth: '236px', maxWidth: '280px', color: LABEL,
    };
    const captionStyle = { fontSize: '12px', lineHeight: '17px', color: LABEL_3 };
    const itemStyle = { fontSize: '13px' };

    /** One finalized-assistant action: the rewind menu for that message's turn. */
    function RewindAction(props) {
      const t = typeof props.i18n === 'function' ? props.i18n : (key) => key;
      const rewind = typeof props.rewind === 'function'
        ? props.rewind
        : async () => ({ error: 'rewind: host action unavailable' });
      const messageId = props.messageId;
      const [open, setOpen] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      const rootRef = React.useRef(null);
      const menuRef = React.useRef(null);

      React.useEffect(() => {
        if (!open) return undefined;
        const close = (event) => {
          if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false);
        };
        const escape = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', escape);
        // Focus the first entry, like the application's own menus do.
        const first = menuRef.current === null ? null : menuRef.current.querySelector('[role="menuitem"]');
        if (first !== null) first.focus();
        return () => {
          document.removeEventListener('mousedown', close);
          document.removeEventListener('keydown', escape);
        };
      }, [open]);

      const run = async (mode) => {
        if (busy) return;
        setBusy(true);
        setError('');
        setOpen(false);
        try {
          const outcome = await rewind(props.sessionId, messageId, mode);
          if (outcome !== undefined && outcome.error !== undefined) setError(outcome.error);
        } catch (failure) {
          setError(messageOf(failure));
        } finally {
          setBusy(false);
        }
      };

      const item = (glyph, label, hint, mode) => h('button', {
        type: 'button',
        role: 'menuitem',
        className: 'dsh-rewind-menu-item',
        style: itemStyle,
        onClick: () => { void run(mode); },
      }, h('span', { className: 'dsh-rewind-menu-glyph' }, glyph), h('span', null, label), hint === undefined ? null : h('span', { className: 'dsh-rewind-menu-hint' }, hint));

      return h(
        'span',
        { ref: rootRef, style: { position: 'relative', display: 'inline-flex', alignItems: 'center' } },
        h('button', {
          type: 'button',
          className: 'dsh-rewind-icon-btn',
          style: { opacity: busy ? '0.55' : '1' },
          disabled: busy,
          title: busy ? t('running') : t('title'),
          'aria-label': t('title'),
          'aria-haspopup': 'menu',
          'aria-expanded': open ? 'true' : 'false',
          onClick: () => { setOpen((value) => !value); },
        }, ICON),
        open
          ? h('div', { ref: menuRef, className: 'dsh-rewind-menu', style: menuStyle, role: 'menu', 'aria-label': t('title') },
            h('div', { className: 'dsh-rewind-menu-caption', style: captionStyle },
              h('div', null, t('captionA')),
              h('div', null, t('captionB'))),
            h('div', { className: 'dsh-rewind-menu-sep', style: { height: '1px', margin: '4px 4px 5px', background: BORDER } }),
            item(FILE_GLYPH, t('code'), undefined, 'code'),
            item(FORK_GLYPH, t('forkCode'), t('forkHint'), 'fork-code'),
          )
          : null,
        error === ''
          ? null
          : h('span', {
            className: 'dsh-rewind-caret',
            style: { marginLeft: '6px', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
            title: error,
          }, error),
      );
    }

    return {
      inject: ['slots', 'sessions', 'uiWorkspace', 'locale', 'remote', 'remote.commands'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'zh', zh), 'rewind: zh dictionary');
        ctx.effect(() => ctx.locale.register(NS, 'en', en), 'rewind: en dictionary');
        // Package-owned stylesheet: scrollbar, hover, and menu-row affordances
        // used by surfaces that live outside the trash page. Removed with the
        // plugin instance, like the dictionaries.
        ctx.effect(() => {
          const element = document.createElement('style');
          element.setAttribute('data-dsh-rewind', 'styles');
          element.textContent = TRASH_CSS;
          document.head.appendChild(element);
          return () => { element.remove(); };
        }, 'rewind: styles');
        const t = ctx.locale.bind(NS);

        /** Put the undone turn's prompt back into this conversation's composer. */
        const refillDraft = async (sessionId, prompt) => {
          for (let attempt = 0; attempt < 60; attempt += 1) {
            const conversation = ctx.get('conversation');
            const binding = ctx.sessions.binding(sessionId);
            if (conversation !== undefined && conversation.input !== undefined && binding !== undefined) {
              try {
                const outcome = conversation.input.requestDraftInitialization(binding, {
                  prompt,
                  whenDraftExists: 'replace',
                });
                if (outcome === 'applied') return true;
                if (outcome === 'blocked') return false;
              } catch {
                /* binding not current yet; retry */
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return false;
        };

        /** Run one hidden host command and return its parsed data marker. */
        const runHostCommand = async (sessionId, line) => {
          const result = await ctx.remote.commands.execute(sessionId, line, []);
          if (result === undefined || result.ok !== true) {
            const failure = result && result.error ? result.error : undefined;
            return { error: failure ? `${failure.code}: ${failure.message}` : t('failed') };
          }
          const execution = result.value;
          const command = execution && execution.result ? execution.result : undefined;
          if (command && command.kind === 'error') {
            return { error: typeof command.text === 'string' ? command.text.split('\n')[0] : t('failed') };
          }
          const parsed = extractData(command && typeof command.text === 'string' ? command.text : '');
          return { data: parsed.data };
        };

        /**
         * Open the branch a Host fork created and refill its composer. The Host
         * owns the fork (persistence + catalog), so the payload already carries
         * the child id; the client-side fork is only a fallback for a Host build
         * without the controller.
         */
        const openBranch = async (sessionId, data) => {
          let opened = false;
          const openChild = (id) => {
            if (opened) return;
            try {
              ctx.uiWorkspace.openSession(id);
              opened = true;
            } catch {
              /* the caller reports the failure once the fork settles */
            }
          };
          const hostChildId = typeof data.childId === 'string' && data.childId !== '' ? data.childId : undefined;
          let childId = hostChildId;
          if (childId === undefined) {
            if (typeof data.startSeq !== 'number' || data.startSeq <= 0) return undefined;
            try {
              childId = await ctx.sessions.fork({
                sessionId,
                atSeq: data.startSeq - 1,
                increaseTitle: true,
                onCreated: (id) => openChild(id),
              });
            } catch (failure) {
              return { error: messageOf(failure) };
            }
          }
          openChild(childId);
          if (typeof data.prompt === 'string' && data.prompt !== '') {
            await refillDraft(childId, data.prompt);
          }
          return undefined;
        };

        /** The per-message menu's action: locate the turn from the message id. */
        const rewind = async (sessionId, messageId, mode) => {
          if (typeof messageId !== 'string' || messageId === '') return { error: t('failed') };
          const outcome = await runHostCommand(sessionId, `/rewind-message ${messageId} ${mode}`);
          if (outcome.error !== undefined) return { error: outcome.error };
          if (outcome.data === undefined || outcome.data.fork !== true) return undefined;
          return openBranch(sessionId, outcome.data);
        };

        /** The dock's action: a turn number works even when the turn was aborted. */
        const rewindTurn = async (sessionId, turn, mode) => {
          if (!Number.isInteger(turn) || turn < 0) return { error: t('failed') };
          const outcome = await runHostCommand(sessionId, `/rewind-turn ${turn} ${mode}`);
          if (outcome.error !== undefined) return { error: outcome.error };
          if (outcome.data === undefined || outcome.data.fork !== true) return undefined;
          return openBranch(sessionId, outcome.data);
        };

        /** Every checkpoint of the session, newest first, for the dock list. */
        const rewindList = async (sessionId) => {
          const outcome = await runHostCommand(sessionId, '/rewind-list');
          if (outcome.error !== undefined) throw new Error(outcome.error);
          return outcome.data !== undefined && Array.isArray(outcome.data.checkpoints) ? outcome.data.checkpoints : [];
        };

        ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
          name: 'conversation.chat.assistant-actions',
          id: 'dsh-rewind',
          order: 20,
          locale: NS,
          inject: () => ({
            i18n: t,
            rewind: (sessionId, messageId, mode) => rewind(sessionId, messageId, mode),
          }),
        }, RewindAction));

        // An aborted turn has no finalized assistant message, so the per-message
        // menu cannot reach it; this dock lists the Session's own checkpoints.
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'rewind-dock',
          order: 30,
          locale: NS,
          inject: () => ({
            i18n: t,
            rewindList: (sessionId) => rewindList(sessionId),
            rewindTurn: (sessionId, turn, mode) => rewindTurn(sessionId, turn, mode),
          }),
        }, RewindDock));

        // The trash is a first-class page: the sidebar panel list shows an icon
        // and the `main` entry with the same id renders the page.
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => ({ i18n: t }),
        }, TrashPage));

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 30,
          label: () => t('trash'),
          locale: NS,
        }, TrashPanelIcon));
      },
    };
  },
});
