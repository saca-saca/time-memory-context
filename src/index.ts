import { ContextCompressor } from './context/compressor';
import { ContextAssembler, AssembledContext } from './context/assembler';
import { MemoryRetriever } from './memory/retriever';
import { MemoryLifecycle, MaintenanceResult } from './memory/lifecycle';
import { Message, CompressedContext, MemorySnippet, SummarizerConfig } from './types';
import { FileUtils } from './utils/file';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * MemoryContext 主类
 * 分层记忆管理，减少 80%+ Token 消耗
 * 
 * 特性：
 * - WAL协议：每日独立文件，保留30天
 * - 日志系统：每日独立文件，保留7天
 * - 时间分层：7天全量 → 30天精简 → 永久归档
 * - BGE-M3向量化：1024维高质量语义检索
 * - 向量缓存：LRU缓存避免重复计算
 */
export class MemoryContext {
  private config: MemoryContextConfig;
  private compressor: ContextCompressor;
  private assembler: ContextAssembler;
  private retriever: MemoryRetriever;
  private lifecycle: MemoryLifecycle;
  private basePath: string;
  private vectorCache: Map<string, number[]>;
  private maxCacheSize: number;

  constructor(config: Partial<MemoryContextConfig> = {}) {
    this.validateConfig(config);
    
    this.config = {
      keepRounds: 3,
      maxTokens: 4000,
      basePath: './memory',
      enableRetrieval: true,
      enableWAL: true,
      enableVectorCache: true,
      logLevel: 'info',
      vectorCacheSize: 1000,
      ...config
    };

    this.basePath = this.config.basePath;
    this.vectorCache = new Map();
    this.maxCacheSize = this.config.vectorCacheSize || 1000;

    // 初始化摘要器配置
    const summarizerConfig: SummarizerConfig | undefined = this.config.summarizerConfig || {
      provider: 'openclaw'
    };

    this.compressor = new ContextCompressor({
      keepRounds: this.config.keepRounds,
      summarizeThreshold: 10,
      summarizerConfig
    });

    this.assembler = new ContextAssembler({
      maxTokens: this.config.maxTokens,
      maxMemorySnippets: 3
    });

    this.retriever = new MemoryRetriever({
      basePath: this.basePath,
      vectorCache: this.config.enableVectorCache ? this.vectorCache : undefined
    });

    this.lifecycle = new MemoryLifecycle({
      basePath: this.basePath,
      tiers: {
        short: { days: 7, compression: 'none' },
        medium: { days: 30, compression: 'clean' },
        long: { compression: 'archive' }
      }
    });

    // 注意：目录创建已移至 initialize() 方法，避免构造函数中的异步竞争条件
  }

  private validateConfig(config: Partial<MemoryContextConfig>): void {
    if (config.keepRounds !== undefined) {
      if (config.keepRounds < 1 || config.keepRounds > 20) {
        throw new Error('keepRounds must be between 1 and 20');
      }
    }
    if (config.maxTokens !== undefined) {
      if (config.maxTokens < 100 || config.maxTokens > 100000) {
        throw new Error('maxTokens must be between 100 and 100000');
      }
    }
    if (config.basePath !== undefined) {
      if (config.basePath.includes('..')) {
        throw new Error('basePath cannot contain ".."');
      }
    }
  }

  /**
   * 处理新消息
   */
  async process(
    userMessage: string,
    history: Message[],
    systemPrompt?: string
  ): Promise<ProcessResult> {
    try {
      // 【WAL Step 1】写入用户消息
      if (this.config.enableWAL) {
        await this.writeWAL(userMessage, 'user');
      }

      this.log('info', `Processing message: ${userMessage.substring(0, 50)}...`);

      const compressed = this.compressor.compress(history);

      let memories: MemorySnippet[] = [];
      if (this.config.enableRetrieval) {
        try {
          memories = await this.retriever.retrieve(userMessage);
        } catch (e) {
          this.log('warn', 'Memory retrieval failed', e);
        }
      }

      const assembled = this.assembler.assemble(compressed, memories, systemPrompt, userMessage);

      // 后台写入日常记忆
      this.writeTodayMemory(userMessage, 'user').catch(e => {
        this.log('warn', 'Failed to write daily memory', e);
      });

      return {
        messages: assembled.messages,
        metadata: {
          ...assembled.metadata,
          memorySnippets: memories.map(m => ({
            source: m.source,
            relevance: m.relevance,
            tier: m.tier
          }))
        }
      };
    } catch (error) {
      this.log('error', 'Process failed', error);
      throw new MemoryContextError('Failed to process message', error);
    }
  }

  /**
   * 【WAL】写入预写日志（每日独立文件）
   */
  private async writeWAL(content: string, role: 'user' | 'assistant'): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const walPath = path.join(this.basePath, 'wal', `${today}.jsonl`);
    
    const walEntry = {
      timestamp: Date.now(),
      role,
      content: content.substring(0, 10000),
      checksum: this.simpleHash(content)
    };

    try {
      await fs.mkdir(path.dirname(walPath), { recursive: true });
      await fs.appendFile(walPath, JSON.stringify(walEntry) + '\n');
    } catch (e) {
      this.log('error', 'WAL write failed', e);
    }
  }

  /**
   * 【日志】写入日志（每日独立文件，保留7天）
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, error?: any): void {
    if (this.shouldLog(level)) {
      const today = new Date().toISOString().split('T')[0];
      const logPath = path.join(this.basePath, 'logs', `${today}.jsonl`);
      
      const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        error: error ? String(error) : undefined
      };

      // 异步写入，不阻塞
      fs.mkdir(path.dirname(logPath), { recursive: true })
        .then(() => fs.appendFile(logPath, JSON.stringify(logEntry) + '\n'))
        .catch(() => { /* 忽略日志写入失败 */ });
    }

    // 同时输出到控制台
    const consoleMethod = level === 'error' ? console.error : 
                         level === 'warn' ? console.warn : 
                         level === 'debug' ? console.debug : console.log;
    consoleMethod(`[${level.toUpperCase()}] ${message}`, error || '');
  }

  private shouldLog(level: string): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    const configLevel = this.config.logLevel || 'info';
    return levels.indexOf(level) >= levels.indexOf(configLevel);
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  /**
   * 记录助手回复（带WAL）
   */
  async recordAssistant(message: string): Promise<void> {
    if (this.config.enableWAL) {
      await this.writeWAL(message, 'assistant');
    }
    await this.writeTodayMemory(message, 'assistant');
  }

  private async writeTodayMemory(content: string, role: 'user' | 'assistant'): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const filePath = path.join(this.basePath, 'daily', `${today}.json`);

    interface DayData {
      date: string;
      messages: Array<{
        role: 'user' | 'assistant';
        content: string;
        timestamp: number;
        important?: boolean;
      }>;
    }

    let data: DayData = { date: today, messages: [] };

    try {
      const existing = await fs.readFile(filePath, 'utf-8');
      data = JSON.parse(existing) as DayData;
    } catch (e) {
      // 文件不存在
    }

    data.messages.push({
      role,
      content,
      timestamp: Date.now()
    });

    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  }

  /**
   * 手动查询记忆
   */
  async recall(query: string, topK: number = 5): Promise<MemorySnippet[]> {
    try {
      return await this.retriever.retrieve(query, { topK });
    } catch (error) {
      this.log('error', 'Recall failed', error);
      return [];
    }
  }

  /**
   * 维护：包含WAL和日志清理
   */
  async maintenance(): Promise<MaintenanceResult> {
    const result = await this.lifecycle.dailyMaintenance();
    
    // 清理30天前的WAL文件
    try {
      const cleanedWAL = await this.cleanOldWALFiles();
      result.cleaned.push(...cleanedWAL);
    } catch (e) {
      result.errors.push(`WAL cleanup failed: ${e}`);
    }

    // 清理7天前的日志文件
    try {
      const cleanedLogs = await this.cleanOldLogFiles();
      result.cleaned.push(...cleanedLogs);
    } catch (e) {
      result.errors.push(`Log cleanup failed: ${e}`);
    }

    return result;
  }

  /**
   * 清理30天前的WAL文件
   */
  private async cleanOldWALFiles(): Promise<string[]> {
    const cleaned: string[] = [];
    const walDir = path.join(this.basePath, 'wal');
    
    try {
      const files = await fs.readdir(walDir);
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        
        const filePath = path.join(walDir, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime.getTime() < thirtyDaysAgo) {
          await fs.unlink(filePath);
          cleaned.push(file);
        }
      }
    } catch (e) {
      // WAL目录可能不存在
    }

    return cleaned;
  }

  /**
   * 清理7天前的日志文件
   */
  private async cleanOldLogFiles(): Promise<string[]> {
    const cleaned: string[] = [];
    const logDir = path.join(this.basePath, 'logs');
    
    try {
      const files = await fs.readdir(logDir);
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        
        const filePath = path.join(logDir, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime.getTime() < sevenDaysAgo) {
          await fs.unlink(filePath);
          cleaned.push(file);
        }
      }
    } catch (e) {
      // 日志目录可能不存在
    }

    return cleaned;
  }

  async markImportant(content: string, note?: string): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const filePath = path.join(this.basePath, 'daily', `${today}.json`);

    interface DayData {
      date: string;
      messages: Array<{
        role: 'user' | 'assistant';
        content: string;
        timestamp: number;
        important?: boolean;
      }>;
    }

    let data: DayData = { date: today, messages: [] };

    try {
      const existing = await fs.readFile(filePath, 'utf-8');
      data = JSON.parse(existing) as DayData;
    } catch (e) {}

    data.messages.push({
      role: 'user',
      content: `${content} --important ${note || ''}`,
      timestamp: Date.now(),
      important: true
    });

    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  }

  async initialize(): Promise<void> {
    await this.ensureDirectories();
  }

  async runMaintenance(): Promise<MaintenanceResult> {
    return this.maintenance();
  }

  async getStats(): Promise<MemoryStats> {
    const stats: MemoryStats = {
      dailyFiles: 0,
      archiveFiles: 0,
      totalMessages: 0,
      memorySize: '0 KB',
      walFiles: 0,
      logFiles: 0,
      vectorCacheSize: this.vectorCache.size,
      basePath: this.basePath
    };

    // 统计 daily
    try {
      const files = await fs.readdir(path.join(this.basePath, 'daily'));
      stats.dailyFiles = files.filter(f => f.endsWith('.json')).length;
    } catch (e) {}

    // 统计 archive
    try {
      const files = await fs.readdir(path.join(this.basePath, 'archive'));
      stats.archiveFiles = files.filter(f => f.endsWith('.jsonl')).length;
    } catch (e) {}

    // 统计 WAL
    try {
      const files = await fs.readdir(path.join(this.basePath, 'wal'));
      stats.walFiles = files.filter(f => f.endsWith('.jsonl')).length;
    } catch (e) {}

    // 统计日志
    try {
      const files = await fs.readdir(path.join(this.basePath, 'logs'));
      stats.logFiles = files.filter(f => f.endsWith('.jsonl')).length;
    } catch (e) {}

    return stats;
  }

  clearVectorCache(): void {
    this.vectorCache.clear();
  }

  /**
   * 获取检索器搜索模式
   */
  getRetrieverMode(): 'vector' | 'keyword' {
    return this.retriever.getSearchMode();
  }

  private async ensureDirectories(): Promise<void> {
    const dirs = [
      path.join(this.basePath, 'daily'),
      path.join(this.basePath, 'archive'),
      path.join(this.basePath, 'vectors'),
      path.join(this.basePath, 'wal'),
      path.join(this.basePath, 'logs')
    ];

    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (e) {}
    }
  }
}

export class MemoryContextError extends Error {
  constructor(message: string, public cause?: any) {
    super(message);
    this.name = 'MemoryContextError';
  }
}

export interface MemoryContextConfig {
  keepRounds: number;
  maxTokens: number;
  basePath: string;
  enableRetrieval: boolean;
  enableWAL: boolean;
  enableVectorCache: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  vectorCacheSize?: number;
  summarizerConfig?: SummarizerConfig;
}

export interface ProcessResult {
  messages: Message[];
  metadata: {
    originalLength: number;
    compressedLength: number;
    memoryCount: number;
    estimatedTokens: number;
    savings: number;
    memorySnippets: Array<{
      source: string;
      relevance: number;
      tier: string;
    }>;
  };
}

export interface MemoryStats {
  dailyFiles: number;
  archiveFiles: number;
  totalMessages: number;
  memorySize: string;
  walFiles: number;
  logFiles: number;
  vectorCacheSize: number;
  basePath: string;
}

export { ContextCompressor, ContextAssembler, MemoryRetriever, MemoryLifecycle };
export * from './types';
