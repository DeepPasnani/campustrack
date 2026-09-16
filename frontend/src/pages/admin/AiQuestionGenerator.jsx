import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { aiAPI } from '../../services/ai';
import { Btn, Input, Select, Badge, Modal, Spinner, Alert } from '../../components/shared/UI';
import toast from 'react-hot-toast';
import { useDropzone } from 'react-dropzone';

const GENRES = [
  { value: 'general', label: 'General' },
  { value: 'quantitative', label: 'Quantitative' },
  { value: 'aptitude', label: 'General Aptitude' },
  { value: 'technical', label: 'Technical' },
  { value: 'verbal', label: 'Verbal Reasoning' },
  { value: 'logical', label: 'Logical' },
  { value: 'data_interpretation', label: 'Data Interpretation' },
];

export default function AiQuestionGenerator() {
  const qc = useQueryClient();
  const [mode, setMode] = useState('topic');
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState('medium');
  const [genre, setGenre] = useState('general');
  const [pdfFile, setPdfFile] = useState(null);
  const [questions, setQuestions] = useState(null);
  const [saving, setSaving] = useState(false);

  const onDrop = useCallback((accepted) => {
    if (accepted.length) setPdfFile(accepted[0]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { 'application/pdf': ['.pdf'] }, maxFiles: 1, maxSize: 10 * 1024 * 1024,
  });

  const generateMut = useMutation({
    mutationFn: (data) => aiAPI.generateMCQs(data),
    onSuccess: (data) => {
      setQuestions(data.questions);
      toast.success(`Generated ${data.questions.length} questions`);
    },
  });

  const saveAll = async () => {
    if (!questions?.length) return;
    setSaving(true);
    try {
      const res = await aiAPI.saveGeneratedMCQs(questions);
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ['question-bank'] });
      setQuestions(null);
      setPdfFile(null);
    } catch (e) {
      toast.error('Failed to save');
    }
    setSaving(false);
  };

  const removeQuestion = (idx) => {
    setQuestions(qs => qs.filter((_, i) => i !== idx));
  };

  return (
    <div className="animate-fade-up space-y-5">
      <div className="section-header">
        <div>
          <h1 className="text-display">AI Question Generator</h1>
          <p className="section-subtitle">Generate MCQ questions using AI from topics or syllabus PDFs</p>
        </div>
      </div>

      <div className="panel p-5">
        <div className="flex gap-2 mb-4">
          <Btn variant={mode === 'topic' ? 'primary' : 'ghost'} onClick={() => setMode('topic')}>From Topic</Btn>
          <Btn variant={mode === 'pdf' ? 'primary' : 'ghost'} onClick={() => setMode('pdf')}>From PDF</Btn>
        </div>

        {mode === 'topic' ? (
          <div className="space-y-3">
            <Input label="Topic" value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Binary Search Trees, Time Complexity, Profit & Loss" />
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="qg-count" className="input-label">Count</label>
                <input type="range" min={1} max={20} value={count} onChange={e => setCount(+e.target.value)} className="w-full accent-accent" id="qg-count" />
                <span className="text-xs text-annotation">{count} questions</span>
              </div>
              <Select label="Difficulty" value={difficulty} onChange={e => setDifficulty(e.target.value)}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </Select>
              <Select label="Genre" value={genre} onChange={e => setGenre(e.target.value)}>
                {GENRES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
              </Select>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div {...getRootProps()} className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${isDragActive ? 'border-accent bg-accent/5' : 'border-rim hover:border-accent/50'}`}>
              <input {...getInputProps()} />
              <svg className="w-8 h-8 mx-auto text-annotation mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              {pdfFile ? (
                <p className="text-sm text-ink font-medium">{pdfFile.name}</p>
              ) : isDragActive ? (
                <p className="text-sm text-accent">Drop PDF here...</p>
              ) : (
                <p className="text-sm text-annotation">Drop a syllabus PDF here, or click to browse</p>
              )}
            </div>
            {pdfFile && (
              <Btn variant="ghost" size="sm" onClick={() => setPdfFile(null)}>Remove file</Btn>
            )}
          </div>
        )}

        <div className="mt-4">
          <Btn onClick={() => {
            if (mode === 'topic' && !topic.trim()) return toast.error('Enter a topic');
            generateMut.mutate(mode === 'topic' ? { topic, count, difficulty, genre } : { pdf: pdfFile });
          }} disabled={generateMut.isLoading || (mode === 'pdf' && !pdfFile)}>
            {generateMut.isLoading ? <><Spinner size={14} className="mr-1" /> Generating...</> : 'Generate Questions'}
          </Btn>
        </div>
      </div>

      {generateMut.error && (
        <Alert type="error">{generateMut.error.message || 'Generation failed. Check your API key.'}</Alert>
      )}

      {questions && questions.length > 0 && (
        <div className="panel p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-display font-bold text-ink">Preview ({questions.length} questions)</h2>
            <div className="flex gap-2">
              <Btn variant="ghost" size="sm" onClick={() => setQuestions(null)}>Discard</Btn>
              <Btn size="sm" onClick={saveAll} disabled={saving}>
                {saving ? <Spinner size={14} /> : 'Save All to Bank'}
              </Btn>
            </div>
          </div>
          <div className="space-y-3">
            {questions.map((q, i) => (
              <div key={i} className="panel-muted p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-xs font-display font-bold text-ink">Q{i + 1}. {q.data?.text}</span>
                  <button onClick={() => removeQuestion(i)} className="text-alert text-xs hover:underline shrink-0">Remove</button>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  {q.data?.options?.map((opt, oi) => (
                    <div key={oi} className={`text-xs p-2 rounded ${oi === q.data?.correctAnswer ? 'bg-verify/10 text-verify border border-verify/20' : 'bg-deck text-annotation'}`}>
                      <span className="font-mono mr-1">{'ABCD'[oi]}.</span> {opt}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-2xs">
                  <Badge color={q.difficulty === 'hard' ? 'alert' : q.difficulty === 'easy' ? 'verify' : 'accent'}>{q.difficulty}</Badge>
                  <Badge color="clarify">{GENRES.find(g => g.value === q.genre)?.label || q.genre}</Badge>
                  <span className="text-annotation/50">{q.marks} marks</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
