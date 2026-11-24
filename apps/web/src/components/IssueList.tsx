import type { PipelineIssue } from '@railyard/shared';

export function IssueList({ issues }: { issues: readonly PipelineIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="issues" aria-label="Validation issues">
      {issues.map((issue, index) => (
        <li key={index} className={`issue issue-${issue.severity}`}>
          <span className="issue-where">
            {issue.line ? `L${issue.line}:${issue.column ?? 1}` : '—'} <code>{issue.path}</code>
          </span>
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}
