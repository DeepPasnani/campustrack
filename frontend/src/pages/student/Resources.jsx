import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { resourcesAPI } from '../../services/api';
import { Spinner, Modal, Btn } from '../../components/shared/UI';
import { RESOURCE_CATEGORIES, resourceIcon, resourceExt, resourceCanPreview, formatFileSize } from '../../lib/resources';
import { FileText, Download, Eye } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════
 * Student Resources — Aptitude / Coding / GD / PI study material
 * uploaded by placement coordinators. PDFs preview in-app; every
 * file type can be downloaded.
 * ═══════════════════════════════════════════════════════════ */

export default function StudentResources() {
  const [category, setCategory] = useState('aptitude');
  const [preview, setPreview] = useState(null); // { resource, url }
  const [previewLoading, setPreviewLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['resources', category],
    queryFn: () => resourcesAPI.list(category),
  });
  const resources = data?.resources || [];

  const openPreview = async (resource) => {
    setPreviewLoading(true);
    try {
      const blob = await resourcesAPI.getFileBlob(resource.id);
      setPreview({ resource, url: URL.createObjectURL(blob) });
    } catch {
      toast.error('Failed to load preview.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  const handleDownload = async (resource) => {
    setDownloadingId(resource.id);
    try {
      const blob = await resourcesAPI.getFileBlob(resource.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resource.filename || resource.title;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download file.');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="animate-fade-up">
      <div className="mb-6">
        <h1 className="text-xl font-display font-bold text-ink">Resources</h1>
        <p className="text-sm text-annotation mt-0.5">Study material uploaded by your placement coordinator</p>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1.5 mb-5 border-b border-rim overflow-x-auto">
        {RESOURCE_CATEGORIES.map(c => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={`px-3.5 pb-2.5 text-sm font-semibold border-b-2 whitespace-nowrap transition-all ${
              category === c.id
                ? 'border-accent text-ink'
                : 'border-transparent text-annotation hover:text-ink'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size={26} className="text-accent" />
        </div>
      ) : resources.length === 0 ? (
        <div className="empty-state">
          <FileText size={40} className="empty-state-icon" />
          <h3 className="empty-state-title">No resources yet</h3>
          <p className="empty-state-desc">Nothing has been uploaded for this category yet — check back later.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {resources.map(r => {
            const Icon = resourceIcon(r.mimetype);
            const canPreview = resourceCanPreview(r.mimetype);
            return (
              <div key={r.id} className="panel p-4 flex flex-col">
                <div className="flex items-start gap-3 mb-2">
                  <div className="w-9 h-9 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0">
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display font-semibold text-sm text-ink truncate">{r.title}</h3>
                    <div className="flex items-center gap-2 text-2xs text-annotation/60 font-mono mt-0.5">
                      <span className="uppercase font-semibold">{resourceExt(r.mimetype)}</span>
                      {r.size_bytes && <span>· {formatFileSize(r.size_bytes)}</span>}
                      {r.created_at && <span>· {format(new Date(r.created_at), 'dd MMM yyyy')}</span>}
                    </div>
                  </div>
                </div>
                {r.description && (
                  <p className="text-xs text-annotation mb-3 line-clamp-2 flex-1">{r.description}</p>
                )}
                <div className="flex gap-2 mt-auto pt-1">
                  {canPreview && (
                    <Btn variant="ghost" size="sm" onClick={() => openPreview(r)} disabled={previewLoading}>
                      <Eye size={14} />
                      <span className="ml-1.5">View</span>
                    </Btn>
                  )}
                  <Btn
                    variant={canPreview ? 'ghost' : 'primary'}
                    size="sm"
                    onClick={() => handleDownload(r)}
                    disabled={downloadingId === r.id}
                  >
                    {downloadingId === r.id ? (
                      <Spinner size={13} />
                    ) : (
                      <>
                        <Download size={14} />
                        <span className="ml-1.5">Download</span>
                      </>
                    )}
                  </Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Preview modal ─────────────────────────────────── */}
      <Modal isOpen={!!preview} onClose={closePreview} title={preview?.resource.title || ''} width="max-w-4xl">
        {preview && (
          <iframe
            src={preview.url}
            title={preview.resource.title}
            className="w-full rounded-lg border border-rim"
            style={{ height: '75vh' }}
          />
        )}
      </Modal>
    </div>
  );
}
