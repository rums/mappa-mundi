import { randomUUID } from 'crypto';
import type { DependencyGraph, SemanticZoomLevel } from '../types.js';
import type { DirectoryNode } from '../directory-tree.js';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type JobType = 'scan' | 'refresh';

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: number;
  startedAt?: string;
  completedAt?: string;
  result?: any;
  error?: string;
}

const JOB_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface SavedProject {
  path: string;
  name: string;
  scannedAt: string;
  regionCount: number;
  moduleCount: number;
  graph: DependencyGraph;
  dirTree: DirectoryNode;
  zoomLevel: SemanticZoomLevel;
  regionModuleMap: Record<string, string[]>;
}

export class Orchestrator {
  private jobs = new Map<string, Job>();
  private activeProjectPath?: string;
  private lastZoomLevel?: SemanticZoomLevel;
  private lastGraph?: DependencyGraph;
  private lastDirTree?: DirectoryNode;
  private regionModuleMap?: Record<string, string[]>;
  private savedProjects = new Map<string, SavedProject>();

  createJob(type: JobType): Job {
    const job: Job = {
      id: randomUUID(),
      type,
      status: 'queued',
      createdAt: Date.now(),
      startedAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  updateJobStatus(id: string, status: JobStatus, extras?: { result?: any; error?: string }): void {
    const job = this.jobs.get(id);
    if (!job) return;

    job.status = status;

    if (status === 'running') {
      job.startedAt = new Date().toISOString();
    }

    if (status === 'completed') {
      job.completedAt = new Date().toISOString();
      if (extras?.result !== undefined) {
        job.result = extras.result;
      }
    }

    if (status === 'failed') {
      job.completedAt = new Date().toISOString();
      if (extras?.error !== undefined) {
        job.error = extras.error;
      }
    }
  }

  cleanupExpiredJobs(): void {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      // Never clean up running jobs
      if (job.status === 'running') continue;

      if (job.completedAt) {
        const completedTime = new Date(job.completedAt).getTime();
        if (now - completedTime > JOB_TTL_MS) {
          this.jobs.delete(id);
        }
      } else if (job.status === 'queued') {
        // Clean up queued jobs that are past TTL
        if (now - job.createdAt > JOB_TTL_MS) {
          this.jobs.delete(id);
        }
      }
    }
  }

  isScanInProgress(): boolean {
    for (const job of this.jobs.values()) {
      if ((job.type === 'scan' || job.type === 'refresh') && (job.status === 'running' || job.status === 'queued')) return true;
    }
    return false;
  }

  setActiveProjectPath(path: string): void {
    this.activeProjectPath = path;
  }

  getActiveProjectPath(): string | undefined {
    return this.activeProjectPath;
  }

  setLastZoomLevel(level: SemanticZoomLevel): void {
    this.lastZoomLevel = level;
  }

  getLastZoomLevel(): SemanticZoomLevel | undefined {
    return this.lastZoomLevel;
  }

  setLastGraph(graph: DependencyGraph): void {
    this.lastGraph = graph;
  }

  getLastGraph(): DependencyGraph | undefined {
    return this.lastGraph;
  }

  setLastDirTree(tree: DirectoryNode): void {
    this.lastDirTree = tree;
  }

  getLastDirTree(): DirectoryNode | undefined {
    return this.lastDirTree;
  }

  setRegionModuleMap(map: Record<string, string[]>): void {
    this.regionModuleMap = map;
  }

  getRegionModuleMap(): Record<string, string[]> | undefined {
    return this.regionModuleMap;
  }

  saveProject(): void {
    if (!this.activeProjectPath || !this.lastGraph || !this.lastDirTree || !this.lastZoomLevel) return;
    const name = this.activeProjectPath.split('/').pop() || this.activeProjectPath;
    this.savedProjects.set(this.activeProjectPath, {
      path: this.activeProjectPath,
      name,
      scannedAt: new Date().toISOString(),
      regionCount: this.lastZoomLevel.regions.length,
      moduleCount: this.lastGraph.nodes.length,
      graph: this.lastGraph,
      dirTree: this.lastDirTree,
      zoomLevel: this.lastZoomLevel,
      regionModuleMap: this.regionModuleMap || {},
    });
  }

  loadProject(path: string): boolean {
    const saved = this.savedProjects.get(path);
    if (!saved) return false;
    this.activeProjectPath = saved.path;
    this.lastGraph = saved.graph;
    this.lastDirTree = saved.dirTree;
    this.lastZoomLevel = saved.zoomLevel;
    this.regionModuleMap = saved.regionModuleMap;
    return true;
  }

  listProjects(): Array<{ path: string; name: string; scannedAt: string; regionCount: number; moduleCount: number }> {
    return [...this.savedProjects.values()].map(({ path, name, scannedAt, regionCount, moduleCount }) => ({
      path, name, scannedAt, regionCount, moduleCount,
    }));
  }
}
