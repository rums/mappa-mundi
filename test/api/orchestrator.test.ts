/**
 * Tests for the scan/refresh orchestrator — pipeline coordination.
 *
 * The orchestrator is the internal engine that:
 * - Manages in-memory job state
 * - Coordinates the scan pipeline: structural scan → clustering → cache zoom
 * - Coordinates the refresh pipeline: re-scan → invalidate cache → re-cluster
 *
 * These are unit tests that mock the upstream modules.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from '../../src/api/orchestrator.js';
import type { DependencyGraph, SemanticZoomLevel } from '../../src/types.js';

// ─── Mock Factories ─────────────────────────────────────────────────────────

function makeMockGraph(): DependencyGraph {
  return {
    root: '/test-project',
    nodes: [
      { id: 'src/index.ts', filePath: '/test-project/src/index.ts', exports: [], symbols: [] },
      { id: 'src/utils.ts', filePath: '/test-project/src/utils.ts', exports: [], symbols: [] },
    ],
    edges: [
      { source: 'src/index.ts', target: 'src/utils.ts', imports: [{ name: 'util', kind: 'named' }] },
    ],
  };
}

function makeMockZoomLevel(): SemanticZoomLevel {
  return {
    id: 'top-level',
    label: 'Project Overview',
    regions: [
      { id: 'region-1', name: 'Core', moduleCount: 2, loc: 100 },
    ],
    relationships: [],
  };
}

// ─── Job Management ─────────────────────────────────────────────────────────

describe('Orchestrator: job management', () => {
  let orchestrator: Orchestrator;

  beforeEach(() => {
    orchestrator = new Orchestrator();
  });

  it('should create a job with queued status', () => {
    const job = orchestrator.createJob('scan');

    expect(job).toHaveProperty('id');
    expect(typeof job.id).toBe('string');
    expect(job.id.length).toBeGreaterThan(0);
    expect(job).toHaveProperty('status', 'queued');
    expect(job).toHaveProperty('type', 'scan');
  });

  it('should retrieve a job by id', () => {
    const created = orchestrator.createJob('scan');
    const retrieved = orchestrator.getJob(created.id);

    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(created.id);
  });

  it('should return undefined for unknown job id', () => {
    const job = orchestrator.getJob('nonexistent-id');
    expect(job).toBeUndefined();
  });

  it('should transition job status from queued to running', () => {
    const job = orchestrator.createJob('scan');
    orchestrator.updateJobStatus(job.id, 'running');

    const updated = orchestrator.getJob(job.id);
    expect(updated!.status).toBe('running');
    expect(updated!.startedAt).toBeDefined();
  });

  it('should transition job status to completed with result', () => {
    const job = orchestrator.createJob('scan');
    const mockResult = makeMockZoomLevel();
    orchestrator.updateJobStatus(job.id, 'completed', { result: mockResult });

    const updated = orchestrator.getJob(job.id);
    expect(updated!.status).toBe('completed');
    expect(updated!.result).toEqual(mockResult);
    expect(updated!.completedAt).toBeDefined();
  });

  it('should transition job status to failed with error', () => {
    const job = orchestrator.createJob('scan');
    orchestrator.updateJobStatus(job.id, 'failed', { error: 'Something went wrong' });

    const updated = orchestrator.getJob(job.id);
    expect(updated!.status).toBe('failed');
    expect(updated!.error).toBe('Something went wrong');
  });

  it('should clean up expired jobs after TTL', () => {
    vi.useFakeTimers();
    try {
      const orch = new Orchestrator();
      const job = orch.createJob('scan');
      orch.updateJobStatus(job.id, 'completed', { result: makeMockZoomLevel() });

      // Before TTL — job should exist
      expect(orch.getJob(job.id)).toBeDefined();

      // Advance past 5-minute TTL
      vi.advanceTimersByTime(6 * 60 * 1000);
      orch.cleanupExpiredJobs();

      expect(orch.getJob(job.id)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('should not clean up running jobs', () => {
    vi.useFakeTimers();
    try {
      const orch = new Orchestrator();
      const job = orch.createJob('scan');
      orch.updateJobStatus(job.id, 'running');

      vi.advanceTimersByTime(10 * 60 * 1000); // 10 minutes
      orch.cleanupExpiredJobs();

      // Running jobs should NOT be cleaned up
      expect(orch.getJob(job.id)).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── Scan Pipeline ──────────────────────────────────────────────────────────

describe('Orchestrator: scan pipeline', () => {
  it('should report that a scan is in progress', () => {
    const orchestrator = new Orchestrator();
    expect(orchestrator.isScanInProgress()).toBe(false);

    const job = orchestrator.createJob('scan');
    orchestrator.updateJobStatus(job.id, 'running');

    expect(orchestrator.isScanInProgress()).toBe(true);
  });

  it('should no longer report scan in progress after completion', () => {
    const orchestrator = new Orchestrator();
    const job = orchestrator.createJob('scan');
    orchestrator.updateJobStatus(job.id, 'running');
    orchestrator.updateJobStatus(job.id, 'completed', { result: makeMockZoomLevel() });

    expect(orchestrator.isScanInProgress()).toBe(false);
  });

  it('should store the active project path after scan', () => {
    const orchestrator = new Orchestrator();
    expect(orchestrator.getActiveProjectPath()).toBeUndefined();

    orchestrator.setActiveProjectPath('/test-project');
    expect(orchestrator.getActiveProjectPath()).toBe('/test-project');
  });

  it('should replace the active project on new scan', () => {
    const orchestrator = new Orchestrator();
    orchestrator.setActiveProjectPath('/project-a');
    orchestrator.setActiveProjectPath('/project-b');

    expect(orchestrator.getActiveProjectPath()).toBe('/project-b');
  });
});

// ─── Refresh Pipeline ───────────────────────────────────────────────────────

describe('Orchestrator: refresh pipeline', () => {
  it('should create a refresh job distinct from scan jobs', () => {
    const orchestrator = new Orchestrator();
    const scanJob = orchestrator.createJob('scan');
    const refreshJob = orchestrator.createJob('refresh');

    expect(scanJob.id).not.toBe(refreshJob.id);
    expect(refreshJob.type).toBe('refresh');
  });
});
