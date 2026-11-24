import { layoutGraph, NODE_HEIGHT, NODE_WIDTH, type GraphNodeInput } from '../graph/layout';
import { StatusPill } from './StatusPill';

export interface RunGraphNode extends GraphNodeInput {
  readonly name: string;
  readonly status: string;
}

interface RunGraphProps {
  readonly jobs: readonly RunGraphNode[];
  readonly criticalPath?: readonly string[];
  readonly selectedKey?: string | null;
  readonly onSelect?: (key: string) => void;
}

/** DAG of a run: one column per topological level, SVG edges, HTML nodes for accessibility. */
export function RunGraph({ jobs, criticalPath = [], selectedKey = null, onSelect }: RunGraphProps) {
  const layout = layoutGraph(jobs, criticalPath);
  return (
    <div
      className="graph"
      style={{ width: layout.width, height: layout.height }}
      role="list"
      aria-label="Pipeline graph"
    >
      <svg className="graph-edges" width={layout.width} height={layout.height} aria-hidden="true">
        {layout.edges.map((edge) => (
          <path
            key={`${edge.from}->${edge.to}`}
            d={edge.path}
            className={edge.critical ? 'edge edge-critical' : 'edge'}
          />
        ))}
      </svg>
      {layout.nodes.map(({ node, x, y }) => (
        <button
          type="button"
          role="listitem"
          key={node.key}
          className={`graph-node status-${node.status}${node.key === selectedKey ? ' selected' : ''}`}
          style={{ left: x, top: y, width: NODE_WIDTH, height: NODE_HEIGHT }}
          onClick={() => onSelect?.(node.key)}
          title={node.key}
        >
          <span className="graph-node-name">{node.name}</span>
          <StatusPill status={node.status} />
        </button>
      ))}
    </div>
  );
}
