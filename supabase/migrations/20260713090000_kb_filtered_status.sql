-- Allow the ingest guardrail to mark off-context knowledge rows as 'filtered'
-- (US/UK D2C tea/coffee/supplements/wellness only). Extends the existing status
-- CHECK constraint on kb_knowledge without dropping data.
ALTER TABLE public.kb_knowledge DROP CONSTRAINT IF EXISTS kb_knowledge_status_check;
ALTER TABLE public.kb_knowledge
  ADD CONSTRAINT kb_knowledge_status_check
  CHECK (status IN ('queued','fetched','summarized','failed','filtered'));
