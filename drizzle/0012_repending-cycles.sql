-- M16: перекрауливаем авторов, чтобы подтянуть циклы (cycles_blocks).
UPDATE crawl_task
SET status = 'pending', attempts = 0, scheduled_at = unixepoch()
WHERE source = 'fantlab' AND status IN ('done', 'failed');
