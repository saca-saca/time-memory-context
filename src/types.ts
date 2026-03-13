/**
 * 类型定义
 */

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp?: number;
  metadata?: Record<string, any>;
}

export interface CompressedContext {
  context: Message[];          // 保留的最近对话
  summary: string | null;      // 老对话摘要
  memoryCandidates: Message[]; // 候选记忆
  originalLength: number;
  compressedLength: number;
}

export interface MemorySnippet {
  source: string;              // 来源：文件路径或日期
  content: string;
  relevance: number;           // 0-1 相关度
  tier: 'short' | 'medium' | 'long';
  timestamp?: number;
}

export interface ContentValue {
  type: 'fact' | 'preference' | 'task' | 'conversation' | 'noise';
  importance: number;          // 0-1
  ttl: number;                 // 建议保留天数
  reason?: string;
}

export interface MemoryTierConfig {
  days: number;
  compression: 'none' | 'clean' | 'archive';
  cleanRules?: {
    minImportance: number;
    keepTasks: boolean;
    keepPreferences: boolean;
    keepDecisions: boolean;
  };
}

export interface ArchiveEntry {
  date: string;
  summary: string;
  keyFacts: string[];
  messageCount: number;
  archivedAt: string;
}

export interface DayFile {
  date: string;
  path: string;
  read(): Promise<any>;
  write(content: any): Promise<void>;
}

export interface RetrievalConfig {
  shortTermEnabled: boolean;
  mediumTermEnabled: boolean;
  longTermEnabled: boolean;
  topK: number;
  similarityThreshold: number;
}

/**
 * 摘要生成配置
 */
export interface SummarizerConfig {
  provider: 'openclaw' | 'openai' | 'custom';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxLength?: number;
}
