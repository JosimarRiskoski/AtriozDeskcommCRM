"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type EdgeMouseHandler,
  type EdgeChange,
  type NodeChange,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  toReactFlow,
  fromReactFlow,
  graphsEqual,
  toFlowNode,
  type RFNode,
  type RFEdge,
  type RFNodeData,
} from "@/lib/followup/graph-mappers";
import { conditionLabel } from "@/lib/followup/edge-condition-options";
import type { FlowEdge, FlowGraph, NodeType } from "@/lib/followup/graph-schema";
import { useFollowupFlow, type FollowupFlowDetailRow } from "@/hooks/followup/useFollowupFlow";
import { NodeConfigPanel } from "./NodeConfigPanel";
import { EdgeConfigPanel } from "./EdgeConfigPanel";
import { NodePalette } from "./NodePalette";
import { PublishBar } from "./PublishBar";
import { NODE_VISUALS } from "./nodes/nodeVisuals";
import { TriggerNode } from "./nodes/TriggerNode";
import { WaitNode } from "./nodes/WaitNode";
import { ConditionNode } from "./nodes/ConditionNode";
import { ClassifyNode } from "./nodes/ClassifyNode";
import { ActionNode } from "./nodes/ActionNode";
import { EndNode } from "./nodes/EndNode";
import { Button } from "@/components/ui/button";
import { ArrowCounterClockwise, ArrowClockwise } from "@/lib/ui/icons";

const EMPTY_GRAPH: FlowGraph = { nodes: [], edges: [] };
const DND_MIME = "application/x-followup-node-type";

// Defined outside the component — React Flow warns (and re-mounts nodes) if
// nodeTypes is a fresh object every render.
const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  wait: WaitNode,
  condition: ConditionNode,
  ai_classify: ClassifyNode,
  action: ActionNode,
  end: EndNode,
};

interface Props {
  flowId: string;
  initialData: FollowupFlowDetailRow;
}

interface CanvasSnapshot {
  nodes: RFNode[];
  edges: RFEdge[];
}

function FlowCanvasInner({ flowId, initialData }: Props) {
  const { data: flow } = useFollowupFlow(flowId, { initialData });
  // `initial` seeds React Flow state ONCE on mount — it must NOT react to
  // `flow` changing on every refetch (that would clobber in-progress edits).
  const initial = useMemo(
    () => toReactFlow(initialData.draft_graph ?? EMPTY_GRAPH),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>(initial.edges);
  const [savedGraph, setSavedGraph] = useState<FlowGraph>(initialData.draft_graph ?? EMPTY_GRAPH);
  const nextId = useRef(1);
  const nextEdgeId = useRef(1);
  const { screenToFlowPosition } = useReactFlow();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const undoStack = useRef<CanvasSnapshot[]>([]);
  const redoStack = useRef<CanvasSnapshot[]>([]);
  const [historyAvailability, setHistoryAvailability] = useState({
    canUndo: false,
    canRedo: false,
  });

  const remember = useCallback(() => {
    undoStack.current = [...undoStack.current.slice(-49), { nodes, edges }];
    redoStack.current = [];
    setHistoryAvailability({ canUndo: true, canRedo: false });
  }, [nodes, edges]);

  const undo = useCallback(() => {
    const previous = undoStack.current.at(-1);
    if (!previous) return;
    undoStack.current = undoStack.current.slice(0, -1);
    redoStack.current = [...redoStack.current.slice(-49), { nodes, edges }];
    setNodes(previous.nodes);
    setEdges(previous.edges);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setHistoryAvailability({
      canUndo: undoStack.current.length > 0,
      canRedo: true,
    });
  }, [edges, nodes, setEdges, setNodes]);

  const redo = useCallback(() => {
    const next = redoStack.current.at(-1);
    if (!next) return;
    redoStack.current = redoStack.current.slice(0, -1);
    undoStack.current = [...undoStack.current.slice(-49), { nodes, edges }];
    setNodes(next.nodes);
    setEdges(next.edges);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setHistoryAvailability({
      canUndo: true,
      canRedo: redoStack.current.length > 0,
    });
  }, [edges, nodes, setEdges, setNodes]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (modifier && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<RFNode>[]) => {
      if (changes.some((change) => change.type === "remove")) remember();
      onNodesChange(changes);
    },
    [onNodesChange, remember],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<RFEdge>[]) => {
      if (changes.some((change) => change.type === "remove")) remember();
      onEdgesChange(changes);
    },
    [onEdgesChange, remember],
  );

  const liveGraph = useMemo(() => fromReactFlow(nodes, edges), [nodes, edges]);
  const dirty = useMemo(() => !graphsEqual(liveGraph, savedGraph), [liveGraph, savedGraph]);

  const markNodeErrors = useCallback(
    (errorsByNode: Record<string, string[]>) => {
      setNodes((nds) =>
        nds.map((n) => ({ ...n, data: { ...n.data, errors: errorsByNode[n.id] } })),
      );
    },
    [setNodes],
  );
  const clearNodeErrors = useCallback(() => {
    setNodes((nds) =>
      nds.map((n) => (n.data.errors ? { ...n, data: { ...n.data, errors: undefined } } : n)),
    );
  }, [setNodes]);

  // Node and edge selection are mutually exclusive — opening one panel closes the other's.
  const onNodeClick = useCallback<NodeMouseHandler<RFNode>>((_, node) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  }, []);
  const onEdgeClick = useCallback<EdgeMouseHandler<RFEdge>>((_, edge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
  }, []);
  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  const updateNodeData = useCallback(
    (id: string, patch: Partial<RFNodeData>) => {
      remember();
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
      );
    },
    [remember, setNodes],
  );

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNodeId) return;
    remember();
    setNodes((current) => current.filter((node) => node.id !== selectedNodeId));
    setEdges((current) =>
      current.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId),
    );
    setSelectedNodeId(null);
  }, [remember, selectedNodeId, setEdges, setNodes]);
  const updateEdgeCondition = useCallback(
    (id: string, condition: FlowEdge["condition"]) => {
      remember();
      setEdges((eds) =>
        eds.map((e) =>
          e.id === id ? { ...e, data: { priority: e.data?.priority ?? 0, condition } } : e,
        ),
      );
    },
    [remember, setEdges],
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;
  const selectedEdgeSource = selectedEdge
    ? (nodes.find((n) => n.id === selectedEdge.source) ?? null)
    : null;
  const selectedEdgeTarget = selectedEdge
    ? (nodes.find((n) => n.id === selectedEdge.target) ?? null)
    : null;

  // Wire label: derived at render time from `data.condition`, never persisted on the edge
  // itself — `condition` alone stays the source of truth the mapper round-trips.
  const edgesForRender = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        label: conditionLabel(e.data?.condition ?? { type: "always" }),
        selected: e.id === selectedEdgeId,
      })),
    [edges, selectedEdgeId],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      remember();
      const newEdge: RFEdge = {
        id: `edge-${nextEdgeId.current++}`,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        data: { priority: 0, condition: { type: "always" } },
      };
      setEdges((eds) => addEdge(newEdge, eds));
    },
    [remember, setEdges],
  );

  const addNodeAt = useCallback(
    (type: NodeType, position: { x: number; y: number }) => {
      remember();
      const visual = NODE_VISUALS[type];
      const id = `${type}-${nextId.current++}`;
      const newNode: RFNode = {
        id,
        type,
        position,
        data: { label: visual.defaultLabel, config: visual.defaultConfig() },
      };
      setNodes((nds) => nds.concat(newNode));
    },
    [remember, setNodes],
  );

  const onPaletteAdd = useCallback(
    (type: NodeType) => {
      const index = nodes.length;
      addNodeAt(type, { x: 80 + (index % 4) * 220, y: 80 + Math.floor(index / 4) * 150 });
    },
    [nodes.length, addNodeAt],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData(DND_MIME) as NodeType | "";
      if (!type) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNodeAt(type, position);
    },
    [screenToFlowPosition, addNodeAt],
  );

  return (
    <div className="flex h-full min-h-[600px] w-full flex-col">
      {flow && (
        <PublishBar
          flowId={flowId}
          flow={flow}
          graph={liveGraph}
          dirty={dirty}
          onSaved={setSavedGraph}
          onPublishErrors={markNodeErrors}
          onPublishSuccess={clearNodeErrors}
        />
      )}
      <div className="flex flex-1 overflow-hidden">
        <NodePalette onAdd={onPaletteAdd} />
        <div
          className="relative h-full flex-1"
          data-testid="flow-canvas"
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <div className="bg-background/95 absolute left-3 top-3 z-10 flex gap-1 rounded-md border p-1 shadow-sm">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={undo}
              disabled={!historyAvailability.canUndo}
              aria-label="Desfazer última alteração"
              title="Desfazer (Ctrl+Z)"
            >
              <ArrowCounterClockwise size={16} aria-hidden />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={redo}
              disabled={!historyAvailability.canRedo}
              aria-label="Refazer última alteração"
              title="Refazer (Ctrl+Y)"
            >
              <ArrowClockwise size={16} aria-hidden />
            </Button>
          </div>
          <ReactFlow
            nodes={nodes}
            edges={edgesForRender}
            nodeTypes={nodeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            deleteKeyCode={null}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>

        {selectedNode && (
          // Docked panel, NOT a modal overlay — the canvas stays fully clickable
          // so switching node selection (or dragging edges) works while it's open.
          <aside
            className="h-full w-96 shrink-0 overflow-y-auto border-l border-border bg-surface p-4"
            data-testid="node-config-sheet"
          >
            <NodeConfigPanel
              key={selectedNode.id}
              node={selectedNode}
              onChange={(patch) => updateNodeData(selectedNode.id, patch)}
              onDelete={selectedNode.type === "trigger" ? undefined : deleteSelectedNode}
            />
          </aside>
        )}

        {selectedEdge && (
          <aside
            className="h-full w-96 shrink-0 overflow-y-auto border-l border-border bg-surface p-4"
            data-testid="edge-config-sheet"
          >
            <EdgeConfigPanel
              key={selectedEdge.id}
              sourceNode={selectedEdgeSource ? toFlowNode(selectedEdgeSource) : undefined}
              targetNode={selectedEdgeTarget ? toFlowNode(selectedEdgeTarget) : undefined}
              condition={selectedEdge.data?.condition ?? { type: "always" }}
              onChange={(condition) => updateEdgeCondition(selectedEdge.id, condition)}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

export function FlowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
