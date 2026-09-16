import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resourcesAPI } from '../../services/api';
import { Btn, Modal, Input, Textarea, Select, Spinner } from '../../components/shared/UI';
import { RESOURCE_CATEGORIES, resourceIcon, resourceExt, resourceCanPreview, formatFileSize } from '../../lib/resources';
import { ALLOWED_DEPARTMENTS as DEPARTMENTS } from '../../lib/departments';
import { useClassOptions } from '../../hooks/useClassOptions';
import { Download, Eye, Trash2, Plus, Pencil } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════
 * Admin Resources — upload & manage Aptitude/Coding/GD/PI study
 * material (PDF/DOC/DOCX/PPT/PPTX/XLS/XLSX), targeted the same
 * way tests are (department/year/class).
 * ═══════════════════════════════════════════════════════════ */

function targetingSummary(r) {
  const parts = [];
  const depts = r.departments || [];
  parts.push(!depts.length || depts.includes('all') ? 'All depts' : `${depts.length} dept${depts.length > 1 ? 's' : ''}`);
  const years = r.years || [];
  if (years.length && !years.includes('all')) parts.push(`Yr ${years.join(',')}`);
  const classes = r.classes || [];
  if (classes.length && !classes.includes('all')) parts.push(`${classes.length} class${classes.length > 1 ? 'es' : ''}`);
  return parts.join(' · ');
}

export default function AdminResources() {
  const qc = useQueryClient();
  const [category, setCategory] = useState('aptitude');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-resources', category],
    queryFn: () => resourcesAPI.list(category),
  });
  const resources = data?.resources || [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-resources'] });

  const deleteMut = useMutation({
    mutationFn: (id) => resourcesAPI.delete(id),
    onSuccess: () => { toast.success('Resource deleted'); setDeleteId(null); invalidate(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to delete'),
  });

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
      <div className="section-header">
        <div>
          <h1 className="section-title">Resources</h1>
          <p className="section-subtitle">Upload Aptitude, Coding, GD &amp; PI study material for students</p>
        </div>
        <Btn variant="primary" onClick={() => setUploadOpen(true)}>
          <Plus size={16} />
          <span className="ml-1.5">Upload Resource</span>
        </Btn>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1.5 mb-5 border-b border-rim overflow-x-auto">
        {RESOURCE_CATEGORIES.map(c => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={`px-3.5 pb-2.5 text-sm font-semibold border-b-2 whitespace-nowrap transition-all ${
              category === c.id ? 'border-accent text-ink' : 'border-transparent text-annotation hover:text-ink'
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
          <h3 className="empty-state-title">No resources in this category</h3>
          <p className="empty-state-desc">Click "Upload Resource" to add the first one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {resources.map(r => {
            const Icon = resourceIcon(r.mimetype);
            const canPreview = resourceCanPreview(r.mimetype);
            return (
              <div key={r.id} className="panel p-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0">
                  <Icon size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-display font-semibold text-sm text-ink truncate">{r.title}</h3>
                  <div className="flex flex-wrap items-center gap-2 text-2xs text-annotation/60 font-mono mt-0.5">
                    <span className="uppercase font-semibold">{resourceExt(r.mimetype)}</span>
                    {r.size_bytes && <span>· {formatFileSize(r.size_bytes)}</span>}
                    {r.created_at && <span>· {format(new Date(r.created_at), 'dd MMM yyyy')}</span>}
                    <span>· {targetingSummary(r)}</span>
                    {r.uploaded_by_name && <span>· by {r.uploaded_by_name}</span>}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {canPreview && (
                    <button className="btn-ghost-icon" title="Preview" onClick={() => openPreview(r)} disabled={previewLoading}>
                      <Eye size={15} />
                    </button>
                  )}
                  <button className="btn-ghost-icon" title="Download" onClick={() => handleDownload(r)} disabled={downloadingId === r.id}>
                    {downloadingId === r.id ? <Spinner size={13} /> : <Download size={15} />}
                  </button>
                  <button className="btn-ghost-icon" title="Edit" onClick={() => setEditing(r)}>
                    <Pencil size={15} />
                  </button>
                  <button className="btn-ghost-icon text-alert" title="Delete" onClick={() => setDeleteId(r.id)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {uploadOpen && (
        <ResourceFormModal
          mode="create"
          defaultCategory={category}
          onClose={() => setUploadOpen(false)}
          onSaved={() => { setUploadOpen(false); invalidate(); }}
        />
      )}
      {editing && (
        <ResourceFormModal
          mode="edit"
          resource={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidate(); }}
        />
      )}

      {/* Delete confirm */}
      <Modal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Delete Resource"
        width="max-w-sm"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setDeleteId(null)}>Cancel</Btn>
            <Btn variant="danger" onClick={() => deleteMut.mutate(deleteId)} disabled={deleteMut.isLoading}>
              {deleteMut.isLoading ? 'Deleting…' : 'Delete'}
            </Btn>
          </>
        }
      >
        <p className="text-sm text-annotation">This removes the file for every student — this can't be undone.</p>
      </Modal>

      {/* Preview */}
      <Modal isOpen={!!preview} onClose={closePreview} title={preview?.resource.title || ''} width="max-w-4xl">
        {preview && (
          <iframe src={preview.url} title={preview.resource.title} className="w-full rounded-lg border border-rim" style={{ height: '75vh' }} />
        )}
      </Modal>
    </div>
  );
}

/* ── Upload / Edit form ───────────────────────────────────────── */
function ResourceFormModal({ mode, resource, defaultCategory, onClose, onSaved }) {
  const [title, setTitle] = useState(resource?.title || '');
  const [description, setDescription] = useState(resource?.description || '');
  const [category, setCategory] = useState(resource?.category || defaultCategory || 'aptitude');
  const [file, setFile] = useState(null);
  const [departments, setDepartments] = useState(resource?.departments?.length ? resource.departments : ['all']);
  const [years, setYears] = useState(resource?.years?.length ? resource.years : ['all']);
  const [classes, setClasses] = useState(resource?.classes?.length ? resource.classes : ['all']);
  const { years: yearOptions, classes: classOptions } = useClassOptions();

  const mut = useMutation({
    mutationFn: () =>
      mode === 'create'
        ? resourcesAPI.create({ title, description, category, departments, years, classes, file })
        : resourcesAPI.update(resource.id, { title, description, category, departments, years, classes }),
    onSuccess: () => { toast.success(mode === 'create' ? 'Resource uploaded' : 'Resource updated'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  const toggleAll = (setter, list) => setter(list.includes('all') ? [] : ['all']);
  const toggleOne = (setter, list, value) => {
    let next = list.includes('all') ? [] : list;
    next = next.includes(value) ? next.filter(v => v !== value) : [...next, value];
    setter(next);
  };

  const canSave = title.trim() && category && (mode === 'edit' || file);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={mode === 'create' ? 'Upload Resource' : 'Edit Resource'}
      width="max-w-lg"
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" disabled={!canSave || mut.isLoading} onClick={() => mut.mutate()}>
            {mut.isLoading ? 'Saving…' : mode === 'create' ? 'Upload' : 'Save Changes'}
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Title *" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Quantitative Aptitude Formula Sheet" />
        <Textarea label="Description (optional)" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
        <Select label="Category *" value={category} onChange={e => setCategory(e.target.value)}>
          {RESOURCE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>

        {mode === 'create' && (
          <div>
            <label className="input-label">File * <span className="text-annotation/60 font-normal">(PDF, DOC/DOCX, PPT/PPTX, XLS/XLSX — up to 25 MB)</span></label>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
              onChange={e => setFile(e.target.files?.[0] || null)}
              className="input-field"
            />
          </div>
        )}

        <div>
          <label className="input-label">Visible to</label>
          <div className="mt-1.5 p-3 bg-panel border border-rim rounded-xl space-y-2 max-h-40 overflow-y-auto">
            <label className="flex items-center gap-2 text-xs font-semibold text-accent cursor-pointer">
              <input type="checkbox" checked={departments.includes('all')} onChange={() => toggleAll(setDepartments, departments)} className="accent-accent w-3.5 h-3.5" />
              All Departments
            </label>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 pl-1">
              {DEPARTMENTS.map(d => (
                <label key={d} className="flex items-center gap-2 text-2xs text-ink cursor-pointer">
                  <input type="checkbox" checked={departments.includes(d)} onChange={() => toggleOne(setDepartments, departments, d)} className="accent-accent w-3.5 h-3.5" />
                  <span className="truncate">{d}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="input-label">Years</label>
            <div className="mt-1.5 p-3 bg-panel border border-rim rounded-xl space-y-1.5">
              <label className="flex items-center gap-2 text-xs font-semibold text-accent cursor-pointer">
                <input type="checkbox" checked={years.includes('all')} onChange={() => toggleAll(setYears, years)} className="accent-accent w-3.5 h-3.5" />
                All Years
              </label>
              {yearOptions.map(y => (
                <label key={y} className="flex items-center gap-2 text-2xs text-ink cursor-pointer">
                  <input type="checkbox" checked={years.includes(String(y))} onChange={() => toggleOne(setYears, years, String(y))} className="accent-accent w-3.5 h-3.5" />
                  Year {y}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="input-label">Classes</label>
            <div className="mt-1.5 p-3 bg-panel border border-rim rounded-xl space-y-1.5 max-h-32 overflow-y-auto">
              <label className="flex items-center gap-2 text-xs font-semibold text-accent cursor-pointer">
                <input type="checkbox" checked={classes.includes('all')} onChange={() => toggleAll(setClasses, classes)} className="accent-accent w-3.5 h-3.5" />
                All Classes
              </label>
              {classOptions.map(c => (
                <label key={c} className="flex items-center gap-2 text-2xs text-ink cursor-pointer">
                  <input type="checkbox" checked={classes.includes(c)} onChange={() => toggleOne(setClasses, classes, c)} className="accent-accent w-3.5 h-3.5" />
                  {c}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
