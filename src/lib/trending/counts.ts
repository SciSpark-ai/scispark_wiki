/**
 * One real OpenAlex work count (`countOpenAlexWorks`) for a query within a date
 * range. `topicId` (optional) additionally scopes the count to one OpenAlex
 * `primary_topic.id` — the SP4 leaderboard's per-candidate PRIOR-count lookup,
 * so a topic's recent count, prior count, growth badge and bars all come from
 * the same filter. Trending supplies the same canonical `fieldId` to all
 * requests and an empty query, avoiding accidental field-name text filtering.
 *
 * This is trending's ONLY counting primitive. The `group_by=publication_date`
 * weekly-series path that used to sit beside it is gone: OpenAlex now rejects
 * that grouping outright (HTTP 400 "Invalid query parameters error", verified
 * 2026-07-25 in every form — plain, date-filtered, keyed and keyless, while
 * `group_by=publication_year` and `group_by=primary_topic.id` both return 200),
 * so the only surviving series path was one request per week per topic. The
 * board draws before/after bars from the counts it already has instead.
 */
/*
 * CONTRACT: resolves only with a REALLY MEASURED count. An implementation that
 * cannot measure one — a transport failure, or a 200 response carrying no
 * `meta.count` — must REJECT, never resolve 0: the orchestrator reads a
 * rejection as "unknown" and omits that discipline/topic (surfacing the reason
 * as `TrendingBoard.dataError`), whereas a fabricated zero would rank a topic
 * as brand-new at the top of the board.
 */
export type CountFn = (q: { query: string; fromDate: string; toDate: string; topicId?: string; fieldId?: string; subfieldIds?: string[] }) => Promise<number>
