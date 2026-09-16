import { loader } from '@monaco-editor/react';

const MONACO_CDN = import.meta.env.VITE_MONACO_CDN
  || 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs';

loader.config({ paths: { vs: MONACO_CDN } });

export default loader;
