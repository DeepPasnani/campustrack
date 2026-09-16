const CODE_EDITOR_SELECTOR = '.monaco-editor, .monaco-editor *';

function preventDefault(e) {
  e.preventDefault();
  e.stopPropagation();
}

let cleanupFns = [];

export const lockdownService = {
  enable(showToast) {
    const showWarning = showToast || (() => {});

    const onContextMenu = (e) => {
      if (e.target.closest(CODE_EDITOR_SELECTOR)) return;
      preventDefault(e);
      showWarning('Right-click disabled during test');
    };

    const onKeyDown = (e) => {
      if (e.target.closest(CODE_EDITOR_SELECTOR) && (e.ctrlKey || e.metaKey)) {
        if (e.key === 'v' || e.key === 'V') return;
      }
      if (e.target.closest(CODE_EDITOR_SELECTOR)) return;

      const blockKey = (cond, msg) => {
        if (cond) {
          preventDefault(e);
          showWarning(msg);
          return true;
        }
        return false;
      };

      if (blockKey(e.key === 'F12', 'Developer tools disabled')) return;
      if (blockKey(e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i'), 'Developer tools disabled')) return;
      if (blockKey(e.ctrlKey && (e.key === 'U' || e.key === 'u'), 'View source disabled')) return;
      if (blockKey(e.ctrlKey && e.shiftKey && (e.key === 'J' || e.key === 'j'), 'Developer tools disabled')) return;
      if (blockKey(e.ctrlKey && (e.key === 's' || e.key === 'S'), 'Save disabled during test')) return;

      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        preventDefault(e);
        showWarning('Copy disabled during test');
        return;
      }
    };

    const onCopy = (e) => {
      if (e.target.closest(CODE_EDITOR_SELECTOR)) return;
      preventDefault(e);
      showWarning('Copy disabled during test');
    };

    const onCut = (e) => {
      if (e.target.closest(CODE_EDITOR_SELECTOR)) return;
      preventDefault(e);
      showWarning('Cut disabled during test');
    };

    const onPaste = (e) => {
      if (e.target.closest(CODE_EDITOR_SELECTOR)) return;
      preventDefault(e);
      showWarning('Paste disabled during test');
    };

    document.addEventListener('contextmenu', onContextMenu, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('copy', onCopy, true);
    document.addEventListener('cut', onCut, true);
    document.addEventListener('paste', onPaste, true);

    cleanupFns = [
      () => document.removeEventListener('contextmenu', onContextMenu, true),
      () => document.removeEventListener('keydown', onKeyDown, true),
      () => document.removeEventListener('copy', onCopy, true),
      () => document.removeEventListener('cut', onCut, true),
      () => document.removeEventListener('paste', onPaste, true),
    ];

    const style = document.createElement('style');
    style.id = 'lockdown-styles';
    style.textContent = `
      .exam-mode, .exam-mode * {
        -webkit-user-select: none !important;
        -moz-user-select: none !important;
        -ms-user-select: none !important;
        user-select: none !important;
      }
      .exam-mode .monaco-editor, .exam-mode .monaco-editor * {
        -webkit-user-select: text !important;
        -moz-user-select: text !important;
        -ms-user-select: text !important;
        user-select: text !important;
      }
    `;
    document.head.appendChild(style);
    cleanupFns.push(() => {
      const s = document.getElementById('lockdown-styles');
      if (s) s.remove();
    });
  },

  disable() {
    cleanupFns.forEach(fn => fn());
    cleanupFns = [];
  },
};
