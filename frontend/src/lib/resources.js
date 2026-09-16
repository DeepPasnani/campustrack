import { FileText, FileSpreadsheet, File as FileIcon } from 'lucide-react';

export const RESOURCE_CATEGORIES = [
  { id: 'aptitude', label: 'Aptitude' },
  { id: 'coding', label: 'Coding' },
  { id: 'gd', label: 'Group Discussion' },
  { id: 'pi', label: 'Personal Interview' },
];

export const RESOURCE_MIME_TYPES = [
  { mime: 'application/pdf', ext: 'PDF' },
  { mime: 'application/msword', ext: 'DOC' },
  { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'DOCX' },
  { mime: 'application/vnd.ms-powerpoint', ext: 'PPT' },
  { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'PPTX' },
  { mime: 'application/vnd.ms-excel', ext: 'XLS' },
  { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'XLSX' },
];

const EXT_BY_MIME = Object.fromEntries(RESOURCE_MIME_TYPES.map(t => [t.mime, t.ext]));

export function resourceExt(mimetype) {
  return EXT_BY_MIME[mimetype] || 'FILE';
}

export function resourceIcon(mimetype) {
  if (mimetype === 'application/pdf') return FileText;
  if (mimetype?.includes('sheet') || mimetype?.includes('excel')) return FileSpreadsheet;
  return FileIcon;
}

export function resourceCanPreview(mimetype) {
  return mimetype === 'application/pdf';
}

export function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
