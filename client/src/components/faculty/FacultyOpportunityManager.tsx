import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import axios from '../../utils/axios';

type OwnedResearchEntity = {
  _id: string;
  slug: string;
  name: string;
  entityType?: string;
  kind?: string;
};

type FacultyOpportunity = {
  _id: string;
  researchEntityId: string;
  title: string;
  description: string;
  term: string;
  deadline?: string;
  applicationUrl: string;
  status: 'OPEN' | 'ROLLING' | 'CLOSED' | 'ARCHIVED';
  hoursPerWeek?: number;
  payRate: string;
  compensationType: string;
  eligibility: string;
  workflowState:
    | 'DRAFT'
    | 'PENDING_REVIEW'
    | 'APPROVED_LIVE'
    | 'REJECTED_NEEDS_SOURCE'
    | 'CLOSED'
    | 'ARCHIVED'
    | 'OWNERSHIP_CONFLICT';
  reviewNote?: string;
  revision: number;
  updatedAt?: string;
};

type OpportunityForm = {
  researchEntityId: string;
  title: string;
  description: string;
  term: string;
  deadline: string;
  applicationUrl: string;
  status: 'OPEN' | 'ROLLING';
  hoursPerWeek: string;
  payRate: string;
  compensationType: string;
  eligibility: string;
};

const emptyForm = (): OpportunityForm => ({
  researchEntityId: '',
  title: '',
  description: '',
  term: '',
  deadline: '',
  applicationUrl: '',
  status: 'OPEN',
  hoursPerWeek: '',
  payRate: '',
  compensationType: 'UNKNOWN',
  eligibility: '',
});

const workflowLabels: Record<FacultyOpportunity['workflowState'], string> = {
  DRAFT: 'Draft',
  PENDING_REVIEW: 'Pending review',
  APPROVED_LIVE: 'Approved and live',
  REJECTED_NEEDS_SOURCE: 'Needs a better source',
  CLOSED: 'Closed',
  ARCHIVED: 'Archived',
  OWNERSHIP_CONFLICT: 'Ownership conflict',
};

const compensationOptions = [
  ['UNKNOWN', 'Not specified'],
  ['PAID', 'Paid'],
  ['STIPEND', 'Stipend'],
  ['WORK_STUDY', 'Work-study'],
  ['VOLUNTEER', 'Volunteer'],
  ['COURSE_CREDIT', 'Course credit'],
  ['FELLOWSHIP', 'Fellowship'],
  ['FELLOWSHIP_ELIGIBLE', 'Fellowship eligible'],
];

const idempotencyKey = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `faculty-opportunity-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const formFromOpportunity = (opportunity: FacultyOpportunity): OpportunityForm => ({
  researchEntityId: opportunity.researchEntityId,
  title: opportunity.title,
  description: opportunity.description,
  term: opportunity.term,
  deadline: opportunity.deadline ? opportunity.deadline.slice(0, 10) : '',
  applicationUrl: opportunity.applicationUrl,
  status: opportunity.status === 'ROLLING' ? 'ROLLING' : 'OPEN',
  hoursPerWeek: opportunity.hoursPerWeek ? String(opportunity.hoursPerWeek) : '',
  payRate: opportunity.payRate,
  compensationType: opportunity.compensationType || 'UNKNOWN',
  eligibility: opportunity.eligibility,
});

const requestPayload = (form: OpportunityForm) => ({
  ...form,
  deadline: form.status === 'OPEN' ? form.deadline || undefined : undefined,
  hoursPerWeek: form.hoursPerWeek || undefined,
});

const errorPayload = (error: any) => ({
  message:
    error?.response?.data?.error ||
    'The opportunity service is temporarily unavailable. Your last confirmed save is unchanged.',
  code: error?.response?.data?.code || 'RETRYABLE_SERVER_FAILURE',
  fieldErrors: (error?.response?.data?.fieldErrors || {}) as Record<string, string>,
});

const FacultyOpportunityManager = () => {
  const [entities, setEntities] = useState<OwnedResearchEntity[]>([]);
  const [opportunities, setOpportunities] = useState<FacultyOpportunity[]>([]);
  const [form, setForm] = useState<OpportunityForm>(emptyForm);
  const [editing, setEditing] = useState<FacultyOpportunity | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const createKeyRef = useRef(idempotencyKey());
  const formHeadingRef = useRef<HTMLHeadingElement>(null);

  const entityNames = useMemo(
    () => new Map(entities.map((entity) => [entity._id, entity.name])),
    [entities],
  );

  const replaceOpportunity = (opportunity: FacultyOpportunity) => {
    setOpportunities((current) => {
      const found = current.some((item) => item._id === opportunity._id);
      return found
        ? current.map((item) => (item._id === opportunity._id ? opportunity : item))
        : [opportunity, ...current];
    });
    setEditing(opportunity);
    setForm(formFromOpportunity(opportunity));
  };

  const load = async () => {
    setLoading(true);
    setError('');
    setAccessCode('');
    try {
      const [entityResponse, opportunityResponse] = await Promise.all([
        axios.get('/opportunities/mine/research-entities'),
        axios.get('/opportunities/mine'),
      ]);
      setEntities(entityResponse.data.researchEntities || []);
      setOpportunities(opportunityResponse.data.opportunities || []);
    } catch (requestError) {
      const failure = errorPayload(requestError);
      setError(failure.message);
      setAccessCode(failure.code);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const focusFirstError = (errors: Record<string, string>) => {
    const field = Object.keys(errors)[0];
    if (!field) return;
    requestAnimationFrame(() => {
      document.getElementById(`faculty-opportunity-${field}`)?.focus();
    });
  };

  const beginNew = () => {
    setEditing(null);
    setForm({ ...emptyForm(), researchEntityId: entities[0]?._id || '' });
    setPreview(null);
    setFieldErrors({});
    setFeedback('');
    setError('');
    createKeyRef.current = idempotencyKey();
    requestAnimationFrame(() => formHeadingRef.current?.focus());
  };

  const beginEdit = (opportunity: FacultyOpportunity) => {
    setEditing(opportunity);
    setForm(formFromOpportunity(opportunity));
    setPreview(null);
    setFieldErrors({});
    setFeedback('');
    setError('');
    requestAnimationFrame(() => formHeadingRef.current?.focus());
  };

  const updateField = (field: keyof OpportunityForm, value: string) => {
    setForm(
      (current) =>
        ({
          ...current,
          [field]: value,
          ...(field === 'status' && value === 'ROLLING' ? { deadline: '' } : {}),
        }) as OpportunityForm,
    );
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setPreview(null);
  };

  const runFormRequest = async (work: () => Promise<void>) => {
    setSaving(true);
    setError('');
    setFeedback('');
    setFieldErrors({});
    try {
      await work();
    } catch (requestError) {
      const failure = errorPayload(requestError);
      setError(failure.message);
      setAccessCode(failure.code);
      setFieldErrors(failure.fieldErrors);
      focusFirstError(failure.fieldErrors);
    } finally {
      setSaving(false);
    }
  };

  const previewDraft = () =>
    runFormRequest(async () => {
      const response = await axios.post('/opportunities/preview', {
        opportunity: requestPayload(form),
      });
      setPreview(response.data.preview);
      setFeedback('Preview updated from validated draft fields. Nothing was published.');
    });

  const saveDraft = (event: FormEvent) => {
    event.preventDefault();
    void runFormRequest(async () => {
      const response = editing
        ? await axios.put(`/opportunities/${editing._id}`, {
            opportunity: requestPayload(form),
            revision: editing.revision,
          })
        : await axios.post(
            '/opportunities',
            { opportunity: requestPayload(form) },
            { headers: { 'Idempotency-Key': createKeyRef.current } },
          );
      const opportunity = response.data.opportunity as FacultyOpportunity;
      replaceOpportunity(opportunity);
      setPreview(null);
      setFeedback('Draft saved. It is not public and has not entered review.');
      createKeyRef.current = idempotencyKey();
    });
  };

  const transition = (opportunity: FacultyOpportunity, action: 'submit' | 'close' | 'archive') => {
    void runFormRequest(async () => {
      const response = await axios.post(`/opportunities/${opportunity._id}/${action}`, {
        revision: opportunity.revision,
      });
      const updated = response.data.opportunity as FacultyOpportunity;
      setOpportunities((current) =>
        current.map((item) => (item._id === updated._id ? updated : item)),
      );
      if (action === 'submit') {
        setEditing(updated);
        setForm(formFromOpportunity(updated));
      } else {
        setEditing(null);
        setForm({ ...emptyForm(), researchEntityId: entities[0]?._id || '' });
      }
      setPreview(null);
      setFeedback(
        action === 'submit'
          ? 'Submitted for administrator review. This opportunity is not public yet.'
          : action === 'close'
            ? 'Opportunity closed. It no longer appears as active planning context.'
            : 'Opportunity archived. Its provenance and audit history were preserved.',
      );
    });
  };

  const fieldError = (field: keyof OpportunityForm) => fieldErrors[field];
  const describedBy = (field: keyof OpportunityForm) =>
    fieldError(field) ? `faculty-opportunity-${field}-error` : undefined;

  if (loading) {
    return (
      <section className="yr-panel mb-6 rounded-md p-5" aria-busy="true">
        <p className="text-sm text-slate-600">Loading faculty opportunities...</p>
      </section>
    );
  }

  if (accessCode === 'PROFILE_VERIFICATION_REQUIRED') {
    return (
      <section
        className="yr-panel mb-6 rounded-md p-5"
        aria-labelledby="faculty-opportunities-title"
      >
        <h2 id="faculty-opportunities-title" className="text-lg font-semibold text-slate-950">
          Post a research opportunity
        </h2>
        <p className="mt-2 text-sm text-amber-800" role="status">
          Your faculty profile must be verified before you can create or manage opportunity drafts.
        </p>
      </section>
    );
  }

  return (
    <section className="yr-panel mb-6 rounded-md p-5" aria-labelledby="faculty-opportunities-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="yr-kicker">Verified faculty workflow</p>
          <h2
            id="faculty-opportunities-title"
            className="mt-1 text-xl font-semibold text-slate-950"
          >
            Post a real research opportunity
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
            Drafts stay private. Submitting sends one specific opening to administrator review, and
            only an approved open or rolling posting can appear for students.
          </p>
        </div>
        <button
          type="button"
          onClick={beginNew}
          disabled={entities.length === 0}
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-[var(--yr-blue)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          New opportunity
        </button>
      </div>

      {error && (
        <div
          className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          {error}
          {accessCode === 'OWNERSHIP_CONFLICT' && (
            <span> An administrator must resolve the linked research-profile identity first.</span>
          )}
        </div>
      )}
      {feedback && (
        <p
          className="mt-4 rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800"
          role="status"
        >
          {feedback}
        </p>
      )}
      {entities.length === 0 && !error && (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No verified, conflict-free lead membership is linked to this account yet.
        </p>
      )}

      {opportunities.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-slate-950">Your opportunities</h3>
          <ul className="mt-3 grid gap-3 lg:grid-cols-2">
            {opportunities.map((opportunity) => (
              <li key={opportunity._id} className="yr-card rounded-md p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-950">{opportunity.title}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {entityNames.get(opportunity.researchEntityId) || 'Owned research profile'}
                    </p>
                  </div>
                  <span className="yr-pill min-h-0 shrink-0 rounded px-2 py-1">
                    {workflowLabels[opportunity.workflowState]}
                  </span>
                </div>
                {opportunity.reviewNote && (
                  <p className="mt-3 text-sm text-amber-800">
                    Reviewer note: {opportunity.reviewNote}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {!['ARCHIVED', 'CLOSED', 'OWNERSHIP_CONFLICT'].includes(
                    opportunity.workflowState,
                  ) && (
                    <button
                      type="button"
                      onClick={() => beginEdit(opportunity)}
                      className="min-h-[44px] rounded-md border border-[var(--yr-line)] px-3 py-2 text-sm font-semibold text-slate-700"
                    >
                      Edit
                    </button>
                  )}
                  {opportunity.workflowState === 'DRAFT' && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => transition(opportunity, 'submit')}
                      className="min-h-[44px] rounded-md bg-[var(--yr-blue)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      Submit for review
                    </button>
                  )}
                  {!['CLOSED', 'ARCHIVED'].includes(opportunity.workflowState) && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => transition(opportunity, 'close')}
                      className="min-h-[44px] rounded-md border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-800 disabled:opacity-50"
                    >
                      Close
                    </button>
                  )}
                  {opportunity.workflowState !== 'ARCHIVED' && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => transition(opportunity, 'archive')}
                      className="min-h-[44px] rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
                    >
                      Archive
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {entities.length > 0 && (
        <form
          className="mt-6 border-t border-[var(--yr-line)] pt-6"
          onSubmit={saveDraft}
          noValidate
        >
          <h3 ref={formHeadingRef} tabIndex={-1} className="text-lg font-semibold text-slate-950">
            {editing ? `Edit ${editing.title}` : 'New opportunity draft'}
          </h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium text-slate-800">
              Research profile
              <select
                id="faculty-opportunity-researchEntityId"
                value={form.researchEntityId}
                disabled={Boolean(editing)}
                aria-invalid={Boolean(fieldError('researchEntityId'))}
                aria-describedby={describedBy('researchEntityId')}
                onChange={(event) => updateField('researchEntityId', event.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-md border border-[var(--yr-line)] bg-white px-3 py-2"
              >
                <option value="">Choose a profile</option>
                {entities.map((entity) => (
                  <option key={entity._id} value={entity._id}>
                    {entity.name}
                  </option>
                ))}
              </select>
              {fieldError('researchEntityId') && (
                <span
                  id="faculty-opportunity-researchEntityId-error"
                  className="mt-1 block text-xs text-red-700"
                >
                  {fieldError('researchEntityId')}
                </span>
              )}
            </label>
            <label className="text-sm font-medium text-slate-800">
              Opportunity title
              <input
                id="faculty-opportunity-title"
                value={form.title}
                maxLength={160}
                aria-invalid={Boolean(fieldError('title'))}
                aria-describedby={describedBy('title')}
                onChange={(event) => updateField('title', event.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-md border border-[var(--yr-line)] px-3 py-2"
              />
              {fieldError('title') && (
                <span
                  id="faculty-opportunity-title-error"
                  className="mt-1 block text-xs text-red-700"
                >
                  {fieldError('title')}
                </span>
              )}
            </label>
            <label className="text-sm font-medium text-slate-800 md:col-span-2">
              Description
              <textarea
                id="faculty-opportunity-description"
                value={form.description}
                maxLength={5000}
                rows={5}
                aria-invalid={Boolean(fieldError('description'))}
                aria-describedby={describedBy('description')}
                onChange={(event) => updateField('description', event.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--yr-line)] px-3 py-2"
              />
              {fieldError('description') && (
                <span
                  id="faculty-opportunity-description-error"
                  className="mt-1 block text-xs text-red-700"
                >
                  {fieldError('description')}
                </span>
              )}
            </label>
            <label className="text-sm font-medium text-slate-800">
              Opening type
              <select
                id="faculty-opportunity-status"
                value={form.status}
                aria-invalid={Boolean(fieldError('status'))}
                aria-describedby={describedBy('status')}
                onChange={(event) => updateField('status', event.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-md border border-[var(--yr-line)] bg-white px-3 py-2"
              >
                <option value="OPEN">Dated opening</option>
                <option value="ROLLING">Rolling opening</option>
              </select>
              {fieldError('status') && (
                <span
                  id="faculty-opportunity-status-error"
                  className="mt-1 block text-xs text-red-700"
                >
                  {fieldError('status')}
                </span>
              )}
            </label>
            <label className="text-sm font-medium text-slate-800">
              Deadline
              <input
                id="faculty-opportunity-deadline"
                type="date"
                value={form.deadline}
                disabled={form.status === 'ROLLING'}
                aria-invalid={Boolean(fieldError('deadline'))}
                aria-describedby={describedBy('deadline')}
                onChange={(event) => updateField('deadline', event.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-md border border-[var(--yr-line)] px-3 py-2 disabled:bg-slate-100"
              />
              {fieldError('deadline') && (
                <span
                  id="faculty-opportunity-deadline-error"
                  className="mt-1 block text-xs text-red-700"
                >
                  {fieldError('deadline')}
                </span>
              )}
            </label>
            <label className="text-sm font-medium text-slate-800 md:col-span-2">
              Official application URL
              <input
                id="faculty-opportunity-applicationUrl"
                type="url"
                inputMode="url"
                value={form.applicationUrl}
                maxLength={2048}
                aria-invalid={Boolean(fieldError('applicationUrl'))}
                aria-describedby={describedBy('applicationUrl')}
                onChange={(event) => updateField('applicationUrl', event.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-md border border-[var(--yr-line)] px-3 py-2"
              />
              {fieldError('applicationUrl') && (
                <span
                  id="faculty-opportunity-applicationUrl-error"
                  className="mt-1 block text-xs text-red-700"
                >
                  {fieldError('applicationUrl')}
                </span>
              )}
            </label>
            <label className="text-sm font-medium text-slate-800">
              Term or timing (optional)
              <input
                id="faculty-opportunity-term"
                value={form.term}
                maxLength={120}
                aria-invalid={Boolean(fieldError('term'))}
                aria-describedby={describedBy('term')}
                onChange={(event) => updateField('term', event.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-md border border-[var(--yr-line)] px-3 py-2"
              />
              {fieldError('term') && (
                <span
                  id="faculty-opportunity-term-error"
                  className="mt-1 block text-xs text-red-700"
                >
                  {fieldError('term')}
                </span>
              )}
            </label>
            <label className="text-sm font-medium text-slate-800">
              Hours per week (optional)
              <input
                id="faculty-opportunity-hoursPerWeek"
                type="number"
                min="1"
                max="80"
                value={form.hoursPerWeek}
                aria-invalid={Boolean(fieldError('hoursPerWeek'))}
                aria-describedby={describedBy('hoursPerWeek')}
                onChange={(event) => updateField('hoursPerWeek', event.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-md border border-[var(--yr-line)] px-3 py-2"
              />
              {fieldError('hoursPerWeek') && (
                <span
                  id="faculty-opportunity-hoursPerWeek-error"
                  className="mt-1 block text-xs text-red-700"
                >
                  {fieldError('hoursPerWeek')}
                </span>
              )}
            </label>
            <label className="text-sm font-medium text-slate-800">
              Compensation
              <select
                id="faculty-opportunity-compensationType"
                value={form.compensationType}
                aria-invalid={Boolean(fieldError('compensationType'))}
                aria-describedby={describedBy('compensationType')}
                onChange={(event) => updateField('compensationType', event.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-md border border-[var(--yr-line)] bg-white px-3 py-2"
              >
                {compensationOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {fieldError('compensationType') && (
                <span
                  id="faculty-opportunity-compensationType-error"
                  className="mt-1 block text-xs text-red-700"
                >
                  {fieldError('compensationType')}
                </span>
              )}
            </label>
            <label className="text-sm font-medium text-slate-800">
              Pay or stipend detail (optional)
              <input
                id="faculty-opportunity-payRate"
                value={form.payRate}
                maxLength={120}
                aria-invalid={Boolean(fieldError('payRate'))}
                aria-describedby={describedBy('payRate')}
                onChange={(event) => updateField('payRate', event.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-md border border-[var(--yr-line)] px-3 py-2"
              />
              {fieldError('payRate') && (
                <span
                  id="faculty-opportunity-payRate-error"
                  className="mt-1 block text-xs text-red-700"
                >
                  {fieldError('payRate')}
                </span>
              )}
            </label>
            <label className="text-sm font-medium text-slate-800 md:col-span-2">
              Eligibility (optional when unknown)
              <textarea
                id="faculty-opportunity-eligibility"
                value={form.eligibility}
                maxLength={2000}
                rows={3}
                aria-invalid={Boolean(fieldError('eligibility'))}
                aria-describedby={describedBy('eligibility')}
                onChange={(event) => updateField('eligibility', event.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--yr-line)] px-3 py-2"
              />
              {fieldError('eligibility') && (
                <span
                  id="faculty-opportunity-eligibility-error"
                  className="mt-1 block text-xs text-red-700"
                >
                  {fieldError('eligibility')}
                </span>
              )}
            </label>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void previewDraft()}
              className="min-h-[44px] rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-[var(--yr-blue)] disabled:opacity-50"
            >
              Preview draft
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-h-[44px] rounded-md bg-[var(--yr-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save draft'}
            </button>
          </div>
        </form>
      )}

      {preview && (
        <article
          className="mt-6 rounded-md border border-blue-200 bg-blue-50 p-5"
          aria-labelledby="faculty-opportunity-preview-title"
        >
          <p className="yr-kicker">Private preview</p>
          <h3
            id="faculty-opportunity-preview-title"
            className="mt-1 text-xl font-semibold text-slate-950"
          >
            {preview.title}
          </h3>
          <p className="mt-1 text-sm font-medium text-slate-600">{preview.researchEntity?.name}</p>
          {preview.description && (
            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {preview.description}
            </p>
          )}
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-slate-950">Opening</dt>
              <dd>
                {preview.status === 'ROLLING'
                  ? 'Rolling'
                  : `Deadline ${String(preview.deadline || '').slice(0, 10) || 'not set'}`}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-950">Application</dt>
              <dd className="break-all">{preview.applicationUrl || 'Not set'}</dd>
            </div>
          </dl>
        </article>
      )}
    </section>
  );
};

export default FacultyOpportunityManager;
