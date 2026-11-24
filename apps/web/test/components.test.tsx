import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnsiLog, colorFor, splitChunks } from '../src/components/AnsiLog';
import { IssueList } from '../src/components/IssueList';
import { RunGraph } from '../src/components/RunGraph';
import { StatusPill } from '../src/components/StatusPill';

describe('RunGraph', () => {
  const jobs = [
    { key: 'build', name: 'build', level: 0, needs: [], status: 'succeeded' },
    { key: 'test[n=1]', name: 'test (1)', level: 1, needs: ['build'], status: 'running' },
  ];

  it('renders a node per job with its status and selects on click', () => {
    const onSelect = vi.fn();
    render(<RunGraph jobs={jobs} selectedKey="build" onSelect={onSelect} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('test (1)')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('test[n=1]'));
    expect(onSelect).toHaveBeenCalledWith('test[n=1]');
    expect(screen.getByTitle('build')).toHaveClass('selected');
  });
});

describe('AnsiLog', () => {
  it('renders coloured segments and carries style across lines', () => {
    const lines = splitChunks([
      { stream: 'stdout', content: '\u001b[31mred\nstill red\u001b[0m\nplain\n' },
    ]);
    expect(lines).toHaveLength(3);
    render(<AnsiLog lines={lines} />);
    expect(screen.getByText('red')).toHaveStyle({ color: '#e06c75' });
    expect(screen.getByText('still red')).toHaveStyle({ color: '#e06c75' });
    expect(screen.getByText('plain')).not.toHaveAttribute(
      'style',
      expect.stringContaining('color'),
    );
  });

  it('shows a placeholder when empty and maps colours', () => {
    render(<AnsiLog lines={[]} />);
    expect(screen.getByText(/Waiting for output/)).toBeInTheDocument();
    expect(colorFor(null)).toBeUndefined();
    expect(colorFor('bright-green')).toBe('#98c379');
    expect(colorFor('rgb(1,2,3)')).toBe('rgb(1,2,3)');
  });

  it('marks stderr and system lines', () => {
    render(
      <AnsiLog
        lines={[
          { stream: 'stderr', text: 'warn' },
          { stream: 'system', text: '$ step' },
        ]}
      />,
    );
    expect(screen.getByText('warn').closest('.log-line')).toHaveClass('log-stderr');
    expect(screen.getByText('$ step').closest('.log-line')).toHaveClass('log-system');
  });
});

describe('IssueList and StatusPill', () => {
  it('lists issues with locations', () => {
    render(
      <IssueList
        issues={[
          {
            severity: 'error',
            code: 'cycle',
            path: 'jobs.a.needs',
            message: 'dependency cycle: a -> b -> a',
            line: 4,
            column: 5,
          },
          {
            severity: 'warning',
            code: 'not_yet_executed',
            path: 'jobs.a.cache',
            message: 'not executed yet',
          },
        ]}
      />,
    );
    expect(screen.getByText('L4:5')).toBeInTheDocument();
    expect(screen.getByText(/dependency cycle/)).toBeInTheDocument();
  });

  it('renders nothing without issues and humanises statuses', () => {
    const { container } = render(<IssueList issues={[]} />);
    expect(container).toBeEmptyDOMElement();
    render(<StatusPill status="timed_out" />);
    expect(screen.getByText('timed out')).toBeInTheDocument();
  });
});
